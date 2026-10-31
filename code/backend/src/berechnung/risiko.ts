import { z } from 'zod';
import { istPaar, kindLabel, personLabel, type Person, type PersonId, type Profil } from '../profil/profil.js';
import { abschliessen, basisVollstaendig, bedarfText, neuePruefung, pruefeBasisPerson, pruefeBeziehung, type Pruefung } from './basis.js';
export type { Angabe } from './basis.js';

// Request and response of APICalc_calculateRisk as specified in APICalc-swagger.yaml (v1.2).
const RiskPerson = z.object({
  Sex: z.union([z.literal(1), z.literal(2)]),
  BirthYear: z.number().int(),
  GrossIncome: z.number().nonnegative().optional(),
  NumberOfChildren: z.number().int().nonnegative().optional(),
  WithBVG: z.boolean(),
  NeedInPcDisability: z.boolean().optional(),
  NeedDisability: z.number().nonnegative().optional(),
  NeedInPcDeath: z.boolean().optional(),
  NeedDeath: z.number().nonnegative().optional(),
}).strict();

export const RiskRequest = z.object({
  Relationship: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  RelationshipSinceYear: z.number().int(),
  Person1: RiskPerson,
  Person2: RiskPerson.optional(),
  NumberOfChildren: z.number().int().nonnegative().optional(),
  WithChildren: z.boolean().optional(),
}).strict();

const zahl = z.number().optional();
export const RiskScenarioSummary = z.object({
  Scenario: z.number().int(),
  ErrorCode: zahl,
  GrossIncome: zahl,
  IncomeNeed: zahl,
  IncomeGap: zahl,
  IncomeSurplus: zahl,
  IncomeTotal: zahl,
  IncomePillar1: zahl,
  IncomePillar2: zahl,
  IncomePartner: zahl,
  CapitalGap: zahl,
});
export const RiskResponse = z.object({ response: z.object({ RiskScenarioSummaries: z.array(RiskScenarioSummary) }) });

export type RiskRequest = z.infer<typeof RiskRequest>;
export type RiskResponse = z.infer<typeof RiskResponse>;
type RiskPerson = z.infer<typeof RiskPerson>;

export type RisikoPruefung = Pruefung<RiskRequest>;

/**
 * Checks which inputs for the risk calculation are present and builds the request only when nothing is missing.
 * The missing list is an internal aid for the advisor, not a prescribed order of questions.
 */
export function pruefeRisiko(profil: Profil, jahr: number): RisikoPruefung {
  const p = neuePruefung<RiskRequest>();
  const paar = istPaar(profil);
  const beziehung = pruefeBeziehung(profil, jahr, p);

  const person1 = pruefePerson(profil.personen.A, 'A', p);
  let person2: RiskPerson | null = null;
  if (paar) person2 = pruefePerson(profil.personen.B ?? {}, 'B', p);
  else if (profil.personen.B && profil.haushalt.beziehung) p.hinweise.push('Person B ist erfasst, wird ohne Paarbeziehung aber nicht in die Berechnung übernommen.');

  const kinder = pruefeKinder(profil, paar, jahr, p);

  p.hinweise.push(
    'Bestehende private Absicherung (3. Säule, private Risikoversicherungen) ist in der APICalc-Berechnung nicht enthalten; bekannte private Leistungen weist das Backend separat aus.',
    'Leistungen der Pensionskasse werden nicht aus einem Vorsorgeausweis übernommen. Welche Annahmen APICalc ohne diese Werte trifft, ist nicht dokumentiert.',
  );
  if (profil.plaene.length > 0) p.hinweise.push('Pläne fliessen nicht ein: Diese Berechnung beschreibt die heutige Situation. Pläne werden als eigene Szenarien gerechnet.');

  if (p.fehlend.length > 0 || !beziehung || !person1 || (paar && !person2) || !kinder) return p;
  if (kinder.person1 > 0) person1.NumberOfChildren = kinder.person1;
  if (person2 && kinder.person2 > 0) person2.NumberOfChildren = kinder.person2;
  return abschliessen(p, RiskRequest.parse({
    ...beziehung,
    Person1: person1,
    ...(person2 ? { Person2: person2 } : {}),
    NumberOfChildren: kinder.gemeinsam,
    WithChildren: kinder.gemeinsam + kinder.person1 + kinder.person2 > 0,
  }));
}

