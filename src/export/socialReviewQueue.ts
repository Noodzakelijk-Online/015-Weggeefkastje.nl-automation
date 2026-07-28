import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SocialReviewMention } from '../adapters/socialEvidence.js';

export function writeSocialReviewQueue(path: string, mentions: SocialReviewMention[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: mentions.length, mentions }, null, 2)}\n`, 'utf8');
}
