export type SourceKind = 'official' | 'manual' | 'approved_export' | 'open_data' | 'unknown';

export type LocationStatus = 'active' | 'uncertain' | 'removed' | 'needs_verification';

export interface IntakeItem {
  sourceKind: SourceKind;
  sourceName: string;
  observedAt: string;
  text: string;
  link?: string;
  city?: string;
  addressHint?: string;
  statusHint?: string;
  notes?: string;
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
}

export interface StoredLocation extends LocationRecordInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
}
