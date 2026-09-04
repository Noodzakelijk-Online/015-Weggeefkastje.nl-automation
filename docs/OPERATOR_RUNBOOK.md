# Operator runbook

This runbook is for the person or small team that operates the resident finder, source register and worker. It is deliberately conservative: source access, exact addresses and public visibility have real-world consequences.

## Before first use

1. Copy **.env.example** to **.env** and keep the loopback defaults.
2. Run:

       npm ci
       npm run migrate
       npm run build
       npm start

3. Open http://127.0.0.1:3000/beheer locally and create the first owner.
4. Confirm **/ready** returns ready after setup.
5. Decide which workspace, if any, is public. For more than one workspace, set **PUBLIC_WORKSPACE_ID** to the intended workspace UUID before exposing **/**.
6. Start the worker separately only after a source has been authorised:

       npm run worker

   For one controlled cycle, `npm run ingest` is the safe alias for `npm run worker -- --once`. It uses the governed catalog path. `npm run ingest:legacy` is deliberately separate and must not be used to populate the public resident finder.

Do not expose first setup through ngrok, a reverse proxy or a public network. A network deployment requires a stable HTTPS base URL, secure cookies and explicit network-binding configuration.

## Daily routine

1. Check **/ready** and worker logs.
2. Review **Kastjes** for locations in review and for open change requests.
3. Review **Bronnen** for recently changed authorisation, attribution or source status.
4. Resolve a public report deliberately. Mark the request resolved/dismissed only after deciding what to do; it does not change the location by itself.
5. Give owners a personal caretaker link instead of a shared operator login.
6. Use the existing manual workflow separately for any social-media post. The application never publishes to Facebook or Nextdoor.

## Activate a source safely

### Checklist for every source

Before entering anything in the application, obtain and retain outside the application:

- the source owner/platform’s permission or licence;
- permission for exact addresses, not merely general viewing permission;
- any required public attribution text;
- a clear understanding of data retention and any private-group restrictions.

Then:

1. Place only the permitted technical input in **APP_DATA_DIR** or set the approved server-side credential.
2. Open **/beheer → Bronnen** and create the source with the exact adapter key.
3. Select the access mode that reflects reality.
4. Enter a short, non-secret authorisation reference. Do not paste tokens, passwords or whole emails.
5. Enter the visible attribution/license text.
6. Leave the source disabled or in **Eerst beoordelen** until a controlled dry run has been checked.
7. Enable **De toestemming omvat exacte adressen** only when written permission covers it.
8. Enable the source. Automatic mode is allowed only when the source is enabled and exact-address permission is recorded.
9. Run one worker cycle and inspect source status, resident-location event, audit event and public output.

### Facebook

- Configure both **FACEBOOK_GRAPH_ACCESS_TOKEN** and **FACEBOOK_GRAPH_API_VERSION**.
- Configure only the approved Page IDs in **FACEBOOK_PAGE_CONTEXTS_JSON**.
- Register **facebook-graph-pages** in the source register.
- Do one controlled read; configuration acceptance is not proof that Meta accepts the credential or Page scope.
- Never add group scraping, profile scraping, browser login or posting automation.

### Nextdoor

- Obtain written admin/platform permission before exporting any group/neighbourhood data.
- Put the approved JSONL file inside **APP_DATA_DIR**.
- Set **NEXTDOOR_APPROVED_EXPORT_PATH** and register **nextdoor-approved-export**.
- Verify that the export contains no unnecessary member fields.
- A source file is not a partner agreement. Do not claim Nextdoor integration is live until the platform-authorised path exists.

### OpenStreetMap pilot

- Pick an HTTPS Overpass endpoint that you are allowed to use.
- Set **OSM_OVERPASS_URL** and **OSM_PILOT_BBOX** together. The bbox order is south, west, north, east and must be a small non-empty area inside the Netherlands.
- Register **openstreetmap-pilot** with a correct attribution such as **© OpenStreetMap contributors — ODbL**.
- Start in review mode, inspect examples and scale only after quality and licence review.
- The adapter ignores elements without complete exact OSM address tags; do not weaken this check for coverage.

