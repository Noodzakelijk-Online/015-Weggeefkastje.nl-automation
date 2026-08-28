import { z } from 'zod';

export const ITEM_STATUSES = [
  'draft',
  'rules_review',
  'human_review',
  'ready_to_post',
  'posted',
  'responding',
  'pickup_scheduled',
  'completed',
  'rejected',
  'cancelled',
  'archived',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const WORKFLOW_ACTIONS = [
  'submit',
  'rules_passed',
  'approve',
  'reject',
  'return_to_review',
  'mark_posted',
  'record_response',
  'schedule_pickup',
  'complete_pickup',
  'cancel',
  'archive',
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];
export type WorkspaceRole = 'owner' | 'operator' | 'viewer';
export type PlatformTarget = 'facebook' | 'nextdoor' | 'weggeefkastje' | 'manual';

export const createItemSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(4000),
  category: z.string().trim().min(2).max(80),
  platformTarget: z.enum(['facebook', 'nextdoor', 'weggeefkastje', 'manual']).default('manual'),
  sourceKind: z.string().trim().min(2).max(40).default('manual'),
  sourceName: z.string().trim().min(2).max(160).default('operator-intake'),
  sourceLink: z.string().url().max(1000).optional(),
  city: z.string().trim().min(2).max(120),
  addressHint: z.string().trim().max(240).optional(),
  latitude: z.number().min(50).max(54).optional(),
  longitude: z.number().min(3).max(8).optional(),
  confidence: z.number().int().min(0).max(100).default(50),
  pickupNotes: z.string().trim().max(1000).optional(),
  contactMethod: z.enum(['platform', 'email', 'phone', 'other']).default('platform'),
  privacyLevel: z.enum(['public', 'approximate', 'private']).default('approximate'),
});

export const updateItemSchema = createItemSchema.partial().extend({
  version: z.number().int().positive(),
});

export const workflowActionSchema = z.object({
  action: z.enum(WORKFLOW_ACTIONS),
  idempotencyKey: z.string().trim().min(8).max(120),
  notes: z.string().trim().max(1000).optional(),
  scheduledAt: z.string().datetime().optional(),
  externalUrl: z.string().url().max(1000).optional(),
});

export interface ExchangeItem {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  title: string;
  description: string;
  category: string;
  platformTarget: PlatformTarget;
  sourceKind: string;
  sourceName: string;
  sourceLink?: string;
  city: string;
  addressHint?: string;
  latitude?: number;
  longitude?: number;
  confidence: number;
  status: ItemStatus;
  needsReview: boolean;
  privacyLevel: 'public' | 'approximate' | 'private';
  pickupNotes?: string;
  contactMethod: 'platform' | 'email' | 'phone' | 'other';
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface WorkflowTransition {
  action: WorkflowAction;
  from: ItemStatus[];
  to: ItemStatus;
}

export const WORKFLOW_TRANSITIONS: WorkflowTransition[] = [
  { action: 'submit', from: ['draft'], to: 'rules_review' },
  { action: 'rules_passed', from: ['rules_review'], to: 'human_review' },
  { action: 'approve', from: ['human_review'], to: 'ready_to_post' },
  { action: 'reject', from: ['human_review', 'rules_review'], to: 'rejected' },
  { action: 'return_to_review', from: ['ready_to_post'], to: 'human_review' },
  { action: 'mark_posted', from: ['ready_to_post'], to: 'posted' },
  { action: 'record_response', from: ['posted', 'responding'], to: 'responding' },
  { action: 'schedule_pickup', from: ['responding'], to: 'pickup_scheduled' },
  { action: 'complete_pickup', from: ['pickup_scheduled'], to: 'completed' },
  { action: 'archive', from: ['completed', 'rejected', 'cancelled'], to: 'archived' },
  { action: 'cancel', from: ['draft', 'rules_review', 'human_review', 'ready_to_post', 'posted', 'responding', 'pickup_scheduled'], to: 'cancelled' },
];

export function nextStatus(current: ItemStatus, action: WorkflowAction): ItemStatus {
  const transition = WORKFLOW_TRANSITIONS.find((candidate) => candidate.action === action && candidate.from.includes(current));
  if (!transition) throw new Error(`Action ${action} is not allowed from ${current}.`);
  return transition.to;
}

export function availableActions(status: ItemStatus): WorkflowAction[] {
  return WORKFLOW_TRANSITIONS.filter((transition) => transition.from.includes(status)).map((transition) => transition.action);
}

export const STATUS_LABELS_NL: Record<ItemStatus, string> = {
  draft: 'Concept',
  rules_review: 'Regels controleren',
  human_review: 'Wacht op beoordeling',
  ready_to_post: 'Klaar voor handmatig plaatsen',
  posted: 'Handmatig geplaatst',
  responding: 'Reacties opvolgen',
  pickup_scheduled: 'Afspraak bevestigen',
  completed: 'Opgehaald',
  rejected: 'Afgewezen',
  cancelled: 'Geannuleerd',
  archived: 'Gearchiveerd',
};
