import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { LocationRecordInput, StoredLocation } from '../types.js';
import { duplicateKey, normaliseKey } from '../core/normalise.js';
import { distanceInMetres } from '../core/distance.js';

const COORDINATE_DUPLICATE_DISTANCE_METRES = 50;

export interface AppDb {
  close(): void;
  upsertLocation(input: LocationRecordInput): StoredLocation;
  listLocations(): StoredLocation[];
}

function encodeCategories(categories: StoredLocation['categories']): string {
  return JSON.stringify(categories ?? []);
}

function decodeCategories(value: string | null | undefined): StoredLocation['categories'] {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function openDatabase(path: string): AppDb {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      duplicate_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      city TEXT,
      address_hint TEXT,
      status TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      needs_review INTEGER NOT NULL,
      evidence_summary TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_link TEXT,
      observed_at TEXT NOT NULL,
      categories_json TEXT NOT NULL DEFAULT '[]',
      latitude REAL,
      longitude REAL,
      municipality TEXT,
      province TEXT,
      evidence_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_link TEXT,
      observed_at TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      imported_count INTEGER NOT NULL DEFAULT 0,
      exported_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );
  `);

  const existingColumns = db.prepare('PRAGMA table_info(locations)').all() as Array<{ name: string }>;
  const hasColumn = (name: string) => existingColumns.some((column) => column.name === name);
  if (!hasColumn('categories_json')) db.exec("ALTER TABLE locations ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]'");
  if (!hasColumn('latitude')) db.exec('ALTER TABLE locations ADD COLUMN latitude REAL');
  if (!hasColumn('longitude')) db.exec('ALTER TABLE locations ADD COLUMN longitude REAL');
  if (!hasColumn('municipality')) db.exec('ALTER TABLE locations ADD COLUMN municipality TEXT');
  if (!hasColumn('province')) db.exec('ALTER TABLE locations ADD COLUMN province TEXT');

  const selectByKey = db.prepare('SELECT * FROM locations WHERE duplicate_key = ?');
  const selectById = db.prepare('SELECT * FROM locations WHERE id = ?');
  const selectWithCoordinates = db.prepare('SELECT * FROM locations WHERE latitude IS NOT NULL AND longitude IS NOT NULL');
  const insertLocation = db.prepare(`
    INSERT INTO locations (
      id, duplicate_key, title, city, address_hint, status, confidence, needs_review,
      evidence_summary, source_kind, source_name, source_link, observed_at, categories_json,
      latitude, longitude, municipality, province, evidence_count, created_at, updated_at
    ) VALUES (
      @id, @duplicateKey, @title, @city, @addressHint, @status, @confidence, @needsReview,
      @evidenceSummary, @sourceKind, @sourceName, @sourceLink, @observedAt, @categoriesJson,
      @latitude, @longitude, @municipality, @province, @evidenceCount, @createdAt, @updatedAt
    )
  `);
  const updateLocation = db.prepare(`
    UPDATE locations SET
      title = @title,
      city = @city,
      address_hint = @addressHint,
      status = @status,
      confidence = @confidence,
      needs_review = @needsReview,
      evidence_summary = @evidenceSummary,
      source_kind = @sourceKind,
      source_name = @sourceName,
      source_link = @sourceLink,
      observed_at = @observedAt,
      categories_json = @categoriesJson,
      latitude = COALESCE(@latitude, latitude),
      longitude = COALESCE(@longitude, longitude),
      municipality = COALESCE(@municipality, municipality),
      province = COALESCE(@province, province),
      evidence_count = evidence_count + 1,
      updated_at = @updatedAt
    WHERE id = @id
  `);
  const insertEvidence = db.prepare(`
    INSERT INTO evidence (
      id, location_id, source_kind, source_name, source_link, observed_at, summary, created_at
    ) VALUES (
      @id, @locationId, @sourceKind, @sourceName, @sourceLink, @observedAt, @summary, @createdAt
    )
  `);
  const listLocationsStmt = db.prepare('SELECT * FROM locations ORDER BY city, title');

  function mapRow(row: any): StoredLocation {
    return {
      id: row.id,
      title: row.title,
      city: row.city ?? undefined,
      addressHint: row.address_hint ?? undefined,
      status: row.status,
      confidence: row.confidence,
      needsReview: row.needs_review === 1,
      evidenceSummary: row.evidence_summary,
      sourceKind: row.source_kind,
      sourceName: row.source_name,
      sourceLink: row.source_link ?? undefined,
      observedAt: row.observed_at,
      categories: decodeCategories(row.categories_json),
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      municipality: row.municipality ?? undefined,
      province: row.province ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      evidenceCount: row.evidence_count,
    };
  }

  function upsertLocation(input: LocationRecordInput): StoredLocation {
    const now = new Date().toISOString();
    const key = duplicateKey(input);
    const keyMatch = selectByKey.get(key) as any | undefined;
    const inputCoordinates = typeof input.latitude === 'number' && typeof input.longitude === 'number'
      ? { latitude: input.latitude, longitude: input.longitude }
      : undefined;
    const coordinateMatch = !keyMatch && inputCoordinates
      ? (selectWithCoordinates.all() as any[]).find((location) => {
          const sameCity = !input.city || !location.city || normaliseKey(input.city) === normaliseKey(location.city);
          return sameCity && distanceInMetres(inputCoordinates, location) <= COORDINATE_DUPLICATE_DISTANCE_METRES;
        })
      : undefined;
    const existing = keyMatch ?? coordinateMatch;

    const nextConfidence = existing ? Math.max(existing.confidence, input.confidence) : input.confidence;
    const payload = {
      id: existing?.id ?? randomUUID(),
      duplicateKey: key,
      ...input,
      city: input.city ?? null,
      addressHint: input.addressHint ?? null,
      sourceLink: input.sourceLink ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      municipality: input.municipality ?? null,
      province: input.province ?? null,
      categoriesJson: encodeCategories(input.categories),
      confidence: nextConfidence,
      needsReview: input.needsReview ? 1 : 0,
      evidenceCount: existing ? existing.evidence_count + 1 : 1,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    if (existing) {
      updateLocation.run(payload);
    } else {
      insertLocation.run(payload);
    }

    insertEvidence.run({
      id: randomUUID(),
      locationId: payload.id,
      sourceKind: input.sourceKind,
      sourceName: input.sourceName,
      sourceLink: input.sourceLink ?? null,
      observedAt: input.observedAt,
      summary: input.evidenceSummary,
      createdAt: now,
    });

    return mapRow(selectById.get(payload.id));
  }

  return {
    close: () => db.close(),
    upsertLocation,
    listLocations: () => listLocationsStmt.all().map(mapRow),
  };
}
