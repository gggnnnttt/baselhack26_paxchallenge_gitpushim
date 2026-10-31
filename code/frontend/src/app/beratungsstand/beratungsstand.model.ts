// Mirrors BeratungsstandAnsicht in backend/src/beratung/darstellung.ts.
export interface Fakt<T> {
  wert: T;
  quelle: 'aussage' | 'ableitung';
  beleg: string;
  begruendung: string | null;
  nachricht: number;
}

export interface Einkommen { betrag: number; einheit: 'chf_jahr' | 'chf_monat'; basis: 'brutto' | 'netto' | null; monatsloehne: 12 | 13 | null }
export interface Bedarf { hoehe: number; einheit: 'prozent' | 'chf_jahr' }

export interface PrivateEu {
  vorhanden?: Fakt<boolean>;
  jahresrente?: Fakt<number>;
  deckung?: Fakt<'krankheit' | 'unfall' | 'beides'>;
  wartefristMonate?: Fakt<number>;
  leistungsendeAlter?: Fakt<number>;
  zusaetzlichBestaetigt?: Fakt<boolean>;
  mehrereVertraege?: Fakt<boolean>;
}
export interface PrivateEuVergleich {
  szenario: string; person: 'A' | 'B'; ursache: 'krankheit' | 'unfall';
  status: 'offen' | 'keine' | 'nicht_gedeckt' | 'modelliert' | 'nicht_verwendbar';
  apiLuecke: number | null; privateJahresrente: number | null;
  wartefristMonate: number | null; leistungsendeAlter: number | null;
  zurLueckendeckung: number | null; lueckeNachLeistungsbeginn: number | null;
  offeneAngaben: string[]; hinweise: string[];
}

export interface Person {
  geschlecht?: Fakt<'weiblich' | 'maennlich'>;
  geburtsjahr?: Fakt<number>;
  erwerb?: Fakt<'angestellt' | 'selbststaendig' | 'nicht_erwerbstaetig'>;
  pensumProzent?: Fakt<number>;
  einkommen?: Fakt<Einkommen>;
  bvgVersichert?: Fakt<boolean>;
  bedarfInvaliditaet?: Fakt<Bedarf>;
  bedarfTodesfall?: Fakt<Bedarf>;
  pensionierungsalter?: Fakt<number>;
  pkAltersrente?: Fakt<number>;
  pkGuthaben?: Fakt<number>;
  privateEu?: PrivateEu;
}

export interface Herkunft { quelle: 'aussage' | 'ableitung'; beleg: string; begruendung: string | null; nachricht: number }

export interface Profil {
  anliegen: { id: string; text: string; herkunft: Herkunft }[];
  haushalt: {
    beziehung?: Fakt<string>;
    beziehungSeitJahr?: Fakt<number>;
    hatKinder?: Fakt<boolean>;
    gemeinsamerHaushalt?: Fakt<boolean>;
    bedarfPensionierung?: Fakt<Bedarf>;
    vermoegenPensionierung?: Fakt<number>;
    pensionierungBasisBestaetigt?: Fakt<boolean>;
    budgetPensionierungMonat?: Fakt<number>;
  };
  personen: { A: Person; B?: Person };
  kinder: {
    id: string;
    bezeichnung: string;
    herkunft: Herkunft;
    geburtsjahr?: Fakt<number>;
    elternteil?: Fakt<'beide' | 'A' | 'B'>;
    alleinigesSorgerecht?: Fakt<boolean>;
  }[];
  plaene: {
    id: string;
    art: string;
    person: 'A' | 'B' | 'haushalt';
    beschreibung: string;
    herkunft: Herkunft;
    zeitpunkt?: Fakt<{ jahr: number; monat: number | null; text: string | null }>;
    pensumProzent?: Fakt<number>;
    einkommen?: Fakt<Einkommen>;
    sicherheit?: Fakt<'fest' | 'geplant' | 'unsicher'>;
  }[];
}

export interface Angabe { label: string; wert?: string; quelle?: 'aussage' | 'ableitung' | 'backend'; warum?: string }

