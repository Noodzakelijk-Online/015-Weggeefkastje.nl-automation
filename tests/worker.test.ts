import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/appDatabase.js';
import { runSocialIntake, scheduleRecurringJobs } from '../src/jobs/runner.js';
import type { AddressVerifier } from '../src/integrations/pdokAddress.js';

const directories: string[] = [];
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('review-gated social intake worker', () => {
  it('imports actionable mentions once and quarantines ambiguous ones', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeef-worker-')); directories.push(directory);
    const exportPath = join(directory, 'nextdoor.jsonl');
    writeFileSync(exportPath, [
      JSON.stringify({ text: 'Nieuw weggeefkastje met boeken bij Markt 1.', city: 'Delft', postalCode: '2611 GV', addressHint: 'Markt 1', sourceName: 'Nextdoor approved', observedAt: '2026-08-08T10:00:00Z' }),
      JSON.stringify({ text: 'Ik zag ergens een buurtkastje.', sourceName: 'Nextdoor approved', observedAt: '2026-08-08T11:00:00Z' }),
    ].join('\n'));
    const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite'), NEXTDOOR_APPROVED_EXPORT_PATH: exportPath }, directory);
    const database = new AppDatabase(config.databasePath);
    databases.push(database);
    const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Beheerder', workspaceName: 'Delft' });
    database.createSource(identity.workspaceId, identity.userId, {
      key: 'nextdoor-approved-export', name: 'Nextdoor export', accessMode: 'approved_export',
      authorizationReference: 'written-admin-permission', attribution: 'Nextdoor export',
      publicationMode: 'automatic', enabled: true, allowsExactAddress: true,
    });
    const verifier: AddressVerifier = {
      verify: async () => ({
        addressLine: 'Markt 1', postalCode: '2611GV', city: 'Delft', municipality: 'Delft', province: 'Zuid-Holland',
        latitude: 52.0116, longitude: 4.3571, provider: 'pdok', verifiedAt: '2026-08-08T10:05:00.000Z',
      }),
    };
    expect(await runSocialIntake(database, config, identity.workspaceId, { verifier })).toEqual({ imported: 1, ambiguous: 1 });
    expect(await runSocialIntake(database, config, identity.workspaceId, { verifier })).toEqual({ imported: 0, ambiguous: 1 });
    expect(database.listItems(identity.workspaceId).items).toHaveLength(0);
    expect(database.listPublicResidentLocations(identity.workspaceId).items).toHaveLength(1);
    expect(database.listAmbiguousSocialMentions(identity.workspaceId)).toHaveLength(1);
    expect(scheduleRecurringJobs(database, config)).toBe(4);
    expect(scheduleRecurringJobs(database, config)).toBe(4);
  });
});
