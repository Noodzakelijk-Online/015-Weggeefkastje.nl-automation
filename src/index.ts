import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { openDatabase } from './db/sqlite.js';
import { readManualTips } from './adapters/manualTips.js';
import { parseBuurtkastjeskaartHtmlExport, parseBuurtkastjeskaartJsonExport } from './adapters/buurtkastjeskaartPublicExport.js';
import { toLocationInput } from './core/normalise.js';
import { writeAppExport } from './export/appExport.js';
import { startServer } from './server.js';
import type { IntakeItem } from './types.js';

const databasePath = process.env.DATABASE_PATH ?? 'data/weggeefkastjes.sqlite';
const manualTipsPath = process.env.MANUAL_TIPS_PATH ?? 'data/manual-tips.example.jsonl';
const buurtkastjeskaartExportPath = process.env.BUURTKASTJESKAART_EXPORT_PATH;
const exportPath = process.env.EXPORT_PATH ?? 'data/exports/app-locations.json';
const shouldServe = process.argv.includes('--serve');

function readBuurtkastjeskaartExport(path: string | undefined): IntakeItem[] {
  if (!path || !existsSync(path)) return [];

  const content = readFileSync(path, 'utf8');
  const extension = extname(path).toLowerCase();

  if (extension === '.json') {
    return parseBuurtkastjeskaartJsonExport(content);
  }

  if (extension === '.html' || extension === '.htm') {
    return parseBuurtkastjeskaartHtmlExport(content);
  }

  throw new Error(`Unsupported Buurtkastjeskaart export extension: ${extension}. Use .json, .html, or .htm.`);
}

async function main(): Promise<void> {
  const db = openDatabase(databasePath);

  const tips = readManualTips(manualTipsPath);
  const buurtkastjeskaartItems = readBuurtkastjeskaartExport(buurtkastjeskaartExportPath);
  const allInputItems = [...tips, ...buurtkastjeskaartItems];
  const imported = allInputItems.map((tip) => db.upsertLocation(toLocationInput(tip)));
  const allLocations = db.listLocations();
  const exportPayload = writeAppExport(exportPath, allLocations);

  console.log(`Imported or updated ${imported.length} location(s).`);
  console.log(`Manual tips: ${tips.length}. Buurtkastjeskaart export items: ${buurtkastjeskaartItems.length}.`);
  console.log(`Exported ${exportPayload.count} public app location(s) to ${exportPath}.`);

  db.close();

  if (shouldServe) {
    startServer({ databasePath, port: Number(process.env.PORT ?? 3000) });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
