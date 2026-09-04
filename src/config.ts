import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';

const optionalString = (schema: z.ZodString = z.string()) => z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  schema.optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_DATA_DIR: z.string().default('data'),
  DATABASE_PATH: z.string().optional(),
  WEB_DIST_PATH: z.string().default('dist-web'),
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(720).default(24),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(1000).default(120),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  ALLOW_NETWORK_BINDING: z.enum(['true', 'false']).default('false'),
  ALLOW_REMOTE_SETUP: z.enum(['true', 'false']).default('false'),
  APP_BASE_URL: optionalString(z.string().url()),
  PUBLIC_WORKSPACE_ID: optionalString(z.string().uuid()),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  ENABLE_DEMO_MODE: z.enum(['true', 'false']).default('false'),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  PDOK_LOCATIESERVER_BASE_URL: z.string().url().default('https://api.pdok.nl'),
  PDOK_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(5_000),
  FACEBOOK_GRAPH_ACCESS_TOKEN: optionalString(),
  FACEBOOK_GRAPH_API_VERSION: optionalString(z.string().regex(/^v\d+\.\d+$/)),
  FACEBOOK_PAGE_CONTEXTS_JSON: z.string().default('[]'),
  NEXTDOOR_APPROVED_EXPORT_PATH: optionalString(),
  BUURTKASTJESKAART_EXPORT_PATH: optionalString(),
  OSM_OVERPASS_URL: optionalString(z.string().url()),
  OSM_PILOT_BBOX: optionalString(z.string().regex(/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/)),
  HAI_FEED_TOKEN: optionalString(z.string().min(32)),
  HAI_WORKSPACE_ID: optionalString(z.string().uuid()),
  HAI_PROJECT_KEY: z.string().trim().min(1).max(120).default('015-Weggeefkastje'),
});

export interface AppConfig {
  mode: 'development' | 'test' | 'production';
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  webDistPath: string;
  sessionTtlHours: number;
  rateLimitPerMinute: number;
  trustProxy: boolean;
  allowNetworkBinding: boolean;
  allowRemoteSetup: boolean;
  baseUrl?: string;
  publicWorkspaceId?: string;
  secureCookies: boolean;
  demoMode: boolean;
  workerPollMs: number;
  addressVerification: {
    baseUrl: string;
    timeoutMs: number;
  };
  hai: {
    enabled: boolean;
    feedToken?: string;
    workspaceId?: string;
    projectKey: string;
  };
  provider: {
    facebookConfigured: boolean;
    facebookAccessToken?: string;
    facebookApiVersion?: string;
    facebookPageContextsJson: string;
    nextdoorExportPath?: string;
    buurtkastjeskaartExportPath?: string;
    openStreetMapConfigured: boolean;
    openStreetMapOverpassUrl?: string;
    openStreetMapPilotBoundingBox?: string;
  };
}

