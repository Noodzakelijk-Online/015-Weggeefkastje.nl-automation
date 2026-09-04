import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppDatabase } from '../src/db/appDatabase.js';

const directories: string[] = [];
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function harness(): { database: AppDatabase; workspaceId: string; userId: string } {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-resident-catalog-'));
  directories.push(directory);
  const database = new AppDatabase(join(directory, 'test.sqlite'));
  databases.push(database);
  const identity = database.bootstrapAdmin({
    email: 'owner@example.nl',
    password: 'correct-horse-battery',
    displayName: 'Owner',
    workspaceName: 'Utrecht',
  });
  return { database, ...identity };
}

const candidate = {
  sourceKey: 'official-map',
  title: 'Weggeefkastje bij de speeltuin',
  address: 'Voorbeeldstraat 10',
  postalCode: '1234AB',
  city: 'Utrecht',
  observedAt: '2026-09-04T10:00:00.000Z',
  evidenceSummary: 'Officiële kaart met een bevestigde locatie.',
  categories: ['Boeken'],
  status: 'active' as const,
};

const verified = {
  addressLine: 'Voorbeeldstraat 10',
  postalCode: '1234AB',
  city: 'Utrecht',
  municipality: 'Utrecht',
  province: 'Utrecht',
  latitude: 52.0907,
  longitude: 5.1214,
  provider: 'pdok' as const,
  verifiedAt: '2026-09-04T11:00:00.000Z',
};

describe('resident catalog database', () => {
  it('publishes an exactly verified location from an enabled automatic source and records its history', () => {
    const { database, workspaceId, userId } = harness();
    const source = database.createSource(workspaceId, userId, {
      key: 'official-map',
      name: 'Officiële kaart',
      accessMode: 'official_api',
      authorizationReference: 'source-agreement-2026',
      attribution: 'Officiële kaart',
      publicationMode: 'automatic',
      enabled: true,
      allowsExactAddress: true,
    });

    const location = database.upsertVerifiedResidentLocation(workspaceId, userId, source, candidate, verified);
    const publicLocations = database.listPublicResidentLocations(workspaceId, { query: 'Utrecht' });

    expect(publicLocations.items).toEqual([expect.objectContaining({
      id: location.id,
      addressLine: 'Voorbeeldstraat 10',
      postalCode: '1234AB',
      city: 'Utrecht',
      status: 'active',
      publicationStatus: 'published',
    })]);
    expect(database.listResidentLocationEvents(workspaceId, location.id))
      .toContainEqual(expect.objectContaining({ action: 'location.published', actorType: 'operator' }));
  });

  it('keeps a source in review mode out of public results and does not unpublish a location after a public report', () => {
    const { database, workspaceId, userId } = harness();
    const automaticSource = database.createSource(workspaceId, userId, {
      key: 'official-map', name: 'Officiële kaart', accessMode: 'official_api',
      authorizationReference: 'source-agreement-2026', attribution: 'Officiële kaart',
      publicationMode: 'automatic', enabled: true, allowsExactAddress: true,
    });
    const published = database.upsertVerifiedResidentLocation(workspaceId, userId, automaticSource, candidate, verified);
    const reviewSource = database.createSource(workspaceId, userId, {
      key: 'review-map', name: 'Nieuwe kaart', accessMode: 'approved_export',
      authorizationReference: 'written-permission-2026', attribution: 'Nieuwe kaart',
      publicationMode: 'review', enabled: true, allowsExactAddress: true,
    });
    database.upsertVerifiedResidentLocation(workspaceId, userId, reviewSource, {
      ...candidate, sourceKey: 'review-map', address: 'Andereweg 2', postalCode: '1234CD',
    }, { ...verified, addressLine: 'Andereweg 2', postalCode: '1234CD', longitude: 5.13 });

    database.queueLocationUpdateRequest(workspaceId, {
      locationId: published.id,
      requestType: 'public_report',
      reason: 'Ik kan het kastje niet meer vinden.',
    });

    expect(database.listPublicResidentLocations(workspaceId).items.map((location) => location.id)).toEqual([published.id]);
    expect(database.getResidentLocation(workspaceId, published.id)?.status).toBe('active');
    expect(database.listLocationUpdateRequests(workspaceId).items)
      .toContainEqual(expect.objectContaining({ locationId: published.id, requestType: 'public_report', status: 'pending' }));
  });
});
