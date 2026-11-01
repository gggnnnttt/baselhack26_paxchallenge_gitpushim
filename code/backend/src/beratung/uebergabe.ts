import { szenarien } from '../berechnung/risiko.js';
import { istPaar, type Person, type Profil } from '../profil/profil.js';
import type { AblaufStand } from './ablauf.js';

/**
 * When a Pax specialist has to take over. The legal framework asks for human review in complex cases
 * or with significant implications "based on predefined criteria": these criteria are fixed rules,
 * so the same situation always leads to the same decision. Only the explanation for the customer is
 * written by the model (see ANTWORT_REGELN, `uebergabe`).
 * Sources: SYSTEM-ANALYSE.md §6 (human-advisor triggers) and the tariff provisions for disability cover.
 */
export interface Kriterium { id: string; titel: string }
export interface Uebergabe { noetig: boolean; kriterien: Kriterium[] }

// Above this yearly disability pension a private cover is indemnity insurance with an over-insurance check (tariff SIR).
const EU_RENTE_GRENZE = 36_000;
const SELBSTSTAENDIG = /selbst(st|s)?ändig|selbststaendig|eigene firma|freiberuf/i;

const personen = (profil: Profil): { person: Person; wer: string }[] => [
  { person: profil.personen.A, wer: 'Sie' },
  ...(istPaar(profil) && profil.personen.B ? [{ person: profil.personen.B, wer: 'Ihr Partner oder Ihre Partnerin' }] : []),
];

export function pruefeUebergabe(stand: AblaufStand): Uebergabe {
  const { profil, berechnung, jahr } = stand.kontext;
  const kriterien: Kriterium[] = [];
  const dazu = (id: string, titel: string) => { if (!kriterien.some(k => k.id === id)) kriterien.push({ id, titel }); };

  for (const { person, wer } of personen(profil)) {
    if (person.erwerb?.wert === 'selbststaendig' && person.bvgVersichert?.wert === false) {
      dazu('selbststaendig_ohne_pk', `Selbstständig ohne Pensionskasse (${wer}): die ganze 2. Säule fehlt`);
    }
    const alter = person.geburtsjahr ? jahr - person.geburtsjahr.wert : null;
    const pension = person.pensionierungsalter?.wert ?? 65;
    if (alter !== null && pension - alter <= 5) dazu('pensionierung_nah', `Pensionierung in höchstens fünf Jahren (${wer}): Bezug und Steuern planen`);
    if (person.privateEu?.vorhanden?.wert) dazu('bestehende_versicherung', 'Bestehende private Versicherung: Anrechnung oder Ersatz prüfen');
  }
  if (profil.plaene.some(p => SELBSTSTAENDIG.test(p.beschreibung))) dazu('selbststaendigkeit_geplant', 'Geplante Selbstständigkeit: Pensionskasse und Risikoschutz fallen weg');
  if (profil.kinder.some(k => k.elternteil && k.elternteil.wert !== 'beide')) dazu('patchwork', 'Kinder aus einer früheren Beziehung: Sorgerecht und Unterhalt prüfen');
  if (stand.phase === 'berechnet' && berechnung) {
    const hoch = szenarien(berechnung.antwort).some(s => s.szenario.startsWith('Erwerbsunfähigkeit') && (s.luecke ?? 0) > EU_RENTE_GRENZE);
    if (hoch) dazu('eu_rente_hoch', "Lücke bei Erwerbsunfähigkeit über CHF 36'000 pro Jahr: Überversicherung prüfen");
    if (szenarien(berechnung.antwort).some(s => s.fehler?.includes('pensioniert'))) dazu('pensionierung_nah', 'Pensionierung steht bevor oder ist erfolgt: Bezug und Steuern planen');
  }
  return { noetig: kriterien.length > 0, kriterien };
}

/** For the advisor instructions: the criteria and what the model has to write about them. */
export function uebergabeKontext(u: Uebergabe): string {
  return [
    '## Übergabe an eine Pax-Fachperson (vordefinierte Kriterien des Backends)',
    ...(u.noetig ? u.kriterien.map(k => `- ${k.titel}`) : ['- Kein Kriterium erfüllt. `uebergabe` ist null.']),
  ].join('\n');
}
