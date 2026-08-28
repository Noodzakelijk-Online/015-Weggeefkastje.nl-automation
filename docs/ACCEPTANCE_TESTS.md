# Acceptance tests

| Outcome | Automated evidence | Result |
| --- | --- | --- |
| First owner can initialize and authenticate | `tests/critical-path.test.ts` | Pass |
| Unauthenticated reads and CSRF-less writes fail | `tests/critical-path.test.ts` | Pass |
| Intake completes review, manual posting, response, pickup and archive | `tests/critical-path.test.ts` | Pass |
| Social evidence filters relevant Dutch terms and redacts contacts | `tests/socialEvidence.test.ts` | Pass |
| Facebook calls only explicitly configured Pages | `tests/socialEvidence.test.ts` | Pass |
| Nextdoor actionable mention updates once; ambiguous mention stays in review | `tests/worker.test.ts` | Pass |
| Coordinates within 50 metres deduplicate and keep evidence | `tests/sqlite.test.ts` | Pass |
| Unverified removal cannot silently unpublish a location | `tests/sqlite.test.ts` | Pass |
| Database path traversal and unsafe network binding fail closed | `tests/config.test.ts` | Pass |
| Blank optional values in the shipped `.env.example` start safely | `tests/config.test.ts` | Pass |
| HAI feed auth, cursor, read-only metadata and privacy redaction | `tests/hai-integration.test.ts` | Pass |
| Remote first-run setup is blocked through a trusted proxy | `tests/hai-integration.test.ts` | Pass |
| Cross-workspace reads remain isolated | `tests/database-boundaries.test.ts` | Pass |
| Paging is bounded and wildcard searches remain literal | `tests/database-boundaries.test.ts` | Pass |
| Online backup completes before the database closes | `tests/database-boundaries.test.ts` | Pass |
| TypeScript server and frontend compile | `npm run typecheck` | Pass |
| Production server and web assets build | `npm run build` | Pass |
| Dependency high/critical audit | `npm audit --audit-level=high` | Pass, zero vulnerabilities |

Manual/browser acceptance covers first-run setup, responsive navigation, intake dialog, workflow drawer, copy gate, ambiguous mention review, safety stop, empty/error/loading states and the persistent manual-posting warning. The packaged Windows production server produced zero browser console errors at desktop and mobile sizes. Provider, live ngrok and live HAI acceptance remain blocked until user-owned credentials/endpoints are available.
