/**
 * Model texts may only use numbers that are in the data they were given. Thousands separators and
 * decimal commas are ignored for the comparison. A text with an unknown number is dropped, never repaired.
 */
const zahlen = (text: string) => (text.match(/\d[\d'’.,]*\d|\d/g) ?? []).map(z => z.replace(/['’.,]/g, ''));

export function nurBelegteZahlen(text: string, belege: string): string | null {
  const bekannt = new Set(zahlen(belege));
  return zahlen(text).every(z => bekannt.has(z)) ? text : null;
}
