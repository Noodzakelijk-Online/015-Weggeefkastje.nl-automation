# UI action audit

| Surface | Action | Backend/effect | State |
| --- | --- | --- | --- |
| First run/login | Create owner / log in | `/api/setup`, `/api/auth/login` | Wired |
| Sidebar | Navigate all workflow areas | Client view/filter state | Wired |
| Header | Search | Local title/city/category filter | Wired |
| Header | Review bell | Opens Beoordelen | Wired |
| Header/empty state | New intake | `/api/items` | Wired |
| Queue row | Open details | `/api/items/:id` | Wired |
| Drawer | Workflow actions | `/api/items/:id/actions` | Wired with current-state allowlist |
| Drawer | Copy package | Clipboard then `/message-package/copy` | Wired; API is not marked copied if clipboard fails |
| Review | View source / dismiss ambiguous mention | External source tab / `/api/review/mentions/:id/dismiss` | Wired |
| Settings | Safety stop | `/api/operator/safety-stop` | Owner only |
| Profile | Logout | `/api/auth/logout` | Wired |
| Refresh | Reload counts/items/review | Three read endpoints | Wired |

Loading, empty, error, validation and responsive states are present. No UI control claims to publish to Facebook or Nextdoor. The manual-posting warning remains visible across authenticated views.
