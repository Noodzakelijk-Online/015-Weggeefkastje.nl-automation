import type { IntakeItem, SourceKind } from '../types.js';
import { cleanText, normaliseKey } from '../core/normalise.js';

export type SocialPlatform = 'facebook' | 'nextdoor';

export interface SocialReviewMention {
  platform: SocialPlatform;
  sourceName: string;
  observedAt: string;
  link?: string;
  summary: string;
  reason: 'missing_reliable_location';
}

export interface SocialIngestionBatch {
  actionable: IntakeItem[];
  review: SocialReviewMention[];
}

export interface FacebookPageContext {
  id: string;
  name?: string;
  city?: string;
  municipality?: string;
  province?: string;
}

export interface FacebookGraphOptions {
  accessToken: string;
  apiVersion: string;
  pages: FacebookPageContext[];
  maxPostsPerPage?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
}

export function parseFacebookPageContextsConfig(value: string): FacebookPageContext[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('FACEBOOK_PAGE_CONTEXTS_JSON must be a JSON array.');
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') {
      throw new Error(`Facebook page context ${index + 1} requires an id.`);
    }
    const row = entry as Record<string, unknown>;
    return {
      id: row.id as string,
      name: asString(row.name),
      city: asString(row.city),
      municipality: asString(row.municipality),
      province: asString(row.province),
    };
  });
}

const MENTION_TERMS = [
  'weggeefkastje',
  'weggeefkastjes',
  'buurtkastje',
  'buurtkastjes',
  'deelkastje',
  'deelkastjes',
  'ruilkastje',
  'ruilkastjes',
  'voedselkastje',
  'voedselkastjes',
  'minibieb',
  'minibibliotheek',
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? cleanText(value) : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function redactContactDetails(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/(?:\+31|0)[\s.-]?(?:\d[\s.-]?){8,10}\d/g, '[redacted phone]');
}

export function isWeggeefkastjeMention(text: string): boolean {
  const normalised = normaliseKey(text);
  return MENTION_TERMS.some((term) => normalised.includes(normaliseKey(term)));
}

function hasReliableLocation(item: IntakeItem): boolean {
  return Boolean(cleanText(item.addressHint)) || (typeof item.latitude === 'number' && typeof item.longitude === 'number');
}

function splitBatch(item: IntakeItem, platform: SocialPlatform): SocialIngestionBatch {
  if (hasReliableLocation(item)) return { actionable: [item], review: [] };

  return {
    actionable: [],
    review: [{
      platform,
      sourceName: item.sourceName,
      observedAt: item.observedAt,
      link: item.link,
      summary: item.text.slice(0, 500),
      reason: 'missing_reliable_location',
    }],
  };
}

function combineBatches(batches: SocialIngestionBatch[]): SocialIngestionBatch {
  return batches.reduce<SocialIngestionBatch>((combined, batch) => ({
    actionable: [...combined.actionable, ...batch.actionable],
    review: [...combined.review, ...batch.review],
  }), { actionable: [], review: [] });
}

function intakeFromRow(row: Record<string, unknown>, platform: SocialPlatform, sourceKind: SourceKind, defaults: Partial<IntakeItem> = {}): IntakeItem | undefined {
  const rawText = asString(row.text ?? row.message ?? row.content ?? row.description);
  if (!rawText || !isWeggeefkastjeMention(rawText)) return undefined;

  const location = typeof row.location === 'object' && row.location !== null ? row.location as Record<string, unknown> : {};
  return {
    sourceKind,
    sourceName: asString(row.sourceName ?? row.pageName ?? defaults.sourceName) ?? `${platform}-approved-source`,
    observedAt: asString(row.observedAt ?? row.created_time ?? row.createdAt) ?? new Date().toISOString(),
    text: redactContactDetails(rawText),
    link: asString(row.link ?? row.permalink_url ?? row.url),
    city: asString(row.city ?? location.city ?? defaults.city),
    addressHint: asString(row.addressHint ?? row.address ?? location.street ?? defaults.addressHint),
    statusHint: asString(row.statusHint ?? row.status),
    notes: asString(row.notes),
    latitude: asNumber(row.latitude ?? row.lat ?? location.latitude),
    longitude: asNumber(row.longitude ?? row.lng ?? row.lon ?? location.longitude),
    municipality: asString(row.municipality ?? location.municipality ?? defaults.municipality),
    province: asString(row.province ?? location.province ?? defaults.province),
  };
}

export function parseApprovedSocialExportJsonl(content: string, platform: SocialPlatform): SocialIngestionBatch {
  const batches = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        throw new Error(`${platform} export line ${index + 1} is not valid JSON.`);
      }
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        throw new Error(`${platform} export line ${index + 1} must be a JSON object.`);
      }
      const item = intakeFromRow(row as Record<string, unknown>, platform, 'approved_export');
      return item ? splitBatch(item, platform) : { actionable: [], review: [] };
    });

  return combineBatches(batches);
}

export function parseFacebookGraphPosts(content: string, page: FacebookPageContext): SocialIngestionBatch {
  const parsed = JSON.parse(content) as { data?: unknown };
  if (!Array.isArray(parsed.data)) throw new Error(`Facebook Graph response for page ${page.id} did not contain a data array.`);

  const batches = parsed.data
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => {
      const place = typeof row.place === 'object' && row.place !== null ? row.place as Record<string, unknown> : undefined;
      const placeLocation = typeof place?.location === 'object' && place.location !== null ? place.location : undefined;
      const item = intakeFromRow({ ...row, location: row.location ?? placeLocation }, 'facebook', 'social_api', {
        sourceName: page.name ?? `Facebook page ${page.id}`,
        city: page.city,
        municipality: page.municipality,
        province: page.province,
      });
      return item ? splitBatch(item, 'facebook') : { actionable: [], review: [] };
    });

  return combineBatches(batches);
}

export async function fetchFacebookPageMentions(options: FacebookGraphOptions): Promise<SocialIngestionBatch> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPostsPerPage = options.maxPostsPerPage ?? 100;
  const maxPages = options.maxPages ?? 5;
  const batches: SocialIngestionBatch[] = [];

  for (const page of options.pages) {
    let endpoint: URL | undefined = new URL(`https://graph.facebook.com/${options.apiVersion}/${encodeURIComponent(page.id)}/posts`);
    endpoint.searchParams.set('fields', 'id,message,created_time,permalink_url,place');
    endpoint.searchParams.set('limit', String(maxPostsPerPage));
    endpoint.searchParams.set('access_token', options.accessToken);

    for (let pageNumber = 0; endpoint && pageNumber < maxPages; pageNumber += 1) {
      const response = await fetchImpl(endpoint);
      if (!response.ok) throw new Error(`Facebook Graph request for page ${page.id} failed with ${response.status}.`);
      const body = await response.text();
      batches.push(parseFacebookGraphPosts(body, page));
      const parsed = JSON.parse(body) as { paging?: { next?: string } };
      if (!parsed.paging?.next) break;
      const next = new URL(parsed.paging.next);
      if (next.protocol !== 'https:' || next.hostname !== 'graph.facebook.com') throw new Error('Facebook paging URL was rejected.');
      endpoint = next;
    }
  }

  return combineBatches(batches);
}
