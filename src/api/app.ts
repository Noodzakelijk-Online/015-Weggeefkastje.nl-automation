import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import compression from 'compression';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../config.js';
import { AppDatabase, type SessionContext } from '../db/appDatabase.js';
import { createItemSchema, ITEM_STATUSES, updateItemSchema, workflowActionSchema, type WorkspaceRole } from '../domain/exchange.js';
import {
  caretakerUpdateSchema,
  publicReportSchema,
  sourceRegistrationSchema,
  sourceUpdateSchema,
  type ResidentLocation,
} from '../domain/residentLocation.js';
import { buildHaiFeed, haiRequestAuthorized } from '../integrations/haiFeed.js';
import { buildGoogleMapsDirectionsUrl } from '../app/navigation.js';
import { createPdokAddressVerifier, type AddressVerifier } from '../integrations/pdokAddress.js';
import { applyCaretakerChange } from '../services/residentCatalog.js';

const SESSION_COOKIE = 'wk_session';

declare module 'express-serve-static-core' {
  interface Locals {
    requestId: string;
    session?: SessionContext;
  }
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map((part) => {
    const [name, ...rest] = part.trim().split('=');
    return [name, decodeURIComponent(rest.join('='))];
  }));
}

function ok(res: Response, data: unknown, status = 200, meta?: Record<string, unknown>): void {
  res.status(status).json({ data, ...(meta ? { meta } : {}) });
}

function requireAuth(database: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = token ? database.getSession(token) : undefined;
    if (!session) return next(new ApiError(401, 'AUTH_REQUIRED', 'Log in om door te gaan.'));
    res.locals.session = session;
    next();
  };
}

function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-csrf-token') !== res.locals.session?.csrfToken) {
    return next(new ApiError(403, 'CSRF_INVALID', 'De beveiligingstoken ontbreekt of is verlopen. Vernieuw de pagina en probeer opnieuw.'));
  }
  next();
}

function requireRole(...roles: WorkspaceRole[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!res.locals.session || !roles.includes(res.locals.session.role)) return next(new ApiError(403, 'FORBIDDEN', 'Je hebt geen toestemming voor deze actie.'));
    next();
  };
}

function session(res: Response): SessionContext {
  if (!res.locals.session) throw new ApiError(401, 'AUTH_REQUIRED', 'Log in om door te gaan.');
  return res.locals.session;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Onbekende fout.';
}

