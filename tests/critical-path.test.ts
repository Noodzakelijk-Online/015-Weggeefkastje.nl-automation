import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/appDatabase.js';
import { createApp } from '../src/api/app.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-critical-'));
  directories.push(directory);
  const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite') }, directory);
  const database = new AppDatabase(config.databasePath);
  return { database, app: createApp(config, database) };
}

describe('critical path', () => {
  it('moves an item through review, manual posting, response, pickup and archive', async () => {
    const { database, app } = harness();
    const agent = request.agent(app);
    const setup = await agent.post('/api/setup').send({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Beheerder', workspaceName: 'Delft' }).expect(201);
    const csrf = setup.body.data.session.csrfToken;
    const write = () => ({ 'x-csrf-token': csrf });
    const created = await agent.post('/api/items').set(write()).send({
      title: 'Doos speelgoed beschikbaar', description: 'Gratis speelgoed voor een gezin in de buurt.', category: 'Speelgoed',
      platformTarget: 'facebook', sourceKind: 'manual', sourceName: 'operator-intake', city: 'Delft', addressHint: 'Binnenstad',
      confidence: 60, contactMethod: 'platform', privacyLevel: 'approximate',
    }).expect(201);
    const id = created.body.data.item.id;
    const act = async (action: string, extra: Record<string, unknown> = {}) => agent.post(`/api/items/${id}/actions`).set(write()).send({ action, idempotencyKey: `${action}-test-key`, ...extra }).expect(200);
    expect((await act('submit')).body.data.item.status).toBe('human_review');
    expect((await act('approve')).body.data.item.status).toBe('ready_to_post');
    await agent.post(`/api/items/${id}/message-package/copy`).set(write()).send({ idempotencyKey: 'copy-test-key' }).expect(200);
    expect((await act('mark_posted', { externalUrl: 'https://www.facebook.com/example' })).body.data.item.status).toBe('posted');
    expect((await act('record_response', { notes: 'Interesse ontvangen via het platform.' })).body.data.item.status).toBe('responding');
    expect((await act('schedule_pickup', { notes: 'Zaterdagmiddag.', scheduledAt: '2026-08-15T12:00:00.000Z' })).body.data.item.status).toBe('pickup_scheduled');
    expect((await act('complete_pickup')).body.data.item.status).toBe('completed');
    expect((await act('archive')).body.data.item.status).toBe('archived');
    const detail = await agent.get(`/api/items/${id}`).expect(200);
    expect(detail.body.data.history).toHaveLength(7);
    expect(detail.body.data.messagePackage.externalUrl).toBe('https://www.facebook.com/example');
    database.close();
  });

  it('requires authentication and CSRF for writes', async () => {
    const { database, app } = harness();
    await request(app).get('/api/dashboard').expect(401);
    const agent = request.agent(app);
    await agent.post('/api/setup').send({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Beheerder', workspaceName: 'Delft' }).expect(201);
    await agent.post('/api/items').send({}).expect(403);
    database.close();
  });
});
