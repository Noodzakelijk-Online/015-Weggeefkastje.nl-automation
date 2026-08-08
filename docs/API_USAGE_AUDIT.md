# Backend endpoint usage audit

| Endpoint | UI/consumer | Status |
| --- | --- | --- |
| `GET /health`, `GET /ready` | Docker/operations | Used |
| `GET /api/setup/status`, `POST /api/setup` | First-run UI | Used |
| `POST /api/auth/login`, `GET /api/auth/status`, `POST /api/auth/logout` | Session UI | Used |
| `GET /api/auth/me` | Authenticated API compatibility | Used in tests/API clients only |
| `GET /api/dashboard`, `GET /api/items`, `GET /api/items/:id` | Overview and drawer | Used |
| `POST /api/items`, `POST /api/items/:id/actions` | Intake and workflow | Used |
| `POST /api/items/:id/message-package/copy` | Manual-post gate | Used |
| `GET /api/review`, `GET /api/review/summary`, `POST /api/review/mentions/:id/dismiss` | Review area and low-cost badge | Used |
| `GET /api/integrations/hai/health`, `GET /api/integrations/hai/feed` | HAI `json-feed` connected source | Used when explicitly configured |
| `GET /api/settings`, `POST /api/operator/safety-stop` | Settings | Used |
| `GET /api/notifications`, `POST /api/notifications/:id/read` | API prepared; UI uses consolidated review badge | Partially used |
| `PATCH /api/items/:id` | External/API editing client | Not yet exposed in UI |
| `DELETE /api/items/:id`, `GET /api/privacy/export` | Privacy/operator API | Documented, not exposed in UI |
| `GET /api/operator/diagnostics` | Operator/API and runbook | Not exposed in UI |

Unused mutation endpoints remain authenticated, role-gated, CSRF protected and covered by the same envelope. They are retained for operator/API parity, not reported as user-facing buttons.