export interface Szenario {
  szenario: string;
  fehler: string | null;
  bedarf?: number;
  einnahmen?: number;
  ersteSaeule?: number;
  zweiteSaeule?: number;
  partner?: number;
  luecke?: number;
  ueberschuss?: number;
  kapitalisierteLuecke?: number;
}

export interface Protokolleintrag { feld: string; text: string; grund?: string }

export interface Handlungskarte {
  id: string; reihenfolge: number; prioritaet: 1 | 2 | 3;
  kategorie: 'grundlagen' | 'klaerung' | 'planung' | 'naechster_schritt';
  titel: string; begruendung: string;
  datengrundlage: { quelle: string; details: string }[];
  offeneFragen: string[]; naechsterSchritt: string;
  aktion: { label: string; nachricht: string };
}

export interface ProduktFall {
  id: string; regelId: string;
  status: 'pruefkandidat' | 'abklaerung' | 'kein_zusaetzlicher_bedarf' | 'nicht_bereit';
  person: 'A' | 'B'; ursache: 'krankheit' | 'unfall'; szenario: string;
  produkt: { id: string; name: string; bedarfsart: string; beschreibung: string; quelle: string; quellenstand: string; fachlicheFreigabe: string } | null;
  handlungId: string; begruendung: string;
  datengrundlage: { quelle: string; details: string }[];
  urspruenglicheLueckeProJahr: number | null; restlueckeProJahr: number | null;
  bestehendeWartefristMonate: number | null; bestehendeLeistungBisAlter: number | null;
  geltungsbereich: string; offenePruefungen: string[]; naechsterSchritt: string;
  aktion: { label: string; nachricht: string };
}

export interface Beratungsstand {
  phase: 'erfassung' | 'bereit' | 'berechnung' | 'berechnet' | 'fehlgeschlagen';
  phaseText: string;
  profil: Profil;
  risiko: {
    vorhanden: Angabe[];
    fehlend: Angabe[];
    hinweise: string[];
    request: unknown;
    ergebnis: { zeitpunkt: string; veraltet: boolean; szenarien: Szenario[] } | null;
    fehler: string | null;
  };
  privateEu: { status: string; hinweise: string[]; vergleiche: PrivateEuVergleich[] };
  pensionierung: {
    phase: 'erfassung' | 'bereit' | 'berechnet' | 'fehlgeschlagen';
    phaseText: string; vorhanden: Angabe[]; fehlend: Angabe[]; hinweise: string[]; request: unknown;
    ergebnis: { zeitpunkt: string; veraltet: boolean; werte: {
      IncomeNeed?: number; IncomeTotal?: number; IncomePillar1?: number; IncomePillar2?: number;
      IncomeWithdrawal?: number; IncomeGap?: number; AvailableFortune?: number; CapitalNeed?: number; CapitalGap?: number;
    } } | null;
    fehler: string | null;
  };
  sparen: {
    phase: 'wartet' | 'bereit' | 'berechnet' | 'kein_bedarf' | 'nicht_moeglich' | 'fehlgeschlagen';
    phaseText: string; hinweise: string[]; fehler: string | null;
    zielkapital: number | null; zieljahr: number | null; dauerJahre: number | null;
    request: unknown;
    ergebnis: { zeitpunkt: string; monatlicherSparbetrag: number; einzahlungen: number; endkapital: number } | null;
  };
  budget: {
    status: 'wartet' | 'offen' | 'ausreichend' | 'unterdeckung' | 'kein_bedarf';
    statusText: string; sparbedarfMonat: number | null; verfuegbarMonat: number | null;
    fehlbetragMonat: number | null; restbudgetMonat: number | null; hinweise: string[];
  };
  handlungsplan: { hinweis: string; karten: Handlungskarte[] };
  produktzuordnung: { statusText: string; hinweise: string[]; faelle: ProduktFall[] };
  letzteNachricht: { uebernommen: Protokolleintrag[]; abgelehnt: Protokolleintrag[] };
}
