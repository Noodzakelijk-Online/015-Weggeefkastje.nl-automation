import http from 'node:http';
import { URL } from 'node:url';
import { openDatabase } from './db/sqlite.js';
import { searchLocations } from './app/search.js';
import { normaliseCategory } from './categories.js';
import type { ReviewAction } from './db/sqlite.js';

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

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  if (!body.trim()) return {};
  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function isReviewAction(value: unknown): value is ReviewAction {
  return value === 'approve' || value === 'reject' || value === 'mark_removed';
}

export function startServer(options: ServerOptions): http.Server {
  const db = openDatabase(options.databasePath);
  const port = options.port ?? 3000;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'weggeefkastje-automation' });
      return;
    }

    if (url.pathname === '/locations') {
      sendJson(response, 200, { locations: db.listLocations() });
      return;
    }

    if (url.pathname === '/review' && request.method === 'GET') {
      sendJson(response, 200, { locations: db.listLocationsNeedingReview() });
      return;
    }

    const reviewMatch = url.pathname.match(/^\/review\/([^/]+)$/);
    if (reviewMatch && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        if (!isReviewAction(body.action)) {
          sendJson(response, 400, { error: 'action must be approve, reject, or mark_removed.' });
          return;
        }
        const location = db.reviewLocation(decodeURIComponent(reviewMatch[1]), body.action);
        if (!location) {
          sendJson(response, 404, { error: 'Location not found.' });
          return;
        }
        sendJson(response, 200, { location });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' });
      }
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

  server.listen(port, '127.0.0.1', () => {
    console.log(`Local API listening on http://127.0.0.1:${port}`);
  });

  server.on('close', () => db.close());
  return server;
}
