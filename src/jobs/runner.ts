import { existsSync, readFileSync } from 'node:fs';
import { inferCategoriesFromText } from '../categories.js';
import { inferStatus, normaliseKey } from '../core/normalise.js';
import { parseBuurtkastjeskaartHtmlExport, parseBuurtkastjeskaartJsonExport } from '../adapters/buurtkastjeskaartPublicExport.js';
import { fetchOpenStreetMapPilotMentions } from '../adapters/openStreetMap.js';
import type { AppConfig } from '../config.js';
import { AppDatabase, type JobRecord } from '../db/appDatabase.js';
import { createPdokAddressVerifier, type AddressVerifier } from '../integrations/pdokAddress.js';
import { ingestResidentCandidate, type ResidentCandidateDraft } from '../services/residentCatalog.js';
import type { IntakeItem } from '../types.js';
import {
  fetchFacebookPageMentions,
  parseApprovedSocialExportJsonl,
  parseFacebookPageContextsConfig,
  type SocialIngestionBatch,
} from '../adapters/socialEvidence.js';

const FACEBOOK_SOURCE_KEY = 'facebook-graph-pages';
const NEXTDOOR_SOURCE_KEY = 'nextdoor-approved-export';
const OPEN_STREET_MAP_SOURCE_KEY = 'openstreetmap-pilot';
const BUURTKASTJESKAART_SOURCE_KEY = 'buurtkastjeskaart-export';
const POSTAL_CODE = /\b(\d{4}\s?[A-Z]{2})\b/i;

export interface IntakeDependencies {
  verifier?: AddressVerifier;
  fetchImpl?: typeof fetch;
}

function mergeBatches(...batches: SocialIngestionBatch[]): SocialIngestionBatch {
  return batches.reduce((all, batch) => ({
    actionable: [...all.actionable, ...batch.actionable],
    review: [...all.review, ...batch.review],
  }), { actionable: [], review: [] });
}

function sourceIsEnabled(database: AppDatabase, workspaceId: string, key: string): boolean {
  const source = database.getSourceByKey(workspaceId, key);
  return Boolean(source?.enabled && source.allowsExactAddress);
}

function extractAddress(item: IntakeItem): { address?: string; postalCode?: string; city?: string } {
  const raw = item.addressHint?.trim();
  const postalCode = item.postalCode?.replace(/\s+/g, '').toUpperCase() ?? raw?.match(POSTAL_CODE)?.[1]?.replace(/\s+/g, '').toUpperCase();
  const address = raw
    ?.replace(POSTAL_CODE, '')
    .split(',')[0]
    ?.replace(/\s+/g, ' ')
    .trim() || undefined;
  let city = item.city?.trim();
  if (!city && raw) {
    const match = new RegExp(`${POSTAL_CODE.source}\\s+(.+)$`, 'i').exec(raw);
    city = match?.[2]?.split(',')[0]?.trim();
  }
  return { address, postalCode, city };
}

function toResidentCandidate(item: IntakeItem, sourceKey: string): ResidentCandidateDraft {
  const address = extractAddress(item);
  const inferredStatus = inferStatus(item);
  const evidenceText = normaliseKey(`${item.statusHint ?? ''} ${item.text} ${item.notes ?? ''}`);
  const explicitlyUncertain = ['misschien', 'mogelijk', 'onzeker', 'weet niet', 'kan zijn']
    .some((term) => evidenceText.includes(normaliseKey(term)));
  return {
    sourceKey,
    title: item.addressHint && address.city ? `Weggeefkastje bij ${item.addressHint}`.slice(0, 160) : item.text.split(/[.!?\n]/)[0]?.trim().slice(0, 160),
    address: address.address,
    postalCode: address.postalCode,
    city: address.city,
    observedAt: item.observedAt,
    evidenceSummary: item.text.slice(0, 1000),
    sourceLink: item.link,
    sourceRecordId: item.link,
    categories: item.categories?.length ? item.categories : inferCategoriesFromText(`${item.text} ${item.notes ?? ''}`),
    status: inferredStatus === 'removed' ? 'removed' : explicitlyUncertain ? 'inactive' : 'active',
  };
}

async function ingestItems(
  database: AppDatabase,
  workspaceId: string,
  actorUserId: string,
  verifier: AddressVerifier,
  sourceKey: string,
  items: IntakeItem[],
): Promise<number> {
  let imported = 0;
  for (const item of items) {
    const result = await ingestResidentCandidate({ database, verifier }, {
      workspaceId,
      actorUserId,
      candidate: toResidentCandidate(item, sourceKey),
    });
    if (result.disposition !== 'duplicate') imported += 1;
  }
  return imported;
}

