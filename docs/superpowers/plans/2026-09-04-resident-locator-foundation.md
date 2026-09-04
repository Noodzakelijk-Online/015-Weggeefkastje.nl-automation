# Resident locator foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, no-account Dutch resident locator with exact address validation, governed source automation, owner updates, and a complete audit trail while preserving the existing authenticated operator workflow.

**Architecture:** Add a canonical resident-location catalog to `AppDatabase`; its database tables, source registry, evidence and events form the only public-read model. The worker normalizes authorized source records and calls an injectable PDOK/BAG verifier before using the source policy to publish or queue a record. A separate React resident shell serves `/`, while the existing operator application continues at `/beheer` and gains catalog/source administration.

**Tech Stack:** Node.js 20+, TypeScript, Express 5, Zod, better-sqlite3, React 19, Vite, Vitest, Supertest, PDOK Locatieserver/BAG, OpenStreetMap Overpass only when explicitly configured.

**Spec:** `docs/superpowers/specs/2026-09-04-resident-locator.md`

## Global Constraints

- All public addresses must have street, house number, postcode and city and must pass an exact PDOK/BAG match before publication.
- Only registered, enabled sources with recorded access rights may be read; automatic publication remains a per-source policy.
- Public responses never include evidence summaries, source links, social text, caretaker details, audit entries or unreviewed records.
- The public root has no account requirement and does not request browser location.
- Facebook stays Graph Page allowlist-only; Nextdoor stays approved JSONL-only; private/browser scraping is forbidden.
- An absence in a source and an anonymous report must never automatically remove a published location.
- `main` remains untouched; implementation runs only in `codex/resident-locator-foundation`.
- Use `npm.cmd` on Windows and keep all provider/network calls mockable in tests.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/domain/residentLocation.ts` | Public, internal and source-policy types plus Zod request schemas. |
| `src/integrations/pdokAddress.ts` | Strict, mockable PDOK/BAG exact-address verifier. |
| `src/adapters/openStreetMap.ts` | Bounded Overpass parser for explicit `amenity=give_box`/`food_sharing` pilot data. |
| `src/db/migrations.ts` | Migration 5 for source, catalog, evidence, change, request and caretaker-token tables/indexes. |
| `src/db/appDatabase.ts` | Transactional catalog APIs, source policy enforcement and audit/event writes. |
| `src/services/residentCatalog.ts` | Candidate-to-canonical-location orchestration and source-key routing. |
| `src/jobs/runner.ts` | Authorized social/OSM/export intake into the canonical catalog; no new writes to legacy `locations`. |
| `src/config.ts` | PDOK, OSM bounded-pilot, public workspace and public rate-limit configuration. |
| `src/api/app.ts` | Unauthenticated public/caretaker API before auth, plus secured source/catalog APIs. |
| `web/src/ResidentApp.tsx` | Accessible no-account finder and correction flow. |
| `web/src/CaretakerApp.tsx` | Limited token-based owner update screen. |
| `web/src/admin/ResidentCatalogView.tsx` | Authenticated record review and caretaker-link management. |
| `web/src/admin/SourceRegistryView.tsx` | Authenticated source-policy management. |
| `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css` | Route public/owner/admin screens and expose the administration views. |
| `tests/*.test.ts` | Database, verifier, source adapter, public API, caretaker, worker and route regressions. |
| `README.md`, `docs/COMPLIANCE_AND_PRIVACY.md` | Accurate product and operational documentation. |

## Task 1: Define resident-catalog contracts

**Files:**
- Create: `src/domain/residentLocation.ts`
- Test: `tests/residentLocationDomain.test.ts`

**Interfaces:**
- Produces `SourceRegistryRecord`, `ResidentLocation`, `VerifiedAddress`, `ResidentCandidate`, `PublicResidentLocation`, `sourceRegistrySchema`, `residentCandidateSchema`, `caretakerUpdateSchema` and `publicReportSchema`.
- Consumes no database or HTTP layer.

- [ ] **Step 1: Write the failing contract tests**

```ts
expect(residentCandidateSchema.safeParse({
  sourceKey: 'facebook-graph-pages',
  title: 'Weggeefkastje',
  address: 'Voorbeeldstraat 10',
  city: 'Utrecht',
  observedAt: '2026-09-04T10:00:00.000Z',
  evidenceSummary: 'Door bron gemeld',
}).success).toBe(true);

expect(caretakerUpdateSchema.safeParse({ address: 'Voorbeeldstraat 10', city: 'Utrecht', status: 'active' }).success).toBe(false);
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `npm.cmd test -- tests/residentLocationDomain.test.ts`

Expected: FAIL because `src/domain/residentLocation.ts` does not exist.

- [ ] **Step 3: Implement the minimal contracts**

```ts
export const exactAddressSchema = z.object({
  address: z.string().trim().min(5).max(240).regex(/\d/, 'Een huisnummer is verplicht.'),
  postalCode: z.string().trim().regex(/^\d{4}\s?[A-Z]{2}$/i),
  city: z.string().trim().min(2).max(120),
});

export const caretakerUpdateSchema = exactAddressSchema.extend({
  status: z.enum(['active', 'inactive']),
  title: z.string().trim().min(3).max(160).optional(),
  categories: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
});
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `npm.cmd test -- tests/residentLocationDomain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/residentLocation.ts tests/residentLocationDomain.test.ts
git commit -m "feat: define resident catalog contracts"
```

## Task 2: Add strict PDOK/BAG address verification

**Files:**
- Create: `src/integrations/pdokAddress.ts`
- Test: `tests/pdokAddress.test.ts`
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes `ExactAddressInput` from `src/domain/residentLocation.ts`.
- Produces `createPdokAddressVerifier(options): AddressVerifier` and `verify(input): Promise<VerifiedAddress | undefined>`.
- Adds `config.addressVerification` with a validated HTTPS PDOK base URL and bounded timeout.

- [ ] **Step 1: Write failing verifier and configuration tests**

```ts
const verifier = createPdokAddressVerifier({ fetchImpl: async () => new Response(JSON.stringify({
  response: { docs: [{ type: 'adres', straatnaam: 'Voorbeeldstraat', huisnummer: '10',
    postcode: '1234AB', woonplaatsnaam: 'Utrecht', centroide_ll: 'POINT(5.1214 52.0907)' }] },
})) });

await expect(verifier.verify({ address: 'Voorbeeldstraat 10', postalCode: '1234 AB', city: 'Utrecht' }))
  .resolves.toMatchObject({ addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht' });
```

- [ ] **Step 2: Run the verifier/configuration tests to verify they fail**

Run: `npm.cmd test -- tests/pdokAddress.test.ts tests/config.test.ts`

Expected: FAIL because the verifier and `addressVerification` configuration do not exist.

- [ ] **Step 3: Implement exact matching and safe configuration**

```ts
const requestUrl = new URL('/bzk/locatieserver/search/v3_1/free', baseUrl);
requestUrl.searchParams.set('q', `${input.address} ${input.postalCode} ${input.city}`);
requestUrl.searchParams.set('fq', 'type:adres');
requestUrl.searchParams.set('rows', '10');

const exact = docs.find((doc) => sameNormalisedAddress(input, doc));
return exact ? toVerifiedAddress(exact) : undefined;
```

Abort an unavailable or malformed external response and return `undefined`; do not guess from coordinates or a fuzzy first result.

- [ ] **Step 4: Run the verifier/configuration tests to verify they pass**

Run: `npm.cmd test -- tests/pdokAddress.test.ts tests/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/integrations/pdokAddress.ts src/config.ts tests/pdokAddress.test.ts tests/config.test.ts
git commit -m "feat: verify exact resident addresses with PDOK"
```

## Task 3: Create the canonical catalog migration and database operations

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/db/appDatabase.ts`
- Create: `tests/residentCatalogDatabase.test.ts`

**Interfaces:**
- Produces `AppDatabase.listSources`, `createSource`, `updateSource`, `getSourceByKey`, `listResidentLocations`, `getPublicResidentLocation`, `upsertVerifiedResidentLocation`, `queueLocationUpdateRequest`, `createCaretakerLink`, `getCaretakerLocation`, `applyCaretakerUpdate`, and `resolvePublicWorkspaceId`.
- Consumes `SourceRegistryRecord`, `ResidentCandidate`, `VerifiedAddress` and validated request types from Task 1.

- [ ] **Step 1: Write failing transactional database tests**

```ts
const source = database.createSource(workspaceId, actorId, {
  key: 'official-map', name: 'Official map', accessMode: 'official_api',
  authorizationReference: 'contract-2026', attribution: 'Official map',
  publicationMode: 'automatic', enabled: true, allowsExactAddress: true,
});
const location = database.upsertVerifiedResidentLocation(workspaceId, actorId, source, candidate, verified);
expect(database.listPublicResidentLocations(workspaceId, { query: 'Utrecht' }).items).toHaveLength(1);
expect(database.listResidentLocationEvents(workspaceId, location.id)).toContainEqual(expect.objectContaining({ action: 'location.published' }));
```

- [ ] **Step 2: Run the database test to verify it fails**

Run: `npm.cmd test -- tests/residentCatalogDatabase.test.ts`

Expected: FAIL because migration 5 and catalog APIs do not exist.

- [ ] **Step 3: Implement migration 5 and transaction boundaries**

```sql
CREATE TABLE resident_locations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  address_key TEXT NOT NULL,
  title TEXT NOT NULL,
  address_line TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','inactive','removed')),
  publication_status TEXT NOT NULL CHECK(publication_status IN ('published','review')),
  address_verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  UNIQUE(workspace_id, address_key)
);
```

Wrap a catalog write, evidence write, `resident_location_events` write and existing `audit_events` write in one SQLite transaction. Do not read or write legacy `locations` from these methods.

- [ ] **Step 4: Run the database test to verify it passes**

Run: `npm.cmd test -- tests/residentCatalogDatabase.test.ts`

Expected: PASS, including cross-workspace isolation and unverified-report non-removal.

- [ ] **Step 5: Commit**

```powershell
git add src/db/migrations.ts src/db/appDatabase.ts tests/residentCatalogDatabase.test.ts
git commit -m "feat: add canonical resident location catalog"
```

## Task 4: Orchestrate source policy, candidates and owner updates

**Files:**
- Create: `src/services/residentCatalog.ts`
- Modify: `src/db/appDatabase.ts`
- Create: `tests/residentCatalogService.test.ts`

**Interfaces:**
- Consumes `AppDatabase`, an `AddressVerifier`, source key and `ResidentCandidate`.
- Produces `ingestResidentCandidate(dependencies, input)` returning `published`, `review`, `duplicate` or `rejected` outcome.
- Produces `applyCaretakerChange(dependencies, token, input)` after a fresh address verification.

- [ ] **Step 1: Write failing source-policy tests**

```ts
await expect(ingestResidentCandidate(deps, candidateFor('automatic-source')))
  .resolves.toMatchObject({ disposition: 'published' });
await expect(ingestResidentCandidate(deps, candidateFor('review-source')))
  .resolves.toMatchObject({ disposition: 'review' });
await expect(ingestResidentCandidate(deps, candidateWithoutPostcode))
  .resolves.toMatchObject({ disposition: 'review', reason: 'exact_address_required' });
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `npm.cmd test -- tests/residentCatalogService.test.ts`

Expected: FAIL because candidate orchestration does not exist.

- [ ] **Step 3: Implement the deterministic decision service**

```ts
const source = database.getSourceByKey(workspaceId, candidate.sourceKey);
if (!source || !source.enabled || !source.allowsExactAddress) return database.queueLocationUpdateRequest(...);
const verified = await verifier.verify(toExactAddressInput(candidate));
if (!verified) return database.queueLocationUpdateRequest(...);
if (source.publicationMode === 'review') return database.queueLocationUpdateRequest(...);
return database.upsertVerifiedResidentLocation(workspaceId, actorUserId, source, candidate, verified);
```

Give `owner-caretaker` a dedicated automatic policy only after a valid hashed token resolves to its one location. Source disappearance does not call an update method.

- [ ] **Step 4: Run the service test to verify it passes**

Run: `npm.cmd test -- tests/residentCatalogService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/residentCatalog.ts src/db/appDatabase.ts tests/residentCatalogService.test.ts
git commit -m "feat: govern resident source ingestion and owner updates"
```

## Task 5: Add bounded OpenStreetMap ingestion and rewire the worker

**Files:**
- Create: `src/adapters/openStreetMap.ts`
- Modify: `src/config.ts`
- Modify: `src/jobs/runner.ts`
- Modify: `src/worker.ts` only if dependency construction needs explicit wiring
- Create: `tests/openStreetMap.test.ts`
- Modify: `tests/worker.test.ts`

**Interfaces:**
- Produces `fetchOpenStreetMapPilotMentions(options): Promise<IntakeItem[]>`.
- Consumes an explicit bounding box, HTTPS Overpass endpoint and mockable `fetchImpl`.
- Worker calls `ingestResidentCandidate` for social/OSM/export evidence and never `openDatabase(...).upsertLocation`.

- [ ] **Step 1: Write failing bounded-OSM and worker tests**

```ts
const mentions = await fetchOpenStreetMapPilotMentions({
  boundingBox: '52.05,5.05,52.15,5.20',
  fetchImpl: mockOverpassResponseWithExactAddress,
});
expect(mentions[0]).toMatchObject({ sourceKind: 'open_data', addressHint: 'Voorbeeldstraat 10', city: 'Utrecht' });
expect(requestedQuery).toContain('amenity');
expect(requestedQuery).toContain('give_box');
```

- [ ] **Step 2: Run the adapter and worker tests to verify they fail**

Run: `npm.cmd test -- tests/openStreetMap.test.ts tests/worker.test.ts`

Expected: FAIL because no bounded OSM adapter or canonical worker integration exists.

- [ ] **Step 3: Implement allowed source paths only**

```ts
if (!config.provider.openStreetMapConfigured) return [];
const query = `[out:json][timeout:25];nwr["amenity"~"^(give_box|food_sharing)$"](${bbox});out center tags;`;
const response = await fetchImpl(overpassUrl, { method: 'POST', body: query, headers: { 'content-type': 'text/plain' } });
```

Reject elements lacking `addr:street`, `addr:housenumber`, `addr:postcode` or `addr:city`. Run the adapter only when its registered source is enabled. Keep Facebook and Nextdoor permission checks exactly as they are.

- [ ] **Step 4: Run the adapter and worker tests to verify they pass**

Run: `npm.cmd test -- tests/openStreetMap.test.ts tests/worker.test.ts`

Expected: PASS and no test relies on a live provider.

- [ ] **Step 5: Commit**

```powershell
git add src/adapters/openStreetMap.ts src/config.ts src/jobs/runner.ts src/worker.ts tests/openStreetMap.test.ts tests/worker.test.ts
git commit -m "feat: ingest governed resident location sources"
```

## Task 6: Expose the public and caretaker API safely

**Files:**
- Modify: `src/api/app.ts`
- Create: `tests/publicResidentApi.test.ts`
- Create: `tests/caretakerApi.test.ts`

**Interfaces:**
- Consumes catalog APIs from Tasks 3-4 and `config.publicWorkspaceId`.
- Produces the `/api/public/locations`, report and caretaker endpoints plus protected `/api/resident-locations` and `/api/sources` endpoints.

- [ ] **Step 1: Write failing public API tests**

```ts
const response = await request(app).get('/api/public/locations?query=Utrecht').expect(200);
expect(response.body.data.items[0]).toEqual(expect.objectContaining({
  addressLine: 'Voorbeeldstraat 10', postalCode: '1234AB', city: 'Utrecht',
}));
expect(response.body.data.items[0]).not.toHaveProperty('sourceLink');
await request(app).post(`/api/public/locations/${id}/reports`).send({ reason: 'Bestaat niet meer' }).expect(202);
expect(database.getPublicResidentLocation(workspaceId, id)?.status).toBe('active');
```

- [ ] **Step 2: Run the public API tests to verify they fail**

Run: `npm.cmd test -- tests/publicResidentApi.test.ts tests/caretakerApi.test.ts`

Expected: FAIL because public and caretaker routes do not exist.

- [ ] **Step 3: Implement routes before authentication middleware**

```ts
app.get('/api/public/locations', publicLimiter, (req, res, next) => { /* public fields only */ });
app.post('/api/public/locations/:id/reports', publicLimiter, (req, res, next) => { /* queue only */ });
app.get('/api/public/caretaker/:token', caretakerLimiter, (req, res, next) => { /* token scope */ });
app.post('/api/public/caretaker/:token', caretakerLimiter, (req, res, next) => { /* revalidate then apply */ });
app.use('/api', requireAuth(database));
```

Use Zod parsing, bounded limits, generic 404s for unavailable/non-public locations, CSRF/role checks for all operator writes and a `202` response for untrusted public reports.

- [ ] **Step 4: Run the public API tests to verify they pass**

Run: `npm.cmd test -- tests/publicResidentApi.test.ts tests/caretakerApi.test.ts`

Expected: PASS, including expired/revoked-token and workspace-isolation cases.

- [ ] **Step 5: Commit**

```powershell
git add src/api/app.ts tests/publicResidentApi.test.ts tests/caretakerApi.test.ts
git commit -m "feat: add privacy-safe resident locator API"
```

## Task 7: Build the resident and caretaker user interfaces

**Files:**
- Create: `web/src/ResidentApp.tsx`
- Create: `web/src/CaretakerApp.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/styles.css`
- Test: `npm.cmd run typecheck` and `npm.cmd run build`

**Interfaces:**
- Consumes public JSON from Task 6.
- Produces `/` resident finder, `/kastje-bijwerken/:token` caretaker update experience and `/beheer` route handoff to existing `App`.

- [ ] **Step 1: Write a failing route/component compile check**

```ts
const path = window.location.pathname;
const Screen = path.startsWith('/beheer') ? App : path.startsWith('/kastje-bijwerken/') ? CaretakerApp : ResidentApp;
createRoot(document.getElementById('root')!).render(<StrictMode><Screen /></StrictMode>);
```

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `npm.cmd run typecheck`

Expected: FAIL because the screen components/imports do not exist.

- [ ] **Step 3: Implement the accessible public experience**

```tsx
<form onSubmit={search} aria-label="Zoek een weggeefkastje">
  <label htmlFor="resident-query">Plaats, postcode of straat</label>
  <input id="resident-query" value={query} onChange={(event) => setQuery(event.target.value)} />
  <button type="submit">Zoeken</button>
