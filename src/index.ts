import 'dotenv/config';
import { openDatabase } from './db/sqlite.js';
import { readManualTips } from './adapters/manualTips.js';
import { toLocationInput } from './core/normalise.js';
import { writeAppExport } from './export/appExport.js';
import { startServer } from './server.js';

const databasePath = process.env.DATABASE_PATH ?? 'data/weggeefkastjes.sqlite';
const manualTipsPath = process.env.MANUAL_TIPS_PATH ?? 'data/manual-tips.example.jsonl';
const exportPath = process.env.EXPORT_PATH ?? 'data/exports/app-locations.json';
const shouldServe = process.argv.includes('--serve');

async function main(): Promise<void> {
  const db = openDatabase(databasePath);

  const tips = readManualTips(manualTipsPath);
  const imported = tips.map((tip) => db.upsertLocation(toLocationInput(tip)));
  const allLocations = db.listLocations();
  const exportPayload = writeAppExport(exportPath, allLocations);

  console.log(`Imported or updated ${imported.length} location(s).`);
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
