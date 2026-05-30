import * as cheerio from 'cheerio';
import type { IntakeItem } from '../types.js';
import { inferCategoriesFromText } from '../categories.js';

function clean(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function parseCoordinate(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function cityFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : undefined;
}

function toItem(raw: Record<string, unknown>, sourceUrl: string): IntakeItem | undefined {
  const title = clean(String(raw.title ?? raw.name ?? raw.post_title ?? raw.marker_title ?? ''));
  const address = clean(String(raw.address ?? raw.marker_address ?? raw.location ?? ''));
  const description = clean(String(raw.description ?? raw.desc ?? raw.content ?? raw.marker_description ?? ''));
  const categoryText = clean(String(raw.category ?? raw.categories ?? raw.marker_category ?? ''));
  const link = clean(String(raw.link ?? raw.url ?? raw.permalink ?? sourceUrl));
  const latitude = parseCoordinate(raw.lat ?? raw.latitude ?? raw.marker_lat);
  const longitude = parseCoordinate(raw.lng ?? raw.lon ?? raw.longitude ?? raw.marker_lng);
  const text = clean([title, categoryText, address, description].filter(Boolean).join(' | '));

  if (!text) return undefined;

  return {
    sourceKind: 'official',
    sourceName: 'buurtkastjeskaart.nl public export',
    observedAt: new Date().toISOString(),
    text,
    link,
    city: cityFromAddress(address),
    addressHint: address,
    statusHint: 'active',
    notes: description,
    categories: inferCategoriesFromText(`${categoryText ?? ''} ${description ?? ''} ${title ?? ''}`),
    latitude,
    longitude,
  };
}

export function parseBuurtkastjeskaartJsonExport(jsonText: string, sourceUrl = 'https://buurtkastjeskaart.nl/'): IntakeItem[] {
  const parsed = JSON.parse(jsonText) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : [];

  return rows
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => toItem(row, sourceUrl))
    .filter((item): item is IntakeItem => Boolean(item));
}

export function parseBuurtkastjeskaartHtmlExport(html: string, sourceUrl = 'https://buurtkastjeskaart.nl/'): IntakeItem[] {
  const $ = cheerio.load(html);
  const candidates: Record<string, unknown>[] = [];

  $('[data-lat], [data-lng], [data-longitude], [data-latitude]').each((_, element) => {
    const node = $(element);
    candidates.push({
      title: node.attr('data-title') ?? node.find('h2,h3,h4,.title').first().text(),
      address: node.attr('data-address') ?? node.find('.address,.adres').first().text(),
      description: node.attr('data-description') ?? node.text(),
      category: node.attr('data-category'),
      lat: node.attr('data-lat') ?? node.attr('data-latitude'),
      lng: node.attr('data-lng') ?? node.attr('data-longitude'),
    });
  });

  const scriptText = $('script')
    .map((_, element) => $(element).text())
    .get()
    .join('\n');

  const jsonArrayMatches = scriptText.match(/\[[\s\S]*?\]/g) ?? [];
  for (const match of jsonArrayMatches) {
    if (!match.includes('lat') && !match.includes('lng') && !match.includes('address')) continue;
    try {
      const parsed = JSON.parse(match) as unknown;
      if (Array.isArray(parsed)) {
        candidates.push(...parsed.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null));
      }
    } catch {
      // Ignore non-JSON script fragments. This parser must fail safely.
    }
  }

  const seen = new Set<string>();
  return candidates
    .map((candidate) => toItem(candidate, sourceUrl))
    .filter((item): item is IntakeItem => Boolean(item))
    .filter((item) => {
      const key = `${item.addressHint ?? ''}|${item.latitude ?? ''}|${item.longitude ?? ''}|${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
