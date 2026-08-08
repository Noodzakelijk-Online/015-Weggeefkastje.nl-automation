# HAI read-only connector

The connector uses HAI's operational `json-feed` connected source. It is incremental, bounded to 100 records per request, stable by external ID, and read-only. It never exposes exact address hints, coordinates, pickup notes, contacts or private descriptions. Drafts are not exported.

## Enable the feed

Generate a random secret of at least 32 characters, set it in the Weggeefkastje `.env`, and restart the server:

```dotenv
HAI_FEED_TOKEN=<random secret>
HAI_PROJECT_KEY=015-Weggeefkastje
```

Set `HAI_WORKSPACE_ID` as well when the database contains more than one workspace. The token is never returned by diagnostics or the frontend.

Test locally with the preferred bearer form:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/integrations/hai/health -Headers @{ Authorization = 'Bearer <random secret>' }
```

## Register in HAI

Create a connected source through HAI's source UI or `POST /api/v1/sources` with the owner-authenticated HAI session:

```json
{
  "connectorKey": "json-feed",
  "name": "Weggeefkastje review feed",
  "category": "generic_feed",
  "enabled": true,
  "localOnly": true,
  "syncFrequency": "15m",
  "syncTarget": "http://host.docker.internal:3000/api/integrations/hai/feed?access_token=<URL-encoded random secret>",
  "defaultProjectKey": "015-Weggeefkastje",
  "ingestionModes": ["scheduled_sync", "incremental_sync"],
  "permissions": ["metadata", "read"]
}
```

When HAI is not in Docker, use `http://127.0.0.1:3000/...`. HAI appends its cursor automatically. `host.docker.internal` and `127.0.0.1` are in HAI's normal local-source allowlist; if the topology differs, add only the exact host to `CONNECTED_SOURCE_HTTP_ALLOWED_HOSTS`.

HAI's current JSON-feed client does not send a custom authorization header, so its compatibility URL contains the feed token as a query value. Keep this route local-only, restrict access to HAI's data/configuration, and rotate `HAI_FEED_TOKEN` if the source configuration is exposed. Other clients should use the bearer header.

There is deliberately no HAI write-back, no provider posting authority and no Gmail or Google Drive permission inheritance. HAI may index the review state; it cannot approve, post, contact people, or mutate this database through this connector.
