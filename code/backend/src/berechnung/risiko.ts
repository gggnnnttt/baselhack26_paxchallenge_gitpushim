import { z } from 'zod';
import { istPaar, kindLabel, personLabel, type Bedarf, type Einkommen, type Person, type PersonId, type Profil } from '../profil/profil.js';

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

export interface Angabe { label: string; wert?: string; quelle?: 'aussage' | 'ableitung' | 'backend'; warum?: string }
export interface RisikoPruefung {
  bereit: boolean;
  vorhanden: Angabe[];
  fehlend: Angabe[];
  hinweise: string[];
  request: RiskRequest | null;
  requestJson: string | null;
}

const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;
const BEZIEHUNG_API = { ledig: 1, geschieden: 1, verwitwet: 1, verheiratet: 2, konkubinat: 3, eingetragene_partnerschaft: 4 } as const;
const BEZIEHUNG_SEIT = { verheiratet: 'Jahr der Heirat', konkubinat: 'Seit welchem Jahr ihr zusammenlebt', eingetragene_partnerschaft: 'Jahr der Eintragung der Partnerschaft' } as const;

/**
 * Checks which inputs for the risk calculation are present and builds the request only when nothing is missing.
 * The missing list is an internal aid for the advisor, not a prescribed order of questions.
 */
export function pruefeRisiko(profil: Profil, jahr: number): RisikoPruefung {
  const vorhanden: Angabe[] = [];
  const fehlend: Angabe[] = [];
  const hinweise: string[] = [];
  const beziehung = profil.haushalt.beziehung;
  const paar = istPaar(profil);

  if (!beziehung) {
    fehlend.push({ label: 'Beziehungsstatus (ledig, verheiratet, Konkubinat, eingetragene Partnerschaft …)', warum: 'Bestimmt, ob Leistungen für eine hinterbliebene Partnerin oder einen hinterbliebenen Partner berechnet werden.' });
  } else {
    vorhanden.push({ label: 'Beziehungsstatus', wert: beziehung.wert.replace('_', ' '), quelle: beziehung.quelle });
    if (beziehung.wert === 'geschieden' || beziehung.wert === 'verwitwet') hinweise.push(`Beziehungsstatus „${beziehung.wert}“ wird als „Single“ übermittelt; Ansprüche aus einer früheren Ehe sind nicht berücksichtigt.`);
  }

  let seitJahr: number | null = null;
  if (paar && beziehung) {
    const seit = profil.haushalt.beziehungSeitJahr;
    const label = BEZIEHUNG_SEIT[beziehung.wert as keyof typeof BEZIEHUNG_SEIT];
    if (seit) {
      seitJahr = seit.wert;
      vorhanden.push({ label, wert: String(seit.wert), quelle: seit.quelle });
    } else {
      fehlend.push({ label, warum: 'Pflichtangabe der Risikoberechnung (RelationshipSinceYear).' });
    }
  } else if (beziehung) {
    seitJahr = jahr;
    hinweise.push('Für Alleinstehende verlangt APICalc ebenfalls ein Beziehungsjahr; die Bedeutung ist nicht dokumentiert. Übermittelt wird das aktuelle Jahr.');
  }

  const person1 = pruefePerson(profil.personen.A, 'A', vorhanden, fehlend, hinweise);
  let person2: RiskPerson | null = null;
  if (paar) person2 = pruefePerson(profil.personen.B ?? {}, 'B', vorhanden, fehlend, hinweise);
  else if (profil.personen.B && beziehung) hinweise.push('Person B ist erfasst, wird ohne Paarbeziehung aber nicht in die Berechnung übernommen.');

  const kinder = pruefeKinder(profil, paar, jahr, vorhanden, fehlend, hinweise);

  hinweise.push(
    'Bestehende private Vorsorge (3. Säule) ist im unveränderten APICalc-Ergebnis nicht berücksichtigt. Eine erfasste private Erwerbsunfähigkeitsrente wird separat im Modellvergleich ausgewiesen; weitere private Versicherungen fehlen weiterhin.',
    'Leistungen der Pensionskasse werden nicht aus einem Vorsorgeausweis übernommen. Welche Annahmen APICalc ohne diese Werte trifft, ist nicht dokumentiert.',
  );
  if (profil.plaene.length > 0) hinweise.push('Erfasste Pläne fliessen nicht ein: Die Berechnung beschreibt die heutige Situation.');

  if (fehlend.length > 0 || !beziehung || seitJahr === null || !person1 || (paar && !person2) || !kinder) {
    return { bereit: false, vorhanden, fehlend, hinweise, request: null, requestJson: null };
  }
  if (kinder.person1 > 0) person1.NumberOfChildren = kinder.person1;
  if (person2 && kinder.person2 > 0) person2.NumberOfChildren = kinder.person2;
  const request = RiskRequest.parse({
    Relationship: BEZIEHUNG_API[beziehung.wert],
    RelationshipSinceYear: seitJahr,
    Person1: person1,
    ...(person2 ? { Person2: person2 } : {}),
    NumberOfChildren: kinder.gemeinsam,
    WithChildren: kinder.gemeinsam + kinder.person1 + kinder.person2 > 0,
  });
  return { bereit: true, vorhanden, fehlend, hinweise, request, requestJson: JSON.stringify(request) };
}

