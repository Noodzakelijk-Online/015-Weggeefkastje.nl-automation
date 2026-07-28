import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/db/sqlite.js';
import { startServer } from '../src/server.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local review API', () => {
  it('lists quarantined records and requires an explicit approval action', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeefkastje-server-test-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'test.sqlite');
    const db = openDatabase(databasePath);
    const pending = db.upsertLocation({
      title: 'Buurtkastje in Utrecht',
      city: 'Utrecht',
      addressHint: 'Voorbeeldstraat 10',
      status: 'active',
      confidence: 75,
      needsReview: true,
      evidenceSummary: 'Approved social export',
      sourceKind: 'approved_export',
      sourceName: 'approved-nextdoor-export',
      observedAt: '2026-07-28T10:00:00.000Z',
      categories: ['Houdbare producten'],
    });
    db.close();

    const server = startServer({ databasePath, port: 0 });
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      const queue = await fetch(`http://127.0.0.1:${port}/review`).then((response) => response.json() as Promise<{ locations: Array<{ id: string }> }>);
      expect(queue.locations).toHaveLength(1);
      expect(queue.locations[0].id).toBe(pending.id);

      const approved = await fetch(`http://127.0.0.1:${port}/review/${pending.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      }).then((response) => response.json() as Promise<{ location: { status: string; needsReview: boolean } }>);
      expect(approved.location).toEqual(expect.objectContaining({ status: 'active', needsReview: false }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