function pruefePerson(person: Person, id: PersonId, p: Pruefung<unknown>): RiskPerson | null {
  const name = personLabel(id);
  const basis = pruefeBasisPerson(person, id, p);
  const ergebnis: Partial<RiskPerson> = { ...basis };
  const einkommen = basis.GrossIncome;
  for (const [feld, art, pc, need] of [['bedarfInvaliditaet', 'bei Erwerbsunfähigkeit', 'NeedInPcDisability', 'NeedDisability'], ['bedarfTodesfall', 'im Todesfall', 'NeedInPcDeath', 'NeedDeath']] as const) {
    const wert = person[feld];
    if (wert) {
      ergebnis[pc] = wert.wert.einheit === 'prozent';
      ergebnis[need] = wert.wert.hoehe;
      p.vorhanden.push({ label: `Bedarf ${art} von ${name}`, wert: bedarfText(wert.wert), quelle: wert.quelle });
      if (wert.wert.einheit === 'prozent' && einkommen === 0) p.hinweise.push(`${name}: Ein Bedarf in Prozent eines Einkommens von 0 ergibt 0. Für Betreuungs- oder Haushaltskosten einen Betrag in CHF verwenden.`);
    } else if (einkommen === 0) {
      p.hinweise.push(`${name}: Kein Bedarf ${art} erfasst. Ohne Bedarf zeigt die Berechnung voraussichtlich keine Lücke, obwohl etwa Betreuungskosten entstehen können.`);
    } else {
      p.fehlend.push({ label: `Gewünschtes Einkommen ${art} von ${name} (in % des heutigen Einkommens oder CHF pro Jahr)`, warum: 'Ohne Bedarf lässt sich keine Lücke bestimmen.' });
    }
  }
  const vollstaendig = basisVollstaendig(basis) && (basis.GrossIncome === 0 || (ergebnis.NeedDisability !== undefined && ergebnis.NeedDeath !== undefined));
  return vollstaendig ? ergebnis as RiskPerson : null;
}

function pruefeKinder(profil: Profil, paar: boolean, jahr: number, p: Pruefung<unknown>) {
  const { vorhanden, fehlend, hinweise } = p;
  const hatKinder = profil.haushalt.hatKinder;
  if (profil.kinder.length === 0) {
    if (hatKinder?.wert === false) {
      vorhanden.push({ label: 'Kinder', wert: 'keine', quelle: hatKinder.quelle });
      return { gemeinsam: 0, person1: 0, person2: 0 };
    }
    fehlend.push(hatKinder?.wert ? { label: 'Anzahl der Kinder', warum: 'Kinder- und Waisenrenten hängen davon ab.' } : { label: 'Ob Kinder da sind', warum: 'Kinder- und Waisenrenten hängen davon ab.' });
    return null;
  }

  const anzahl = { gemeinsam: 0, person1: 0, person2: 0 };
  let vollstaendig = true;
  for (const kind of profil.kinder) {
    const name = kindLabel(profil, kind);
    if (kind.geburtsjahr && jahr - kind.geburtsjahr.wert >= 18) hinweise.push(`${name} ist volljährig. Ob volljährige Kinder mitzuzählen sind, dokumentiert die Spezifikation nicht; gezählt wird es trotzdem.`);
    const elternteil = kind.elternteil?.wert ?? (paar ? undefined : 'A');
    if (!elternteil) {
      fehlend.push({ label: `Ob ${name} ein gemeinsames Kind ist`, warum: 'APICalc unterscheidet gemeinsame Kinder und Kinder eines Elternteils.' });
      vollstaendig = false;
      continue;
    }
    if (elternteil === 'beide') {
      anzahl.gemeinsam++;
      vorhanden.push({ label: name, wert: 'gemeinsames Kind', quelle: kind.elternteil!.quelle });
      continue;
    }
    if (elternteil === 'B' && !paar) {
      hinweise.push(`${name} gehört zu Person B, die ohne Paarbeziehung nicht berechnet wird.`);
      continue;
    }
    const sorgerecht = kind.alleinigesSorgerecht;
    if (!sorgerecht) {
      fehlend.push({ label: `Ob ${elternteil === 'A' ? 'du' : 'Person B'} das alleinige Sorgerecht für ${name} hat`, warum: 'APICalc zählt bei einem Elternteil nur Kinder mit alleinigem Sorgerecht.' });
      vollstaendig = false;
      continue;
    }
    if (!sorgerecht.wert) {
      hinweise.push(`${name}: kein alleiniges Sorgerecht. Dafür hat die Schnittstelle kein Feld; das Kind wird nicht gezählt.`);
      continue;
    }
    anzahl[elternteil === 'A' ? 'person1' : 'person2']++;
    vorhanden.push({ label: name, wert: `Kind von ${personLabel(elternteil)}, alleiniges Sorgerecht`, quelle: sorgerecht.quelle });
  }
  if (anzahl.gemeinsam + anzahl.person1 + anzahl.person2 > 0) hinweise.push('Das Feld WithChildren ist nicht dokumentiert; es wird gesetzt, sobald Kinder gezählt werden.');
  return vollstaendig ? anzahl : null;
}

