# Resume checkpoints

| Checkpoint | Durable evidence | State |
| --- | --- | --- |
| Starting point | Start commit in audit/worklog | Complete |
| Domain foundation | `src/domain`, `src/db/migrations.ts`, `src/db/appDatabase.ts` | Complete |
| Product API | `src/api/app.ts`, `src/server-main.ts` | Complete |
| Social automation | `src/jobs/runner.ts`, `src/worker.ts` | Complete, credential-gated |
| Operator UI | `web/src` | Complete for critical path |
| Verification | `tests`, CI, audit/matrix/report | In final verification |
| External acceptance | User-owned Facebook/Nextdoor authorization | Blocked externally |

Resume rule: first inspect `git status`, compare branch with remote, read `FINAL_VERIFICATION_REPORT.md`, rerun the verification commands, and never interpret missing provider credentials as an implementation failure or permission to scrape.
