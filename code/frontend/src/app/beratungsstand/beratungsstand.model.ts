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
  pensionierung: {
    phase: 'erfassung' | 'bereit' | 'berechnet' | 'fehlgeschlagen';
    phaseText: string; vorhanden: Angabe[]; fehlend: Angabe[]; hinweise: string[]; request: unknown;
    ergebnis: { zeitpunkt: string; veraltet: boolean; werte: {
      IncomeNeed?: number; IncomeTotal?: number; IncomePillar1?: number; IncomePillar2?: number;
      IncomeWithdrawal?: number; IncomeGap?: number; AvailableFortune?: number; CapitalNeed?: number; CapitalGap?: number;
    } } | null;
    fehler: string | null;
  };
  letzteNachricht: { uebernommen: Protokolleintrag[]; abgelehnt: Protokolleintrag[] };
}
