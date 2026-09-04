import type { IntakeItem } from '../types.js';

export interface OpenStreetMapPilotOptions {
  overpassUrl: string;
  boundingBox: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, unknown>;
}

function parseBoundingBox(value: string): [number, number, number, number] {
  const values = value.split(',').map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((part) => !Number.isFinite(part))) throw new Error('OpenStreetMap pilot bounding box must contain four coordinates.');
  const [south, west, north, east] = values as [number, number, number, number];
  if (south < 50 || north > 54 || west < 3 || east > 8 || south >= north || west >= east) {
    throw new Error('OpenStreetMap pilot bounding box must be a non-empty area in the Netherlands.');
  }
  return [south, west, north, east];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function itemFromElement(element: OverpassElement, now: () => Date): IntakeItem | undefined {
  const tags = element.tags ?? {};
  const amenity = text(tags.amenity);
  const street = text(tags['addr:street']);
  const houseNumber = text(tags['addr:housenumber']);
  const postalCode = text(tags['addr:postcode'])?.replace(/\s+/g, '').toUpperCase();
  const city = text(tags['addr:city']);
  if (!['give_box', 'food_sharing'].includes(amenity ?? '') || !street || !houseNumber || !postalCode || !/^\d{4}[A-Z]{2}$/.test(postalCode) || !city) return undefined;
  const latitude = number(element.lat) ?? number(element.center?.lat);
  const longitude = number(element.lon) ?? number(element.center?.lon);
  if (latitude === undefined || longitude === undefined || !element.type || !Number.isInteger(element.id)) return undefined;
  const title = text(tags.name) ?? 'Weggeefkastje';
  const addressHint = `${street} ${houseNumber}`;
  return {
    sourceKind: 'open_data',
    sourceName: 'OpenStreetMap pilot',
    observedAt: now().toISOString(),
    text: `${title} bij ${addressHint}, ${postalCode} ${city}.`,
    link: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    city,
    addressHint,
    postalCode,
    statusHint: 'active',
    latitude,
    longitude,
  };
}

export async function fetchOpenStreetMapPilotMentions(options: OpenStreetMapPilotOptions): Promise<IntakeItem[]> {
  const boundingBox = parseBoundingBox(options.boundingBox);
  const endpoint = new URL(options.overpassUrl);
  if (endpoint.protocol !== 'https:') throw new Error('OpenStreetMap pilot requires an HTTPS Overpass endpoint.');
  const query = `[out:json][timeout:25];nwr["amenity"~"^(give_box|food_sharing)$"](${boundingBox.join(',')});out center tags;`;
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', accept: 'application/json' },
    body: query,
  });
  if (!response.ok) throw new Error(`OpenStreetMap pilot query failed with ${response.status}.`);
  const payload: unknown = await response.json();
  const elements = payload && typeof payload === 'object' && Array.isArray((payload as { elements?: unknown }).elements)
    ? (payload as { elements: unknown[] }).elements
    : [];
  const now = options.now ?? (() => new Date());
  const seen = new Set<string>();
  return elements
    .filter((element): element is OverpassElement => Boolean(element) && typeof element === 'object')
    .map((element) => itemFromElement(element, now))
    .filter((item): item is IntakeItem => Boolean(item))
    .filter((item) => {
      const key = item.link ?? `${item.addressHint}|${item.postalCode}|${item.city}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
