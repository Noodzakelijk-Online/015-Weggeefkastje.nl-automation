import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createCsrfToken, createSessionToken, hashPassword, hashSessionToken, verifyPassword } from '../auth/password.js';
import {
  availableActions,
  nextStatus,
  type ExchangeItem,
  type ItemStatus,
  type PlatformTarget,
  type WorkflowAction,
  type WorkspaceRole,
} from '../domain/exchange.js';
import { evaluateRules, hasBlockingRuleFailure, type RuleResult } from '../domain/rules.js';
import { generateMessagePackage } from '../domain/messagePackage.js';
import {
  sourceRegistrationSchema,
  type CaretakerUpdateInput,
  type LocationUpdateRequest,
  type ResidentCandidate,
  type ResidentLocation,
  type ResidentLocationEvent,
  type SourceRegistryRecord,
  type SourceRegistrationInput,
  type SourceUpdateInput,
  type VerifiedAddress,
} from '../domain/residentLocation.js';
import { normaliseKey } from '../core/normalise.js';
import { migrationStatus, runMigrations } from './migrations.js';

export interface SessionContext {
  sessionId: string;
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
  workspaceName: string;
  role: WorkspaceRole;
  csrfToken: string;
  expiresAt: string;
}

export interface CreateSessionResult {
  token: string;
  context: SessionContext;
}

export interface ItemListRequest {
  status?: ItemStatus;
  statuses?: ItemStatus[];
  source?: string;
  city?: string;
  query?: string;
  page?: number;
  limit?: number;
  includeArchived?: boolean;
}

export interface ItemListResult {
  items: ExchangeItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ItemDetail {
  item: ExchangeItem;
  evidence: Array<Record<string, unknown>>;
  latestRules?: { results: RuleResult[]; blockingFailures: number; createdAt: string };
  messagePackage?: Record<string, unknown>;
  coordination: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  availableActions: WorkflowAction[];
}

export interface WorkflowRequest {
  action: WorkflowAction;
  idempotencyKey: string;
  notes?: string;
  scheduledAt?: string;
  externalUrl?: string;
}

export interface CreateExchangeItemInput {
  title: string;
  description: string;
  category: string;
  platformTarget: PlatformTarget;
  sourceKind: string;
  sourceName: string;
  sourceLink?: string;
  city: string;
  addressHint?: string;
  latitude?: number;
  longitude?: number;
  confidence: number;
  pickupNotes?: string;
  contactMethod: 'platform' | 'email' | 'phone' | 'other';
  privacyLevel: 'public' | 'approximate' | 'private';
}

export interface JobRecord {
  id: string;
  workspaceId?: string;
  jobType: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  idempotencyKey: string;
}

export interface AmbiguousSocialMentionInput {
  platform: string;
  sourceName: string;
  sourceLink?: string;
  summary: string;
  reason: string;
  observedAt: string;
}

export interface ResidentLocationListRequest {
  query?: string;
  page?: number;
  limit?: number;
  includeReview?: boolean;
}

export interface ResidentLocationListResult {
  items: ResidentLocation[];
  total: number;
  page: number;
  limit: number;
}

export interface QueueLocationUpdateRequestInput {
  locationId?: string;
  sourceRegistryId?: string;
  requestType: LocationUpdateRequest['requestType'];
  reason: string;
  candidate?: Partial<ResidentCandidate>;
}

export interface CaretakerLink {
  id: string;
  locationId: string;
  token: string;
  expiresAt: string;
}

export interface CaretakerLinkRecord {
  id: string;
  locationId: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapItem(row: any): ExchangeItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    category: row.category,
    platformTarget: row.platform_target,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    sourceLink: row.source_link ?? undefined,
    city: row.city,
    addressHint: row.address_hint ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    confidence: row.confidence,
    status: row.status,
    needsReview: row.needs_review === 1,
    privacyLevel: row.privacy_level,
    pickupNotes: row.pickup_notes ?? undefined,
    contactMethod: row.contact_method,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
  };
}

function mapSource(row: any): SourceRegistryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.source_key,
    name: row.name,
    accessMode: row.access_mode,
    authorizationReference: row.authorization_reference,
    attribution: row.attribution,
    publicationMode: row.publication_mode,
    enabled: row.enabled === 1,
    allowsExactAddress: row.allows_exact_address === 1,
    lastCheckedAt: row.last_checked_at ?? undefined,
    lastStatus: row.last_status ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResidentLocation(row: any): ResidentLocation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    addressKey: row.address_key,
    title: row.title,
    addressLine: row.address_line,
    postalCode: row.postal_code,
    city: row.city,
    municipality: row.municipality ?? undefined,
    province: row.province ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    publicationStatus: row.publication_status,
    categories: parseJson<string[]>(row.categories_json, []),
    addressVerifiedAt: row.address_verified_at,
    lastVerifiedAt: row.last_verified_at,
    lastObservedAt: row.last_observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResidentLocationEvent(row: any): ResidentLocationEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    locationId: row.location_id,
    action: row.action,
    actorType: row.actor_type,
    sourceRegistryId: row.source_registry_id ?? undefined,
    requestId: row.request_id ?? undefined,
    before: parseJson<Record<string, unknown>>(row.before_json, {}),
    after: parseJson<Record<string, unknown>>(row.after_json, {}),
    createdAt: row.created_at,
  };
}

