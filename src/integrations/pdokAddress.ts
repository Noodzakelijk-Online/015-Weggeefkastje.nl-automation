import type { ExactAddressInput, VerifiedAddress } from '../domain/residentLocation.js';

export interface AddressVerifier {
  verify(input: ExactAddressInput): Promise<VerifiedAddress | undefined>;
}

export interface PdokAddressVerifierOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface PdokAddressDocument {
  type?: string;
  straatnaam?: string;
  huisnummer?: string | number;
  huisletter?: string;
  huisnummertoevoeging?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
  provincienaam?: string;
  centroide_ll?: string;
}

function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function documentAddressLine(document: PdokAddressDocument): string | undefined {
  if (!document.straatnaam || document.huisnummer === undefined || document.huisnummer === null) return undefined;
  return `${document.straatnaam} ${document.huisnummer}${document.huisletter ?? ''}${document.huisnummertoevoeging ?? ''}`.trim();
}

function parsePoint(value: string | undefined): { latitude: number; longitude: number } | undefined {
  const match = /^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i.exec(value ?? '');
  if (!match) return undefined;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < 50 || latitude > 54 || longitude < 3 || longitude > 8) return undefined;
  return { latitude, longitude };
}

function isExactAddressMatch(input: ExactAddressInput, document: PdokAddressDocument): boolean {
  const addressLine = documentAddressLine(document);
  if (!addressLine || !document.postcode || !document.woonplaatsnaam) return false;
  return normalise(input.address) === normalise(addressLine)
    && normalise(input.postalCode) === normalise(document.postcode)
    && normalise(input.city) === normalise(document.woonplaatsnaam);
}

function parseDocuments(value: unknown): PdokAddressDocument[] {
  if (!value || typeof value !== 'object') return [];
  const response = (value as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return [];
  const documents = (response as { docs?: unknown }).docs;
  return Array.isArray(documents) ? documents.filter((document): document is PdokAddressDocument => Boolean(document) && typeof document === 'object') : [];
}

function toVerifiedAddress(document: PdokAddressDocument, now: () => Date): VerifiedAddress | undefined {
  const addressLine = documentAddressLine(document);
  const coordinates = parsePoint(document.centroide_ll);
  if (!addressLine || !document.postcode || !document.woonplaatsnaam || !coordinates) return undefined;
  return {
    addressLine,
    postalCode: document.postcode.replace(/\s+/g, '').toUpperCase(),
    city: document.woonplaatsnaam,
    municipality: document.gemeentenaam || undefined,
    province: document.provincienaam || undefined,
    ...coordinates,
    provider: 'pdok',
    verifiedAt: now().toISOString(),
  };
}

export function createPdokAddressVerifier(options: PdokAddressVerifierOptions): AddressVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    async verify(input: ExactAddressInput): Promise<VerifiedAddress | undefined> {
      const requestUrl = new URL('/bzk/locatieserver/search/v3_1/free', options.baseUrl);
      requestUrl.searchParams.set('q', `${input.address} ${input.postalCode} ${input.city}`);
      requestUrl.searchParams.set('fq', 'type:adres');
      requestUrl.searchParams.set('rows', '10');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetchImpl(requestUrl, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return undefined;
        const payload: unknown = await response.json();
        const document = parseDocuments(payload).find((candidate) => candidate.type?.toLowerCase() === 'adres' && isExactAddressMatch(input, candidate));
        return document ? toVerifiedAddress(document, now) : undefined;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
