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

describe('caretaker API', () => {
  it('limits a bearer link to one location and revalidates its update', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeef-caretaker-api-'));
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
      sourceKey: 'official-map', title: 'Weggeefkastje', address: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht',
      observedAt: '2026-09-04T10:00:00.000Z', evidenceSummary: 'Interne samenvatting.', status: 'active', categories: [],
    }, {
      addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht', latitude: 52.0907, longitude: 5.1214,
      provider: 'pdok', verifiedAt: '2026-09-04T11:00:00.000Z',
    });
    const link = database.createCaretakerLink(identity.workspaceId, identity.userId, location.id)!;
    const app = createApp(config, database, {
      addressVerifier: {
        verify: async () => ({
          addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht', latitude: 52.0907, longitude: 5.1214,
          provider: 'pdok', verifiedAt: '2026-09-04T12:00:00.000Z',
        }),
      },
    });

    const read = await request(app).get(`/api/public/caretaker/${link.token}`).expect(200);
    expect(read.body.data).toEqual(expect.objectContaining({ id: location.id, addressLine: 'Voorbeeldstraat 10' }));
    expect(read.body.data).not.toHaveProperty('sourceLink');
    await request(app).post(`/api/public/caretaker/${link.token}`)
      .send({ address: 'Voorbeeldstraat 10', postalCode: '1234 AB', city: 'Utrecht', status: 'inactive', categories: [] })
      .expect(200);
    expect(database.getResidentLocation(identity.workspaceId, location.id)?.status).toBe('inactive');
    await request(app).get(`/api/public/caretaker/${link.token}notvalid`).expect(404);
  });
});
