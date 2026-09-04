import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppDatabase } from '../src/db/appDatabase.js';
import { ingestResidentCandidate } from '../src/services/residentCatalog.js';
import type { AddressVerifier } from '../src/integrations/pdokAddress.js';

const directories: string[] = [];
const databases: AppDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const verifiedAddress = {
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

function harness(publicationMode: 'automatic' | 'review') {
  const directory = mkdtempSync(join(tmpdir(), 'weggeef-resident-service-'));
  directories.push(directory);
  const database = new AppDatabase(join(directory, 'test.sqlite'));
  databases.push(database);
  const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Owner', workspaceName: 'Utrecht' });
  database.createSource(identity.workspaceId, identity.userId, {
    key: 'test-source', name: 'Testbron', accessMode: 'official_api', authorizationReference: 'approved-2026',
    attribution: 'Testbron', publicationMode, enabled: true, allowsExactAddress: true,
  });
  const verifier: AddressVerifier = { verify: async () => verifiedAddress };
  return { database, verifier, ...identity };
}

const candidate = {
  sourceKey: 'test-source',
  title: 'Weggeefkastje bij de speeltuin',
  address: 'Voorbeeldstraat 10',
  postalCode: '1234AB',
  city: 'Utrecht',
  observedAt: '2026-09-04T10:00:00.000Z',
  evidenceSummary: 'Toegestane bron heeft dit kastje genoemd.',
  categories: ['Boeken'],
  status: 'active' as const,
};

describe('resident catalog ingestion policy', () => {
  it('publishes a PDOK-verified candidate from an automatic source', async () => {
    const { database, verifier, workspaceId, userId } = harness('automatic');

    const result = await ingestResidentCandidate({ database, verifier }, { workspaceId, actorUserId: userId, candidate });

    expect(result).toMatchObject({ disposition: 'published', location: { addressLine: 'Voorbeeldstraat 10' } });
    expect(database.listPublicResidentLocations(workspaceId).items).toHaveLength(1);
  });

  it('queues a verified candidate when the source requires review', async () => {
    const { database, verifier, workspaceId, userId } = harness('review');

    const result = await ingestResidentCandidate({ database, verifier }, { workspaceId, actorUserId: userId, candidate });

    expect(result).toMatchObject({ disposition: 'review', location: { publicationStatus: 'review' } });
    expect(database.listPublicResidentLocations(workspaceId).items).toHaveLength(0);
  });

  it('queues rather than guesses when a source omits the exact address', async () => {
    const { database, verifier, workspaceId, userId } = harness('automatic');

    const result = await ingestResidentCandidate({ database, verifier }, {
      workspaceId,
      actorUserId: userId,
      candidate: { ...candidate, postalCode: undefined },
    });

    expect(result).toMatchObject({ disposition: 'review', reason: 'exact_address_required' });
    expect(database.listPublicResidentLocations(workspaceId).items).toHaveLength(0);
    expect(database.listLocationUpdateRequests(workspaceId).items)
      .toContainEqual(expect.objectContaining({ reason: 'exact_address_required', requestType: 'candidate' }));
  });
});
