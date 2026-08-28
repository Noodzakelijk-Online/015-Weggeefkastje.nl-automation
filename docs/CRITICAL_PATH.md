# Critical path

The product outcome is: an operator can turn a trusted signal or manual opportunity into a safely reviewed message, place it manually, coordinate a response/pickup, and retain an auditable history.

1. Create an intake manually, read an approved Nextdoor JSONL export, or read explicitly configured public Facebook Pages through the Graph API.
2. Redact contact details and require a usable location. Deduplicate accepted evidence against the location catalog; quarantine location-less mentions.
3. Store the opportunity as a draft with source evidence and workspace ownership.
4. Submit it through deterministic checks for required content, giveaway-only language, contact privacy and location privacy.
5. A human approves or rejects it. Approval creates a deterministic, redacted placement package.
6. The operator copies the package, posts it outside this tool, and explicitly records that it was placed.
7. Record responses, schedule pickup, confirm completion and archive.
8. Consult workflow, evidence, coordination and audit history at any point.

The automated smoke test is `npm run smoke`. It executes the entire path at API/database level, including the mandatory copy-before-post gate.

## Blocked external acceptance

Live Facebook ingestion needs an approved token, API version and allowed Page IDs. Nextdoor needs an approved export. There is no safe or general-purpose Nextdoor scraping API assumed. External posting remains manual and therefore cannot be end-to-end automated or falsely reported as verified.
