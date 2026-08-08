import 'dotenv/config';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { AppDatabase } from './db/appDatabase.js';
import { createApp } from './api/app.js';

const config = loadConfig();
const database = new AppDatabase(config.databasePath);
const app = createApp(config, database);
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    event: 'server.started',
    address: `http://${config.host}:${config.port}`,
    mode: config.mode,
    setupRequired: !database.hasUsers(),
    manualPostingOnly: true,
  }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ event: 'server.stopping', signal }));
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
