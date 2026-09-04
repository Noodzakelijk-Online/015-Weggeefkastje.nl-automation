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
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-admin-resident-api-'));
  directories.push(directory);
  const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite') }, directory);
  const database = new AppDatabase(config.databasePath);
  databases.push(database);
  return { database, app: createApp(config, database) };
}

describe('authenticated resident catalog API', () => {
  it('manages authorised sources, review publication, reports and one-time caretaker links', async () => {
    const { app, database } = harness();
    const agent = request.agent(app);
    const setup = await agent.post('/api/setup').send({
      email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Beheerder', workspaceName: 'Utrecht',
    }).expect(201);
    const csrf = setup.body.data.session.csrfToken as string;
    const write = () => ({ 'x-csrf-token': csrf });

    const createdSource = await agent.post('/api/sources').set(write()).send({
      key: 'approved-map', name: 'Goedgekeurde kaart', accessMode: 'approved_export', authorizationReference: 'consent-2026-09',
      attribution: 'Partnerkaart', publicationMode: 'review', enabled: true, allowsExactAddress: true,
    }).expect(201);
    const source = createdSource.body.data;
    await agent.patch(`/api/sources/${source.id}`).set(write()).send({ publicationMode: 'automatic' }).expect(200);
    const sources = await agent.get('/api/sources').expect(200);
    expect(sources.body.data).toContainEqual(expect.objectContaining({ id: source.id, publicationMode: 'automatic' }));

    const reviewSource = database.updateSource(setup.body.data.session.workspaceId, setup.body.data.session.userId, source.id, { publicationMode: 'review' })!;
    const location = database.upsertVerifiedResidentLocation(setup.body.data.session.workspaceId, setup.body.data.session.userId, reviewSource, {
      sourceKey: reviewSource.key, title: 'Kastje bij de speeltuin', address: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht',
      observedAt: '2026-09-04T10:00:00.000Z', evidenceSummary: 'Alleen intern.', status: 'active', categories: ['Boeken'],
    }, {
      addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht', latitude: 52.0907, longitude: 5.1214,
      provider: 'pdok', verifiedAt: '2026-09-04T11:00:00.000Z',
    });
    const locations = await agent.get('/api/resident-locations?includeReview=true').expect(200);
    expect(locations.body.data.items).toContainEqual(expect.objectContaining({ id: location.id, publicationStatus: 'review' }));

    await agent.post(`/api/resident-locations/${location.id}/publish`).set(write()).send({}).expect(200);
    const link = await agent.post(`/api/resident-locations/${location.id}/caretaker-links`).set(write()).send({ expiresInDays: 30 }).expect(201);
    expect(link.body.data).toEqual(expect.objectContaining({ locationId: location.id, url: expect.stringContaining('/kastje-bijwerken/') }));

    const report = database.queueLocationUpdateRequest(setup.body.data.session.workspaceId, {
      locationId: location.id, requestType: 'public_report', reason: 'Het kastje lijkt tijdelijk leeg.',
    });
    const requests = await agent.get('/api/location-update-requests').expect(200);
    expect(requests.body.data.items).toContainEqual(expect.objectContaining({ id: report.id, status: 'pending' }));
    await agent.post(`/api/location-update-requests/${report.id}/resolve`).set(write()).send({ status: 'dismissed' }).expect(200);
    expect(database.getLocationUpdateRequest(setup.body.data.session.workspaceId, report.id)?.status).toBe('dismissed');
    expect(database.getResidentLocation(setup.body.data.session.workspaceId, location.id)?.publicationStatus).toBe('published');
  });
});
