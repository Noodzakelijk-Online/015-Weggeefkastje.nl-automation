# Weggeefkastje.nl Automation

Automation project for collecting, normalising, enriching, deduplicating, and updating information about **weggeefkastjes across the Netherlands**.

The goal is not only to mirror the current state of `weggeefkastje.nl`, but also to detect public signals from other permitted sources where people often report new, moved, removed, or outdated giveaway cupboards.

## Core goal

Build a reliable local-first data pipeline that can:

1. collect candidate weggeefkastjes from approved sources;
2. normalise messy source text into one structured location model;
3. enrich locations with geocoding, municipality, province, and source evidence;
4. deduplicate repeated reports across websites, Facebook groups, Nextdoor, search results, and manual tips;
5. classify each kastje as `active`, `uncertain`, `removed`, or `needs_verification`;
6. keep provenance so every decision can be traced back to its evidence;
7. export clean data for a map, dashboard, CSV, JSON, or API.

## Important compliance rule

This project must **not** bypass login walls, CAPTCHAs, robots restrictions, platform access controls, private groups, or personal privacy settings.

For Facebook, Nextdoor, WhatsApp, and similar platforms, the approved collection methods are:

- official APIs where available and permitted;
- public pages or public posts only where terms allow automated access;
- group-admin-approved exports;
- user-submitted tips;
- manual copy/paste imports;
- email or form submissions from volunteers.

The tool may store the existence, status, and approximate location of a kastje. It should avoid storing unnecessary personal data about the person who posted it.

See `docs/COMPLIANCE_AND_PRIVACY.md`.

## Proposed MVP flow

```text
source adapters
   ↓
raw source items
   ↓
normalisation
   ↓
deduplication
   ↓
geocoding + enrichment
   ↓
confidence scoring
   ↓
SQLite storage
   ↓
exports / dashboard / API
```

## Source strategy

### 1. Weggeefkastje.nl adapter

Primary adapter for data already published on the official website.

Because the current HTML/API structure still needs to be inspected during implementation, this adapter is selector-driven through environment variables. Once the website structure is confirmed, selectors can be locked down and covered by tests.

### 2. Manual/social tip adapter

For Facebook, Nextdoor, WhatsApp, local neighbourhood apps, and similar channels, this repo starts with a safe manual import path:

```text
data/manual-tips.jsonl
```

Each line is one JSON object containing source text, source URL if available, city, address hint, and status hint.

### 3. Future adapters

Possible future adapters:

- OpenStreetMap / Overpass candidate search;
- municipal open data if available;
- volunteer submission form;
- email inbox parser;
- approved Facebook Graph API integration;
- approved group export parser;
- Nextdoor partner/export workflow if legally and technically available.

## Social evidence automation

The pipeline can automatically ingest only approved social evidence. It does not crawl private spaces or bypass platform controls.

- **Facebook:** set a Graph API version, an access token, and the explicitly approved Page IDs in `FACEBOOK_PAGE_CONTEXTS_JSON`. Only posts from those Pages are requested.
- **Nextdoor:** export data with the group's or platform's approval, save it as JSON Lines, and point `NEXTDOOR_APPROVED_EXPORT_PATH` at the file. There is intentionally no Nextdoor scraper.
- **Matching:** a social mention must contain an address or coordinates to update a location automatically. Other relevant mentions are saved to `SOCIAL_REVIEW_PATH` for human review.
- **Safety:** social-source records always remain `needsReview`; an unverified social removal report adds evidence and flags the existing record for review instead of unpublishing it immediately.

Each approved-export line may contain `text` (or `message`), `observedAt`, `link`, `city`, `addressHint`, `latitude`, `longitude`, `statusHint`, `municipality`, and `province`. The intake filters for Dutch giveaway-cupboard terms and redacts email addresses and phone numbers before storing evidence.

Use [data/approved-nextdoor-export.example.jsonl](data/approved-nextdoor-export.example.jsonl) as the JSON Lines schema example. It is sample data only, not a Nextdoor connection.

Run `npm run serve` for the loopback-only review API. `GET /review` lists quarantined locations. `POST /review/:id` with `{ "action": "approve" }`, `{ "action": "reject" }`, or `{ "action": "mark_removed" }` records the operator decision in the local audit log; none of these actions runs automatically.

## Installation

```bash
npm install
cp .env.example .env
npm run dev
```

## Commands

```bash
npm run dev          # run the pipeline in development mode
npm run build        # compile TypeScript
npm run typecheck    # TypeScript validation
npm test             # run tests once tests are added
```

## Data model summary

Main entities:

- `locations`: canonical weggeefkastje records;
- `evidence`: each source mention, post, export row, or website entry supporting a location;
- `runs`: audit log for every pipeline run.

Every location should be traceable back to its supporting source evidence.

## Development stages

1. **MVP ingestion**: website adapter + manual tips + SQLite storage.
2. **Data quality**: dedupe, status inference, confidence score.
3. **Enrichment**: geocoding, municipality/province, stale-data detection.
4. **Review UI/API**: admin review for uncertain matches.
5. **Automation**: scheduled runs, exports, and monitoring.

Full staged plan: `docs/IMPLEMENTATION_PLAN.md`.
