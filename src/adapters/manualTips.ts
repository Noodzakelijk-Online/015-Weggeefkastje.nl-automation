import { existsSync, readFileSync } from 'node:fs';
import type { IntakeItem } from '../types.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readManualTips(path: string): IntakeItem[] {
  if (!existsSync(path)) return [];

  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const text = asString(parsed.text);
      if (!text) throw new Error(`Manual tip line ${index + 1} is missing required field: text`);

      return {
        sourceKind: (asString(parsed.sourceKind) as IntakeItem['sourceKind']) ?? 'manual',
        sourceName: asString(parsed.sourceName) ?? 'manual-tip',
        observedAt: asString(parsed.observedAt) ?? new Date().toISOString(),
        text,
        link: asString(parsed.link),
        city: asString(parsed.city),
        addressHint: asString(parsed.addressHint),
        statusHint: asString(parsed.statusHint),
        notes: asString(parsed.notes),
      };
    });
}
