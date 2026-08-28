import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { loadConfig } from './config.js';
import { AppDatabase } from './db/appDatabase.js';
import { createApp } from './api/app.js';

const directory = mkdtempSync(join(tmpdir(), 'weggeef-benchmark-'));
const config = loadConfig({ NODE_ENV: 'test', APP_DATA_DIR: directory, DATABASE_PATH: join(directory, 'benchmark.sqlite'), RATE_LIMIT_PER_MINUTE: '1000' }, directory);
const database = new AppDatabase(config.databasePath);
const identity = database.bootstrapAdmin({ email: 'benchmark@example.nl', password: 'benchmark-password-long', displayName: 'Benchmark', workspaceName: 'Benchmark' });
for (let index = 0; index < 500; index++) {
  database.createItem(identity.workspaceId, identity.userId, {
    title: `Benchmark item ${index}`, description: `Bounded benchmark record ${index}`, category: 'Overig', platformTarget: 'manual',
    sourceKind: 'benchmark', sourceName: 'local-benchmark', city: index % 2 ? 'Delft' : 'Utrecht', confidence: 50,
    contactMethod: 'platform', privacyLevel: 'approximate',
  });
}
const createdSession = database.createSession(identity.userId, identity.workspaceId, 1);
const server = createServer(createApp(config, database));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = (server.address() as AddressInfo).port;
const urls = Array.from({ length: 200 }, (_, index) => index % 2
  ? `http://127.0.0.1:${port}/api/items?limit=25&page=${(index % 20) + 1}&status=draft`
  : `http://127.0.0.1:${port}/api/dashboard`);
const durations: number[] = [];
const rssBefore = process.memoryUsage().rss;
const started = performance.now();
for (let offset = 0; offset < urls.length; offset += 20) {
  await Promise.all(urls.slice(offset, offset + 20).map(async (url) => {
    const requestStarted = performance.now();
    const response = await fetch(url, { headers: { cookie: `wk_session=${createdSession.token}` } });
    if (!response.ok) throw new Error(`Benchmark request failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
    durations.push(performance.now() - requestStarted);
  }));
}
const elapsed = performance.now() - started;
durations.sort((a, b) => a - b);
const percentile = (value: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * value))];
console.log(JSON.stringify({
  datasetItems: 500,
  requests: durations.length,
  concurrency: 20,
  requestsPerSecond: Number((durations.length / (elapsed / 1000)).toFixed(1)),
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  rssDeltaBytes: process.memoryUsage().rss - rssBefore,
}, null, 2));
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
database.close();
rmSync(directory, { recursive: true, force: true });