function pruefePerson(person: Person, id: PersonId, vorhanden: Angabe[], fehlend: Angabe[], hinweise: string[]): RiskPerson | null {
  const name = personLabel(id);
  const ergebnis: Partial<RiskPerson> = {};

  if (person.geschlecht) {
    ergebnis.Sex = person.geschlecht.wert === 'maennlich' ? 1 : 2;
    vorhanden.push({ label: `Geschlecht ${name}`, wert: person.geschlecht.wert === 'maennlich' ? 'männlich' : 'weiblich', quelle: person.geschlecht.quelle });
  } else {
    fehlend.push({ label: `Geschlecht ${name}`, warum: 'Pflichtangabe der Risikoberechnung (Sex).' });
  }

  if (person.geburtsjahr) {
    ergebnis.BirthYear = person.geburtsjahr.wert;
    vorhanden.push({ label: `Geburtsjahr ${name}`, wert: String(person.geburtsjahr.wert), quelle: person.geburtsjahr.quelle });
  } else {
    fehlend.push({ label: `Geburtsjahr ${name}`, warum: 'Pflichtangabe; Leistungen hängen vom Alter ab.' });
  }

  const erwerb = person.erwerb?.wert;
  if (person.einkommen) {
    const brutto = bruttoJahr(person.einkommen.wert);
    if (typeof brutto === 'number') {
      ergebnis.GrossIncome = brutto;
      vorhanden.push({ label: `Bruttoeinkommen ${name}`, wert: `${chf(brutto)} pro Jahr`, quelle: person.einkommen.quelle });
    } else {
      fehlend.push({ label: `${brutto} (${name})`, warum: 'Die Berechnung verlangt das Bruttoeinkommen pro Jahr.' });
    }
  } else if (erwerb === 'nicht_erwerbstaetig') {
    ergebnis.GrossIncome = 0;
    vorhanden.push({ label: `Bruttoeinkommen ${name}`, wert: 'CHF 0 (nicht erwerbstätig)', quelle: 'backend' });
  } else {
    fehlend.push({ label: `Erwerbssituation und Bruttoeinkommen ${name}`, warum: 'Grundlage für Leistungen und Bedarf.' });
  }

  if (person.bvgVersichert) {
    ergebnis.WithBVG = person.bvgVersichert.wert;
    vorhanden.push({ label: `Pensionskasse ${name}`, wert: person.bvgVersichert.wert ? 'versichert' : 'nicht versichert', quelle: person.bvgVersichert.quelle });
  } else if (erwerb === 'nicht_erwerbstaetig') {
    ergebnis.WithBVG = false;
    vorhanden.push({ label: `Pensionskasse ${name}`, wert: 'nicht versichert (abgeleitet: nicht erwerbstätig)', quelle: 'backend' });
    hinweise.push(`${name}: Ohne Erwerb wird keine Pensionskasse angenommen. Ein Freizügigkeitsguthaben ist nicht berücksichtigt.`);
  } else {
    fehlend.push({ label: `Ob ${name} bei einer Pensionskasse versichert ist`, warum: 'Ohne Pensionskasse entfallen Leistungen der 2. Säule.' });
  }

  const einkommen = ergebnis.GrossIncome;
  for (const [feld, art, pc, need] of [['bedarfInvaliditaet', 'bei Erwerbsunfähigkeit', 'NeedInPcDisability', 'NeedDisability'], ['bedarfTodesfall', 'im Todesfall', 'NeedInPcDeath', 'NeedDeath']] as const) {
    const wert = person[feld];
    if (wert) {
      ergebnis[pc] = wert.wert.einheit === 'prozent';
      ergebnis[need] = wert.wert.hoehe;
      vorhanden.push({ label: `Bedarf ${art} von ${name}`, wert: bedarfText(wert.wert), quelle: wert.quelle });
      if (wert.wert.einheit === 'prozent' && einkommen === 0) hinweise.push(`${name}: Ein Bedarf in Prozent eines Einkommens von 0 ergibt 0. Für Betreuungs- oder Haushaltskosten einen Betrag in CHF verwenden.`);
    } else if (einkommen === 0) {
      hinweise.push(`${name}: Kein Bedarf ${art} erfasst. Ohne Bedarf zeigt die Berechnung voraussichtlich keine Lücke, obwohl etwa Betreuungskosten entstehen können.`);
    } else {
      fehlend.push({ label: `Gewünschtes Einkommen ${art} von ${name} (in % des heutigen Einkommens oder CHF pro Jahr)`, warum: 'Ohne Bedarf lässt sich keine Lücke bestimmen.' });
    }
  }

  const vollstaendig = ergebnis.Sex !== undefined && ergebnis.BirthYear !== undefined && ergebnis.WithBVG !== undefined && ergebnis.GrossIncome !== undefined
    && (ergebnis.GrossIncome === 0 || (ergebnis.NeedDisability !== undefined && ergebnis.NeedDeath !== undefined));
  return vollstaendig ? ergebnis as RiskPerson : null;
}

