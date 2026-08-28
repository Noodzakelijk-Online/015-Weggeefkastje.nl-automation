import 'dotenv/config';
import { loadConfig } from './config.js';
import { AppDatabase } from './db/appDatabase.js';
import { runOneJob, scheduleRecurringJobs } from './jobs/runner.js';

const once = process.argv.includes('--once');
const config = loadConfig();
const database = new AppDatabase(config.databasePath);
let scheduledDay = '';

async function tick(): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== scheduledDay) {
    scheduleRecurringJobs(database, config);
    scheduledDay = today;
  }
  return runOneJob(database, config);
}

async function main(): Promise<void> {
  if (once) {
    while (await tick()) { /* drain work due now */ }
    return;
  }
  for (;;) {
    const handled = await tick();
    if (!handled) await new Promise((resolve) => setTimeout(resolve, config.workerPollMs));
  }
}

function shutdown(): void {
  database.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error(JSON.stringify({ event: 'worker.fatal', message: error instanceof Error ? error.message : String(error) }));
  database.close();
  process.exitCode = 1;
});
