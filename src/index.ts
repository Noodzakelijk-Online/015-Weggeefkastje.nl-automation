import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { openDatabase } from './db/sqlite.js';
import { readManualTips } from './adapters/manualTips.js';
import { parseBuurtkastjeskaartHtmlExport, parseBuurtkastjeskaartJsonExport } from './adapters/buurtkastjeskaartPublicExport.js';
import { toLocationInput } from './core/normalise.js';
import { writeAppExport } from './export/appExport.js';
import { writeSocialReviewQueue } from './export/socialReviewQueue.js';
import { startServer } from './server.js';
import type { IntakeItem } from './types.js';
import {
  fetchFacebookPageMentions,
  parseApprovedSocialExportJsonl,
  type FacebookPageContext,
  type SocialIngestionBatch,
} from './adapters/socialEvidence.js';

const databasePath = process.env.DATABASE_PATH ?? 'data/weggeefkastjes.sqlite';
const manualTipsPath = process.env.MANUAL_TIPS_PATH ?? 'data/manual-tips.example.jsonl';
const buurtkastjeskaartExportPath = process.env.BUURTKASTJESKAART_EXPORT_PATH;
const nextdoorApprovedExportPath = process.env.NEXTDOOR_APPROVED_EXPORT_PATH;
const socialReviewPath = process.env.SOCIAL_REVIEW_PATH ?? 'data/review/social-mentions.json';
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

function readNextdoorApprovedExport(path: string | undefined): SocialIngestionBatch {
  if (!path || !existsSync(path)) return { actionable: [], review: [] };
  return parseApprovedSocialExportJsonl(readFileSync(path, 'utf8'), 'nextdoor');
}

function readFacebookPageContexts(value: string | undefined): FacebookPageContext[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('FACEBOOK_PAGE_CONTEXTS_JSON must be a JSON array.');
  }
  if (!Array.isArray(parsed)) throw new Error('FACEBOOK_PAGE_CONTEXTS_JSON must be a JSON array.');

  return parsed.map((page, index) => {
    if (typeof page !== 'object' || page === null || typeof (page as { id?: unknown }).id !== 'string') {
      throw new Error(`FACEBOOK_PAGE_CONTEXTS_JSON entry ${index + 1} requires an id.`);
    }
    const context = page as Record<string, unknown>;
    return {
      id: context.id as string,
      name: typeof context.name === 'string' ? context.name : undefined,
      city: typeof context.city === 'string' ? context.city : undefined,
      municipality: typeof context.municipality === 'string' ? context.municipality : undefined,
      province: typeof context.province === 'string' ? context.province : undefined,
    };
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when Facebook pages are configured.`);
  return value;
}

async function main(): Promise<void> {
  const db = openDatabase(databasePath);

  const tips = readManualTips(manualTipsPath);
  const buurtkastjeskaartItems = readBuurtkastjeskaartExport(buurtkastjeskaartExportPath);
  const nextdoorBatch = readNextdoorApprovedExport(nextdoorApprovedExportPath);
  const facebookPages = readFacebookPageContexts(process.env.FACEBOOK_PAGE_CONTEXTS_JSON);
  const facebookBatch = facebookPages.length === 0
    ? { actionable: [], review: [] }
    : await fetchFacebookPageMentions({
        accessToken: requiredEnvironment('FACEBOOK_GRAPH_ACCESS_TOKEN'),
        apiVersion: requiredEnvironment('FACEBOOK_GRAPH_API_VERSION'),
        pages: facebookPages,
        maxPostsPerPage: Number(process.env.FACEBOOK_MAX_POSTS_PER_PAGE ?? 100),
      });
  const allInputItems = [...tips, ...buurtkastjeskaartItems, ...nextdoorBatch.actionable, ...facebookBatch.actionable];
  const imported = allInputItems.map((tip) => db.upsertLocation(toLocationInput(tip)));
  const allLocations = db.listLocations();
  const exportPayload = writeAppExport(exportPath, allLocations);
  const socialReview = [...nextdoorBatch.review, ...facebookBatch.review];
  writeSocialReviewQueue(socialReviewPath, socialReview);

  console.log(`Imported or updated ${imported.length} location(s).`);
  console.log(`Manual tips: ${tips.length}. Buurtkastjeskaart export items: ${buurtkastjeskaartItems.length}.`);
  console.log(`Nextdoor actionable mentions: ${nextdoorBatch.actionable.length}. Facebook actionable mentions: ${facebookBatch.actionable.length}.`);
  console.log(`Queued ${socialReview.length} social mention(s) for review at ${socialReviewPath}.`);
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