export function bruttoJahr(einkommen: Einkommen): number | string {
  if (einkommen.basis === 'netto') return 'Bruttoeinkommen (genannt wurde ein Nettobetrag)';
  if (einkommen.basis === null) return 'Ob das genannte Einkommen brutto oder netto ist';
  if (einkommen.einheit === 'chf_jahr') return einkommen.betrag;
  if (einkommen.monatsloehne === null) return 'Anzahl Monatslöhne (12 oder 13)';
  return einkommen.betrag * einkommen.monatsloehne;
}

const bedarfText = (bedarf: Bedarf) => (bedarf.einheit === 'prozent' ? `${bedarf.hoehe} % des heutigen Einkommens` : `${chf(bedarf.hoehe)} pro Jahr`);

function pruefeKinder(profil: Profil, paar: boolean, jahr: number, vorhanden: Angabe[], fehlend: Angabe[], hinweise: string[]) {
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

const SZENARIEN: Record<number, string> = {
  1: 'Erwerbsunfähigkeit durch Krankheit – Person A',
  2: 'Erwerbsunfähigkeit durch Unfall – Person A',
  3: 'Todesfall durch Krankheit – Person A',
  4: 'Todesfall durch Unfall – Person A',
  5: 'Erwerbsunfähigkeit durch Krankheit – Person B',
  6: 'Erwerbsunfähigkeit durch Unfall – Person B',
  7: 'Todesfall durch Krankheit – Person B',
  8: 'Todesfall durch Unfall – Person B',
};
const FEHLERCODES: Record<number, string> = { 2: 'interner Fehler der Berechnung', 8: 'Person A ist bereits oder bald pensioniert', 9: 'Person B ist bereits oder bald pensioniert' };

export interface Szenario {
  szenario: string;
  fehler: string | null;
  bedarf?: number; einnahmen?: number; ersteSaeule?: number; zweiteSaeule?: number; partner?: number; luecke?: number; ueberschuss?: number; kapitalisierteLuecke?: number;
}

export const szenarien = (antwort: RiskResponse): Szenario[] => antwort.response.RiskScenarioSummaries.map(s => ({
  szenario: SZENARIEN[s.Scenario] ?? `Szenario ${s.Scenario}`,
  fehler: s.ErrorCode && s.ErrorCode !== 1 ? FEHLERCODES[s.ErrorCode] ?? `Fehlercode ${s.ErrorCode}` : null,
  bedarf: s.IncomeNeed, einnahmen: s.IncomeTotal, ersteSaeule: s.IncomePillar1, zweiteSaeule: s.IncomePillar2,
  partner: s.IncomePartner, luecke: s.IncomeGap, ueberschuss: s.IncomeSurplus, kapitalisierteLuecke: s.CapitalGap,
}));
