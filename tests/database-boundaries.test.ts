import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/password.js';
import { AppDatabase, type CreateExchangeItemInput } from '../src/db/appDatabase.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-boundaries-'));
  directories.push(directory);
  return new AppDatabase(join(directory, 'test.sqlite'));
}

const baseItem: CreateExchangeItemInput = {
  title: 'Voorbeeld', description: 'Veilige beschrijving', category: 'Overig', platformTarget: 'manual',
  sourceKind: 'manual', sourceName: 'test', city: 'Delft', confidence: 50, contactMethod: 'platform', privacyLevel: 'approximate',
};

describe('database boundaries and scale behavior', () => {
  it('keeps records scoped to their workspace', () => {
    const database = harness();
    const first = database.bootstrapAdmin({ email: 'first@example.nl', password: 'correct-horse-battery', displayName: 'First', workspaceName: 'First' });
    const secondUser = randomUUID();
    const secondWorkspace = randomUUID();
    const now = new Date().toISOString();
    database.db.transaction(() => {
      database.db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(secondWorkspace, 'Second', now, now);
      database.db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(secondUser, 'second@example.nl', 'Second', hashPassword('correct-horse-battery'), now);
      database.db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(secondWorkspace, secondUser, now);
      database.db.prepare('INSERT INTO workspace_settings (workspace_id, updated_at) VALUES (?, ?)').run(secondWorkspace, now);
    })();
    const privateToSecond = database.createItem(secondWorkspace, secondUser, baseItem);
    expect(database.listItems(first.workspaceId, { includeArchived: true }).total).toBe(0);
    expect(database.getItemDetail(first.workspaceId, privateToSecond.item.id)).toBeUndefined();
    expect(database.getItemDetail(secondWorkspace, privateToSecond.item.id)?.item.title).toBe('Voorbeeld');
    database.close();
  });

  it('returns stable bounded pages and treats wildcard search characters literally', () => {
    const database = harness();
    const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Delft' });
    for (let index = 0; index < 30; index++) database.createItem(identity.workspaceId, identity.userId, { ...baseItem, title: index === 0 ? '100% gratis' : `Item ${index}` });
    const first = database.listItems(identity.workspaceId, { page: 1, limit: 25 });
    const second = database.listItems(identity.workspaceId, { page: 2, limit: 25 });
    expect(first).toEqual(expect.objectContaining({ total: 30, page: 1, limit: 25 }));
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(5);
    expect(database.listItems(identity.workspaceId, { query: '%', limit: 25 }).items.map((item) => item.title)).toEqual(['100% gratis']);
    database.close();
  });

  it('finishes an online backup before its source connection closes', async () => {
    const database = harness();
    database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Delft' });
    const destination = join(dirname(database.db.name), 'backup.sqlite');
    await database.backupTo(destination);
    database.close();
    const restored = new AppDatabase(destination);
    expect(restored.diagnostics()).toEqual(expect.objectContaining({ ok: true }));
    expect(restored.hasUsers()).toBe(true);
    restored.close();
  });
});
