import type { ProductCategory } from './categories.js';

export type SourceKind = 'official' | 'manual' | 'approved_export' | 'social_api' | 'open_data' | 'unknown';

export type LocationStatus = 'active' | 'uncertain' | 'removed' | 'needs_verification';

export interface IntakeItem {
  sourceKind: SourceKind;
  sourceName: string;
  observedAt: string;
  text: string;
  link?: string;
  city?: string;
  addressHint?: string;
  postalCode?: string;
  statusHint?: string;
  notes?: string;
  categories?: ProductCategory[];
  latitude?: number;
  longitude?: number;
  municipality?: string;
  province?: string;
}

export interface LocationRecordInput {
  title: string;
  city?: string;
  addressHint?: string;
  status: LocationStatus;
  confidence: number;
  needsReview: boolean;
  evidenceSummary: string;
  sourceKind: SourceKind;
  sourceName: string;
  sourceLink?: string;
  observedAt: string;
  categories: ProductCategory[];
  latitude?: number;
  longitude?: number;
  municipality?: string;
  province?: string;
}

export interface StoredLocation extends LocationRecordInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
}
