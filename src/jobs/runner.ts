import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inferCategoriesFromText } from '../categories.js';
import { toLocationInput } from '../core/normalise.js';
import { openDatabase } from '../db/sqlite.js';
import type { AppConfig } from '../config.js';
import { AppDatabase, type CreateExchangeItemInput, type JobRecord } from '../db/appDatabase.js';
import type { IntakeItem } from '../types.js';
import {
  fetchFacebookPageMentions,
  parseApprovedSocialExportJsonl,
  parseFacebookPageContextsConfig,
  type SocialIngestionBatch,
} from '../adapters/socialEvidence.js';

function batchKey(item: IntakeItem): string {
  return createHash('sha256').update([item.sourceKind, item.sourceName, item.link ?? '', item.observedAt, item.text].join('|')).digest('hex').slice(0, 24);
}

function exchangeInput(item: IntakeItem): CreateExchangeItemInput {
  const firstLine = item.text.split(/[.!?\n]/)[0]?.trim() || 'Melding van een weggeefkastje';
  return {
    title: firstLine.slice(0, 160),
    description: item.text.slice(0, 4000),
    category: (item.categories?.[0] ?? inferCategoriesFromText(item.text)[0]) || 'Overig',
    platformTarget: item.sourceName.toLowerCase().includes('nextdoor') || item.sourceKind === 'approved_export' ? 'nextdoor' : 'facebook',
    sourceKind: item.sourceKind,
    sourceName: item.sourceName,
    sourceLink: item.link,
    city: item.city ?? item.municipality ?? 'Onbekend',
    addressHint: item.addressHint,
    latitude: item.latitude,
    longitude: item.longitude,
    confidence: typeof item.latitude === 'number' && typeof item.longitude === 'number' ? 80 : 65,
    pickupNotes: item.notes,
    contactMethod: 'platform',
    privacyLevel: 'approximate',
  };
}

function mergeBatches(...batches: SocialIngestionBatch[]): SocialIngestionBatch {
  return batches.reduce((all, batch) => ({
    actionable: [...all.actionable, ...batch.actionable],
    review: [...all.review, ...batch.review],
  }), { actionable: [], review: [] });
}

export async function collectSocialEvidence(config: AppConfig): Promise<SocialIngestionBatch> {
  const batches: SocialIngestionBatch[] = [];
  if (config.provider.nextdoorExportPath && existsSync(config.provider.nextdoorExportPath)) {
    batches.push(parseApprovedSocialExportJsonl(readFileSync(config.provider.nextdoorExportPath, 'utf8'), 'nextdoor'));
  }
  if (config.provider.facebookConfigured) {
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

export async function runSocialIntake(database: AppDatabase, config: AppConfig, workspaceId: string): Promise<{ imported: number; ambiguous: number }> {
  if (database.workspaceSafetyStop(workspaceId)) return { imported: 0, ambiguous: 0 };
  const actorUserId = database.workspaceOperatorUserId(workspaceId);
  if (!actorUserId) throw new Error('Social intake needs a workspace owner or operator.');
  const batch = await collectSocialEvidence(config);
  let imported = 0;
  const catalogue = openDatabase(config.databasePath);
  try {
    for (const mention of batch.actionable) {
      const input = exchangeInput(mention);
      if (database.hasItemEvidence(workspaceId, input)) continue;
      const detail = database.createItem(workspaceId, actorUserId, input, `worker-social-${batchKey(mention)}`);
      catalogue.upsertLocation(toLocationInput(mention));
      database.transitionItem(workspaceId, actorUserId, detail.item.id, {
        action: 'submit',
        idempotencyKey: `social-submit-${batchKey(mention)}`,
      }, `worker-social-${batchKey(mention)}`);
      imported += 1;
    }
  } finally {
    catalogue.close();
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
  }
  return queued;
}

export async function executeJob(database: AppDatabase, config: AppConfig, job: JobRecord): Promise<void> {
  switch (job.jobType) {
    case 'cleanup_sessions': database.cleanupExpiredSessions(); return;
    case 'stale_review': database.staleItems(job.workspaceId!, Number(job.payload.days ?? 30)); return;
    case 'retention_cleanup': database.applyRetention(job.workspaceId!, Number(job.payload.days ?? 365)); return;
    case 'social_intake': await runSocialIntake(database, config, job.workspaceId!); return;
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
