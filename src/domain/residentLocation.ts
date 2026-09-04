import { z } from 'zod';

export const SOURCE_ACCESS_MODES = ['official_api', 'approved_export', 'open_data', 'owner_authorized', 'manual'] as const;
export const SOURCE_PUBLICATION_MODES = ['automatic', 'review'] as const;
export const RESIDENT_LOCATION_STATUSES = ['active', 'inactive', 'removed'] as const;
export const LOCATION_UPDATE_REQUEST_TYPES = ['candidate', 'public_report', 'source_review'] as const;

export type SourceAccessMode = (typeof SOURCE_ACCESS_MODES)[number];
export type SourcePublicationMode = (typeof SOURCE_PUBLICATION_MODES)[number];
export type ResidentLocationStatus = (typeof RESIDENT_LOCATION_STATUSES)[number];
export type LocationUpdateRequestType = (typeof LOCATION_UPDATE_REQUEST_TYPES)[number];

const postalCodePattern = /^\d{4}[A-Z]{2}$/;
const houseNumberPattern = /(?:^|\s)\d{1,5}(?:\s*[-/]?\s*[A-Z0-9]{0,8})?(?:\s|$)/i;

export const postalCodeSchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/\s+/g, ''))
  .refine((value) => postalCodePattern.test(value), 'Gebruik een Nederlandse postcode, bijvoorbeeld 1234AB.');

export const exactAddressSchema = z.object({
  address: z.string()
    .trim()
    .min(5)
    .max(240)
    .refine((value) => houseNumberPattern.test(value), 'Een huisnummer is verplicht.'),
  postalCode: postalCodeSchema,
  city: z.string().trim().min(2).max(120),
});

const sourceRegistrationBaseSchema = z.object({
  key: z.string().trim().min(3).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Gebruik kleine letters, cijfers en streepjes.'),
  name: z.string().trim().min(3).max(160),
  accessMode: z.enum(SOURCE_ACCESS_MODES),
  authorizationReference: z.string().trim().min(3).max(500),
  attribution: z.string().trim().min(2).max(300),
  publicationMode: z.enum(SOURCE_PUBLICATION_MODES).default('review'),
  enabled: z.boolean().default(false),
  allowsExactAddress: z.boolean().default(false),
});

export const sourceRegistrationSchema = sourceRegistrationBaseSchema.superRefine((source, context) => {
  if (source.publicationMode === 'automatic' && !source.enabled) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['enabled'], message: 'Een automatische bron moet ingeschakeld zijn.' });
  }
  if (source.publicationMode === 'automatic' && !source.allowsExactAddress) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowsExactAddress'], message: 'Automatisch publiceren vereist toestemming voor het exacte adres.' });
  }
});

export const sourceUpdateSchema = sourceRegistrationBaseSchema.partial().omit({ key: true });

export const residentCandidateSchema = exactAddressSchema.extend({
  sourceKey: z.string().trim().min(3).max(80),
  title: z.string().trim().min(3).max(160),
  observedAt: z.string().datetime(),
  evidenceSummary: z.string().trim().min(3).max(1000),
  sourceLink: z.string().url().max(1000).optional(),
  sourceRecordId: z.string().trim().min(1).max(240).optional(),
  categories: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  status: z.enum(RESIDENT_LOCATION_STATUSES).default('active'),
});

export const caretakerUpdateSchema = exactAddressSchema.extend({
  status: z.enum(['active', 'inactive']),
  title: z.string().trim().min(3).max(160).optional(),
  categories: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
});

export const publicReportSchema = z.object({
  reason: z.string().trim().min(3).max(800),
});

export type ExactAddressInput = z.infer<typeof exactAddressSchema>;
export type SourceRegistrationInput = z.infer<typeof sourceRegistrationSchema>;
export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;
export type ResidentCandidate = z.infer<typeof residentCandidateSchema>;
export type CaretakerUpdateInput = z.infer<typeof caretakerUpdateSchema>;
export type PublicReportInput = z.infer<typeof publicReportSchema>;

export interface VerifiedAddress {
  addressLine: string;
  postalCode: string;
  city: string;
  municipality?: string;
  province?: string;
  latitude: number;
  longitude: number;
  provider: 'pdok';
  verifiedAt: string;
}

export interface SourceRegistryRecord extends SourceRegistrationInput {
  id: string;
  workspaceId: string;
  lastCheckedAt?: string;
  lastStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResidentLocation {
  id: string;
  workspaceId: string;
  title: string;
  addressKey: string;
  addressLine: string;
  postalCode: string;
  city: string;
  municipality?: string;
  province?: string;
  latitude: number;
  longitude: number;
  status: ResidentLocationStatus;
  publicationStatus: 'published' | 'review';
  categories: string[];
  addressVerifiedAt: string;
  lastVerifiedAt: string;
  lastObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicResidentLocation {
  id: string;
  title: string;
  addressLine: string;
  postalCode: string;
  city: string;
  municipality?: string;
  province?: string;
  latitude: number;
  longitude: number;
  categories: string[];
  lastVerifiedAt: string;
  directionsUrl: string;
}

export interface ResidentLocationEvent {
  id: string;
  workspaceId: string;
  locationId: string;
  action: string;
  actorType: 'system' | 'operator' | 'caretaker' | 'public';
  sourceRegistryId?: string;
  requestId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
}

export interface LocationUpdateRequest {
  id: string;
  workspaceId: string;
  locationId?: string;
  requestType: LocationUpdateRequestType;
  status: 'pending' | 'resolved' | 'dismissed';
  reason: string;
  candidate?: Partial<ResidentCandidate>;
  createdAt: string;
  resolvedAt?: string;
}