### Existing map/export

- Use **BUURTKASTJESKAART_EXPORT_PATH** only with permission to use that particular export.
- Register **buurtkastjeskaart-export** and record its attribution/licence.
- Do not replace a controlled export with a screen scrape.

## Review and publication rules

### Candidate has no exact address

Leave it as an internal request. Ask the authorised source owner for a permitted correction if appropriate. Do not approximate the location publicly.

### PDOK cannot verify an address

Do not publish. Check spelling, house number, postcode and city against an allowed source. Do not accept a near match.

### Source is in review mode

The location will remain internal even if PDOK confirms its address. Inspect the evidence via the authenticated process, then choose **Publiceer** in **Kastjes** if it is accurate and appropriate.

### Public correction report says a cupboard is gone

Do not automatically delete or unpublish. Check the report against fresh, authorised evidence or use the owner/caretaker route. Then update the location through a reviewed action.

### Owner says a cupboard is temporarily unavailable

Issue or reuse the scoped caretaker link. The owner can mark the record inactive. It disappears from the resident finder but remains in the catalog and audit trail.

## Caretaker-link handling

- Send the one-time URL only through a suitable private channel.
- Do not put the raw URL in tickets, analytics, screenshots, email lists or audit notes.
- Set a sensible expiry (default is 180 days; maximum is 365).
- A new link revokes existing active links for the same location.
- Use **Beheerlinks** in the catalog to inspect expiration/usage metadata and revoke a link if the recipient changes or the link may be exposed.
- If an owner needs access to a different cupboard, issue a different link; do not share the original.

## Safety stop, failure and incident response

### Provider or worker failure

1. Read the worker error and source status; do not assume an ambiguous timeout failed or succeeded.
2. Leave retries intact while checking a credential, Page scope, export format or Overpass endpoint.
3. Enable the safety stop if the source should not keep attempting.
4. Keep the public catalog available; stopping intake does not require deleting existing verified locations.
5. Resume with one controlled source run after the root cause is understood.

### Suspected privacy or credential incident

1. Enable the safety stop.
2. Stop the worker.
3. Revoke or rotate the affected external credential at the provider.
4. Revoke affected caretaker links when relevant.
5. Make an online backup and generate a redacted support bundle.
6. Inspect audit events, location events and source settings; do not destroy evidence during triage.
7. Correct configuration, run diagnostics and resume only with a controlled source test.

## Backup and recovery

Create a backup:

    npm run backup

Create a checksum:

    npm run cli -- checksum --file data/backups/<file>.sqlite

Restore only after stopping server and worker:

    npm run cli -- restore --from data/backups/<file>.sqlite --confirm

The restore command makes a recovery copy and verifies the reopened database. Preserve the printed recovery path until the restored instance has been accepted. Test backup/restore on non-production data before relying on it.

## Release checklist

Before releasing a code or configuration change:

1. Confirm **.env**, source exports, databases and backups are not staged.
2. Run:

       npm run lint
       npm run typecheck
       npm test
       npm run build
       npm run doctor

3. For a UI change, test **/**, **/beheer** and a caretaker-link route in a browser at desktop and narrow-mobile widths.
4. For a source change, run a controlled, authorised input and check attribution plus public/private data separation.
5. For a migration, create a backup first and verify **/ready** after migration.
6. For public deployment, verify HTTPS, secure cookies, trusted proxy setup, **APP_BASE_URL**, **PUBLIC_WORKSPACE_ID** and disabled remote first setup.
7. Record what was tested and which external acceptance remains pending.

## Related documents

- [README.md](../README.md): product, architecture and configuration reference
- [COMPLIANCE_AND_PRIVACY.md](COMPLIANCE_AND_PRIVACY.md): source permission and minimisation rules
- [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md): automated and manual acceptance criteria
- [SECURITY.md](SECURITY.md): technical controls and residual risk
