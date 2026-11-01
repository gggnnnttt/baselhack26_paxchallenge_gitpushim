import type { AblaufStand } from './ablauf.js';
import { lagebild } from './verstaendnis.js';

/**
 * When a Pax specialist has to take over. The legal framework asks for human review in complex cases
 * or with significant implications "based on predefined criteria". The criteria are this fixed catalogue;
 * whether the concrete situation meets one is judged by the model, because complexity lies in how the
 * facts of a household interact, not in a single keyword. The backend only accepts catalogue ids and
 * asks for a judgement only once the situation is understood (all three pillars known), so a first
 * "I want to become self-employed" never triggers a handoff on its own.
 * Sources: SYSTEM-ANALYSE.md §6 (human-advisor triggers) and the tariff provisions for disability cover.
 */
export interface Kriterium { id: string; titel: string }
export interface Uebergabe { noetig: boolean; kriterien: Kriterium[] }
// What the model decided last: catalogue ids and its explanation for the customer.
export interface UebergabeUrteil { kriterien: string[]; text: string }

interface Katalogeintrag extends Kriterium { wann: string }
export const KRITERIEN: readonly Katalogeintrag[] = [
  { id: 'selbststaendigkeit', titel: 'Selbstständigkeit mit Folgen für Pensionskasse und Risikoschutz',
    wann: 'Die Person ist oder wird selbstständig, und der Wegfall von Pensionskasse und Risikoschutz trifft diesen Haushalt konkret, z. B. weil Familie oder Wohneigentum vom Einkommen abhängen oder über eine freiwillige BVG-Lösung, das Freizügigkeitsguthaben oder einen Kapitalbezug entschieden werden muss.' },
  { id: 'pensionierung', titel: 'Pensionierung mit weitreichenden Entscheiden',
    wann: 'Die Pensionierung steht in wenigen Jahren an oder ist erfolgt, und es sind Entscheide mit grosser Tragweite offen: Rente oder Kapital, gestaffelter Bezug, Einkäufe, Steuern, Frühpensionierung.' },
  { id: 'bestehende_vertraege', titel: 'Bestehende Verträge ersetzen oder anrechnen',
    wann: 'Es bestehen private Versicherungen oder Vorsorgeverträge, und die Beratung läuft auf Kündigung, Ersatz, Anrechnung oder Überschneidung hinaus.' },
  { id: 'familie', titel: 'Familienkonstellation mit rechtlichen Folgen',
    wann: 'Patchwork, Kinder aus früheren Beziehungen, Unterhaltspflichten, Konkubinat oder Trennung beeinflussen Begünstigung, Hinterlassenenleistungen oder Absicherung so, dass rechtliche Fragen zu klären sind.' },
  { id: 'hohe_absicherung', titel: 'Hohe Absicherung mit Prüfung beim Versicherer',
    wann: 'Die nötige Absicherung ist so hoch, dass Überversicherung, Gesundheitsprüfung oder Annahmegrenzen des Versicherers eine Rolle spielen, z. B. eine Lücke bei Erwerbsunfähigkeit deutlich über CHF 36\'000 pro Jahr, oder es gibt Hinweise auf gesundheitliche Vorbelastungen.' },
  { id: 'grosse_entscheidung', titel: 'Entscheid mit grosser finanzieller Tragweite',
    wann: 'Ein Schritt bindet einen grossen Teil des Vermögens oder der Vorsorge oder ist kaum umkehrbar: Vorbezug für Wohneigentum, grosser Pensionskasseneinkauf, Auswanderung, Erbschaft.' },
  { id: 'verflochten', titel: 'Mehrere Themen greifen ineinander',
    wann: 'Mehrere Veränderungen oder widersprüchliche Ziele hängen so zusammen, dass eine Standardempfehlung nicht reicht und eine individuelle Gesamtplanung nötig ist.' },
];
export const KRITERIUM_IDS = KRITERIEN.map(k => k.id) as [string, ...string[]];

// Pax judges only once it understands the household; until then a statement of intent is not enough.
export const kannBeurteilen = (stand: AblaufStand) => lagebild(stand).phase !== 'verstehen';

export function pruefeUebergabe(stand: AblaufStand): Uebergabe {
  const ids = new Set(stand.uebergabe?.kriterien ?? []);
  const kriterien = KRITERIEN.filter(k => ids.has(k.id)).map(({ id, titel }) => ({ id, titel }));
  return { noetig: kriterien.length > 0, kriterien };
}

/** For the advisor instructions: the catalogue, the current judgement and when to judge at all. */
export function uebergabeKontext(stand: AblaufStand): string {
  const titel = '## Übergabe an eine Pax-Fachperson (vordefinierte Kriterien)';
  if (!kannBeurteilen(stand)) return [titel, 'Das Lagebild ist noch unvollständig. Beurteile noch keine Übergabe, `uebergabe` ist null.'].join('\n');
  const aktuell = pruefeUebergabe(stand);
  return [
    titel,
    'Beurteile anhand der Lage dieser Person, ob eines dieser Kriterien erfüllt ist:',
    ...KRITERIEN.map(k => `- \`${k.id}\` (${k.titel}): ${k.wann}`),
    `Deine bisherige Beurteilung: ${aktuell.noetig ? aktuell.kriterien.map(k => `\`${k.id}\``).join(', ') : 'keine Übergabe'}.`,
  ].join('\n');
}

/** Only catalogue ids count; without a valid criterion or explanation there is no handoff. */
export function bereinigeUrteil(roh: { kriterien: string[]; text: string } | null): UebergabeUrteil | null {
  if (!roh) return null;
  const kriterien = [...new Set(roh.kriterien)].filter(id => KRITERIUM_IDS.includes(id));
  return kriterien.length && roh.text.trim() ? { kriterien, text: roh.text.trim() } : null;
}
