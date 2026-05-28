export const PRODUCT_CATEGORIES = [
  'Boeken',
  'Houdbare producten',
  'Kleding',
  'Koelkast',
  'Overig',
  'Speelgoed',
  'Persoonlijke Hygiëne',
  'Planten',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_ALIASES: Record<ProductCategory, string[]> = {
  Boeken: ['boek', 'boeken', 'roman', 'leesboek', 'tijdschrift', 'magazine'],
  'Houdbare producten': [
    'houdbaar',
    'eten',
    'voedsel',
    'levensmiddelen',
    'conserven',
    'pasta',
    'rijst',
    'potjes',
    'blikken',
    'voorraadkast',
  ],
  Kleding: ['kleding', 'kleren', 'jas', 'jassen', 'broek', 'shirt', 'schoenen', 'textiel'],
  Koelkast: ['koelkast', 'gekoeld', 'vers', 'zuivel', 'groente', 'fruit'],
  Overig: ['overig', 'diversen', 'spullen', 'gratis spullen', 'weggeefspullen'],
  Speelgoed: ['speelgoed', 'spelletjes', 'puzzels', 'knuffels', 'lego', 'duplo'],
  'Persoonlijke Hygiëne': [
    'persoonlijke hygiëne',
    'persoonlijke hygiene',
    'hygiene',
    'hygiëne',
    'zeep',
    'shampoo',
    'tandpasta',
    'maandverband',
    'tampons',
    'deodorant',
    'toiletartikelen',
    'verzorging',
  ],
  Planten: ['plant', 'planten', 'stekje', 'stekjes', 'zaadjes', 'zaden', 'bloemen', 'tuinplanten'],
};

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isProductCategory(value: string): value is ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

export function normaliseCategory(value: string): ProductCategory | undefined {
  const lower = normalise(value);
  return PRODUCT_CATEGORIES.find((category) => normalise(category) === lower);
}

export function inferCategoriesFromText(text: string): ProductCategory[] {
  const normalisedText = normalise(text);
  const matches = PRODUCT_CATEGORIES.filter((category) =>
    CATEGORY_ALIASES[category].some((alias) => normalisedText.includes(normalise(alias))),
  );

  return matches.length > 0 ? matches : ['Overig'];
}
