import http from 'node:http';
import { URL } from 'node:url';
import { openDatabase } from './db/sqlite.js';
import { searchLocations } from './app/search.js';
import { normaliseCategory } from './categories.js';

export interface ServerOptions {
  databasePath: string;
  port?: number;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function startServer(options: ServerOptions): http.Server {
  const db = openDatabase(options.databasePath);
  const port = options.port ?? 3000;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'weggeefkastje-automation' });
      return;
    }

    if (url.pathname === '/locations') {
      sendJson(response, 200, { locations: db.listLocations() });
      return;
    }

    if (url.pathname === '/search') {
      const categoryRaw = url.searchParams.get('category') ?? undefined;
      const category = categoryRaw ? normaliseCategory(categoryRaw) : undefined;

      if (categoryRaw && !category) {
        sendJson(response, 400, { error: `Unknown category: ${categoryRaw}` });
        return;
      }

      const results = searchLocations(db.listLocations(), {
        category,
        city: url.searchParams.get('city') ?? undefined,
        includeNeedsReview: url.searchParams.get('includeNeedsReview') === 'true',
        limit: Number(url.searchParams.get('limit') ?? 20),
      });
      sendJson(response, 200, { results });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });

  server.listen(port, () => {
    console.log(`Local API listening on http://localhost:${port}`);
  });

  server.on('close', () => db.close());
  return server;
}
