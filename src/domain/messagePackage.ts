import { createHash } from 'node:crypto';
import type { ExchangeItem } from './exchange.js';
import { redactPublicContactDetails } from './rules.js';

export interface GeneratedMessagePackage {
  subject: string;
  body: string;
  contentHash: string;
}

function publicLocation(item: ExchangeItem): string {
  if (item.privacyLevel === 'public' && item.addressHint) return `${item.addressHint}, ${item.city}`;
  if (item.addressHint) return `${item.addressHint} (${item.city})`;
  return item.city;
}

export function generateMessagePackage(item: ExchangeItem): GeneratedMessagePackage {
  const subject = `Gratis beschikbaar: ${redactPublicContactDetails(item.title)}`;
  const description = redactPublicContactDetails(item.description).trim();
  const pickup = item.pickupNotes ? `\n\nOphalen: ${redactPublicContactDetails(item.pickupNotes)}` : '';
  const body = `${subject}\n\n${description}\n\nLocatie: ${publicLocation(item)}.${pickup}\n\nInteresse? Reageer via het platform. Van harte welkom!`;
  return {
    subject,
    body,
    contentHash: createHash('sha256').update(`${subject}\n${body}`).digest('hex'),
  };
}
