import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { createApp } from '../src/api/app.js';
import { loadConfig, publicConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/appDatabase.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function harness(extra: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-hai-'));
  directories.push(directory);
  const config = loadConfig({
    NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite'),
    HAI_FEED_TOKEN: 'a-secure-hai-feed-token-with-32-characters', HAI_PROJECT_KEY: '015-Weggeefkastje',
    ...extra,
  }, directory);
  const database = new AppDatabase(config.databasePath);
  return { config, database, app: createApp(config, database) };
}

describe('HAI read-only connector', () => {
  it('requires its dedicated token, redacts private content and advances a cursor', async () => {
    const { app, config, database } = harness();
    const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Delft' });
    const detail = database.createItem(identity.workspaceId, identity.userId, {
      title: 'Privé overdracht 0612345678', description: 'Geheim telefoonnummer 0612345678', category: 'Overig', platformTarget: 'facebook',
      sourceKind: 'manual', sourceName: 'operator', sourceLink: 'https://www.facebook.com/example', city: 'Delft',
      addressHint: 'Exact huisnummer 42', confidence: 60, contactMethod: 'platform', privacyLevel: 'private',
    });
    database.transitionItem(identity.workspaceId, identity.userId, detail.item.id, { action: 'submit', idempotencyKey: 'hai-submit-1' });

    await request(app).get('/api/integrations/hai/feed').expect(401);
    const first = await request(app).get('/api/integrations/hai/feed')
      .set('authorization', `Bearer ${config.hai.feedToken}`).expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0]).toEqual(expect.objectContaining({ itemType: 'weggeefkastje_exchange', projectKey: '015-Weggeefkastje' }));
    expect(first.text).not.toContain('0612345678');
    expect(first.text).not.toContain('huisnummer 42');
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app).get('/api/integrations/hai/feed')
      .query({ access_token: config.hai.feedToken, cursor: first.body.nextCursor }).expect(200);
    expect(second.body.items).toEqual([]);
    expect(JSON.stringify(publicConfig(config))).not.toContain(config.hai.feedToken);
    database.close();
  });

  it('rejects invalid cursors without exposing internal errors', async () => {
    const { app, config, database } = harness();
    database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Delft' });
    const result = await request(app).get('/api/integrations/hai/feed')
      .query({ access_token: config.hai.feedToken, cursor: 'not-a-cursor' }).expect(400);
    expect(result.body.error.code).toBe('HAI_FEED_UNAVAILABLE');
    database.close();
  });
});

describe('tunnel setup boundary', () => {
  it('blocks first-run setup through a trusted public proxy by default', async () => {
    const { app, database } = harness({ TRUST_PROXY: 'true' });
    const response = await request(app).post('/api/setup').set('x-forwarded-for', '203.0.113.10').send({
      email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Delft',
    }).expect(403);
    expect(response.body.error.code).toBe('REMOTE_SETUP_DISABLED');
    expect(database.hasUsers()).toBe(false);
    database.close();
  });
});