const SZENARIEN: Record<number, { person: PersonId; fall: 'erwerbsunfaehigkeit' | 'tod'; ursache: 'Krankheit' | 'Unfall' }> = {
  1: { person: 'A', fall: 'erwerbsunfaehigkeit', ursache: 'Krankheit' },
  2: { person: 'A', fall: 'erwerbsunfaehigkeit', ursache: 'Unfall' },
  3: { person: 'A', fall: 'tod', ursache: 'Krankheit' },
  4: { person: 'A', fall: 'tod', ursache: 'Unfall' },
  5: { person: 'B', fall: 'erwerbsunfaehigkeit', ursache: 'Krankheit' },
  6: { person: 'B', fall: 'erwerbsunfaehigkeit', ursache: 'Unfall' },
  7: { person: 'B', fall: 'tod', ursache: 'Krankheit' },
  8: { person: 'B', fall: 'tod', ursache: 'Unfall' },
};
const FEHLERCODES: Record<number, string> = { 2: 'interner Fehler der Berechnung', 8: 'Person A ist bereits oder bald pensioniert', 9: 'Person B ist bereits oder bald pensioniert' };

export interface Szenario {
  szenario: string;
  person: PersonId | null;
  fall: 'erwerbsunfaehigkeit' | 'tod' | null;
  fehler: string | null;
  bedarf?: number; einnahmen?: number; ersteSaeule?: number; zweiteSaeule?: number; partner?: number; luecke?: number; ueberschuss?: number; kapitalisierteLuecke?: number;
}

// APICalc returns 0 for OK in practice, 1 in the specification; both mean OK.
export const szenarien = (antwort: RiskResponse): Szenario[] => antwort.response.RiskScenarioSummaries.map(s => {
  const art = SZENARIEN[s.Scenario];
  return {
    szenario: art ? `${art.fall === 'tod' ? 'Todesfall' : 'Erwerbsunfähigkeit'} durch ${art.ursache} – Person ${art.person}` : `Szenario ${s.Scenario}`,
    person: art?.person ?? null,
    fall: art?.fall ?? null,
    fehler: s.ErrorCode && s.ErrorCode !== 1 ? FEHLERCODES[s.ErrorCode] ?? `Fehlercode ${s.ErrorCode}` : null,
    bedarf: s.IncomeNeed, einnahmen: s.IncomeTotal, ersteSaeule: s.IncomePillar1, zweiteSaeule: s.IncomePillar2,
    partner: s.IncomePartner, luecke: s.IncomeGap, ueberschuss: s.IncomeSurplus, kapitalisierteLuecke: s.CapitalGap,
  };
});
