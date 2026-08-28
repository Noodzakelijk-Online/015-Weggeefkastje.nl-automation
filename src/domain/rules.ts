import type { ExchangeItem, PlatformTarget } from './exchange.js';

export interface RuleResult {
  key: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
}

const CONTACT_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+31|0)[\s.-]?(?:\d[\s.-]?){8,10}\d)/i;
const SALE_PATTERN = /\b(?:te koop|vraagprijs|bieden vanaf|€\s*\d|EUR\s*\d)\b/i;

const PLATFORM_LABELS: Record<PlatformTarget, string> = {
  facebook: 'Facebook',
  nextdoor: 'Nextdoor',
  weggeefkastje: 'Weggeefkastje.nl',
  manual: 'Handmatig kanaal',
};

export function evaluateRules(item: Pick<ExchangeItem, 'title' | 'description' | 'category' | 'city' | 'platformTarget' | 'privacyLevel' | 'addressHint'>): RuleResult[] {
  const combined = `${item.title} ${item.description}`;
  return [
    {
      key: 'required_content',
      passed: Boolean(item.title.trim() && item.description.trim() && item.category.trim() && item.city.trim()),
      severity: 'blocking',
      message: 'Titel, omschrijving, categorie en plaats zijn verplicht.',
    },
    {
      key: 'giveaway_only',
      passed: !SALE_PATTERN.test(combined),
      severity: 'blocking',
      message: 'Alleen gratis aanbieden; verkoopprijzen en biedingen zijn niet toegestaan.',
    },
    {
      key: 'personal_contact',
      passed: !CONTACT_PATTERN.test(combined),
      severity: 'blocking',
      message: 'Openbare berichttekst mag geen e-mailadres of telefoonnummer bevatten.',
    },
    {
      key: 'location_privacy',
      passed: item.privacyLevel !== 'public' || !item.addressHint,
      severity: 'warning',
      message: 'Gebruik een wijk of globale locatie; publiceer geen exact privéadres.',
    },
    {
      key: 'manual_posting',
      passed: true,
      severity: 'info',
      message: `${PLATFORM_LABELS[item.platformTarget]} wordt alleen ondersteund via een handmatige, door de gebruiker bevestigde plaatsing.`,
    },
  ];
}

export function hasBlockingRuleFailure(results: RuleResult[]): boolean {
  return results.some((result) => result.severity === 'blocking' && !result.passed);
}

export function redactPublicContactDetails(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[contact via platform]')
    .replace(/(?:\+31|0)[\s.-]?(?:\d[\s.-]?){8,10}\d/g, '[contact via platform]');
}
