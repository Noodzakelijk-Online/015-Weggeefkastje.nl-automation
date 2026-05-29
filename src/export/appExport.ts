import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredLocation } from '../types.js';
import { buildGoogleMapsDirectionsUrl, buildGoogleMapsSearchUrl } from '../app/navigation.js';

export interface AppExportLocation {
  id: string;
  title: string;
  city?: string;
  addressHint?: string;
  status: StoredLocation['status'];
  categories: StoredLocation['categories'];
  confidence: number;
  needsReview: boolean;
  latitude?: number;
  longitude?: number;
  municipality?: string;
  province?: string;
  evidenceCount: number;
  lastObservedAt: string;
  directionsUrl: string;
  mapsSearchUrl: string;
}

export interface AppExportPayload {
  generatedAt: string;
  count: number;
  locations: AppExportLocation[];
}

export function toAppExportLocation(location: StoredLocation): AppExportLocation {
  return {
    id: location.id,
    title: location.title,
    city: location.city,
    addressHint: location.addressHint,
    status: location.status,
    categories: location.categories,
    confidence: location.confidence,
    needsReview: location.needsReview,
    latitude: location.latitude,
    longitude: location.longitude,
    municipality: location.municipality,
    province: location.province,
    evidenceCount: location.evidenceCount,
    lastObservedAt: location.observedAt,
    directionsUrl: buildGoogleMapsDirectionsUrl(location),
    mapsSearchUrl: buildGoogleMapsSearchUrl(location),
  };
}

export function buildAppExport(locations: StoredLocation[]): AppExportPayload {
  const publicLocations = locations.filter((location) => location.status !== 'removed');
  return {
    generatedAt: new Date().toISOString(),
    count: publicLocations.length,
    locations: publicLocations.map(toAppExportLocation),
  };
}

export function writeAppExport(path: string, locations: StoredLocation[]): AppExportPayload {
  mkdirSync(dirname(path), { recursive: true });
  const payload = buildAppExport(locations);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}
