import type { AppDatabase } from '../db/appDatabase.js';
import type { AddressVerifier } from '../integrations/pdokAddress.js';
import {
  caretakerUpdateSchema,
  residentCandidateSchema,
  type CaretakerUpdateInput,
  type LocationUpdateRequest,
  type ResidentCandidate,
  type ResidentLocation,
} from '../domain/residentLocation.js';

export interface ResidentCandidateDraft {
  sourceKey?: string;
  title?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  observedAt?: string;
  evidenceSummary?: string;
  sourceLink?: string;
  sourceRecordId?: string;
  categories?: string[];
  status?: 'active' | 'inactive' | 'removed';
}

export interface ResidentCatalogDependencies {
  database: AppDatabase;
  verifier: AddressVerifier;
}

export interface ResidentCandidateIngestionRequest {
  workspaceId: string;
  actorUserId?: string;
  candidate: ResidentCandidateDraft;
}

export type ResidentCandidateIngestionResult =
  | { disposition: 'published'; location: ResidentLocation }
  | { disposition: 'duplicate'; location: ResidentLocation }
  | { disposition: 'review'; reason: string; location?: ResidentLocation; request: LocationUpdateRequest };

function toPartialCandidate(candidate: ResidentCandidateDraft): Partial<ResidentCandidate> {
  return {
    sourceKey: candidate.sourceKey,
    title: candidate.title,
    address: candidate.address,
    postalCode: candidate.postalCode,
    city: candidate.city,
    observedAt: candidate.observedAt,
    evidenceSummary: candidate.evidenceSummary,
    sourceLink: candidate.sourceLink,
    sourceRecordId: candidate.sourceRecordId,
    categories: candidate.categories,
    status: candidate.status,
  };
}

function queueReview(
  dependencies: ResidentCatalogDependencies,
  input: ResidentCandidateIngestionRequest,
  reason: string,
  sourceRegistryId?: string,
): ResidentCandidateIngestionResult {
  const request = dependencies.database.queueLocationUpdateRequest(input.workspaceId, {
    requestType: 'candidate',
    reason,
    sourceRegistryId,
    candidate: toPartialCandidate(input.candidate),
  }, input.actorUserId);
  return { disposition: 'review', reason, request };
}

export async function ingestResidentCandidate(
  dependencies: ResidentCatalogDependencies,
  input: ResidentCandidateIngestionRequest,
): Promise<ResidentCandidateIngestionResult> {
  const parsedCandidate = residentCandidateSchema.safeParse(input.candidate);
  if (!parsedCandidate.success) return queueReview(dependencies, input, 'exact_address_required');

  const candidate = parsedCandidate.data;
  const source = dependencies.database.getSourceByKey(input.workspaceId, candidate.sourceKey);
  if (!source || !source.enabled || !source.allowsExactAddress) {
    return queueReview(dependencies, input, 'source_not_authorized', source?.id);
  }
  const existing = dependencies.database.findResidentLocationByEvidence(input.workspaceId, source, candidate);
  if (existing) return { disposition: 'duplicate', location: existing };

  const verified = await dependencies.verifier.verify({
    address: candidate.address,
    postalCode: candidate.postalCode,
    city: candidate.city,
  });
  if (!verified) return queueReview(dependencies, input, 'address_not_verified', source.id);

  const location = dependencies.database.upsertVerifiedResidentLocation(
    input.workspaceId,
    input.actorUserId,
    source,
    candidate,
    verified,
    'system',
  );
  if (location.publicationStatus === 'published' && location.status === 'active') {
    return { disposition: 'published', location };
  }
  const request = dependencies.database.queueLocationUpdateRequest(input.workspaceId, {
    locationId: location.id,
    sourceRegistryId: source.id,
    requestType: 'source_review',
    reason: 'source_review_required',
    candidate,
  }, input.actorUserId);
  return { disposition: 'review', reason: 'source_review_required', location, request };
}

export async function applyCaretakerChange(
  dependencies: ResidentCatalogDependencies,
  token: string,
  input: CaretakerUpdateInput,
): Promise<ResidentLocation | undefined> {
  const parsed = caretakerUpdateSchema.parse(input);
  const verified = await dependencies.verifier.verify({
    address: parsed.address,
    postalCode: parsed.postalCode,
    city: parsed.city,
  });
  if (!verified) return undefined;
  return dependencies.database.applyCaretakerUpdate(token, parsed, verified);
}