function addressVerifier(config: AppConfig, dependencies: IntakeDependencies): AddressVerifier {
  return dependencies.verifier ?? createPdokAddressVerifier({
    baseUrl: config.addressVerification.baseUrl,
    timeoutMs: config.addressVerification.timeoutMs,
  });
}

export async function collectSocialEvidence(config: AppConfig, enabledSourceKeys: ReadonlySet<string>): Promise<SocialIngestionBatch> {
  const batches: SocialIngestionBatch[] = [];
  if (enabledSourceKeys.has(NEXTDOOR_SOURCE_KEY) && config.provider.nextdoorExportPath && existsSync(config.provider.nextdoorExportPath)) {
    batches.push(parseApprovedSocialExportJsonl(readFileSync(config.provider.nextdoorExportPath, 'utf8'), 'nextdoor'));
  }
  if (enabledSourceKeys.has(FACEBOOK_SOURCE_KEY) && config.provider.facebookConfigured) {
    const pages = parseFacebookPageContextsConfig(config.provider.facebookPageContextsJson);
    if (pages.length > 0) {
      batches.push(await fetchFacebookPageMentions({
        accessToken: config.provider.facebookAccessToken!,
        apiVersion: config.provider.facebookApiVersion!,
        pages,
      }));
    }
  }
  return mergeBatches(...batches);
}

export async function runSocialIntake(
  database: AppDatabase,
  config: AppConfig,
  workspaceId: string,
  dependencies: IntakeDependencies = {},
): Promise<{ imported: number; ambiguous: number }> {
  if (database.workspaceSafetyStop(workspaceId)) return { imported: 0, ambiguous: 0 };
  const actorUserId = database.workspaceOperatorUserId(workspaceId);
  if (!actorUserId) throw new Error('Social intake needs a workspace owner or operator.');
  const enabledSources = new Set([FACEBOOK_SOURCE_KEY, NEXTDOOR_SOURCE_KEY].filter((key) => sourceIsEnabled(database, workspaceId, key)));
  const batch = await collectSocialEvidence(config, enabledSources);
  let imported = 0;
  const verifier = addressVerifier(config, dependencies);
  if (enabledSources.has(NEXTDOOR_SOURCE_KEY)) {
    imported += await ingestItems(database, workspaceId, actorUserId, verifier, NEXTDOOR_SOURCE_KEY, batch.actionable.filter((item) => item.sourceKind === 'approved_export'));
    database.recordSourceCheck(workspaceId, database.getSourceByKey(workspaceId, NEXTDOOR_SOURCE_KEY)!.id, 'ok');
  }
  if (enabledSources.has(FACEBOOK_SOURCE_KEY)) {
    imported += await ingestItems(database, workspaceId, actorUserId, verifier, FACEBOOK_SOURCE_KEY, batch.actionable.filter((item) => item.sourceKind === 'social_api'));
    database.recordSourceCheck(workspaceId, database.getSourceByKey(workspaceId, FACEBOOK_SOURCE_KEY)!.id, 'ok');
  }
  for (const mention of batch.review) database.queueAmbiguousSocialMention(workspaceId, {
    platform: mention.platform,
    sourceName: mention.sourceName,
    sourceLink: mention.link,
    summary: mention.summary,
    reason: mention.reason,
    observedAt: mention.observedAt,
  });
  return { imported, ambiguous: batch.review.length };
}

export async function runOpenStreetMapIntake(
  database: AppDatabase,
  config: AppConfig,
  workspaceId: string,
  dependencies: IntakeDependencies = {},
): Promise<{ imported: number }> {
  if (database.workspaceSafetyStop(workspaceId) || !config.provider.openStreetMapConfigured || !sourceIsEnabled(database, workspaceId, OPEN_STREET_MAP_SOURCE_KEY)) return { imported: 0 };
  const actorUserId = database.workspaceOperatorUserId(workspaceId);
  if (!actorUserId) throw new Error('OpenStreetMap intake needs a workspace owner or operator.');
  const mentions = await fetchOpenStreetMapPilotMentions({
    overpassUrl: config.provider.openStreetMapOverpassUrl!,
    boundingBox: config.provider.openStreetMapPilotBoundingBox!,
    fetchImpl: dependencies.fetchImpl,
  });
  const imported = await ingestItems(database, workspaceId, actorUserId, addressVerifier(config, dependencies), OPEN_STREET_MAP_SOURCE_KEY, mentions);
  database.recordSourceCheck(workspaceId, database.getSourceByKey(workspaceId, OPEN_STREET_MAP_SOURCE_KEY)!.id, 'ok');
  return { imported };
}

