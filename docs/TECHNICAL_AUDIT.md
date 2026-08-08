# Technical audit

Audit date: 2026-08-08. Starting commit: `b49fe3b234e50c5ed7ab41507c3fe8e79c514d5d` on `main`, equal to `origin/main` when work began.

## Starting point

The repository contained a TypeScript/Node ingestion prototype, a local unauthenticated review endpoint, SQLite catalog tables, approved social-evidence parsers and nine tests. It had no application authentication, ownership model, formal migrations, product state machine, web UI, background worker, deployment image, CI workflow, backup/restore utility or end-to-end product test. The initial dependency audit reported six vulnerabilities (three moderate, two high, one critical).

The earlier 50-metre coordinate deduplication and review-gated Facebook/Nextdoor evidence work was relevant and retained. No archive was executed. No login-wall scraper or automatic poster was ported.

## Implemented architecture

- Express 5 API and React/Vite operator UI, served together in production.
- SQLite remains the local-first source of truth. Four formal migrations add users, workspaces, sessions, exchange items, evidence, decisions, packages, coordination, jobs, notifications, feature flags, audit, local analytics and queue/cursor indexes.
- The legacy `locations` catalog remains compatible. Social intake updates it only for a newly accepted actionable evidence record.
- One explicit state machine drives `draft -> review -> ready_to_post -> posted -> responding -> pickup_scheduled -> completed -> archived` plus reject/cancel paths.
- Provider intake runs in a separate retrying worker. A workspace safety stop suppresses social intake.
- Every publication action is an operator assertion after a reviewed package was copied; the application itself never posts.

## Risk findings and disposition

| Finding | Disposition |
| --- | --- |
| Unauthenticated prototype review API | Preserved as a legacy local endpoint for compatibility; new product API requires session, workspace scope, role and CSRF. Documented for retirement. |
| Vulnerable development dependency tree | Updated; `npm audit --audit-level=high` reports zero vulnerabilities. |
| No ownership boundary | Workspace foreign keys and scoped queries added; cross-workspace access is denied by absence. |
| No durable workflow history | Workflow/audit/coordination tables and idempotency keys added. |
| Provider reality unclear | Official Facebook Page API and approved Nextdoor exports only. No private-space or browser scraper. |
| False external success possible | `mark_posted` is blocked until the reviewed package was copied and records an operator-confirmed URL if supplied. |
| Config paths could escape | Database, export and restore inputs are confined to `APP_DATA_DIR`; public binding fails closed. |
| No deployment or recovery path | Multi-stage image, loopback Compose, health/readiness, online backup, validated restore and support bundle added. |
| HAI had no bounded integration surface | Added an opt-in, authenticated, incremental, privacy-redacted, read-only JSON feed compatible with HAI's allowlisted source adapter. |
| Large queues were truncated in the UI/export | Added server-side multi-status paging/search, complete privacy exports and a reproducible 500-item benchmark. |
| Session/worker writes were amplified | Session activity writes are throttled to five minutes and recurring jobs are scheduled once per UTC day per worker process. |

## Known debt

- Retire or authenticate the legacy `src/server.ts` API after downstream consumers move to `/api`.
- Add true multi-member invitations and member management before calling team RBAC complete.
- Add a standards-based translation catalog if an English UI becomes a real requirement.
- Live provider acceptance, quota monitoring and account rotation require user-owned credentials and provider approval.
- Live ngrok/HAI acceptance needs an operator-owned ngrok endpoint and a running owner-authenticated HAI workspace.
- Docker Compose syntax validates, but the local Docker daemon stopped responding during the bounded image-build verification; CI should rerun the image gate.
- File uploads, email delivery, billing and AI generation were intentionally not invented for this product.
