# Acceptance tests

This checklist separates what is proven by local automated tests from what still needs an operator, real permissions or a real provider account. Do not mark an external provider as accepted merely because the local test suite passes.

## Automated acceptance matrix

| Outcome | Evidence in repository | Expected proof |
| --- | --- | --- |
| Public finder has no account requirement | tests/publicResidentApi.test.ts | Anonymous request returns only active, published locations |
| A public result has an exact address and no private evidence | tests/publicResidentApi.test.ts, tests/residentCatalogDatabase.test.ts | Address is present; source summary/link/authorisation reference are absent |
| Public source attribution is visible without exposing permission evidence | tests/publicResidentApi.test.ts | Public attribution endpoint returns name + attribution only |
| Missing postcode, fuzzy address or failed PDOK match cannot publish | tests/residentCatalogService.test.ts, tests/pdokAddress.test.ts | Candidate becomes a review request |
| Automatic source policy can publish only with exact-address permission | tests/residentCatalogDatabase.test.ts, tests/residentCatalogService.test.ts | Automatic active source publishes; review source stays internal |
| An operator can create/update an authorised source and publish a review record | tests/adminResidentApi.test.ts | Authenticated CSRF-protected management route succeeds |
| A public report cannot unpublish a location | tests/publicResidentApi.test.ts, tests/residentCatalogDatabase.test.ts | Request is queued while the visible record remains published |
| Caretaker token is scoped to one location and its address is revalidated | tests/caretakerApi.test.ts | Correct token can update only its own record; invalid token gets no data |
| Caretaker links are issued/revoked through the management API | tests/adminResidentApi.test.ts | Creation returns a one-time URL; historical link records expose no raw token |
| OSM pilot accepts only bounded Dutch area and complete OSM addresses | tests/openStreetMap.test.ts, tests/config.test.ts | Invalid bbox/input is rejected; only qualifying elements become intake candidates |
| Facebook/Nextdoor access remains bounded | tests/socialEvidence.test.ts, tests/worker.test.ts | Page allowlist/export parsing; no browser/private scraping path |
| Worker processing is idempotent | tests/worker.test.ts | Same approved export does not create duplicate public locations |
| Public/admin/caretaker route split is preserved | tests/webRoutes.test.ts | Root, /beheer and /kastje-bijwerken/:token resolve to distinct React screens |
| Existing manual placement workflow remains protected | tests/critical-path.test.ts | Copy/review gate and manual post confirmation still work |
| Sessions, CSRF, workspace isolation and configuration fail closed | tests/critical-path.test.ts, tests/database-boundaries.test.ts, tests/config.test.ts | Unauthorized/cross-workspace/unsafe configuration use fails |
| Code is releasable locally | npm run lint; npm run typecheck; npm test; npm run build | All commands must exit successfully |

Run the full local suite with:

    npm run lint
    npm run typecheck
    npm test
    npm run build

On Windows, use **npm.cmd run ...** if PowerShell blocks the local npm shim.

## Manual product acceptance

### Resident flow

- [ ] Open **/** in an unauthenticated browser.
- [ ] Confirm that the first visible screen is the resident finder, not a login screen.
- [ ] Search by city, postcode and street against a controlled test location.
- [ ] Confirm that every displayed record has street+house number, postcode and city.
- [ ] Confirm that no result, detail or page source shows evidence summary, source URL, authorisation reference, caretaker token or operator email.
- [ ] Open the Route control and confirm it is a user-initiated external navigation.
- [ ] Send a correction report and verify that it creates a pending request without unpublishing the location.
- [ ] Check desktop and a narrow mobile viewport for clipped controls, unreadable text, console errors and framework error overlays.

### Caretaker flow

- [ ] Create a caretaker link in **/beheer → Kastjes**.
- [ ] Copy the one-time URL through an approved channel; do not paste it into logs, screenshots or tickets.
- [ ] Open the link in a fresh browser session and confirm it reveals only that one location.
- [ ] Submit a valid address change and confirm that PDOK verification succeeds before the public record changes.
- [ ] Try an invalid postcode/address combination and confirm it remains rejected.
- [ ] Make the cupboard inactive and confirm it disappears from **/**.
- [ ] Revoke the link, then confirm that it no longer works.

### Source policy flow

- [ ] For every live source, verify written permission, terms and licence outside the application.
- [ ] Register the source with the correct key, access mode, authorisation reference and public attribution.
- [ ] Keep **Eerst beoordelen** enabled for a new or unproven source.
- [ ] Attempt to choose automatic mode without enabling the source or granting exact-address permission; confirm it is refused.
- [ ] Run one controlled worker cycle and inspect source status, catalog event and audit entry.
- [ ] For OpenStreetMap, confirm the chosen endpoint/bounding box is intentionally small and the required attribution is rendered on public output.
- [ ] For Facebook/Nextdoor, prove only the owned/authorised Page or export is being read; never test via browser scraping.

### Deployment and recovery

- [ ] Confirm **/health** and **/ready** on the deployment host.
- [ ] Confirm that a multi-workspace installation sets **PUBLIC_WORKSPACE_ID** and that the wrong/no ID does not expose data.
- [ ] Run a backup, checksum it and perform a documented restore rehearsal on non-production data.
- [ ] Confirm file permissions protect .env, SQLite files, source exports, backups and logs.
- [ ] If using a public HTTPS proxy, verify secure cookies, trusted proxy settings, stable base URL and disabled remote first setup.

## External acceptance gates

These are intentionally outside automated local tests:

- Meta app/token review, Page access and real Graph API response;
- written permission plus a real approved Nextdoor export, or a future Nextdoor partner/API agreement;
- terms/licence review and capacity acceptance for a chosen Overpass endpoint;
- a controlled live PDOK call from the target deployment network;
- the owner’s consent to make a specific exact household-adjacent address public;
- production hosting, TLS, backup retention and incident-response acceptance.

See [README.md](../README.md), [COMPLIANCE_AND_PRIVACY.md](COMPLIANCE_AND_PRIVACY.md) and [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md).