export async function runBuurtkastjeskaartIntake(
  database: AppDatabase,
  config: AppConfig,
  workspaceId: string,
  dependencies: IntakeDependencies = {},
): Promise<{ imported: number }> {
  const path = config.provider.buurtkastjeskaartExportPath;
  if (database.workspaceSafetyStop(workspaceId) || !path || !existsSync(path) || !sourceIsEnabled(database, workspaceId, BUURTKASTJESKAART_SOURCE_KEY)) return { imported: 0 };
  const actorUserId = database.workspaceOperatorUserId(workspaceId);
  if (!actorUserId) throw new Error('Buurtkastjeskaart intake needs a workspace owner or operator.');
  const content = readFileSync(path, 'utf8');
  const mentions = path.toLowerCase().endsWith('.json')
    ? parseBuurtkastjeskaartJsonExport(content)
    : parseBuurtkastjeskaartHtmlExport(content);
  const imported = await ingestItems(database, workspaceId, actorUserId, addressVerifier(config, dependencies), BUURTKASTJESKAART_SOURCE_KEY, mentions);
  database.recordSourceCheck(workspaceId, database.getSourceByKey(workspaceId, BUURTKASTJESKAART_SOURCE_KEY)!.id, 'ok');
  return { imported };
}

export function scheduleRecurringJobs(database: AppDatabase, config: AppConfig, now = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  let queued = 0;
  database.queueJob({ jobType: 'cleanup_sessions', idempotencyKey: `cleanup-sessions:${day}` });
  queued += 1;
  for (const workspaceId of database.workspaceIds()) {
    const settings = database.getSettings(workspaceId) as { staleAfterDays?: number; retentionDays?: number } | undefined;
    database.queueJob({ workspaceId, jobType: 'stale_review', payload: { days: settings?.staleAfterDays ?? 30 }, idempotencyKey: `stale-review:${workspaceId}:${day}` });
    database.queueJob({ workspaceId, jobType: 'retention_cleanup', payload: { days: settings?.retentionDays ?? 365 }, idempotencyKey: `retention:${workspaceId}:${day}` });
    queued += 2;
    if (config.provider.facebookConfigured || config.provider.nextdoorExportPath) {
      database.queueJob({ workspaceId, jobType: 'social_intake', idempotencyKey: `social-intake:${workspaceId}:${day}`, maxAttempts: 4 });
      queued += 1;
    }
    if (config.provider.openStreetMapConfigured) {
      database.queueJob({ workspaceId, jobType: 'openstreetmap_intake', idempotencyKey: `openstreetmap-intake:${workspaceId}:${day}`, maxAttempts: 3 });
      queued += 1;
    }
    if (config.provider.buurtkastjeskaartExportPath) {
      database.queueJob({ workspaceId, jobType: 'buurtkastjeskaart_intake', idempotencyKey: `buurtkastjeskaart-intake:${workspaceId}:${day}`, maxAttempts: 3 });
      queued += 1;
    }
  }
  return queued;
}

export async function executeJob(database: AppDatabase, config: AppConfig, job: JobRecord): Promise<void> {
  switch (job.jobType) {
    case 'cleanup_sessions': database.cleanupExpiredSessions(); return;
    case 'stale_review': database.staleItems(job.workspaceId!, Number(job.payload.days ?? 30)); return;
    case 'retention_cleanup': database.applyRetention(job.workspaceId!, Number(job.payload.days ?? 365)); return;
    case 'social_intake': await runSocialIntake(database, config, job.workspaceId!); return;
    case 'openstreetmap_intake': await runOpenStreetMapIntake(database, config, job.workspaceId!); return;
    case 'buurtkastjeskaart_intake': await runBuurtkastjeskaartIntake(database, config, job.workspaceId!); return;
    default: throw new Error(`Unknown job type: ${job.jobType}`);
  }
}

export async function runOneJob(database: AppDatabase, config: AppConfig): Promise<boolean> {
  const job = database.claimNextJob();
  if (!job) return false;
  try {
    await executeJob(database, config, job);
    database.completeJob(job.id);
  } catch (error) {
    database.failJob(job.id, error instanceof Error ? error.message : String(error));
  }
  return true;
}
