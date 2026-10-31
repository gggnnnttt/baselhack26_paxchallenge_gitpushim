import { z } from 'zod';
import type { StrukturFormat } from '../chat.js';
import { fuerStrictModus } from '../profil/extraktion.js';

/**
 * Pax answers briefly and asks at most one question, which the browser shows with a fitting control
 * (buttons, amount field, year …) next to the household picture. This keeps the advice from turning into long chat text.
 */
export const EINGABEN = ['ja_nein', 'auswahl', 'mehrfach', 'betrag', 'zahl', 'jahr', 'text'] as const;

// No numeric or array limits in the schema itself: strict structured outputs do not accept all of them. Checked below.
const Frage = z.object({
  text: z.string(),
  eingabe: z.enum(EINGABEN),
  optionen: z.array(z.string()),
  einheit: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
}).strict();
const Antwort = z.object({ antwort: z.string(), frage: Frage.nullable() }).strict();
export type Frage = z.infer<typeof Frage>;

export const ANTWORT_FORMAT: StrukturFormat = {
  name: 'advisor_antwort',
  schema: fuerStrictModus(z.toJSONSchema(Antwort)) as Record<string, unknown>,
};

export const ANTWORT_REGELN = `## Antwortformat
Du antwortest als JSON mit \`antwort\` und \`frage\`. Neben dem Gespräch sieht die Person ihre erfassten Angaben, Berechnungen und Handlungsschritte sowie ihren Lebensweg; erzähle diese Angaben nicht nach.
- \`antwort\`: kurz, in der Regel höchstens drei Sätze, Markdown erlaubt. Keine Aufzählung des Profils und keine Wiederholung der Frage. Erklärst du ein Berechnungsergebnis, einen Vergleich oder einen Handlungsschritt, darfst du die wichtigsten Werte als wenige knappe Stichpunkte zeigen und nennst die Grenzen aus dem Beratungsstand in einem Satz.
- \`frage\`: höchstens eine Frage, die die Beratung jetzt am meisten weiterbringt, sonst null. Sie steht nur in \`frage.text\`, nicht zusätzlich in \`antwort\`. Diese Regel ersetzt „ein bis zwei Fragen“.
- \`frage.eingabe\` bestimmt das Bedienelement. Wähle die einfachste passende: \`ja_nein\`; \`auswahl\` (eine aus 2 bis 6 kurzen \`optionen\`); \`mehrfach\` (mehrere aus 2 bis 6 \`optionen\`); \`betrag\` (Franken, \`einheit\` z. B. „CHF pro Jahr“); \`zahl\` (mit \`einheit\` wie „%“ und sinnvollem \`min\`/\`max\`); \`jahr\`; \`text\` für freie Antworten. Nur bei \`auswahl\` und \`mehrfach\` hat \`optionen\` Einträge, sonst ist die Liste leer. \`einheit\`, \`min\` und \`max\` sind null, wenn sie nicht passen.
- Die Person kann immer auch frei schreiben oder „Weiss ich nicht“ wählen; biete das nicht als Option an.`;

export interface AdvisorAntwort {
  text: string;
  frage: Frage | null;
  // What goes into the history: the model and the profile extraction need the question to understand a short answer.
  verlauf: string;
}

/**
 * Reads the model output. Every text the browser shows passes `pruefen` (the output guardrails).
 * A provider that ignores the format returns plain text; that is shown as is, without a question.
 */
export function leseAntwort(roh: string, pruefen: (text: string) => string): AdvisorAntwort {
  let daten: unknown;
  try { daten = JSON.parse(roh); } catch { daten = undefined; }
  const geparst = Antwort.safeParse(daten);
  if (!geparst.success) {
    const text = pruefen(roh);
    return { text, frage: null, verlauf: text };
  }
  const frage = bereinige(geparst.data.frage, pruefen);
  const text = geparst.data.antwort.trim() ? pruefen(geparst.data.antwort) : '';
  if (!text && !frage) pruefen('');
  return { text, frage, verlauf: [text, frage?.text].filter(Boolean).join('\n\n') };
}

function bereinige(frage: Frage | null, pruefen: (text: string) => string): Frage | null {
  if (!frage?.text.trim()) return null;
  const optionen = frage.optionen.map(o => o.trim()).filter(Boolean).slice(0, 6).map(o => pruefen(o).slice(0, 80));
  const mitOptionen = frage.eingabe === 'auswahl' || frage.eingabe === 'mehrfach';
  // A choice without at least two options cannot be shown as buttons; the person then answers in their own words.
  const eingabe = mitOptionen && optionen.length < 2 ? 'text' : frage.eingabe;
  const zahl = eingabe === 'betrag' || eingabe === 'zahl' || eingabe === 'jahr';
  return {
    text: pruefen(frage.text).slice(0, 300),
    eingabe,
    optionen: eingabe === 'auswahl' || eingabe === 'mehrfach' ? optionen : [],
    einheit: zahl && frage.einheit?.trim() ? pruefen(frage.einheit).slice(0, 30) : null,
    min: zahl && Number.isFinite(frage.min) ? frage.min : null,
    max: zahl && Number.isFinite(frage.max) ? frage.max : null,
  };
}
