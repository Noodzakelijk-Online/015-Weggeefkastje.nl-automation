import type { StoredLocation } from '../types.js';
import type { ProductCategory } from '../categories.js';
import { inferCategoriesFromText } from '../categories.js';
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsSearchUrl } from './navigation.js';

export interface SearchRequest {
  category?: ProductCategory;
  city?: string;
  includeNeedsReview?: boolean;
  limit?: number;
}

export interface AppSearchResult {
  location: StoredLocation;
  matchedCategories: ProductCategory[];
  score: number;
  directionsUrl: string;
  mapsSearchUrl: string;
}

function normalise(value: string | undefined): string {
  return value
    ?.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() ?? '';
}

function scoreLocation(location: StoredLocation, request: SearchRequest, matchedCategories: ProductCategory[]): number {
  let score = location.confidence;

  if (location.status === 'active') score += 25;
  if (location.status === 'removed') score -= 100;
  if (location.needsReview) score -= 20;
  if (request.category && matchedCategories.includes(request.category)) score += 30;
  if (request.city && normalise(location.city) === normalise(request.city)) score += 20;
  if (location.addressHint) score += 10;
  if (location.evidenceCount > 1) score += Math.min(15, location.evidenceCount * 3);

  return score;
}

export function searchLocations(locations: StoredLocation[], request: SearchRequest): AppSearchResult[] {
  const limit = request.limit ?? 20;
  const city = normalise(request.city);

  return locations
    .filter((location) => request.includeNeedsReview || !location.needsReview)
    .filter((location) => location.status !== 'removed')
    .filter((location) => !city || normalise(location.city) === city)
    .map((location) => {
      const matchedCategories = inferCategoriesFromText(`${location.title} ${location.evidenceSummary}`);
      return {
        location,
        matchedCategories,
        score: scoreLocation(location, request, matchedCategories),
        directionsUrl: buildGoogleMapsDirectionsUrl(location),
        mapsSearchUrl: buildGoogleMapsSearchUrl(location),
      };
    })
    .filter((result) => !request.category || result.matchedCategories.includes(request.category))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
