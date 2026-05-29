import { existsSync, readFileSync } from 'node:fs';
import type { IntakeItem } from '../types.js';
import { isProductCategory } from '../categories.js';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asCategories(value: unknown): IntakeItem['categories'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const categories = value.filter((item): item is NonNullable<IntakeItem['categories']>[number] => {
    return typeof item === 'string' && isProductCategory(item);
  });
  return categories.length > 0 ? categories : undefined;
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
        categories: asCategories(parsed.categories),
        latitude: asNumber(parsed.latitude),
        longitude: asNumber(parsed.longitude),
        municipality: asString(parsed.municipality),
        province: asString(parsed.province),
      };
    });
}
