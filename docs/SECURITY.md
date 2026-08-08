# Security and threat model

Report a vulnerability privately to the repository owner. Do not include tokens, personal data or production databases in an issue.

## Assets and trust boundaries

- Assets: workspace data, approximate locations, evidence links, session tokens, provider credentials and audit history.
- Untrusted inputs: browser bodies/queries, JSONL exports, Facebook API responses, environment variables and backup paths.
- External boundaries: browser, filesystem, Facebook Graph API, approved Nextdoor export process and reverse proxy.

## Controls

- Passwords are scrypt hashes; opaque session tokens are stored only as SHA-256 hashes.
- Session cookies are HttpOnly and SameSite=Strict. Mutations require a per-session CSRF token.
- Roles are `owner`, `operator`, `viewer`; all product data queries are workspace scoped.
- JSON is capped at 256 KiB, endpoints are rate limited, and Helmet sets CSP/frame/object/referrer protections.
- Public binding is denied unless explicitly enabled. Production network binding requires an HTTPS base URL and secure cookies.
- Database, provider-export, backup, restore and support paths stay inside `APP_DATA_DIR`.
- Provider tokens remain server-side and are redacted from diagnostics/support output.
- Facebook pagination must stay HTTPS on `graph.facebook.com`; only configured Page IDs are queried.
- Message packages redact email/phone details. No autonomous external write exists.
- Audit records cover login, creation, editing, review, copying, workflow changes, privacy deletion and safety-stop changes.

## Residual risks

- An approved export can still contain misleading public text; human review is the mitigation.
- SQLite file access equals data access. Protect the host, volume, backups and filesystem permissions.
- A compromised Facebook token can expose only the provider scope granted by the owner; rotate/revoke it at Meta and replace `.env` immediately.
- The legacy loopback review API predates product authentication. Keep the server loopback-only and migrate consumers to `/api`.

## Incident response

1. Enable the workspace safety stop.
2. Stop the worker.
3. Revoke provider credentials at the provider.
4. Take an online backup and generate a redacted support bundle.
5. Inspect audit and workflow history; do not delete evidence during triage.
6. Rotate credentials, repair configuration, run `npm run doctor`, and resume with one controlled intake.
