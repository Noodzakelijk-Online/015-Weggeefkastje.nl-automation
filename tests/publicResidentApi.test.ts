import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/appDatabase.js';
import { createApp } from '../src/api/app.js';

const directories: string[] = [];
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-public-api-'));
  directories.push(directory);
  const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite') }, directory);
  const database = new AppDatabase(config.databasePath);
  databases.push(database);
  const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Utrecht' });
  const source = database.createSource(identity.workspaceId, identity.userId, {
    key: 'official-map', name: 'Officiële kaart', accessMode: 'official_api', authorizationReference: 'approved-2026',
    attribution: 'Officiële kaart', publicationMode: 'automatic', enabled: true, allowsExactAddress: true,
  });
  const location = database.upsertVerifiedResidentLocation(identity.workspaceId, identity.userId, source, {
    sourceKey: 'official-map', title: 'Weggeefkastje bij de speeltuin', address: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht',
    observedAt: '2026-09-04T10:00:00.000Z', evidenceSummary: 'Interne broninformatie die nooit openbaar mag worden.', status: 'active', categories: ['Boeken'],
  }, {
    addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht', municipality: 'Utrecht', province: 'Utrecht',
    latitude: 52.0907, longitude: 5.1214, provider: 'pdok', verifiedAt: '2026-09-04T11:00:00.000Z',
  });
  return { database, app: createApp(config, database), location, workspaceId: identity.workspaceId };
}

describe('public resident locator API', () => {
  it('returns only published exact locations without source evidence or authentication', async () => {
    const { app } = harness();

    const response = await request(app).get('/api/public/locations?query=Utrecht').expect(200);
    const attributions = await request(app).get('/api/public/attributions').expect(200);

    expect(response.body.data.items).toEqual([expect.objectContaining({
      addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht', directionsUrl: expect.stringContaining('google.com/maps/dir'),
    })]);
    expect(JSON.stringify(response.body.data.items[0])).not.toContain('Interne broninformatie');
    expect(response.body.data.items[0]).not.toHaveProperty('sourceLink');
    expect(attributions.body.data).toEqual([{ name: 'Officiële kaart', attribution: 'Officiële kaart' }]);
    expect(JSON.stringify(attributions.body.data)).not.toContain('approved-2026');
  });

  it('queues a public report without removing the existing location', async () => {
    const { app, database, location, workspaceId } = harness();

    await request(app).post(`/api/public/locations/${location.id}/reports`)
      .send({ reason: 'Ik kan dit kastje niet meer vinden.' })
      .expect(202);

    expect(database.getResidentLocation(workspaceId, location.id)?.status).toBe('active');
    expect(database.listLocationUpdateRequests(workspaceId).items)
      .toContainEqual(expect.objectContaining({ locationId: location.id, requestType: 'public_report' }));
  });
});
