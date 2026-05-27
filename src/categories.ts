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

export function isProductCategory(value: string): value is ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

export function normaliseCategory(value: string): ProductCategory | undefined {
  const lower = value.trim().toLowerCase();
  return PRODUCT_CATEGORIES.find((category) => category.toLowerCase() === lower);
}
