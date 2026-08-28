import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up(db: Database.Database): void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'workspace_auth_and_exchange_workflow',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          locale TEXT NOT NULL DEFAULT 'nl-NL',
          safety_stop INTEGER NOT NULL DEFAULT 0,
          retention_days INTEGER NOT NULL DEFAULT 365,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          disabled_at TEXT
        );

        CREATE TABLE IF NOT EXISTS workspace_members (
          workspace_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner', 'operator', 'viewer')),
          created_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, user_id),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          csrf_token TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exchange_items (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          category TEXT NOT NULL,
          platform_target TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_link TEXT,
          city TEXT NOT NULL,
          address_hint TEXT,
          latitude REAL,
          longitude REAL,
          confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
          status TEXT NOT NULL,
          needs_review INTEGER NOT NULL DEFAULT 1,
          privacy_level TEXT NOT NULL DEFAULT 'approximate',
          pickup_notes TEXT,
          contact_method TEXT NOT NULL DEFAULT 'platform',
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(owner_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS item_evidence (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_link TEXT,
          summary TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          evidence_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(workspace_id, evidence_hash),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS rule_evaluations (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          results_json TEXT NOT NULL,
          blocking_failures INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS message_packages (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          external_url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          approved_at TEXT,
          copied_at TEXT,
          posted_at TEXT,
          UNIQUE(workspace_id, item_id, content_hash),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS coordination_events (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          notes TEXT,
          scheduled_at TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE,
          FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS workflow_events (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          UNIQUE(workspace_id, idempotency_key),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE,
          FOREIGN KEY(actor_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          actor_user_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          request_id TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
          FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS item_review_decisions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE,
          FOREIGN KEY(actor_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          user_id TEXT,
          item_id TEXT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          read_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES exchange_items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          job_type TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          run_after TEXT NOT NULL,
          locked_at TEXT,
          finished_at TEXT,
          last_error TEXT,
          idempotency_key TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS feature_flags (
          workspace_id TEXT NOT NULL,
          flag_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, flag_key),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS analytics_events (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          event_name TEXT NOT NULL,
          properties_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
        CREATE INDEX IF NOT EXISTS idx_items_workspace_status ON exchange_items(workspace_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_items_workspace_city ON exchange_items(workspace_id, city);
        CREATE INDEX IF NOT EXISTS idx_evidence_item ON item_evidence(workspace_id, item_id, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_workflow_item ON workflow_events(workspace_id, item_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_coordination_item ON coordination_events(workspace_id, item_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_workspace_created ON audit_events(workspace_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, run_after);
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(workspace_id, user_id, read_at, created_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'provider_checkpoints_and_workspace_settings',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_checkpoints (
          workspace_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          cursor TEXT,
          last_fetched_at TEXT,
          cooldown_until TEXT,
          last_status TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, provider),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workspace_settings (
          workspace_id TEXT PRIMARY KEY,
          default_platform TEXT NOT NULL DEFAULT 'manual',
          default_city TEXT,
          default_privacy_level TEXT NOT NULL DEFAULT 'approximate',
          stale_after_days INTEGER NOT NULL DEFAULT 30,
          notifications_enabled INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 3,
    name: 'ambiguous_social_review_queue',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS social_review_mentions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          source_name TEXT NOT NULL,
          source_link TEXT,
          summary TEXT NOT NULL,
          reason TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          mention_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          resolved_by TEXT,
          resolved_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(workspace_id, mention_hash),
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY(resolved_by) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_social_review_pending ON social_review_mentions(workspace_id, status, observed_at DESC);
      `);
    },
  },
  {
    version: 4,
    name: 'cursor_and_queue_performance_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_items_workspace_updated
          ON exchange_items(workspace_id, updated_at, id);
        CREATE INDEX IF NOT EXISTS idx_items_workspace_review
          ON exchange_items(workspace_id, needs_review, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_seen
          ON sessions(last_seen_at);
      `);
    },
  },
];

export function runMigrations(db: Database.Database): { applied: number[]; currentVersion: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const existing = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((row) => row.version));
  const applied: number[] = [];

  for (const migration of migrations) {
    if (existing.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString());
    })();
    applied.push(migration.version);
  }

  const currentVersion = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version;
  return { applied, currentVersion };
}

export function migrationStatus(db: Database.Database): { currentVersion: number; latestVersion: number; pending: number[] } {
  const currentVersion = (db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version;
  return {
    currentVersion,
    latestVersion: migrations.at(-1)?.version ?? 0,
    pending: migrations.filter((migration) => migration.version > currentVersion).map((migration) => migration.version),
  };
}
