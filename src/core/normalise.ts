import type { IntakeItem, LocationRecordInput, LocationStatus } from '../types.js';
import { inferCategoriesFromText } from '../categories.js';

const REMOVED_WORDS = ['verwijderd', 'weggehaald', 'bestaat niet meer', 'is weg', 'removed'];
const ACTIVE_WORDS = ['actief', 'staat er nog', 'beschikbaar', 'aanwezig', 'open'];
const UNCERTAIN_WORDS = ['misschien', 'mogelijk', 'onzeker', 'weet niet', 'kan zijn'];

export function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function normaliseKey(value: string | undefined): string {
  return cleanText(value)?.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() ?? '';
}

export function inferStatus(item: IntakeItem): LocationStatus {
  const combined = normaliseKey(`${item.statusHint ?? ''} ${item.text} ${item.notes ?? ''}`);

  if (REMOVED_WORDS.some((word) => combined.includes(normaliseKey(word)))) return 'removed';
  if (UNCERTAIN_WORDS.some((word) => combined.includes(normaliseKey(word)))) return 'uncertain';
  if (ACTIVE_WORDS.some((word) => combined.includes(normaliseKey(word)))) return 'active';

  return item.sourceKind === 'manual' ? 'needs_verification' : 'uncertain';
}

export function scoreConfidence(item: IntakeItem, status: LocationStatus): number {
  let score = 30;

  if (item.city) score += 15;
  if (item.addressHint) score += 20;
  if (item.link) score += 10;
  if (typeof item.latitude === 'number' && typeof item.longitude === 'number') score += 15;
  if (item.categories && item.categories.length > 0) score += 10;
  if (item.sourceKind === 'official') score += 20;
  if (item.sourceKind === 'approved_export') score += 10;
  if (status === 'active') score += 10;
  if (status === 'removed') score += 5;
  if (status === 'uncertain' || status === 'needs_verification') score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function toLocationInput(item: IntakeItem): LocationRecordInput {
  const status = inferStatus(item);
  const confidence = scoreConfidence(item, status);
  const city = cleanText(item.city);
  const addressHint = cleanText(item.addressHint);
  const titleBase = addressHint && city ? `${addressHint}, ${city}` : city ? `Buurtkastje in ${city}` : 'Buurtkastje zonder bevestigde plaats';
  const inferredCategories = inferCategoriesFromText(`${item.text} ${item.notes ?? ''} ${item.statusHint ?? ''}`);

  return {
    title: titleBase,
    city,
    addressHint,
    status,
    confidence,
    needsReview: confidence < 70 || status !== 'active',
    evidenceSummary: cleanText(item.text)?.slice(0, 500) ?? 'No evidence summary provided.',
    sourceKind: item.sourceKind,
    sourceName: cleanText(item.sourceName) ?? 'Unknown source',
    sourceLink: cleanText(item.link),
    observedAt: item.observedAt,
    categories: item.categories && item.categories.length > 0 ? item.categories : inferredCategories,
    latitude: item.latitude,
    longitude: item.longitude,
    municipality: cleanText(item.municipality),
    province: cleanText(item.province),
  };
}

export function duplicateKey(input: Pick<LocationRecordInput, 'city' | 'addressHint' | 'title'>): string {
  const city = normaliseKey(input.city);
  const address = normaliseKey(input.addressHint);
  const title = normaliseKey(input.title);
  return [city, address || title].filter(Boolean).join('::');
}