</form>
```

Render exact address, last verification date and a user-initiated route link. The correction form posts only a limited free-text report to an existing location. The caretaker screen reads and posts only the token-scoped data and never shows evidence/source data.

- [ ] **Step 4: Run the frontend build checks to verify they pass**

Run: `npm.cmd run typecheck; npm.cmd run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add web/src/ResidentApp.tsx web/src/CaretakerApp.tsx web/src/main.tsx web/src/api.ts web/src/styles.css
git commit -m "feat: build public resident finder and owner updater"
```

## Task 8: Add authenticated catalog and source management

**Files:**
- Create: `web/src/admin/ResidentCatalogView.tsx`
- Create: `web/src/admin/SourceRegistryView.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`
- Test: `npm.cmd run typecheck` and `npm.cmd run build`

**Interfaces:**
- Consumes protected `/api/resident-locations` and `/api/sources` APIs from Task 6.
- Produces catalog review, source policy editing and caretaker-link generate/revoke interactions for owner/operator roles.

- [ ] **Step 1: Write the failing admin component imports and view union**

```ts
type View = 'overview' | 'intake' | 'review' | 'publish' | 'coordinate' | 'archive' | 'locations' | 'sources' | 'settings';
```

- [ ] **Step 2: Run the typecheck to verify it fails**

Run: `npm.cmd run typecheck`

Expected: FAIL because the new views and API types are absent.

- [ ] **Step 3: Implement the small management surfaces**

```tsx
<button onClick={() => issueCaretakerLink(location.id)}>Beheerlink maken</button>
<select value={source.publicationMode} onChange={(event) => updateSource(source.id, { publicationMode: event.target.value })}>
  <option value="review">Eerst beoordelen</option>
  <option value="automatic">Automatisch bij exact adres</option>
