# Security and threat model

Report a vulnerability privately to the repository owner. Do not include tokens, personal data, source exports or production databases in a public issue.

## Assets and trust boundaries

| Asset | Why it needs protection |
| --- | --- |
| Exact public location records | Correctness, resident safety and unwanted exposure risk |
| Internal evidence and permission references | May contain source context or personal data that must not be public |
| Caretaker links | Bearer credentials for one physical location |
| Sessions and user credentials | Access to source policy and catalog management |
| Provider credentials and source exports | External-account scope and private-group permission boundaries |
| SQLite database, backups and logs | Contain the above data and audit history |

Untrusted inputs include browser requests, public reports, caretaker form bodies, JSONL exports, Facebook Graph responses, OSM Overpass responses, environment variables and backup paths.

## Implemented controls

### Public resident API

- Public routes return only locations that are both active and published.
- Exact street+house number, postcode and city are validated against the official PDOK host before a record can be public.
- Evidence summaries, source links, source keys, permissions, audit data, user identities and raw caretaker tokens are not returned by public location routes.
- Public attribution returns only source name and attribution text for sources contributing to visible locations.
- A report is an internal request, not a direct location mutation.
- Public routes are rate limited and marked no-store.

### Authentication and authorisation

- Passwords use scrypt hashes.
- Opaque session tokens and caretaker tokens are stored as SHA-256 hashes.
- Session cookies are HttpOnly and SameSite=Strict.
- Authenticated writes require the session-specific CSRF header.
- Workspace data queries are scoped by workspace ID.
- Roles are owner, operator and viewer. Source/caretaker/publication mutations require owner or operator.
- Caretaker links are scoped to one location, expire and can be revoked. Issuing a replacement revokes earlier active links for that location.

### Source and automation boundaries

- A source must be registered, enabled and explicitly marked as allowed to process exact addresses before the worker reads it.
- Automatic publication additionally requires active status, a complete exact address and successful PDOK verification.
- Facebook ingestion is constrained to configured Page IDs and an official Graph API version.
- Nextdoor ingestion accepts only an approved local export; there is no browser/login scraper.
- OSM uses an HTTPS endpoint and a bounded Dutch pilot box. It accepts only complete qualifying address tags.
- Source disappearance, a single social signal and an anonymous correction report cannot automatically remove a public record.
- External posting and messaging do not exist in the code path.

### Runtime and filesystem

- JSON bodies are size-limited; Helmet sets CSP, frame, object and referrer protections.
- The server defaults to loopback. Public network binding requires explicit configuration; production network binding requires HTTPS base URL and secure cookies.
- Database, export, backup, restore and support paths are constrained to APP_DATA_DIR.
- Provider secrets remain server-side and are not returned by diagnostics/public configuration.
- SQLite uses foreign keys, WAL mode, busy timeout, migrations and integrity diagnostics.

## Residual risks

- A permitted source can still contain a false, stale or malicious claim. Source policy, exact verification, review mode and audit history reduce but do not eliminate that risk.
- An exact address may be adjacent to a private home. The operator must confirm that publication is appropriate and permitted.
- Anyone holding an unrevoked caretaker link can edit its one location until expiry. Send it through a suitable private channel and revoke promptly if exposed.
- SQLite filesystem access is database access. Protect the host, user profile, backups and attached storage.
- A provider token grants whatever external scope its owner configured. The application cannot make an over-scoped credential safe.
- Local automated tests do not prove live provider terms, credentials, TLS deployment, rate capacity or partner acceptance.

## Incident response

1. Enable the workspace safety stop.
2. Stop the worker.
3. If relevant, revoke/rotate the external credential at the provider.
4. Revoke affected caretaker links.
5. Make an online backup and create a redacted support bundle.
6. Inspect source settings, location events and audit events without destroying evidence.
7. Fix the root cause, run diagnostics and resume with one controlled authorised input.

See [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md) for the step-by-step operating procedure and [COMPLIANCE_AND_PRIVACY.md](COMPLIANCE_AND_PRIVACY.md) for permission/data-minimisation requirements.
