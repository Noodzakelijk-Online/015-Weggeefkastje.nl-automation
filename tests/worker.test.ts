import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { AppDatabase } from '../src/db/appDatabase.js';
import { runSocialIntake, scheduleRecurringJobs } from '../src/jobs/runner.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('review-gated social intake worker', () => {
  it('imports actionable mentions once and quarantines ambiguous ones', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeef-worker-')); directories.push(directory);
    const exportPath = join(directory, 'nextdoor.jsonl');
    writeFileSync(exportPath, [
      JSON.stringify({ text: 'Nieuw weggeefkastje met boeken bij Markt 1.', city: 'Delft', addressHint: 'Markt 1', sourceName: 'Nextdoor approved', observedAt: '2026-08-08T10:00:00Z' }),
      JSON.stringify({ text: 'Ik zag ergens een buurtkastje.', sourceName: 'Nextdoor approved', observedAt: '2026-08-08T11:00:00Z' }),
    ].join('\n'));
    const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'test.sqlite'), NEXTDOOR_APPROVED_EXPORT_PATH: exportPath }, directory);
    const database = new AppDatabase(config.databasePath);
    const identity = database.bootstrapAdmin({ email: 'owner@example.nl', password: 'correct-horse-battery', displayName: 'Beheerder', workspaceName: 'Delft' });
    expect(await runSocialIntake(database, config, identity.workspaceId)).toEqual({ imported: 1, ambiguous: 1 });
    expect(await runSocialIntake(database, config, identity.workspaceId)).toEqual({ imported: 0, ambiguous: 1 });
    expect(database.listItems(identity.workspaceId).items).toHaveLength(1);
    expect(database.listItems(identity.workspaceId).items[0].status).toBe('human_review');
    expect(database.listAmbiguousSocialMentions(identity.workspaceId)).toHaveLength(1);
    expect(scheduleRecurringJobs(database, config)).toBe(4);
    expect(scheduleRecurringJobs(database, config)).toBe(4);
    database.close();
  });
});
