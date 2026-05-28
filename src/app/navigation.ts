export interface NavigationTarget {
  title: string;
  city?: string;
  addressHint?: string;
  latitude?: number;
  longitude?: number;
}

function encode(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildDestinationQuery(target: NavigationTarget): string {
  if (typeof target.latitude === 'number' && typeof target.longitude === 'number') {
    return `${target.latitude},${target.longitude}`;
  }

  return [target.addressHint, target.city, 'Nederland'].filter(Boolean).join(', ');
}

export function buildGoogleMapsDirectionsUrl(target: NavigationTarget): string {
  const destination = buildDestinationQuery(target);
  return `https://www.google.com/maps/dir/?api=1&destination=${encode(destination)}`;
}

export function buildGoogleMapsSearchUrl(target: NavigationTarget): string {
  const query = buildDestinationQuery(target);
  return `https://www.google.com/maps/search/?api=1&query=${encode(query)}`;
}