function mapLocationUpdateRequest(row: any): LocationUpdateRequest {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    locationId: row.location_id ?? undefined,
    requestType: row.request_type,
    status: row.status,
    reason: row.reason,
    candidate: parseJson<Partial<ResidentCandidate>>(row.candidate_json, {}),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function residentAddressKey(address: Pick<VerifiedAddress, 'addressLine' | 'postalCode' | 'city'>): string {
  return [normaliseKey(address.addressLine), normaliseKey(address.postalCode), normaliseKey(address.city)].join('::');
}

function residentEvidenceHash(source: SourceRegistryRecord, candidate: ResidentCandidate): string {
  return createHash('sha256')
    .update([source.id, candidate.sourceRecordId ?? '', candidate.sourceLink ?? '', candidate.observedAt, candidate.evidenceSummary].join('|'))
    .digest('hex');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function mapSession(row: any): SessionContext {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    workspaceName: row.workspace_name,
    role: row.role,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
  };
}

function evidenceHash(input: CreateExchangeItemInput): string {
  return createHash('sha256')
    .update([input.sourceKind, input.sourceName, input.sourceLink ?? '', input.title, input.description, input.city, input.addressHint ?? ''].join('|'))
    .digest('hex');
}

export class AppDatabase {
  readonly db: Database.Database;
  readonly migrationResult: { applied: number[]; currentVersion: number };

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.migrationResult = runMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  async backupTo(destination: string): Promise<void> {
    mkdirSync(dirname(destination), { recursive: true });
    await this.db.backup(destination);
  }

  hasUsers(): boolean {
    return (this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count > 0;
  }

  bootstrapAdmin(input: { email: string; password: string; displayName: string; workspaceName: string }): { userId: string; workspaceId: string } {
    if (this.hasUsers()) throw new Error('Initial setup has already been completed.');
    if (input.password.length < 12) throw new Error('Password must contain at least 12 characters.');
    const now = new Date().toISOString();
    const userId = randomUUID();
    const workspaceId = randomUUID();

    this.db.transaction(() => {
      this.db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(workspaceId, input.workspaceName.trim(), now, now);
      this.db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, input.email.trim().toLowerCase(), input.displayName.trim(), hashPassword(input.password), now);
      this.db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
        .run(workspaceId, userId, 'owner', now);
      this.db.prepare('INSERT INTO workspace_settings (workspace_id, updated_at) VALUES (?, ?)').run(workspaceId, now);
      for (const flag of ['social_intake', 'notifications', 'local_analytics']) {
        this.db.prepare('INSERT INTO feature_flags (workspace_id, flag_key, enabled, updated_at) VALUES (?, ?, 1, ?)')
          .run(workspaceId, flag, now);
      }
      this.audit({ workspaceId, actorUserId: userId, action: 'workspace.bootstrap', resourceType: 'workspace', resourceId: workspaceId });
    })();
    return { userId, workspaceId };
  }

  authenticate(email: string, password: string): { userId: string; workspaceId: string } | undefined {
    const row = this.db.prepare(`
      SELECT u.id AS user_id, u.password_hash, wm.workspace_id
      FROM users u JOIN workspace_members wm ON wm.user_id = u.id
      WHERE u.email = ? COLLATE NOCASE AND u.disabled_at IS NULL
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END LIMIT 1
    `).get(email.trim()) as any | undefined;
    if (!row || !verifyPassword(password, row.password_hash)) return undefined;
    return { userId: row.user_id, workspaceId: row.workspace_id };
  }

  createSession(userId: string, workspaceId: string, ttlHours: number): CreateSessionResult {
    const { token, hash } = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO sessions (id, user_id, workspace_id, token_hash, csrf_token, expires_at, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, workspaceId, hash, createCsrfToken(), expiresAt, now.toISOString(), now.toISOString());
    const context = this.getSession(token);
    if (!context) throw new Error('Could not create session.');
    this.audit({ workspaceId, actorUserId: userId, action: 'auth.login', resourceType: 'session', resourceId: id });
    return { token, context };
  }

  getSession(token: string): SessionContext | undefined {
    const now = new Date();
    const row = this.db.prepare(`
      SELECT s.id AS session_id, s.user_id, s.workspace_id, s.csrf_token, s.expires_at, s.last_seen_at,
             u.email, u.display_name, w.name AS workspace_name, wm.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id AND u.disabled_at IS NULL
      JOIN workspaces w ON w.id = s.workspace_id
      JOIN workspace_members wm ON wm.user_id = s.user_id AND wm.workspace_id = s.workspace_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashSessionToken(token), now.toISOString()) as any | undefined;
    if (!row) return undefined;
    if (now.getTime() - new Date(row.last_seen_at).getTime() >= 5 * 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), row.session_id);
    }
    return mapSession(row);
  }

  invalidateSession(sessionId: string, context?: Pick<SessionContext, 'workspaceId' | 'userId'>): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    if (context) this.audit({ workspaceId: context.workspaceId, actorUserId: context.userId, action: 'auth.logout', resourceType: 'session', resourceId: sessionId });
  }

  cleanupExpiredSessions(): number {
    return this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()).changes;
  }

  createItem(workspaceId: string, ownerUserId: string, input: CreateExchangeItemInput, requestId?: string): ItemDetail {
    const intakeHash = evidenceHash(input);
    const existing = this.db.prepare('SELECT item_id FROM item_evidence WHERE workspace_id = ? AND evidence_hash = ?').get(workspaceId, intakeHash) as { item_id: string } | undefined;
    if (existing) {
      this.audit({ workspaceId, actorUserId: ownerUserId, action: 'item.duplicate_ignored', resourceType: 'exchange_item', resourceId: existing.item_id, requestId, details: { evidenceHash: intakeHash } });
      return this.getItemDetail(workspaceId, existing.item_id)!;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO exchange_items (
          id, workspace_id, owner_user_id, title, description, category, platform_target,
          source_kind, source_name, source_link, city, address_hint, latitude, longitude,
          confidence, status, needs_review, privacy_level, pickup_notes, contact_method,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, 1, ?, ?)
      `).run(
        id, workspaceId, ownerUserId, input.title, input.description, input.category, input.platformTarget,
        input.sourceKind, input.sourceName, input.sourceLink ?? null, input.city, input.addressHint ?? null,
        input.latitude ?? null, input.longitude ?? null, input.confidence, input.privacyLevel,
        input.pickupNotes ?? null, input.contactMethod, now, now,
      );
      this.db.prepare(`
        INSERT INTO item_evidence (id, workspace_id, item_id, source_kind, source_name, source_link, summary, observed_at, evidence_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), workspaceId, id, input.sourceKind, input.sourceName, input.sourceLink ?? null, input.description.slice(0, 1000), now, intakeHash, now);
      this.audit({ workspaceId, actorUserId: ownerUserId, action: 'item.created', resourceType: 'exchange_item', resourceId: id, requestId, details: { sourceKind: input.sourceKind } });
      this.analytics(workspaceId, 'item_created', { sourceKind: input.sourceKind, platform: input.platformTarget });
    })();
    return this.getItemDetail(workspaceId, id)!;
  }

  hasItemEvidence(workspaceId: string, input: CreateExchangeItemInput): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM item_evidence WHERE workspace_id = ? AND evidence_hash = ?')
      .get(workspaceId, evidenceHash(input)));
  }

  listItems(workspaceId: string, request: ItemListRequest = {}): ItemListResult {
    const page = Math.max(1, request.page ?? 1);
    const limit = Math.min(100, Math.max(1, request.limit ?? 25));
    const clauses = ['workspace_id = ?'];
    const parameters: unknown[] = [workspaceId];
    if (request.status) { clauses.push('status = ?'); parameters.push(request.status); }
    if (request.statuses?.length) {
      clauses.push(`status IN (${request.statuses.map(() => '?').join(',')})`);
      parameters.push(...request.statuses);
    }
    if (request.source) { clauses.push('source_kind = ?'); parameters.push(request.source); }
    if (request.city) { clauses.push('city = ? COLLATE NOCASE'); parameters.push(request.city); }
    if (request.query) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
      const query = `%${request.query.replace(/[%_]/g, '\\$&')}%`;
      parameters.push(query, query, query);
    }
    if (!request.includeArchived) clauses.push("status <> 'archived'");
    const where = clauses.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM exchange_items WHERE ${where}`).get(...parameters) as { count: number }).count;
    const rows = this.db.prepare(`SELECT * FROM exchange_items WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...parameters, limit, (page - 1) * limit);
    return { items: rows.map(mapItem), total, page, limit };
  }

  getItem(workspaceId: string, id: string): ExchangeItem | undefined {
    const row = this.db.prepare('SELECT * FROM exchange_items WHERE workspace_id = ? AND id = ?').get(workspaceId, id);
    return row ? mapItem(row) : undefined;
  }

  getItemDetail(workspaceId: string, id: string): ItemDetail | undefined {
    const item = this.getItem(workspaceId, id);
    if (!item) return undefined;
    const evidence = (this.db.prepare('SELECT source_kind AS sourceKind, source_name AS sourceName, source_link AS sourceLink, summary, observed_at AS observedAt FROM item_evidence WHERE workspace_id = ? AND item_id = ? ORDER BY observed_at DESC').all(workspaceId, id) as Array<Record<string, unknown>>);
    const ruleRow = this.db.prepare('SELECT results_json, blocking_failures, created_at FROM rule_evaluations WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC LIMIT 1').get(workspaceId, id) as any | undefined;
    const packageRow = this.db.prepare('SELECT id, platform, subject, body, status, external_url AS externalUrl, approved_at AS approvedAt, copied_at AS copiedAt, posted_at AS postedAt, updated_at AS updatedAt FROM message_packages WHERE workspace_id = ? AND item_id = ? ORDER BY updated_at DESC LIMIT 1').get(workspaceId, id) as Record<string, unknown> | undefined;
    const coordination = this.db.prepare('SELECT id, event_type AS eventType, notes, scheduled_at AS scheduledAt, created_at AS createdAt FROM coordination_events WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC').all(workspaceId, id) as Array<Record<string, unknown>>;
    const history = (this.db.prepare('SELECT action, from_status AS fromStatus, to_status AS toStatus, details_json, created_at AS createdAt FROM workflow_events WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC').all(workspaceId, id) as any[])
      .map((row) => ({ ...row, details: parseJson(row.details_json, {}), details_json: undefined }));
    return {
      item,
      evidence,
      latestRules: ruleRow ? { results: parseJson(ruleRow.results_json, []), blockingFailures: ruleRow.blocking_failures, createdAt: ruleRow.created_at } : undefined,
      messagePackage: packageRow,
      coordination,
      history,
      availableActions: availableActions(item.status),
    };
  }

  updateItem(workspaceId: string, actorUserId: string, id: string, updates: Partial<CreateExchangeItemInput> & { version: number }, requestId?: string): ItemDetail | undefined {
    const existing = this.getItem(workspaceId, id);
    if (!existing) return undefined;
    if (!['draft', 'rules_review', 'human_review', 'ready_to_post'].includes(existing.status)) throw new Error('This item can no longer be edited in its current phase.');
    const next = { ...existing, ...updates };
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE exchange_items SET title = ?, description = ?, category = ?, platform_target = ?, source_kind = ?,
        source_name = ?, source_link = ?, city = ?, address_hint = ?, latitude = ?, longitude = ?, confidence = ?,
        privacy_level = ?, pickup_notes = ?, contact_method = ?, version = version + 1, updated_at = ?
      WHERE workspace_id = ? AND id = ? AND version = ?
    `).run(
      next.title, next.description, next.category, next.platformTarget, next.sourceKind, next.sourceName,
      next.sourceLink ?? null, next.city, next.addressHint ?? null, next.latitude ?? null, next.longitude ?? null,
      next.confidence, next.privacyLevel, next.pickupNotes ?? null, next.contactMethod, now, workspaceId, id, updates.version,
    );
    if (result.changes !== 1) throw new Error('The item changed in another session. Refresh and retry.');
    this.audit({ workspaceId, actorUserId, action: 'item.updated', resourceType: 'exchange_item', resourceId: id, requestId });
    return this.getItemDetail(workspaceId, id);
  }

  transitionItem(workspaceId: string, actorUserId: string, id: string, request: WorkflowRequest, requestId?: string): ItemDetail | undefined {
    const result = this.db.transaction(() => {
      const previousEvent = this.db.prepare('SELECT item_id FROM workflow_events WHERE workspace_id = ? AND idempotency_key = ?').get(workspaceId, request.idempotencyKey) as { item_id: string } | undefined;
      if (previousEvent) {
        if (previousEvent.item_id !== id) throw new Error('Idempotency key was already used for another item.');
        return this.getItemDetail(workspaceId, id);
      }

      const item = this.getItem(workspaceId, id);
      if (!item) return undefined;
      let target = nextStatus(item.status, request.action);
      const now = new Date().toISOString();

      if (request.action === 'submit') {
        const rules = evaluateRules(item);
        const blockingFailures = rules.filter((rule) => rule.severity === 'blocking' && !rule.passed).length;
        this.db.prepare('INSERT INTO rule_evaluations (id, workspace_id, item_id, results_json, blocking_failures, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), workspaceId, id, JSON.stringify(rules), blockingFailures, now);
        if (!hasBlockingRuleFailure(rules)) target = 'human_review';
      }

      if (request.action === 'approve') {
        const generated = generateMessagePackage(item);
        this.db.prepare(`
          INSERT INTO message_packages (id, workspace_id, item_id, platform, subject, body, content_hash, status, created_at, updated_at, approved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
          ON CONFLICT(workspace_id, item_id, content_hash) DO UPDATE SET status = 'approved', updated_at = excluded.updated_at, approved_at = excluded.approved_at
        `).run(randomUUID(), workspaceId, id, item.platformTarget, generated.subject, generated.body, generated.contentHash, now, now, now);
        this.db.prepare('INSERT INTO item_review_decisions (id, workspace_id, item_id, actor_user_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), workspaceId, id, actorUserId, 'approve', request.notes ?? null, now);
      }

      if (request.action === 'reject') {
        this.db.prepare('INSERT INTO item_review_decisions (id, workspace_id, item_id, actor_user_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), workspaceId, id, actorUserId, 'reject', request.notes ?? null, now);
      }

      if (request.action === 'mark_posted') {
        const message = this.db.prepare('SELECT id, copied_at FROM message_packages WHERE workspace_id = ? AND item_id = ? ORDER BY updated_at DESC LIMIT 1').get(workspaceId, id) as any | undefined;
        if (!message?.copied_at) throw new Error('Copy the reviewed message package before marking it as manually posted.');
        this.db.prepare("UPDATE message_packages SET status = 'posted', external_url = ?, posted_at = ?, updated_at = ? WHERE id = ?")
          .run(request.externalUrl ?? null, now, now, message.id);
      }

      const coordinationType: Partial<Record<WorkflowAction, string>> = {
        record_response: 'response_received',
        schedule_pickup: 'pickup_scheduled',
        complete_pickup: 'pickup_completed',
        cancel: 'cancelled',
      };
      if (coordinationType[request.action]) {
        this.db.prepare('INSERT INTO coordination_events (id, workspace_id, item_id, event_type, notes, scheduled_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), workspaceId, id, coordinationType[request.action], request.notes ?? null, request.scheduledAt ?? null, actorUserId, now);
      }

      const archivedAt = target === 'archived' ? now : null;
      const needsReview = target === 'human_review' || target === 'rules_review' ? 1 : 0;
      this.db.prepare('UPDATE exchange_items SET status = ?, needs_review = ?, archived_at = COALESCE(?, archived_at), version = version + 1, updated_at = ? WHERE workspace_id = ? AND id = ?')
        .run(target, needsReview, archivedAt, now, workspaceId, id);
      this.db.prepare('INSERT INTO workflow_events (id, workspace_id, item_id, actor_user_id, action, from_status, to_status, idempotency_key, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), workspaceId, id, actorUserId, request.action, item.status, target, request.idempotencyKey, JSON.stringify({ notes: request.notes, scheduledAt: request.scheduledAt, manual: request.action === 'mark_posted' }), now);
      this.audit({ workspaceId, actorUserId, action: `workflow.${request.action}`, resourceType: 'exchange_item', resourceId: id, requestId, details: { from: item.status, to: target } });
      this.analytics(workspaceId, 'workflow_transition', { action: request.action, from: item.status, to: target });
      this.maybeNotify(workspaceId, actorUserId, id, target);
      return this.getItemDetail(workspaceId, id);
    })();
    return result;
  }

  markMessageCopied(workspaceId: string, actorUserId: string, itemId: string, requestId?: string): ItemDetail | undefined {
    const item = this.getItem(workspaceId, itemId);
    if (!item) return undefined;
    if (item.status !== 'ready_to_post') throw new Error('Message packages can only be copied after review approval.');
    const now = new Date().toISOString();
    const result = this.db.prepare("UPDATE message_packages SET status = 'copied', copied_at = COALESCE(copied_at, ?), updated_at = ? WHERE workspace_id = ? AND item_id = ?")
      .run(now, now, workspaceId, itemId);
    if (result.changes < 1) throw new Error('No approved message package exists for this item.');
    this.audit({ workspaceId, actorUserId, action: 'message.copied', resourceType: 'exchange_item', resourceId: itemId, requestId, details: { externalStateChanged: false } });
    return this.getItemDetail(workspaceId, itemId);
  }

  deleteItem(workspaceId: string, actorUserId: string, itemId: string, requestId?: string): boolean {
    const item = this.getItem(workspaceId, itemId);
    if (!item) return false;
    this.db.transaction(() => {
      this.audit({ workspaceId, actorUserId, action: 'privacy.item_deleted', resourceType: 'exchange_item', resourceId: itemId, requestId, details: { titleHash: createHash('sha256').update(item.title).digest('hex') } });
      this.db.prepare('DELETE FROM exchange_items WHERE workspace_id = ? AND id = ?').run(workspaceId, itemId);
    })();
    return true;
  }

  createSource(workspaceId: string, actorUserId: string, input: SourceRegistrationInput, requestId?: string): SourceRegistryRecord {
    const source = sourceRegistrationSchema.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO source_registry (
        id, workspace_id, source_key, name, access_mode, authorization_reference, attribution,
        publication_mode, enabled, allows_exact_address, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, workspaceId, source.key, source.name, source.accessMode, source.authorizationReference, source.attribution,
      source.publicationMode, source.enabled ? 1 : 0, source.allowsExactAddress ? 1 : 0, now, now,
    );
    this.audit({ workspaceId, actorUserId, action: 'resident_source.created', resourceType: 'source_registry', resourceId: id, requestId, details: { key: source.key, publicationMode: source.publicationMode } });
    return this.getSource(workspaceId, id)!;
  }

  listSources(workspaceId: string): SourceRegistryRecord[] {
    return (this.db.prepare('SELECT * FROM source_registry WHERE workspace_id = ? ORDER BY name COLLATE NOCASE, id').all(workspaceId) as any[]).map(mapSource);
  }

  getSource(workspaceId: string, id: string): SourceRegistryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM source_registry WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as any | undefined;
    return row ? mapSource(row) : undefined;
  }

  getSourceByKey(workspaceId: string, key: string): SourceRegistryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM source_registry WHERE workspace_id = ? AND source_key = ?').get(workspaceId, key) as any | undefined;
    return row ? mapSource(row) : undefined;
  }

  updateSource(workspaceId: string, actorUserId: string, id: string, updates: SourceUpdateInput, requestId?: string): SourceRegistryRecord | undefined {
    const current = this.getSource(workspaceId, id);
    if (!current) return undefined;
    const next = sourceRegistrationSchema.parse({
      key: current.key,
      name: updates.name ?? current.name,
      accessMode: updates.accessMode ?? current.accessMode,
      authorizationReference: updates.authorizationReference ?? current.authorizationReference,
      attribution: updates.attribution ?? current.attribution,
      publicationMode: updates.publicationMode ?? current.publicationMode,
      enabled: updates.enabled ?? current.enabled,
      allowsExactAddress: updates.allowsExactAddress ?? current.allowsExactAddress,
    });
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE source_registry SET name = ?, access_mode = ?, authorization_reference = ?, attribution = ?,
        publication_mode = ?, enabled = ?, allows_exact_address = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(
      next.name, next.accessMode, next.authorizationReference, next.attribution,
      next.publicationMode, next.enabled ? 1 : 0, next.allowsExactAddress ? 1 : 0, now,
      workspaceId, id,
    );
    this.audit({ workspaceId, actorUserId, action: 'resident_source.updated', resourceType: 'source_registry', resourceId: id, requestId, details: { before: current.publicationMode, after: next.publicationMode } });
    return this.getSource(workspaceId, id);
  }

  recordSourceCheck(workspaceId: string, sourceId: string, status: string): void {
    this.db.prepare('UPDATE source_registry SET last_checked_at = ?, last_status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?')
      .run(new Date().toISOString(), status.slice(0, 120), new Date().toISOString(), workspaceId, sourceId);
  }

  upsertVerifiedResidentLocation(
    workspaceId: string,
    actorUserId: string | undefined,
    source: SourceRegistryRecord,
    candidate: ResidentCandidate,
    verified: VerifiedAddress,
    actorType: ResidentLocationEvent['actorType'] = 'operator',
    requestId?: string,
  ): ResidentLocation {
    if (source.workspaceId !== workspaceId) throw new Error('Source does not belong to this workspace.');
    if (!source.enabled || !source.allowsExactAddress) throw new Error('Source is not permitted to publish exact addresses.');
    const evidenceKey = residentEvidenceHash(source, candidate);
    const result = this.db.transaction(() => {
      const evidence = this.db.prepare('SELECT location_id FROM resident_location_evidence WHERE workspace_id = ? AND evidence_hash = ?')
        .get(workspaceId, evidenceKey) as { location_id: string } | undefined;
      if (evidence) return this.getResidentLocation(workspaceId, evidence.location_id)!;

      const addressKey = residentAddressKey(verified);
      const row = this.db.prepare('SELECT * FROM resident_locations WHERE workspace_id = ? AND address_key = ?').get(workspaceId, addressKey) as any | undefined;
      const current = row ? mapResidentLocation(row) : undefined;
      const canPublish = source.publicationMode === 'automatic' && candidate.status === 'active';
      const now = new Date().toISOString();
      const id = current?.id ?? randomUUID();
      const next = {
        id,
        workspaceId,
        addressKey,
        title: canPublish || !current ? candidate.title : current.title,
        addressLine: canPublish || !current ? verified.addressLine : current.addressLine,
        postalCode: canPublish || !current ? verified.postalCode : current.postalCode,
        city: canPublish || !current ? verified.city : current.city,
        municipality: canPublish || !current ? verified.municipality ?? null : current.municipality ?? null,
        province: canPublish || !current ? verified.province ?? null : current.province ?? null,
        latitude: canPublish || !current ? verified.latitude : current.latitude,
        longitude: canPublish || !current ? verified.longitude : current.longitude,
        status: canPublish ? 'active' : current?.status ?? candidate.status,
        publicationStatus: canPublish ? 'published' : current?.publicationStatus ?? 'review',
        categories: canPublish || !current ? candidate.categories : current.categories,
        addressVerifiedAt: canPublish || !current ? verified.verifiedAt : current.addressVerifiedAt,
        lastVerifiedAt: verified.verifiedAt,
        lastObservedAt: current && current.lastObservedAt > candidate.observedAt ? current.lastObservedAt : candidate.observedAt,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };

      if (current) {
        this.db.prepare(`
          UPDATE resident_locations SET title = ?, address_line = ?, postal_code = ?, city = ?, municipality = ?, province = ?,
            latitude = ?, longitude = ?, status = ?, publication_status = ?, categories_json = ?, address_verified_at = ?,
            last_verified_at = ?, last_observed_at = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(
          next.title, next.addressLine, next.postalCode, next.city, next.municipality, next.province,
          next.latitude, next.longitude, next.status, next.publicationStatus, JSON.stringify(next.categories), next.addressVerifiedAt,
          next.lastVerifiedAt, next.lastObservedAt, next.updatedAt, workspaceId, id,
        );
      } else {
        this.db.prepare(`
          INSERT INTO resident_locations (
            id, workspace_id, address_key, title, address_line, postal_code, city, municipality, province, latitude, longitude,
            status, publication_status, categories_json, address_verified_at, last_verified_at, last_observed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, workspaceId, next.addressKey, next.title, next.addressLine, next.postalCode, next.city, next.municipality, next.province,
          next.latitude, next.longitude, next.status, next.publicationStatus, JSON.stringify(next.categories), next.addressVerifiedAt,
          next.lastVerifiedAt, next.lastObservedAt, next.createdAt, next.updatedAt,
        );
      }

      this.db.prepare(`
        INSERT INTO resident_location_evidence (
          id, workspace_id, location_id, source_registry_id, source_record_id, source_link, summary, observed_at, evidence_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), workspaceId, id, source.id, candidate.sourceRecordId ?? null, candidate.sourceLink ?? null,
        candidate.evidenceSummary, candidate.observedAt, evidenceKey, now,
      );
      const location = this.getResidentLocation(workspaceId, id)!;
      const action = !current && canPublish ? 'location.published' : !current ? 'location.queued_for_review' : canPublish ? 'location.updated' : 'location.evidence_added';
      this.recordResidentLocationEvent({
        workspaceId,
        locationId: id,
        action,
        actorType,
        sourceRegistryId: source.id,
        requestId,
        before: current ? this.residentSnapshot(current) : {},
        after: this.residentSnapshot(location),
      });
      this.audit({ workspaceId, actorUserId, action: `resident_${action}`, resourceType: 'resident_location', resourceId: id, requestId, details: { sourceKey: source.key, publicationStatus: location.publicationStatus } });
      return location;
    })();
    return result;
  }

  findResidentLocationByEvidence(workspaceId: string, source: SourceRegistryRecord, candidate: ResidentCandidate): ResidentLocation | undefined {
    const row = this.db.prepare('SELECT location_id FROM resident_location_evidence WHERE workspace_id = ? AND evidence_hash = ?')
      .get(workspaceId, residentEvidenceHash(source, candidate)) as { location_id: string } | undefined;
    return row ? this.getResidentLocation(workspaceId, row.location_id) : undefined;
  }

  getResidentLocation(workspaceId: string, id: string): ResidentLocation | undefined {
    const row = this.db.prepare('SELECT * FROM resident_locations WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as any | undefined;
    return row ? mapResidentLocation(row) : undefined;
  }

  listResidentLocations(workspaceId: string, request: ResidentLocationListRequest = {}): ResidentLocationListResult {
    const page = Math.max(1, request.page ?? 1);
    const limit = Math.min(100, Math.max(1, request.limit ?? 25));
    const clauses = ['workspace_id = ?'];
    const parameters: unknown[] = [workspaceId];
    if (!request.includeReview) clauses.push("publication_status = 'published'");
    if (request.query?.trim()) {
      const query = `%${escapeLike(request.query.trim())}%`;
      clauses.push("(title LIKE ? ESCAPE '\\' OR address_line LIKE ? ESCAPE '\\' OR postal_code LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
      parameters.push(query, query, query, query);
    }
    const where = clauses.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM resident_locations WHERE ${where}`).get(...parameters) as { count: number }).count;
    const rows = this.db.prepare(`SELECT * FROM resident_locations WHERE ${where} ORDER BY city COLLATE NOCASE, address_line COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...parameters, limit, (page - 1) * limit) as any[];
    return { items: rows.map(mapResidentLocation), total, page, limit };
  }

  listPublicResidentLocations(workspaceId: string, request: Omit<ResidentLocationListRequest, 'includeReview'> = {}): ResidentLocationListResult {
    const page = Math.max(1, request.page ?? 1);
    const limit = Math.min(100, Math.max(1, request.limit ?? 25));
    const clauses = ["workspace_id = ?", "publication_status = 'published'", "status = 'active'"];
    const parameters: unknown[] = [workspaceId];
    if (request.query?.trim()) {
      const query = `%${escapeLike(request.query.trim())}%`;
      clauses.push("(title LIKE ? ESCAPE '\\' OR address_line LIKE ? ESCAPE '\\' OR postal_code LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
      parameters.push(query, query, query, query);
    }
    const where = clauses.join(' AND ');
    const total = (this.db.prepare(`SELECT COUNT(*) AS count FROM resident_locations WHERE ${where}`).get(...parameters) as { count: number }).count;
    const rows = this.db.prepare(`SELECT * FROM resident_locations WHERE ${where} ORDER BY city COLLATE NOCASE, address_line COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...parameters, limit, (page - 1) * limit) as any[];
    return { items: rows.map(mapResidentLocation), total, page, limit };
  }

  listPublicResidentAttributions(workspaceId: string): Array<{ name: string; attribution: string }> {
    return this.db.prepare(`
      SELECT DISTINCT source.name, source.attribution
      FROM source_registry AS source
      JOIN resident_location_evidence AS evidence ON evidence.source_registry_id = source.id
      JOIN resident_locations AS location ON location.id = evidence.location_id
      WHERE location.workspace_id = ? AND location.publication_status = 'published' AND location.status = 'active'
      ORDER BY source.name COLLATE NOCASE, source.id
    `).all(workspaceId) as Array<{ name: string; attribution: string }>;
  }

  getPublicResidentLocation(workspaceId: string, id: string): ResidentLocation | undefined {
    const row = this.db.prepare("SELECT * FROM resident_locations WHERE workspace_id = ? AND id = ? AND publication_status = 'published' AND status = 'active'")
      .get(workspaceId, id) as any | undefined;
    return row ? mapResidentLocation(row) : undefined;
  }

  listResidentLocationEvents(workspaceId: string, locationId: string): ResidentLocationEvent[] {
    return (this.db.prepare('SELECT * FROM resident_location_events WHERE workspace_id = ? AND location_id = ? ORDER BY created_at ASC, id ASC')
      .all(workspaceId, locationId) as any[]).map(mapResidentLocationEvent);
  }

  publishResidentLocation(workspaceId: string, actorUserId: string, id: string, requestId?: string): ResidentLocation | undefined {
    const current = this.getResidentLocation(workspaceId, id);
    if (!current) return undefined;
    if (current.status !== 'active') throw new Error('Only active resident locations can be published.');
    if (current.publicationStatus === 'published') return current;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE resident_locations SET publication_status = 'published', updated_at = ? WHERE workspace_id = ? AND id = ?")
        .run(now, workspaceId, id);
      const published = this.getResidentLocation(workspaceId, id)!;
      this.recordResidentLocationEvent({
        workspaceId,
        locationId: id,
        action: 'location.published_by_operator',
        actorType: 'operator',
        requestId,
        before: this.residentSnapshot(current),
        after: this.residentSnapshot(published),
      });
      this.audit({ workspaceId, actorUserId, action: 'resident_location.published_by_operator', resourceType: 'resident_location', resourceId: id, requestId });
    })();
    return this.getResidentLocation(workspaceId, id);
  }

  queueLocationUpdateRequest(workspaceId: string, input: QueueLocationUpdateRequestInput, actorUserId?: string, requestId?: string): LocationUpdateRequest {
    if (input.reason.trim().length < 3) throw new Error('A location update request needs a reason.');
    if (input.locationId && !this.getResidentLocation(workspaceId, input.locationId)) throw new Error('Resident location not found.');
    if (input.sourceRegistryId && !this.getSource(workspaceId, input.sourceRegistryId)) throw new Error('Source not found.');
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO location_update_requests (
          id, workspace_id, location_id, source_registry_id, request_type, status, reason, candidate_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        id, workspaceId, input.locationId ?? null, input.sourceRegistryId ?? null, input.requestType,
        input.reason.trim(), JSON.stringify(input.candidate ?? {}), now,
      );
      if (input.locationId) {
        this.recordResidentLocationEvent({
          workspaceId,
          locationId: input.locationId,
          action: input.requestType === 'public_report' ? 'location.public_reported' : 'location.review_requested',
          actorType: input.requestType === 'public_report' ? 'public' : 'system',
          sourceRegistryId: input.sourceRegistryId,
          requestId,
          before: {},
          after: { requestId: id },
        });
      }
      this.audit({ workspaceId, actorUserId, action: `resident_request.${input.requestType}`, resourceType: 'location_update_request', resourceId: id, requestId, details: { locationId: input.locationId } });
    })();
    return this.getLocationUpdateRequest(workspaceId, id)!;
  }

  getLocationUpdateRequest(workspaceId: string, id: string): LocationUpdateRequest | undefined {
    const row = this.db.prepare('SELECT * FROM location_update_requests WHERE workspace_id = ? AND id = ?').get(workspaceId, id) as any | undefined;
    return row ? mapLocationUpdateRequest(row) : undefined;
  }

  listLocationUpdateRequests(workspaceId: string, status: LocationUpdateRequest['status'] = 'pending'): { items: LocationUpdateRequest[]; total: number } {
    const rows = this.db.prepare('SELECT * FROM location_update_requests WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC, id DESC LIMIT 100')
      .all(workspaceId, status) as any[];
    const total = (this.db.prepare('SELECT COUNT(*) AS count FROM location_update_requests WHERE workspace_id = ? AND status = ?').get(workspaceId, status) as { count: number }).count;
    return { items: rows.map(mapLocationUpdateRequest), total };
  }

  resolveLocationUpdateRequest(
    workspaceId: string,
    actorUserId: string,
    id: string,
    status: Extract<LocationUpdateRequest['status'], 'resolved' | 'dismissed'>,
    requestId?: string,
  ): LocationUpdateRequest | undefined {
    const current = this.getLocationUpdateRequest(workspaceId, id);
    if (!current || current.status !== 'pending') return undefined;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE location_update_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE workspace_id = ? AND id = ? AND status = 'pending'")
        .run(status, actorUserId, now, workspaceId, id);
      if (current.locationId) {
        this.recordResidentLocationEvent({
          workspaceId,
          locationId: current.locationId,
          action: `location.request_${status}`,
          actorType: 'operator',
          requestId,
          before: { requestId: id, status: current.status },
          after: { requestId: id, status },
        });
      }
      this.audit({ workspaceId, actorUserId, action: `resident_request.${status}`, resourceType: 'location_update_request', resourceId: id, requestId, details: { locationId: current.locationId } });
    })();
    return this.getLocationUpdateRequest(workspaceId, id);
  }

  resolvePublicWorkspaceId(preferredWorkspaceId?: string): string | undefined {
    if (preferredWorkspaceId) {
      return (this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(preferredWorkspaceId) as { id: string } | undefined)?.id;
    }
    const workspaces = this.db.prepare('SELECT id FROM workspaces ORDER BY created_at, id LIMIT 2').all() as Array<{ id: string }>;
    return workspaces.length === 1 ? workspaces[0].id : undefined;
  }

  createCaretakerLink(workspaceId: string, actorUserId: string, locationId: string, expiresInDays = 180, requestId?: string): CaretakerLink | undefined {
    if (!this.getResidentLocation(workspaceId, locationId)) return undefined;
    const boundedDays = Math.min(365, Math.max(1, Math.floor(expiresInDays)));
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + boundedDays * 86_400_000).toISOString();
    this.db.transaction(() => {
      this.db.prepare('UPDATE caretaker_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ? AND location_id = ? AND revoked_at IS NULL')
        .run(now.toISOString(), workspaceId, locationId);
      this.db.prepare('INSERT INTO caretaker_tokens (id, workspace_id, location_id, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, workspaceId, locationId, tokenHash, expiresAt, actorUserId, now.toISOString());
      this.recordResidentLocationEvent({ workspaceId, locationId, action: 'location.caretaker_link_created', actorType: 'operator', requestId, before: {}, after: { expiresAt } });
      this.audit({ workspaceId, actorUserId, action: 'resident_location.caretaker_link_created', resourceType: 'resident_location', resourceId: locationId, requestId, details: { expiresAt } });
    })();
    return { id, locationId, token, expiresAt };
  }

  listCaretakerLinks(workspaceId: string, locationId: string): CaretakerLinkRecord[] {
    return (this.db.prepare(`
      SELECT id, location_id, expires_at, created_at, last_used_at, revoked_at
      FROM caretaker_tokens
      WHERE workspace_id = ? AND location_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(workspaceId, locationId) as any[]).map((row) => ({
      id: row.id,
      locationId: row.location_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
    }));
  }

  getCaretakerLocation(token: string): ResidentLocation | undefined {
    const row = this.getActiveCaretakerToken(token);
    return row ? this.getResidentLocation(row.workspace_id, row.location_id) : undefined;
  }

  applyCaretakerUpdate(token: string, input: CaretakerUpdateInput, verified: VerifiedAddress, requestId?: string): ResidentLocation | undefined {
    const tokenRow = this.getActiveCaretakerToken(token);
    if (!tokenRow) return undefined;
    return this.db.transaction(() => {
      const current = this.getResidentLocation(tokenRow.workspace_id, tokenRow.location_id);
      if (!current) return undefined;
      const now = new Date().toISOString();
      const nextAddressKey = residentAddressKey(verified);
      const duplicate = this.db.prepare('SELECT id FROM resident_locations WHERE workspace_id = ? AND address_key = ? AND id <> ?')
        .get(tokenRow.workspace_id, nextAddressKey, current.id) as { id: string } | undefined;
      if (duplicate) throw new Error('This exact address already belongs to another resident location.');
      this.db.prepare(`
        UPDATE resident_locations SET title = ?, address_key = ?, address_line = ?, postal_code = ?, city = ?, municipality = ?, province = ?,
          latitude = ?, longitude = ?, status = ?, publication_status = ?, categories_json = ?, address_verified_at = ?, last_verified_at = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(
        input.title ?? current.title, nextAddressKey, verified.addressLine, verified.postalCode, verified.city, verified.municipality ?? null, verified.province ?? null,
        verified.latitude, verified.longitude, input.status, input.status === 'active' ? 'published' : 'review', JSON.stringify(input.categories),
        verified.verifiedAt, verified.verifiedAt, now, tokenRow.workspace_id, current.id,
      );
      this.db.prepare('UPDATE caretaker_tokens SET last_used_at = ? WHERE id = ?').run(now, tokenRow.id);
      const location = this.getResidentLocation(tokenRow.workspace_id, current.id)!;
      this.recordResidentLocationEvent({ workspaceId: tokenRow.workspace_id, locationId: current.id, action: 'location.caretaker_updated', actorType: 'caretaker', requestId, before: this.residentSnapshot(current), after: this.residentSnapshot(location) });
      this.audit({ workspaceId: tokenRow.workspace_id, action: 'resident_location.caretaker_updated', resourceType: 'resident_location', resourceId: current.id, requestId, details: { status: input.status } });
      return location;
    })();
  }

  revokeCaretakerLink(workspaceId: string, actorUserId: string, id: string, requestId?: string): boolean {
    const row = this.db.prepare('SELECT location_id FROM caretaker_tokens WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL').get(workspaceId, id) as { location_id: string } | undefined;
    if (!row) return false;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE caretaker_tokens SET revoked_at = ? WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL').run(now, workspaceId, id);
    this.recordResidentLocationEvent({ workspaceId, locationId: row.location_id, action: 'location.caretaker_link_revoked', actorType: 'operator', requestId, before: {}, after: {} });
    this.audit({ workspaceId, actorUserId, action: 'resident_location.caretaker_link_revoked', resourceType: 'resident_location', resourceId: row.location_id, requestId });
    return true;
  }

  dashboard(workspaceId: string): Record<string, unknown> {
    const counts = this.db.prepare('SELECT status, COUNT(*) AS count FROM exchange_items WHERE workspace_id = ? GROUP BY status').all(workspaceId) as Array<{ status: string; count: number }>;
    const attention = this.listItems(workspaceId, {
      statuses: ['rules_review', 'human_review', 'ready_to_post', 'responding', 'pickup_scheduled'],
      limit: 20,
    }).items;
    const unread = (this.db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE workspace_id = ? AND read_at IS NULL').get(workspaceId) as { count: number }).count;
    return {
      counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
      attention,
      unreadNotifications: unread,
      manualPostingOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }

  listReviewQueue(workspaceId: string): ItemDetail[] {
    return (this.db.prepare("SELECT id FROM exchange_items WHERE workspace_id = ? AND needs_review = 1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 100").all(workspaceId) as Array<{ id: string }>)
      .map((row) => this.getItemDetail(workspaceId, row.id)!)
      .filter(Boolean);
  }

  queueAmbiguousSocialMention(workspaceId: string, input: AmbiguousSocialMentionInput): void {
    const hash = createHash('sha256').update([input.platform, input.sourceName, input.sourceLink ?? '', input.summary, input.observedAt].join('|')).digest('hex');
    this.db.prepare(`
      INSERT INTO social_review_mentions (id, workspace_id, platform, source_name, source_link, summary, reason, observed_at, mention_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, mention_hash) DO NOTHING
    `).run(randomUUID(), workspaceId, input.platform, input.sourceName, input.sourceLink ?? null, input.summary, input.reason, input.observedAt, hash, new Date().toISOString());
  }

  listAmbiguousSocialMentions(workspaceId: string): Array<Record<string, unknown>> {
    return this.db.prepare(`
      SELECT id, platform, source_name AS sourceName, source_link AS sourceLink, summary, reason, observed_at AS observedAt, created_at AS createdAt
      FROM social_review_mentions WHERE workspace_id = ? AND status = 'pending' ORDER BY observed_at DESC
    `).all(workspaceId) as Array<Record<string, unknown>>;
  }

  countAmbiguousSocialMentions(workspaceId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM social_review_mentions WHERE workspace_id = ? AND status = 'pending'")
      .get(workspaceId) as { count: number }).count;
  }

  dismissAmbiguousSocialMention(workspaceId: string, actorUserId: string, id: string, requestId?: string): boolean {
    const result = this.db.prepare("UPDATE social_review_mentions SET status = 'dismissed', resolved_by = ?, resolved_at = ? WHERE workspace_id = ? AND id = ? AND status = 'pending'")
      .run(actorUserId, new Date().toISOString(), workspaceId, id);
    if (result.changes === 1) this.audit({ workspaceId, actorUserId, action: 'social_mention.dismissed', resourceType: 'social_review_mention', resourceId: id, requestId });
    return result.changes === 1;
  }

  listNotifications(workspaceId: string, userId: string): Array<Record<string, unknown>> {
    return this.db.prepare('SELECT id, item_id AS itemId, type, title, message, read_at AS readAt, created_at AS createdAt FROM notifications WHERE workspace_id = ? AND (user_id IS NULL OR user_id = ?) ORDER BY created_at DESC LIMIT 100').all(workspaceId, userId) as Array<Record<string, unknown>>;
  }

  markNotificationRead(workspaceId: string, userId: string, id: string): boolean {
    return this.db.prepare('UPDATE notifications SET read_at = ? WHERE workspace_id = ? AND id = ? AND (user_id IS NULL OR user_id = ?)')
      .run(new Date().toISOString(), workspaceId, id, userId).changes === 1;
  }

  workspaceExport(workspaceId: string): Record<string, unknown> {
    const workspace = this.db.prepare('SELECT id, name, locale, retention_days AS retentionDays, created_at AS createdAt FROM workspaces WHERE id = ?').get(workspaceId);
    const items = (this.db.prepare('SELECT * FROM exchange_items WHERE workspace_id = ? ORDER BY updated_at DESC').all(workspaceId) as any[]).map(mapItem);
    return {
      exportedAt: new Date().toISOString(),
      workspace,
      items: items.map((item) => this.getItemDetail(workspaceId, item.id)),
      audit: this.db.prepare('SELECT action, resource_type AS resourceType, resource_id AS resourceId, created_at AS createdAt FROM audit_events WHERE workspace_id = ? ORDER BY created_at').all(workspaceId),
    };
  }

  haiFeedPage(workspaceId: string, cursor?: { updatedAt: string; id: string }, limit = 100): { items: ExchangeItem[]; hasMore: boolean } {
    const boundedLimit = Math.min(250, Math.max(1, limit));
    const parameters: unknown[] = [workspaceId];
    let cursorClause = '';
    if (cursor) {
      cursorClause = 'AND (updated_at > ? OR (updated_at = ? AND id > ?))';
      parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const rows = this.db.prepare(`
      SELECT * FROM exchange_items
      WHERE workspace_id = ? AND status <> 'draft' ${cursorClause}
      ORDER BY updated_at ASC, id ASC LIMIT ?
    `).all(...parameters, boundedLimit + 1);
    return { items: rows.slice(0, boundedLimit).map(mapItem), hasMore: rows.length > boundedLimit };
  }

  getSettings(workspaceId: string): Record<string, unknown> | undefined {
    const row = this.db.prepare(`
      SELECT w.name, w.locale, w.safety_stop, w.retention_days, s.default_platform, s.default_city,
             s.default_privacy_level, s.stale_after_days, s.notifications_enabled
      FROM workspaces w JOIN workspace_settings s ON s.workspace_id = w.id WHERE w.id = ?
    `).get(workspaceId) as any | undefined;
    if (!row) return undefined;
    const flags = this.db.prepare('SELECT flag_key AS key, enabled FROM feature_flags WHERE workspace_id = ? ORDER BY flag_key').all(workspaceId) as Array<{ key: string; enabled: number }>;
    return {
      name: row.name,
      locale: row.locale,
      safetyStop: row.safety_stop === 1,
      retentionDays: row.retention_days,
      defaultPlatform: row.default_platform,
      defaultCity: row.default_city,
      defaultPrivacyLevel: row.default_privacy_level,
      staleAfterDays: row.stale_after_days,
      notificationsEnabled: row.notifications_enabled === 1,
      featureFlags: Object.fromEntries(flags.map((flag) => [flag.key, flag.enabled === 1])),
    };
  }

  setSafetyStop(workspaceId: string, actorUserId: string, enabled: boolean, requestId?: string): void {
    this.db.prepare('UPDATE workspaces SET safety_stop = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, new Date().toISOString(), workspaceId);
    this.audit({ workspaceId, actorUserId, action: enabled ? 'operator.safety_stop_enabled' : 'operator.safety_stop_disabled', resourceType: 'workspace', resourceId: workspaceId, requestId });
  }

  queueJob(input: { workspaceId?: string; jobType: string; payload?: Record<string, unknown>; runAfter?: string; maxAttempts?: number; idempotencyKey: string }): JobRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO jobs (id, workspace_id, job_type, payload_json, status, attempts, max_attempts, run_after, idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(randomUUID(), input.workspaceId ?? null, input.jobType, JSON.stringify(input.payload ?? {}), input.maxAttempts ?? 3, input.runAfter ?? now, input.idempotencyKey, now, now);
    return this.getJobByKey(input.idempotencyKey)!;
  }

  claimNextJob(): JobRecord | undefined {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY run_after, created_at LIMIT 1").get(new Date().toISOString()) as any | undefined;
      if (!row) return undefined;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(now, now, row.id);
      return this.getJob(row.id);
    })();
  }

  completeJob(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE jobs SET status = 'succeeded', finished_at = ?, locked_at = NULL, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  failJob(id: string, error: string): void {
    const job = this.getJob(id);
    if (!job) return;
    const now = new Date();
    const retry = job.attempts < job.maxAttempts;
    const delayMinutes = Math.min(60, 2 ** job.attempts);
    this.db.prepare('UPDATE jobs SET status = ?, run_after = ?, locked_at = NULL, last_error = ?, finished_at = ?, updated_at = ? WHERE id = ?')
      .run(retry ? 'queued' : 'failed', new Date(now.getTime() + delayMinutes * 60_000).toISOString(), error.slice(0, 2000), retry ? null : now.toISOString(), now.toISOString(), id);
  }

  staleItems(workspaceId: string, days: number): number {
    const threshold = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db.prepare("UPDATE exchange_items SET needs_review = 1, updated_at = ? WHERE workspace_id = ? AND status IN ('posted', 'responding', 'pickup_scheduled') AND updated_at < ?")
      .run(new Date().toISOString(), workspaceId, threshold);
    return result.changes;
  }

  applyRetention(workspaceId: string, days: number): number {
    const threshold = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.db.prepare("DELETE FROM exchange_items WHERE workspace_id = ? AND status = 'archived' AND archived_at < ?").run(workspaceId, threshold);
    this.audit({ workspaceId, action: 'retention.applied', resourceType: 'workspace', resourceId: workspaceId, details: { deleted: result.changes, days } });
    return result.changes;
  }

  readiness(): { ok: boolean; setupRequired: boolean; migration: ReturnType<typeof migrationStatus> } {
    const migration = migrationStatus(this.db);
    const databaseReachable = (this.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
    return { ok: databaseReachable && migration.pending.length === 0, setupRequired: !this.hasUsers(), migration };
  }

  diagnostics(): Record<string, unknown> {
    const integrity = (this.db.pragma('integrity_check') as Array<{ integrity_check: string }>).map((row) => row.integrity_check);
    const foreignKeyViolations = this.db.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    const migration = migrationStatus(this.db);
    const counts = Object.fromEntries(['workspaces', 'users', 'exchange_items', 'jobs', 'audit_events'].map((table) => [
      table,
      (this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]));
    return {
      ok: integrity.length === 1 && integrity[0] === 'ok' && foreignKeyViolations.length === 0 && migration.pending.length === 0,
      integrity,
      foreignKeyViolations,
      migration,
      counts,
      runtime: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed },
    };
  }

  workspaceIds(): string[] {
    return (this.db.prepare('SELECT id FROM workspaces').all() as Array<{ id: string }>).map((row) => row.id);
  }

  workspaceOperatorUserId(workspaceId: string): string | undefined {
    return (this.db.prepare(`
      SELECT user_id AS userId FROM workspace_members
      WHERE workspace_id = ? AND role IN ('owner', 'operator')
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at
      LIMIT 1
    `).get(workspaceId) as { userId: string } | undefined)?.userId;
  }

  workspaceSafetyStop(workspaceId: string): boolean {
    return (this.db.prepare('SELECT safety_stop FROM workspaces WHERE id = ?').get(workspaceId) as { safety_stop: number } | undefined)?.safety_stop === 1;
  }

  private recordResidentLocationEvent(input: {
    workspaceId: string;
    locationId: string;
    action: string;
    actorType: ResidentLocationEvent['actorType'];
    sourceRegistryId?: string;
    requestId?: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): void {
    this.db.prepare(`
      INSERT INTO resident_location_events (
        id, workspace_id, location_id, action, actor_type, source_registry_id, request_id, before_json, after_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.workspaceId, input.locationId, input.action, input.actorType,
      input.sourceRegistryId ?? null, input.requestId ?? null, JSON.stringify(input.before), JSON.stringify(input.after), new Date().toISOString(),
    );
  }

  private residentSnapshot(location: ResidentLocation): Record<string, unknown> {
    return {
      title: location.title,
      addressLine: location.addressLine,
      postalCode: location.postalCode,
      city: location.city,
      municipality: location.municipality,
      province: location.province,
      latitude: location.latitude,
      longitude: location.longitude,
      status: location.status,
      publicationStatus: location.publicationStatus,
      categories: location.categories,
      lastVerifiedAt: location.lastVerifiedAt,
    };
  }

  private getActiveCaretakerToken(token: string): { id: string; workspace_id: string; location_id: string } | undefined {
    const hash = createHash('sha256').update(token).digest('hex');
    return this.db.prepare(`
      SELECT id, workspace_id, location_id FROM caretaker_tokens
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(hash, new Date().toISOString()) as { id: string; workspace_id: string; location_id: string } | undefined;
  }

  private getJob(id: string): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  private getJobByKey(key: string): JobRecord | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(key) as any | undefined;
    return row ? this.mapJob(row) : undefined;
  }

  private mapJob(row: any): JobRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id ?? undefined,
      jobType: row.job_type,
      payload: parseJson(row.payload_json, {}),
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAfter: row.run_after,
      idempotencyKey: row.idempotency_key,
    };
  }

  private maybeNotify(workspaceId: string, userId: string, itemId: string, status: ItemStatus): void {
    const messages: Partial<Record<ItemStatus, [string, string]>> = {
      human_review: ['Beoordeling nodig', 'Een item is klaar voor menselijke beoordeling.'],
      ready_to_post: ['Berichtpakket gereed', 'Het gecontroleerde bericht kan handmatig worden geplaatst.'],
      pickup_scheduled: ['Ophaalafspraak gepland', 'Controleer de afspraak en bevestig de overdracht.'],
      completed: ['Overdracht afgerond', 'Het item kan worden gearchiveerd.'],
    };
    const message = messages[status];
    if (!message) return;
    this.db.prepare('INSERT INTO notifications (id, workspace_id, user_id, item_id, type, title, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), workspaceId, userId, itemId, status, message[0], message[1], new Date().toISOString());
  }

  private analytics(workspaceId: string, eventName: string, properties: Record<string, unknown>): void {
    const enabled = (this.db.prepare("SELECT enabled FROM feature_flags WHERE workspace_id = ? AND flag_key = 'local_analytics'").get(workspaceId) as { enabled: number } | undefined)?.enabled === 1;
    if (!enabled) return;
    this.db.prepare('INSERT INTO analytics_events (id, workspace_id, event_name, properties_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), workspaceId, eventName, JSON.stringify(properties), new Date().toISOString());
  }

  private audit(input: { workspaceId?: string; actorUserId?: string; action: string; resourceType: string; resourceId?: string; requestId?: string; details?: Record<string, unknown> }): void {
    this.db.prepare('INSERT INTO audit_events (id, workspace_id, actor_user_id, action, resource_type, resource_id, request_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), input.workspaceId ?? null, input.actorUserId ?? null, input.action, input.resourceType, input.resourceId ?? null, input.requestId ?? null, JSON.stringify(input.details ?? {}), new Date().toISOString());
  }
}
