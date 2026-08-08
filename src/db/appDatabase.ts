import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
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
