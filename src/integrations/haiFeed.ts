import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/appDatabase.js';
import type { ExchangeItem } from '../domain/exchange.js';
import { redactPublicContactDetails } from '../domain/rules.js';

interface HaiCursor {
  updatedAt: string;
  id: string;
}

function sameSecret(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function haiRequestAuthorized(req: Request, config: AppConfig): boolean {
  if (!config.hai.enabled) return false;
  const authorization = req.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
  const compatibilityToken = typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
  return sameSecret(bearer ?? compatibilityToken, config.hai.feedToken);
}

export function decodeHaiCursor(raw: unknown): HaiCursor | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<HaiCursor>;
    if (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt)) || typeof value.id !== 'string' || !value.id) {
      return undefined;
    }
    return { updatedAt: value.updatedAt, id: value.id };
  } catch {
    return undefined;
  }
}

function encodeHaiCursor(item: ExchangeItem): string {
  return Buffer.from(JSON.stringify({ updatedAt: item.updatedAt, id: item.id })).toString('base64url');
}

function haiContent(item: ExchangeItem): string {
  const description = item.privacyLevel === 'private'
    ? 'Beschrijving afgeschermd wegens het ingestelde privacyniveau.'
    : redactPublicContactDetails(item.description);
  return [
    description,
    `Status: ${item.status}`,
    `Plaats: ${item.city}`,
    `Categorie: ${item.category}`,
    `Doelplatform: ${item.platformTarget}`,
    `Menselijke controle nodig: ${item.needsReview ? 'ja' : 'nee'}`,
  ].join('\n\n');
}

export function buildHaiFeed(database: AppDatabase, config: AppConfig, rawCursor: unknown) {
  const workspaceIds = database.workspaceIds();
  const workspaceId = config.hai.workspaceId ?? (workspaceIds.length === 1 ? workspaceIds[0] : undefined);
  if (!workspaceId || !workspaceIds.includes(workspaceId)) {
    throw new Error('HAI feed needs HAI_WORKSPACE_ID when the database has zero or multiple workspaces.');
  }
  const cursor = decodeHaiCursor(rawCursor);
  if (typeof rawCursor === 'string' && rawCursor && !cursor) throw new Error('Invalid HAI feed cursor.');
  const page = database.haiFeedPage(workspaceId, cursor, 100);
  const last = page.items.at(-1);
  return {
    items: page.items.map((item) => ({
      externalId: `weggeefkastje:${workspaceId}:${item.id}`,
      title: redactPublicContactDetails(item.title),
      content: haiContent(item),
      sourceUri: item.sourceLink ?? `weggeefkastje://item/${item.id}`,
      itemType: 'weggeefkastje_exchange',
      projectKey: config.hai.projectKey,
      metadata: JSON.stringify({
        schemaVersion: 1,
        status: item.status,
        city: item.city,
        category: item.category,
        platform: item.platformTarget,
        confidence: item.confidence,
        needsReview: item.needsReview,
        updatedAt: item.updatedAt,
        readOnly: true,
      }),
    })),
    ...(last ? { nextCursor: encodeHaiCursor(last) } : {}),
  };
}
