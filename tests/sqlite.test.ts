import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../src/db/sqlite.js';
import type { LocationRecordInput } from '../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function input(overrides: Partial<LocationRecordInput> = {}): LocationRecordInput {
  return {
    title: 'Buurtkastje in Utrecht',
    city: 'Utrecht',
    status: 'active',
    confidence: 80,
    needsReview: false,
    evidenceSummary: 'Public source evidence',
    sourceKind: 'official',
    sourceName: 'test-source',
    observedAt: '2026-07-26T10:00:00.000Z',
    categories: ['Boeken'],
    ...overrides,
  };
}

describe('coordinate deduplication', () => {
  it('merges nearby coordinates and keeps both evidence items', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeefkastje-test-'));
    temporaryDirectories.push(directory);
    const db = openDatabase(join(directory, 'test.sqlite'));

    try {
      const first = db.upsertLocation(input({ addressHint: 'Voorbeeldstraat 1', latitude: 52.0907, longitude: 5.1214 }));
      const second = db.upsertLocation(input({
        title: 'Een andere omschrijving',
        addressHint: 'Zonder bekend adres',
        sourceName: 'second-source',
        latitude: 52.0909,
        longitude: 5.1214,
      }));

      expect(second.id).toBe(first.id);
      expect(db.listLocations()).toHaveLength(1);
      expect(db.listLocations()[0].evidenceCount).toBe(2);
    } finally {
      db.close();
    }
  });

  it('does not merge coordinates more than fifty metres apart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeefkastje-test-'));
    temporaryDirectories.push(directory);
    const db = openDatabase(join(directory, 'test.sqlite'));

    try {
      db.upsertLocation(input({ addressHint: 'Voorbeeldstraat 1', latitude: 52.0907, longitude: 5.1214 }));
      db.upsertLocation(input({
        title: 'Ander kastje',
        addressHint: 'Voorbeeldstraat 99',
        latitude: 52.092,
        longitude: 5.1214,
      }));

      expect(db.listLocations()).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('flags an unverified removal report for review without unpublishing an active location', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeefkastje-test-'));
    temporaryDirectories.push(directory);
    const db = openDatabase(join(directory, 'test.sqlite'));

    try {
      db.upsertLocation(input({ addressHint: 'Voorbeeldstraat 1', sourceKind: 'official' }));
      const updated = db.upsertLocation(input({
        addressHint: 'Voorbeeldstraat 1',
        sourceKind: 'approved_export',
        sourceName: 'approved-nextdoor-export',
        status: 'removed',
        needsReview: true,
      }));

      expect(updated.status).toBe('active');
      expect(updated.needsReview).toBe(true);
      expect(updated.evidenceCount).toBe(2);
    } finally {
      db.close();
    }
  });

  it('requires an explicit review decision before publishing or removing a quarantined location', () => {
    const directory = mkdtempSync(join(tmpdir(), 'weggeefkastje-test-'));
    temporaryDirectories.push(directory);
    const db = openDatabase(join(directory, 'test.sqlite'));

    try {
      const pending = db.upsertLocation(input({
        sourceKind: 'social_api',
        addressHint: 'Voorbeeldstraat 1',
        needsReview: true,
      }));

      expect(db.listLocationsNeedingReview()).toHaveLength(1);
      expect(db.reviewLocation(pending.id, 'approve')).toMatchObject({ status: 'active', needsReview: false });
      expect(db.listLocationsNeedingReview()).toHaveLength(0);
      expect(db.reviewLocation(pending.id, 'mark_removed')).toMatchObject({ status: 'removed', needsReview: false });
    } finally {
      db.close();
    }
  });
});