export function resolveWithin(base: string, candidate: string): string {
  const absoluteBase = resolve(base);
  const absoluteCandidate = isAbsolute(candidate) ? resolve(candidate) : resolve(absoluteBase, candidate);
  const pathFromBase = relative(absoluteBase, absoluteCandidate);
  if (pathFromBase.startsWith('..') || isAbsolute(pathFromBase)) throw new Error(`Path must remain inside ${absoluteBase}.`);
  return absoluteCandidate;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = envSchema.parse(env);
  const dataDir = isAbsolute(parsed.APP_DATA_DIR) ? resolve(parsed.APP_DATA_DIR) : resolve(cwd, parsed.APP_DATA_DIR);
  const configuredDatabasePath = parsed.DATABASE_PATH
    ? (isAbsolute(parsed.DATABASE_PATH) ? parsed.DATABASE_PATH : resolve(cwd, parsed.DATABASE_PATH))
    : undefined;
  const databasePath = configuredDatabasePath
    ? resolveWithin(dataDir, configuredDatabasePath)
    : resolveWithin(dataDir, 'weggeefkastjes.sqlite');
  const nextdoorExportPath = parsed.NEXTDOOR_APPROVED_EXPORT_PATH
    ? resolveWithin(dataDir, isAbsolute(parsed.NEXTDOOR_APPROVED_EXPORT_PATH) ? parsed.NEXTDOOR_APPROVED_EXPORT_PATH : resolve(cwd, parsed.NEXTDOOR_APPROVED_EXPORT_PATH))
    : undefined;
  const buurtkastjeskaartExportPath = parsed.BUURTKASTJESKAART_EXPORT_PATH
    ? resolveWithin(dataDir, isAbsolute(parsed.BUURTKASTJESKAART_EXPORT_PATH) ? parsed.BUURTKASTJESKAART_EXPORT_PATH : resolve(cwd, parsed.BUURTKASTJESKAART_EXPORT_PATH))
    : undefined;
  const networkHost = !['127.0.0.1', 'localhost', '::1'].includes(parsed.HOST);
  const secureCookies = parsed.COOKIE_SECURE ? parsed.COOKIE_SECURE === 'true' : parsed.NODE_ENV === 'production' && networkHost;

  if (networkHost && parsed.ALLOW_NETWORK_BINDING !== 'true') {
    throw new Error('Network binding is disabled. Set ALLOW_NETWORK_BINDING=true only behind a trusted HTTPS reverse proxy.');
  }
  if (parsed.NODE_ENV === 'production') {
    if (parsed.ENABLE_DEMO_MODE === 'true') throw new Error('Demo mode is forbidden in production.');
    if (networkHost && (!parsed.APP_BASE_URL || !parsed.APP_BASE_URL.startsWith('https://'))) {
      throw new Error('Production network binding requires an HTTPS APP_BASE_URL.');
    }
    if (networkHost && !secureCookies) throw new Error('Secure cookies are required for production network binding.');
  }
  if (Boolean(parsed.FACEBOOK_GRAPH_ACCESS_TOKEN) !== Boolean(parsed.FACEBOOK_GRAPH_API_VERSION)) {
    throw new Error('Facebook access token and API version must be configured together.');
  }
  if (parsed.HAI_WORKSPACE_ID && !parsed.HAI_FEED_TOKEN) {
    throw new Error('HAI_WORKSPACE_ID requires HAI_FEED_TOKEN.');
  }
  if (Boolean(parsed.OSM_OVERPASS_URL) !== Boolean(parsed.OSM_PILOT_BBOX)) {
    throw new Error('OSM_OVERPASS_URL and OSM_PILOT_BBOX must be configured together.');
  }
  if (parsed.OSM_OVERPASS_URL && new URL(parsed.OSM_OVERPASS_URL).protocol !== 'https:') {
    throw new Error('OSM_OVERPASS_URL must use HTTPS.');
  }
  const pdokUrl = new URL(parsed.PDOK_LOCATIESERVER_BASE_URL);
  if (pdokUrl.protocol !== 'https:' || pdokUrl.hostname !== 'api.pdok.nl') {
    throw new Error('PDOK_LOCATIESERVER_BASE_URL must use the official HTTPS api.pdok.nl host.');
  }

  return {
    mode: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    dataDir,
    databasePath,
    webDistPath: isAbsolute(parsed.WEB_DIST_PATH) ? resolve(parsed.WEB_DIST_PATH) : resolve(cwd, parsed.WEB_DIST_PATH),
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    rateLimitPerMinute: parsed.RATE_LIMIT_PER_MINUTE,
    trustProxy: parsed.TRUST_PROXY === 'true',
    allowNetworkBinding: parsed.ALLOW_NETWORK_BINDING === 'true',
    allowRemoteSetup: parsed.ALLOW_REMOTE_SETUP === 'true',
    baseUrl: parsed.APP_BASE_URL,
    publicWorkspaceId: parsed.PUBLIC_WORKSPACE_ID,
    secureCookies,
    demoMode: parsed.ENABLE_DEMO_MODE === 'true',
    workerPollMs: parsed.WORKER_POLL_MS,
    addressVerification: {
      baseUrl: pdokUrl.origin,
      timeoutMs: parsed.PDOK_TIMEOUT_MS,
    },
    hai: {
      enabled: Boolean(parsed.HAI_FEED_TOKEN),
      feedToken: parsed.HAI_FEED_TOKEN,
      workspaceId: parsed.HAI_WORKSPACE_ID,
      projectKey: parsed.HAI_PROJECT_KEY,
    },
    provider: {
      facebookConfigured: Boolean(parsed.FACEBOOK_GRAPH_ACCESS_TOKEN && parsed.FACEBOOK_GRAPH_API_VERSION),
      facebookAccessToken: parsed.FACEBOOK_GRAPH_ACCESS_TOKEN,
      facebookApiVersion: parsed.FACEBOOK_GRAPH_API_VERSION,
      facebookPageContextsJson: parsed.FACEBOOK_PAGE_CONTEXTS_JSON,
      nextdoorExportPath,
      buurtkastjeskaartExportPath,
      openStreetMapConfigured: Boolean(parsed.OSM_OVERPASS_URL && parsed.OSM_PILOT_BBOX),
      openStreetMapOverpassUrl: parsed.OSM_OVERPASS_URL,
      openStreetMapPilotBoundingBox: parsed.OSM_PILOT_BBOX,
    },
  };
}

export function publicConfig(config: AppConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
    databasePath: config.databasePath,
    webDistPath: config.webDistPath,
    secureCookies: config.secureCookies,
    demoMode: config.demoMode,
    addressVerification: { provider: 'pdok' },
    haiFeedConfigured: config.hai.enabled,
    publicWorkspaceConfigured: Boolean(config.publicWorkspaceId),
    providers: {
      facebookConfigured: config.provider.facebookConfigured,
      nextdoorExportConfigured: Boolean(config.provider.nextdoorExportPath),
      openStreetMapConfigured: config.provider.openStreetMapConfigured,
    },
  };
}