function isLoopback(ip: string | undefined): boolean {
  return Boolean(ip && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'));
}

const setupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(2).max(120),
  workspaceName: z.string().trim().min(2).max(120),
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const copySchema = z.object({ idempotencyKey: z.string().trim().min(8).max(120) });
const safetyStopSchema = z.object({ enabled: z.boolean() });
const caretakerLinkSchema = z.object({ expiresInDays: z.number().int().min(1).max(365).default(180) });
const updateRequestResolutionSchema = z.object({ status: z.enum(['resolved', 'dismissed']) });

export interface CreateAppDependencies {
  addressVerifier?: AddressVerifier;
}

function publicLocation(location: ResidentLocation): Record<string, unknown> {
  return {
    id: location.id,
    title: location.title,
    addressLine: location.addressLine,
    postalCode: location.postalCode,
    city: location.city,
    municipality: location.municipality,
    province: location.province,
    latitude: location.latitude,
    longitude: location.longitude,
    categories: location.categories,
    lastVerifiedAt: location.lastVerifiedAt,
    directionsUrl: buildGoogleMapsDirectionsUrl({
      title: location.title,
      addressHint: location.addressLine,
      city: location.city,
      latitude: location.latitude,
      longitude: location.longitude,
    }),
  };
}

function caretakerLocation(location: ResidentLocation): Record<string, unknown> {
  return {
    id: location.id,
    title: location.title,
    addressLine: location.addressLine,
    postalCode: location.postalCode,
    city: location.city,
    status: location.status,
    categories: location.categories,
    lastVerifiedAt: location.lastVerifiedAt,
  };
}

export function createApp(config: AppConfig, database: AppDatabase, dependencies: CreateAppDependencies = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('x-request-id', res.locals.requestId);
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }));
  app.use(rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Te veel verzoeken. Wacht even en probeer opnieuw.' } },
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });

  app.get('/health', (_req, res) => ok(res, { ok: true, service: 'weggeefkastje-automation', mode: config.mode }));
  app.get('/ready', (_req, res) => {
    const readiness = database.readiness();
    const ready = readiness.ok && !readiness.setupRequired;
    res.status(ready ? 200 : 503).json({ data: { ready, ...readiness } });
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  const publicLimiter = rateLimit({
    windowMs: 60_000,
    limit: Math.min(config.rateLimitPerMinute, 120),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Te veel verzoeken. Wacht even en probeer opnieuw.' } },
  });
  const publicWorkspaceId = (): string => {
    const workspaceId = database.resolvePublicWorkspaceId(config.publicWorkspaceId);
    if (!workspaceId) throw new ApiError(404, 'PUBLIC_LOCATOR_UNAVAILABLE', 'De bewonersvinder is nog niet beschikbaar.');
    return workspaceId;
  };
  const addressVerifier = dependencies.addressVerifier ?? createPdokAddressVerifier({
    baseUrl: config.addressVerification.baseUrl,
    timeoutMs: config.addressVerification.timeoutMs,
  });
  app.get('/api/setup/status', (_req, res) => ok(res, { setupRequired: !database.hasUsers(), demoMode: config.demoMode }));
  app.post('/api/setup', authLimiter, (req, res, next) => {
    try {
      if (!config.allowRemoteSetup && !isLoopback(req.ip)) {
        throw new ApiError(403, 'REMOTE_SETUP_DISABLED', 'Initial setup is alleen lokaal toegestaan. Rond de installatie af voordat je een tunnel opent.');
      }
      const input = setupSchema.parse(req.body);
      const created = database.bootstrapAdmin(input);
      const createdSession = database.createSession(created.userId, created.workspaceId, config.sessionTtlHours);
      res.cookie(SESSION_COOKIE, createdSession.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.secureCookies,
        path: '/',
        maxAge: config.sessionTtlHours * 60 * 60 * 1000,
      });
      ok(res, { session: createdSession.context, manualPostingOnly: true }, 201);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', authLimiter, (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const identity = database.authenticate(input.email, input.password);
      if (!identity) throw new ApiError(401, 'LOGIN_FAILED', 'E-mailadres of wachtwoord is onjuist.');
      const created = database.createSession(identity.userId, identity.workspaceId, config.sessionTtlHours);
      res.cookie(SESSION_COOKIE, created.token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: config.secureCookies,
        path: '/',
        maxAge: config.sessionTtlHours * 60 * 60 * 1000,
      });
      ok(res, { session: created.context, manualPostingOnly: true });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/status', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const current = token ? database.getSession(token) : undefined;
    ok(res, current ? { authenticated: true, session: current, manualPostingOnly: true, mode: config.mode } : { authenticated: false });
  });

  app.get('/api/integrations/hai/health', (req, res, next) => {
    if (!haiRequestAuthorized(req, config)) return next(new ApiError(401, 'HAI_AUTH_REQUIRED', 'Geldige HAI feed-toegang is vereist.'));
    ok(res, { ok: true, connector: 'json-feed', readOnly: true, projectKey: config.hai.projectKey });
  });
  app.get('/api/integrations/hai/feed', (req, res, next) => {
    try {
      if (!haiRequestAuthorized(req, config)) throw new ApiError(401, 'HAI_AUTH_REQUIRED', 'Geldige HAI feed-toegang is vereist.');
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.json(buildHaiFeed(database, config, req.query.cursor));
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      const message = safeErrorMessage(error);
      return next(new ApiError(message.startsWith('Invalid HAI feed cursor') ? 400 : 503, 'HAI_FEED_UNAVAILABLE', message));
    }
  });

  app.get('/api/public/locations', publicLimiter, (req, res, next) => {
    try {
      const result = database.listPublicResidentLocations(publicWorkspaceId(), {
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 25),
      });
      ok(res, { items: result.items.map(publicLocation), total: result.total, page: result.page, limit: result.limit });
    } catch (error) { next(error); }
  });
  app.get('/api/public/attributions', publicLimiter, (_req, res, next) => {
    try {
      ok(res, database.listPublicResidentAttributions(publicWorkspaceId()));
    } catch (error) { next(error); }
  });
  app.get('/api/public/locations/:id', publicLimiter, (req, res, next) => {
    try {
      const location = database.getPublicResidentLocation(publicWorkspaceId(), String(req.params.id));
      if (!location) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      ok(res, publicLocation(location));
    } catch (error) { next(error); }
  });
  app.post('/api/public/locations/:id/reports', publicLimiter, (req, res, next) => {
    try {
      const workspaceId = publicWorkspaceId();
      const location = database.getPublicResidentLocation(workspaceId, String(req.params.id));
      if (!location) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      const input = publicReportSchema.parse(req.body);
      database.queueLocationUpdateRequest(workspaceId, { locationId: location.id, requestType: 'public_report', reason: input.reason }, undefined, res.locals.requestId);
      ok(res, { received: true }, 202);
    } catch (error) { next(error); }
  });
  app.get('/api/public/caretaker/:token', publicLimiter, (req, res, next) => {
    try {
      const location = database.getCaretakerLocation(String(req.params.token));
      if (!location) throw new ApiError(404, 'CARETTAKER_LINK_NOT_FOUND', 'Deze beheerlink is niet beschikbaar.');
      ok(res, caretakerLocation(location));
    } catch (error) { next(error); }
  });
  app.post('/api/public/caretaker/:token', publicLimiter, async (req, res, next) => {
    try {
      const token = String(req.params.token);
      if (!database.getCaretakerLocation(token)) throw new ApiError(404, 'CARETTAKER_LINK_NOT_FOUND', 'Deze beheerlink is niet beschikbaar.');
      const input = caretakerUpdateSchema.parse(req.body);
      const location = await applyCaretakerChange({ database, verifier: addressVerifier }, token, input);
      if (!location) throw new ApiError(422, 'ADDRESS_NOT_VERIFIED', 'Dit adres kon niet als exact Nederlands adres worden bevestigd.');
      ok(res, caretakerLocation(location));
    } catch (error) { next(error); }
  });

  app.use('/api', requireAuth(database));
  app.get('/api/auth/me', (_req, res) => ok(res, { session: session(res), manualPostingOnly: true, mode: config.mode }));
  app.use('/api', requireCsrf);
  app.post('/api/auth/logout', (_req, res) => {
    const current = session(res);
    database.invalidateSession(current.sessionId, current);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    ok(res, { loggedOut: true });
  });

  app.get('/api/sources', (_req, res) => ok(res, database.listSources(session(res).workspaceId)));
  app.post('/api/sources', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const input = sourceRegistrationSchema.parse(req.body);
      if (database.getSourceByKey(current.workspaceId, input.key)) {
        throw new ApiError(409, 'SOURCE_KEY_EXISTS', 'Er bestaat al een bron met deze sleutel.');
      }
      ok(res, database.createSource(current.workspaceId, current.userId, input, res.locals.requestId), 201);
    } catch (error) { next(error); }
  });
  app.patch('/api/sources/:id', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const source = database.updateSource(current.workspaceId, current.userId, String(req.params.id), sourceUpdateSchema.parse(req.body), res.locals.requestId);
      if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', 'Bron niet gevonden.');
      ok(res, source);
    } catch (error) { next(error); }
  });

  app.get('/api/resident-locations', (req, res) => {
    const result = database.listResidentLocations(session(res).workspaceId, {
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      page: Number(req.query.page ?? 1),
      limit: Number(req.query.limit ?? 50),
      includeReview: req.query.includeReview !== 'false',
    });
    ok(res, result);
  });
  app.get('/api/resident-locations/:id/events', (req, res, next) => {
    try {
      const current = session(res);
      if (!database.getResidentLocation(current.workspaceId, String(req.params.id))) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      ok(res, database.listResidentLocationEvents(current.workspaceId, String(req.params.id)));
    } catch (error) { next(error); }
  });
  app.post('/api/resident-locations/:id/publish', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const location = database.publishResidentLocation(current.workspaceId, current.userId, String(req.params.id), res.locals.requestId);
      if (!location) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      ok(res, location);
    } catch (error) { next(error); }
  });
  app.get('/api/resident-locations/:id/caretaker-links', (req, res, next) => {
    try {
      const current = session(res);
      if (!database.getResidentLocation(current.workspaceId, String(req.params.id))) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      ok(res, database.listCaretakerLinks(current.workspaceId, String(req.params.id)));
    } catch (error) { next(error); }
  });
  app.post('/api/resident-locations/:id/caretaker-links', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const input = caretakerLinkSchema.parse(req.body);
      const link = database.createCaretakerLink(current.workspaceId, current.userId, String(req.params.id), input.expiresInDays, res.locals.requestId);
      if (!link) throw new ApiError(404, 'LOCATION_NOT_FOUND', 'Locatie niet gevonden.');
      const relativeUrl = `/kastje-bijwerken/${encodeURIComponent(link.token)}`;
      const url = config.baseUrl ? new URL(relativeUrl, config.baseUrl).toString() : relativeUrl;
      ok(res, { id: link.id, locationId: link.locationId, expiresAt: link.expiresAt, url }, 201);
    } catch (error) { next(error); }
  });
  app.delete('/api/caretaker-links/:id', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      if (!database.revokeCaretakerLink(current.workspaceId, current.userId, String(req.params.id), res.locals.requestId)) {
        throw new ApiError(404, 'CARETTAKER_LINK_NOT_FOUND', 'Beheerlink niet gevonden of al ingetrokken.');
      }
      ok(res, { revoked: true });
    } catch (error) { next(error); }
  });
  app.get('/api/location-update-requests', (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
      if (!['pending', 'resolved', 'dismissed'].includes(status)) throw new ApiError(400, 'INVALID_STATUS', 'Ongeldige verzoekstatus.');
      ok(res, database.listLocationUpdateRequests(session(res).workspaceId, status as 'pending' | 'resolved' | 'dismissed'));
    } catch (error) { next(error); }
  });
  app.post('/api/location-update-requests/:id/resolve', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const input = updateRequestResolutionSchema.parse(req.body);
      const updated = database.resolveLocationUpdateRequest(current.workspaceId, current.userId, String(req.params.id), input.status, res.locals.requestId);
      if (!updated) throw new ApiError(404, 'LOCATION_UPDATE_REQUEST_NOT_FOUND', 'Openstaand wijzigingsverzoek niet gevonden.');
      ok(res, updated);
    } catch (error) { next(error); }
  });

  app.get('/api/dashboard', (_req, res) => ok(res, database.dashboard(session(res).workspaceId)));
  app.get('/api/items', (req, res, next) => {
    try {
      const current = session(res);
      const requestedStatuses = typeof req.query.status === 'string' ? req.query.status.split(',').filter(Boolean) : [];
      if (requestedStatuses.some((value) => !ITEM_STATUSES.includes(value as any))) throw new ApiError(400, 'INVALID_STATUS', 'Een of meer statussen zijn ongeldig.');
      const result = database.listItems(current.workspaceId, {
        statuses: requestedStatuses as any,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        city: typeof req.query.city === 'string' ? req.query.city : undefined,
        query: typeof req.query.query === 'string' ? req.query.query : undefined,
        page: Number(req.query.page ?? 1),
        limit: Number(req.query.limit ?? 25),
        includeArchived: req.query.includeArchived === 'true',
      });
      ok(res, result.items, 200, { total: result.total, page: result.page, limit: result.limit });
    } catch (error) { next(error); }
  });
  app.post('/api/items', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const item = database.createItem(current.workspaceId, current.userId, createItemSchema.parse(req.body), res.locals.requestId);
      ok(res, item, 201);
    } catch (error) { next(error); }
  });
  app.get('/api/items/:id', (req, res, next) => {
    try {
      const detail = database.getItemDetail(session(res).workspaceId, String(req.params.id));
      if (!detail) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item niet gevonden.');
      ok(res, detail);
    } catch (error) { next(error); }
  });
  app.patch('/api/items/:id', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const detail = database.updateItem(current.workspaceId, current.userId, String(req.params.id), updateItemSchema.parse(req.body), res.locals.requestId);
      if (!detail) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item niet gevonden.');
      ok(res, detail);
    } catch (error) { next(error); }
  });
  app.delete('/api/items/:id', requireRole('owner'), (req, res, next) => {
    try {
      const current = session(res);
      if (!database.deleteItem(current.workspaceId, current.userId, String(req.params.id), res.locals.requestId)) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item niet gevonden.');
      ok(res, { deleted: true });
    } catch (error) { next(error); }
  });
  app.post('/api/items/:id/actions', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      const current = session(res);
      const detail = database.transitionItem(current.workspaceId, current.userId, String(req.params.id), workflowActionSchema.parse(req.body), res.locals.requestId);
      if (!detail) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item niet gevonden.');
      ok(res, detail);
    } catch (error) { next(error); }
  });
  app.post('/api/items/:id/message-package/copy', requireRole('owner', 'operator'), (req, res, next) => {
    try {
      copySchema.parse(req.body);
      const current = session(res);
      const detail = database.markMessageCopied(current.workspaceId, current.userId, String(req.params.id), res.locals.requestId);
      if (!detail) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Item niet gevonden.');
      ok(res, detail);
    } catch (error) { next(error); }
  });
  app.get('/api/review', (_req, res) => {
    const workspaceId = session(res).workspaceId;
    ok(res, { items: database.listReviewQueue(workspaceId), ambiguousMentions: database.listAmbiguousSocialMentions(workspaceId) });
  });
  app.get('/api/review/summary', (_req, res) => {
    const workspaceId = session(res).workspaceId;
    ok(res, { ambiguousMentions: database.countAmbiguousSocialMentions(workspaceId) });
  });
  app.post('/api/review/mentions/:id/dismiss', requireRole('owner', 'operator'), (req, res) => {
    const current = session(res);
    ok(res, { updated: database.dismissAmbiguousSocialMention(current.workspaceId, current.userId, String(req.params.id), res.locals.requestId) });
  });
  app.get('/api/notifications', (_req, res) => {
    const current = session(res);
    ok(res, database.listNotifications(current.workspaceId, current.userId));
  });
  app.post('/api/notifications/:id/read', (_req, res) => {
    const current = session(res);
    ok(res, { updated: database.markNotificationRead(current.workspaceId, current.userId, _req.params.id) });
  });
  app.get('/api/privacy/export', (_req, res) => ok(res, database.workspaceExport(session(res).workspaceId)));
  app.get('/api/settings', (_req, res) => ok(res, database.getSettings(session(res).workspaceId)));
  app.post('/api/operator/safety-stop', requireRole('owner'), (req, res, next) => {
    try {
      const current = session(res);
      const input = safetyStopSchema.parse(req.body);
      database.setSafetyStop(current.workspaceId, current.userId, input.enabled, res.locals.requestId);
      ok(res, { safetyStop: input.enabled });
    } catch (error) { next(error); }
  });
  app.get('/api/operator/diagnostics', requireRole('owner', 'operator'), (_req, res) => ok(res, {
    ...database.diagnostics(),
    providers: {
      facebook: config.provider.facebookConfigured ? 'configured_unverified' : 'not_configured',
      nextdoor: config.provider.nextdoorExportPath ? 'approved_export_configured' : 'not_configured',
      externalPosting: 'manual_only',
    },
    mode: config.mode,
    demoMode: config.demoMode,
  }));

  if (existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath, { index: false, fallthrough: true, maxAge: config.mode === 'production' ? '1h' : 0 }));
    app.get(/^(?!\/api|\/health|\/ready).*/, (_req, res) => res.sendFile(join(config.webDistPath, 'index.html')));
  }

  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route niet gevonden.')));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    const requestId = res.locals.requestId;
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details, requestId } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Controleer de ingevoerde gegevens.', details: error.flatten(), requestId } });
      return;
    }
    const message = safeErrorMessage(error);
    const conflict = message.includes('another session') || message.includes('Idempotency key');
    const invalidState = message.includes('not allowed') || message.includes('can no longer') || message.includes('Copy the reviewed') || message.includes('only be copied');
    const status = conflict ? 409 : invalidState ? 422 : 500;
    res.status(status).json({
      error: {
        code: conflict ? 'CONFLICT' : invalidState ? 'INVALID_STATE' : 'INTERNAL_ERROR',
        message: status === 500 ? 'Er ging iets mis. Probeer opnieuw of bekijk de diagnose.' : message,
        requestId,
      },
    });
  });
  return app;
}
