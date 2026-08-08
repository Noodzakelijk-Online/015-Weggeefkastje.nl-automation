# Weggeefkastje.nl Automation

A local-first Dutch operator workspace for finding, checking, publishing and coordinating weggeefkastje opportunities. It combines the existing location catalog with a review-gated exchange workflow.

The system never logs into or scrapes private Facebook or Nextdoor spaces. Facebook intake uses the official Graph API for explicitly configured Pages. Nextdoor intake accepts an administrator-approved JSONL export. Every new social mention is deduplicated against the SQLite catalog and either enters human review or an ambiguity queue. Publication is always manual.

## Working flow

```text
manual intake / approved export / Facebook Page API
  -> contact redaction and location validation
  -> 50 metre catalog deduplication
  -> deterministic safety rules
  -> human approval
  -> reviewed message package
  -> operator copies and posts it manually
  -> response and pickup coordination
  -> completion and archive
```

## Quick start

Requirements: Node.js 20 through 25, npm, and a supported compiler environment for `better-sqlite3` when no prebuilt binary is available.

```powershell
Copy-Item .env.example .env
npm ci
npm run migrate
npm run dev
```

Open `http://127.0.0.1:5173`, create the first owner account with a password of at least 12 characters, and add an intake. The API is proxied to `127.0.0.1:3000`.

For the production-like single server:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Run the scheduler/worker separately:

```powershell
npm run worker
```

## Provider activation

- Facebook requires `FACEBOOK_GRAPH_ACCESS_TOKEN`, a pinned `FACEBOOK_GRAPH_API_VERSION`, and an allowlist in `FACEBOOK_PAGE_CONTEXTS_JSON`. The worker only reads those Page posts and validates pagination remains on `graph.facebook.com`.
- Nextdoor requires `NEXTDOOR_APPROVED_EXPORT_PATH` to point to a JSONL file inside `APP_DATA_DIR`. There is intentionally no browser scraper.
- Missing credentials do not break local operation. Diagnostics show providers as not configured.
- The safety stop under operator settings prevents external intake work. No code path publishes a post.

The example at [data/approved-nextdoor-export.example.jsonl](data/approved-nextdoor-export.example.jsonl) defines the accepted export shape.

## Windows, ngrok and HAI

- Windows 11 has one-time install plus validated background start/stop scripts; see [WINDOWS_AND_NGROK.md](docs/WINDOWS_AND_NGROK.md).
- ngrok exposure requires an initialized database and exact stable HTTPS URL; remote first-run setup is blocked by default.
- HAI reads a private, incremental JSON feed without write-back or inherited provider authority; see [HAI_INTEGRATION.md](docs/HAI_INTEGRATION.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API and dashboard in watch mode |
| `npm run build` | Compile server and production web assets |
| `npm test` | Automated unit, API, worker and critical-path tests |
| `npm run lint` / `npm run typecheck` | Static verification |
| `npm run migrate` | Apply versioned SQLite migrations |
| `npm run doctor` | Redacted config, integrity and migration checks |
| `npm run cli -- reconcile` | Read-only integrity and foreign-key reconciliation report |
| `npm run benchmark` | Local 500-item API latency/resource baseline |
| `npm run windows:install` / `windows:start` / `windows:stop` | Windows 11 standalone lifecycle |
| `npm run backup` | SQLite online backup under `data/backups` |
| `npm run cli -- restore --from data/backups/file.sqlite --confirm` | Restore with a recovery copy and integrity check |
| `npm run cli -- export` | Workspace privacy/audit export |
| `npm run cli -- support-bundle` | Redacted local diagnostic bundle |
| `npm run worker -- --once` | Drain scheduled work once |

## Security and privacy

Sessions use opaque HttpOnly, SameSite=Strict cookies; only token hashes are stored. State changes require CSRF headers. Workspace IDs scope all application queries. Passwords use scrypt. CSP, request-size limits and rate limiting are enabled. Exact private addresses and contact details are rejected or redacted from public message packages.

Do not commit `.env`, provider credentials, production databases, exports, backups, or support bundles. See [SECURITY.md](docs/SECURITY.md), [COMPLIANCE_AND_PRIVACY.md](docs/COMPLIANCE_AND_PRIVACY.md), and the [operator runbook](docs/OPERATOR_RUNBOOK.md).

## Honest scope

The implemented critical path works locally without external credentials. Live Facebook acceptance still requires an approved app/token/Page access. Nextdoor remains an approved-export workflow because a general-purpose scraping or posting interface would violate the product's safety boundary. ngrok needs an operator-owned account and stable HTTPS endpoint; HAI needs its running source service and an owner-created connected source. Geocoding, email delivery, billing, file uploads and autonomous posting are not claimed as complete.
