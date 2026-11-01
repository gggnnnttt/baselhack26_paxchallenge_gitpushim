/**
 * Model texts may only use numbers that are in the data they were given. A text with an unknown number
 * is dropped, never repaired. Numbers are compared without thousands separators (85'000, 85’000, 85.000)
 * and with a decimal point (1,5 → 1.5), so "15 %" does not match a "1.5" in the data.
 */
function zahl(roh: string): string {
  let z = roh.replace(/['’\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(z)) z = z.replace(/\./g, '');
  z = z.replace(',', '.');
  const n = Number(z);
  return Number.isFinite(n) ? String(n) : z;
}
// "1. Säule" or "3a" name a pillar, they are not amounts.
const ohneBezeichnungen = (text: string) => text.replace(/\b[123]\.\s*Säule/g, 'Säule').replace(/\b(?:Säule\s*)?3[ab]\b/g, '');
const zahlen = (text: string) => (ohneBezeichnungen(text).match(/\d+(?:['’ ]\d{3})*(?:[.,]\d+)*/g) ?? []).map(zahl);

/** The numbers of a text as a set, built once for several checks. */
export const belegteZahlen = (belege: string) => new Set(zahlen(belege));

export function nurBelegteZahlen(text: string, belege: string | Set<string>): string | null {
  const bekannt = typeof belege === 'string' ? belegteZahlen(belege) : belege;
  return zahlen(text).every(z => bekannt.has(z)) ? text : null;
}

/** A parsed example or amount from the model, e.g. "85'000", "85.000" or "1,5". NaN if it is not a number. */
export const alsZahl = (roh: string) => Number(zahl(roh));