</select>
```

Require a source access reference and the exact-address permission checkbox before allowing automatic mode. Display audit-safe timestamps and state, not secret/token values after the initial copy dialog.

- [ ] **Step 4: Run the admin build checks to verify they pass**

Run: `npm.cmd run typecheck; npm.cmd run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add web/src/admin/ResidentCatalogView.tsx web/src/admin/SourceRegistryView.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat: manage resident locations and source policies"
```

## Task 9: Document the real product boundary and verify end-to-end

**Files:**
- Modify: `README.md`
- Modify: `docs/COMPLIANCE_AND_PRIVACY.md`
- Modify: `docs/ACCEPTANCE_TESTS.md`
- Modify: `docs/OPERATOR_RUNBOOK.md`
- Test: all test/build/lint commands

**Interfaces:**
- Documents configuration from Task 2/5, source behavior from Tasks 3-5, public/caretaker API from Task 6 and UI paths from Tasks 7-8.

- [ ] **Step 1: Add failing documentation assertions to the acceptance checklist**

```markdown
- [ ] An anonymous browser can find only validated, published locations.
- [ ] A source in review mode never exposes a candidate publicly.
- [ ] A caretaker link cannot read or change another location.
```

- [ ] **Step 2: Run the full test suite before documentation edits**

Run: `npm.cmd test`

Expected: PASS after Tasks 1-8; investigate any regression before documenting success.

- [ ] **Step 3: Update operator and contributor documentation**

Document the `/` versus `/beheer` distinction, `PUBLIC_WORKSPACE_ID`, PDOK/OSM constraints, exact-address publication rule, source registry fields, issued caretaker links, report handling, legacy-importer boundary and external provider limits. Link the official PDOK documentation and OpenStreetMap attribution/license guidance. Do not claim a live Facebook/Nextdoor/Overpass account has been tested.

- [ ] **Step 4: Run all release checks**

Run: `npm.cmd test; npm.cmd run typecheck; npm.cmd run lint; npm.cmd run build`

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```powershell
git add README.md docs/COMPLIANCE_AND_PRIVACY.md docs/ACCEPTANCE_TESTS.md docs/OPERATOR_RUNBOOK.md
git commit -m "docs: document resident locator operations"
```

## Self-review

### Spec coverage

- Resident-first, free, neutral, no-account finder: Tasks 6-7.
- Exact validated address guarantee: Tasks 1-4 and public filtering in Task 6.
- Per-source automatic/review choice and source register: Tasks 3-5 and 8.
- Full audit, no automatic removal and privacy: Tasks 3-4 and API tests in Task 6.
- Facebook/Nextdoor allowed routes and prepared partner boundary: Task 5 and Task 9.
- OSM bounded pilot support: Task 5 and Task 9.
- Owner update path: Tasks 3-4, 6-8.
- Existing operator/legacy safety: Task 5 regression tests and Task 9 full suite.

No specified requirement is left without an implementation task.

### Placeholder scan

The plan contains no deferred markers, vague error-handling instructions or cross-task implementation references. Each code-changing task names the interfaces, files, test, failure command, implementation shape and success command.

### Type consistency

`ExactAddressInput` and `VerifiedAddress` originate in Task 1, `AddressVerifier` in Task 2, `SourceRegistryRecord` and `ResidentLocation` in Task 1, database methods in Task 3, and the orchestrator in Task 4. Later worker, API and React tasks consume those exact named interfaces.

## Execution decision

The user explicitly authorized building everything necessary. Execute inline in this isolated worktree, task by task, with tests after each independently reviewable deliverable. Do not commit, merge or push unless the user separately authorizes that external Git action.
