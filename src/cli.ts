import 'dotenv/config';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, publicConfig, resolveWithin } from './config.js';
import { AppDatabase } from './db/appDatabase.js';
import { runOneJob, scheduleRecurringJobs } from './jobs/runner.js';

const config = loadConfig();
const [command = 'help', ...args] = process.argv.slice(2);

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function value(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function backupPath(): string {
  const folder = resolveWithin(config.dataDir, 'backups');
  mkdirSync(folder, { recursive: true });
  return join(folder, `weggeefkastjes-${stamp()}.sqlite`);
}

async function backup(): Promise<string> {
  if (!existsSync(config.databasePath)) throw new Error('Database does not exist yet. Run migrate or the server first.');
  const destination = backupPath();
  const database = new AppDatabase(config.databasePath);
  try {
    await database.backupTo(destination);
  } finally {
    database.close();
  }
  return destination;
}

async function main(): Promise<void> {
  if (command === 'migrate') {
    const database = new AppDatabase(config.databasePath);
    console.log(JSON.stringify({ database: config.databasePath, migration: database.migrationResult }, null, 2));
    database.close();
    return;
  }
  if (command === 'doctor') {
    const database = new AppDatabase(config.databasePath);
    const result = { config: publicConfig(config), diagnostics: database.diagnostics() };
    database.close();
    console.log(JSON.stringify(result, null, 2));
    if (!(result.diagnostics as { ok: boolean }).ok) process.exitCode = 1;
    return;
  }
  if (command === 'reconcile') {
    const database = new AppDatabase(config.databasePath);
    const diagnostics = database.diagnostics();
    database.close();
    console.log(JSON.stringify({ mode: 'read-only', diagnostics }, null, 2));
    if (!(diagnostics as { ok: boolean }).ok) process.exitCode = 1;
    return;
  }
  if (command === 'ready-for-tunnel') {
    const database = new AppDatabase(config.databasePath);
    const readiness = database.readiness();
    database.close();
    const safe = readiness.ok && !readiness.setupRequired && config.baseUrl?.startsWith('https://') && config.secureCookies && config.trustProxy && !config.allowRemoteSetup;
    console.log(JSON.stringify({ readyForTunnel: Boolean(safe), baseUrl: config.baseUrl, secureCookies: config.secureCookies, trustProxy: config.trustProxy, remoteSetupAllowed: config.allowRemoteSetup, readiness }, null, 2));
    if (!safe) process.exitCode = 1;
    return;
  }
  if (command === 'backup') {
    console.log(await backup());
    return;
  }
  if (command === 'restore') {
    const sourceArg = value('--from');
    if (!sourceArg || !args.includes('--confirm')) throw new Error('Usage: npm run cli -- restore --from data/backups/file.sqlite --confirm');
    const source = resolveWithin(config.dataDir, resolve(sourceArg));
    if (!existsSync(source)) throw new Error(`Backup not found: ${source}`);
    const recoveryCopy = existsSync(config.databasePath) ? await backup() : undefined;
    mkdirSync(dirname(config.databasePath), { recursive: true });
    copyFileSync(source, config.databasePath);
    const database = new AppDatabase(config.databasePath);
    const diagnostics = database.diagnostics();
    database.close();
    if (!(diagnostics as { ok: boolean }).ok) throw new Error(`Restored database failed validation; previous copy: ${recoveryCopy ?? 'none'}`);
    console.log(JSON.stringify({ restoredFrom: source, recoveryCopy, diagnostics }, null, 2));
    return;
  }
  if (command === 'export') {
    const database = new AppDatabase(config.databasePath);
    const workspace = value('--workspace') ?? database.workspaceIds()[0];
    if (!workspace) throw new Error('No workspace exists.');
    const output = resolveWithin(config.dataDir, value('--out') ? resolve(value('--out')!) : join(config.dataDir, 'exports', `workspace-${stamp()}.json`));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(database.workspaceExport(workspace), null, 2));
    database.close();
    console.log(output);
    return;
  }
  if (command === 'support-bundle') {
    const database = new AppDatabase(config.databasePath);
    const output = resolveWithin(config.dataDir, join(config.dataDir, 'support', `support-${stamp()}.json`));
    mkdirSync(dirname(output), { recursive: true });
    const body = { generatedAt: new Date().toISOString(), version: process.env.npm_package_version ?? 'unknown', config: publicConfig(config), diagnostics: database.diagnostics() };
    database.close();
    writeFileSync(output, JSON.stringify(body, null, 2));
    console.log(output);
    return;
  }
  if (command === 'worker') {
    const database = new AppDatabase(config.databasePath);
    scheduleRecurringJobs(database, config);
    while (await runOneJob(database, config)) { /* drain */ }
    database.close();
    return;
  }
  if (command === 'checksum') {
    const fileArg = value('--file');
    if (!fileArg) throw new Error('Usage: npm run cli -- checksum --file data/backups/file.sqlite');
    const file = resolveWithin(config.dataDir, resolve(fileArg));
    console.log(`${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`);
    return;
  }
  console.log('Commands: migrate, doctor, reconcile, ready-for-tunnel, backup, restore, export, support-bundle, worker, checksum');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
