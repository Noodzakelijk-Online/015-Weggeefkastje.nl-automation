# Implementation Plan

## Stage 1 — MVP ingestion and storage

Goal: create a working local-first pipeline that can ingest official-site entries and manual/social tips.

Deliverables:

- TypeScript project scaffold;
- SQLite database schema;
- `weggeefkastje.nl` adapter skeleton;
- manual JSONL import adapter;
- normalised `LocationCandidate` model;
- run audit log;
- JSON export.

Acceptance criteria:

- `npm run dev` processes sample data without crashing;
- all ingested items are stored with source evidence;
- manual tips can be imported from `data/manual-tips.example.jsonl`;
- output is written to `data/exports/locations.json`.

## Stage 2 — Normalisation and deduplication

Goal: prevent duplicates and create a single canonical record per kastje.

Deliverables:

- address and city normalisation;
- text similarity matching;
- coordinate-distance matching once geocoded;
- source confidence scoring;
- duplicate merge logic;
- `needs_review` flag for uncertain merges.

Acceptance criteria:

- repeated mentions of the same kastje are linked as evidence;
- uncertain matches are not merged automatically;
- every merge decision is auditable.

## Stage 3 — Enrichment

Goal: make records useful for a map and for ongoing maintenance.

Deliverables:

- geocoding service abstraction;
- municipality/province enrichment;
- stale-data detection;
- status inference from evidence text;
- confidence score calculation.

Acceptance criteria:

- entries can be enriched into approximate coordinates;
- entries can be filtered by municipality/province;
- old unverified entries are marked as stale or `needs_verification`.

## Stage 4 — Admin review dashboard/API

Goal: allow a human to quickly approve, reject, merge, or correct uncertain records.

Deliverables:

- lightweight local API;
- review queue;
- actions: approve, reject, merge, mark removed, update status;
- audit trail.

Acceptance criteria:

- uncertain social-source records are never published without review;
- admin decisions are saved and traceable;
- public exports exclude rejected/private records.

## Stage 5 — Automation and monitoring

Goal: make the tool run reliably with little oversight.

Deliverables:

- scheduled pipeline runs;
- run summaries;
- error logging;
- retry handling;
- export publishing;
- optional notifications.

Acceptance criteria:

- pipeline can run unattended;
- failures are visible;
- stale data and new high-confidence records are highlighted.

## Suggested architecture

```text
src/
  adapters/
    weggeefkastje.ts
    manualTips.ts
  core/
    normalise.ts
    dedupe.ts
    confidence.ts
    status.ts
  db/
    schema.ts
    sqlite.ts
  export/
    jsonExport.ts
  types.ts
  index.ts
```

## First build milestone

A developer should first make these commands work:

```bash
npm install
npm run dev
npm run typecheck
```

The first milestone is complete when sample manual tips are ingested, normalised, stored, and exported.
