import { z } from 'zod';
import type { StrukturFormat } from '../chat.js';
import { fuerStrictModus } from '../profil/extraktion.js';
import { alsZahl } from './belege.js';

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
  // A realistic example value shown as placeholder, e.g. 1988 for a birth year. Checked in bereinige().
  beispiel: z.string().nullable(),
}).strict();
const Antwort = z.object({ antwort: z.string(), frage: Frage.nullable(), erkenntnisse: z.array(z.string()), uebergabe: z.string().nullable() }).strict();
export type Frage = z.infer<typeof Frage>;

export const ANTWORT_FORMAT: StrukturFormat = {
  name: 'advisor_antwort',
  schema: fuerStrictModus(z.toJSONSchema(Antwort)) as Record<string, unknown>,
};

export const ANTWORT_REGELN = `## Antwortformat
Du antwortest als JSON mit \`antwort\`, \`frage\`, \`erkenntnisse\` und \`uebergabe\`. Alle Texte für die Person stehen in der Sie-Form, nie in der Du-Form. Neben dem Gespräch sieht die Person ihre erfassten Angaben, Berechnungen und Handlungsschritte sowie ihren Lebensweg; erzähle diese Angaben nicht nach.
- \`antwort\`: kurz, höchstens drei Sätze, Markdown erlaubt. Keine Aufzählung des Profils, keine Wiederholung der Frage, keine Absätze über Annahmen und Grenzen. Erklärst du ein Ergebnis, nenne die ein bis zwei wichtigsten Zahlen. Nur in der Phase „empfehlen“ darfst du Zusammenfassung und Empfehlungen als bis zu fünf knappe Stichpunkte schreiben.
- \`frage\`: höchstens eine Frage, die die Beratung jetzt am meisten weiterbringt, sonst null. Sie steht nur in \`frage.text\`, nicht zusätzlich in \`antwort\`. Diese Regel ersetzt „ein bis zwei Fragen“.
- \`frage.eingabe\` bestimmt das Bedienelement. Wähle die einfachste passende: \`ja_nein\`; \`auswahl\` (eine aus 2 bis 6 kurzen \`optionen\`); \`mehrfach\` (mehrere aus 2 bis 6 \`optionen\`); \`betrag\` (Franken, \`einheit\` z. B. „CHF pro Jahr“); \`zahl\` (mit \`einheit\` wie „%“ und sinnvollem \`min\`/\`max\`); \`jahr\`; \`text\` für freie Antworten. Nur bei \`auswahl\` und \`mehrfach\` hat \`optionen\` Einträge, sonst ist die Liste leer. \`einheit\`, \`min\` und \`max\` sind null, wenn sie nicht passen.
- \`frage.beispiel\`: ein realistischer, typischer Beispielwert als Platzhalter, passend zu genau dieser Frage, z. B. „1988“ für ein Geburtsjahr, „85000“ für einen Jahreslohn, „500“ für einen monatlichen Sparbetrag, „2030“ für einen geplanten Hauskauf, „80“ für ein Pensum in %. Nur die Zahl ohne Einheit oder Tausendertrennzeichen; bei \`text\` ein kurzes Beispiel; bei \`ja_nein\`, \`auswahl\` und \`mehrfach\` null. Vergangenes (Geburt, Heirat) liegt in der Vergangenheit, Geplantes in der Zukunft.
- \`erkenntnisse\`: 0 bis 3 kurze Sätze (je höchstens 25 Wörter): was du als Berater aus der aktuellen Lage dieser Person erkennst und warum es für ihre Vorsorge wichtig ist, z. B. was ein Kind, ein geplanter Schritt oder die Erwerbssituation konkret für sie bedeutet. Persönlich und konkret, keine allgemeinen Lehrbuchsätze, keine Produkte, keine Zahlen ausser solchen, die im Beratungsstand stehen. Gib jedes Mal die vollständige aktuelle Liste; sie ersetzt die bisherige. Leere Liste, solange du noch nichts Belastbares erkennst.
- \`uebergabe\`: Nur wenn unter „Übergabe an eine Pax-Fachperson“ Kriterien stehen: 2 bis 3 Sätze, warum in dieser Situation eine Pax-Fachperson übernehmen sollte und was sie konkret prüft, bezogen auf genau diese Kriterien und die Lage der Person, ruhig und ohne Alarm. Sonst null. Keine Zahlen ausser solchen aus dem Beratungsstand.
- Die Person kann immer auch frei schreiben oder „Weiss ich nicht“ wählen; biete das nicht als Option an.`;

export interface AdvisorAntwort {
  text: string;
  frage: Frage | null;
  // Insights for the situation picture; null keeps the previous ones (e.g. when the model ignored the format).
  erkenntnisse: string[] | null;
  // Why a specialist should take over; null if the model wrote none or it was rejected.
  uebergabe: string | null;
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
    return { text, frage: null, erkenntnisse: null, uebergabe: null, verlauf: text };
  }
  const frage = bereinige(geparst.data.frage, pruefen);
  const text = geparst.data.antwort.trim() ? pruefen(geparst.data.antwort) : '';
  if (!text && !frage) pruefen('');
  // Optional: an insight the output guardrails reject is dropped, the reply itself still counts.
  const erkenntnisse = geparst.data.erkenntnisse.map(e => e.trim()).filter(Boolean).flatMap(e => {
    try { return [pruefen(e).slice(0, 240)]; } catch { return []; }
  }).slice(0, 3);
  let uebergabe: string | null = null;
  try { uebergabe = geparst.data.uebergabe?.trim() ? pruefen(geparst.data.uebergabe.trim()).slice(0, 600) : null; } catch { uebergabe = null; }
  return { text, frage, erkenntnisse, uebergabe, verlauf: [text, frage?.text].filter(Boolean).join('\n\n') };
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
    beispiel: beispiel(frage, eingabe, pruefen),
  };
}

const VERGANGENHEIT = /geboren|jahrgang|geburt|geheiratet|heirat|seit wann|seit welchem/i;

// A placeholder must be plausible: a number inside min/max, a birth year in the past. Otherwise the browser picks one.
function beispiel(frage: Frage, eingabe: Frage['eingabe'], pruefen: (text: string) => string): string | null {
  const roh = frage.beispiel?.trim();
  if (!roh) return null;
  if (eingabe === 'text') { try { return pruefen(roh).slice(0, 60); } catch { return null; } }
  if (eingabe !== 'jahr' && eingabe !== 'betrag' && eingabe !== 'zahl') return null;
  const wert = alsZahl(roh);
  if (!Number.isFinite(wert) || wert < 0) return null;
  if (frage.min !== null && Number.isFinite(frage.min) && wert < frage.min) return null;
  if (frage.max !== null && Number.isFinite(frage.max) && wert > frage.max) return null;
  if (eingabe === 'jahr') {
    const jahr = new Date().getFullYear();
    if (!Number.isInteger(wert) || wert < 1900 || wert > jahr + 80) return null;
    if (VERGANGENHEIT.test(frage.text) && wert > jahr) return null;
  }
  return String(wert);
}
