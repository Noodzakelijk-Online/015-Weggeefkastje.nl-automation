# Windows 11 and ngrok

## Standalone local installation

Install Node.js 20 through 25 and run this once from PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

The installer restores the locked dependencies, builds the production frontend/backend, applies migrations and runs database diagnostics. It creates `.env` from safe loopback defaults only when the file does not exist.

Start and stop the application with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-windows.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-windows.ps1
```

The server and worker run in hidden background processes. Their validated PIDs are stored under `data/runtime`; logs remain under `data/logs`. The stop script refuses to stop a PID whose command line does not match this application.

## Public HTTPS through ngrok

1. Complete local first-run setup before opening any tunnel.
2. Install the current ngrok v3 agent and run `ngrok config add-authtoken <token>` once.
3. Use a stable HTTPS endpoint assigned to your ngrok account:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-ngrok.ps1 -PublicUrl https://your-domain.ngrok.app
```

The launcher keeps Express bound to `127.0.0.1`, enables trusted-proxy and secure-cookie behavior, disables remote setup and ngrok request inspection, and refuses to tunnel an uninitialized or unhealthy database. It uses the current `ngrok http 3000 --url https://...` syntax. Authentication and manual-posting review remain required over the public endpoint.

Do not use a random URL for a durable deployment: the application needs its exact HTTPS base URL before it starts so secure sessions remain predictable. Stop the tunnel and application with `scripts\stop-windows.ps1`.

## Docker

`docker compose up --build` is a loopback-published local container deployment. Its Compose environment is explicitly development-mode because TLS terminates nowhere in that local topology. For public container operation, place the image behind a real HTTPS reverse proxy and provide production `APP_BASE_URL`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`, and deliberate network-binding settings.
