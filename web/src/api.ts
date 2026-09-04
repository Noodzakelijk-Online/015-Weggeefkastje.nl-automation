export interface Session {
  userId: string;
  workspaceId: string;
  email: string;
  displayName: string;
  workspaceName: string;
  role: 'owner' | 'operator' | 'viewer';
  csrfToken: string;
}

export interface Item {
  id: string;
  title: string;
  description: string;
  category: string;
  platformTarget: string;
  sourceKind: string;
  sourceName: string;
  sourceLink?: string;
  city: string;
  addressHint?: string;
  confidence: number;
  status: string;
  needsReview: boolean;
  version: number;
  updatedAt: string;
}

export interface ItemDetail {
  item: Item;
  latestRules?: { results: Array<{ key: string; passed: boolean; message: string; severity: string }>; blockingFailures: number };
  messagePackage?: { subject?: string; body?: string; copiedAt?: string; externalUrl?: string };
  evidence: Array<{ sourceName?: string; sourceLink?: string; summary?: string; observedAt?: string }>;
  history: Array<{ action: string; createdAt: string }>;
  coordination: Array<{ eventType: string; notes?: string; scheduledAt?: string; createdAt: string }>;
  availableActions: string[];
}

export interface PublicLocation {
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

export interface PublicLocationList {
  items: PublicLocation[];
  total: number;
  page: number;
  limit: number;
}

export interface PublicAttribution {
  name: string;
  attribution: string;
}

interface ApiResponse<T> { data: T; meta?: Record<string, number> }
export interface ApiEnvelope<T> { data: T; meta?: Record<string, number> }

export class ApiClient {
  csrfToken = '';

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await this.requestEnvelope<T>(path, init)).data;
  }

  async requestEnvelope<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('content-type', 'application/json');
    if (!['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) && this.csrfToken) headers.set('x-csrf-token', this.csrfToken);
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    const body = await response.json() as ApiResponse<T> & { error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? `Verzoek mislukt (${response.status}).`);
    return { data: body.data, meta: body.meta };
  }

  async me(): Promise<Session> {
    const value = await this.request<{ authenticated: boolean; session?: Session }>('/api/auth/status');
    if (!value.authenticated || !value.session) throw new Error('Niet ingelogd.');
    this.csrfToken = value.session.csrfToken;
    return value.session;
  }

  async signIn(path: '/api/setup' | '/api/auth/login', body: Record<string, string>): Promise<Session> {
    const value = await this.request<{ session: Session }>(path, { method: 'POST', body: JSON.stringify(body) });
    this.csrfToken = value.session.csrfToken;
    return value.session;
  }
}

export const api = new ApiClient();
