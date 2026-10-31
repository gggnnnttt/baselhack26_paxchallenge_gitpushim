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
  saeule3a?: Fakt<boolean>;
  saeule3aGuthaben?: Fakt<number>;
  todesfallkapital?: Fakt<number>;
  erwerbsunfaehigkeitsrente?: Fakt<number>;
  bedarfInvaliditaet?: Fakt<Bedarf>;
  bedarfTodesfall?: Fakt<Bedarf>;
}

export interface Herkunft { quelle: 'aussage' | 'ableitung'; beleg: string; begruendung: string | null; nachricht: number }

export interface Profil {
  anliegen: { id: string; text: string; thema: string; herkunft: Herkunft }[];
  haushalt: {
    beziehung?: Fakt<string>;
    beziehungSeitJahr?: Fakt<number>;
    hatKinder?: Fakt<boolean>;
    gemeinsamerHaushalt?: Fakt<boolean>;
    wohnen?: Fakt<'miete' | 'eigentum'>;
    hypothek?: Fakt<number>;
    vermoegen?: Fakt<number>;
    sparbetrag?: Fakt<{ betrag: number; einheit: 'chf_jahr' | 'chf_monat' }>;
    bedarfAlter?: Fakt<Bedarf>;
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
    alter?: Fakt<number>;
    kaufpreis?: Fakt<number>;
  }[];
}

export interface Angabe { label: string; wert?: string; quelle?: 'aussage' | 'ableitung' | 'backend' | 'annahme'; warum?: string }

export interface Szenario {
  szenario: string;
  person: 'A' | 'B' | null;
  fall: 'erwerbsunfaehigkeit' | 'tod' | null;
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

export interface Pensionsergebnis {
  fehler: string | null;
  einkommenHeute?: number; bedarf?: number; einnahmen?: number; ersteSaeule?: number; zweiteSaeule?: number;
  vermoegensverzehr?: number; luecke?: number; verfuegbaresVermoegen?: number; noetigesVermoegen?: number; kapitalLuecke?: number;
}

export interface Eigenheimergebnis {
  kaufpreis: number; kaufjahr: number; eigenmittelBeiKauf: number; eigenmittelNoetig: number; eigenmittelLuecke: number;
  sparbetragFuerZielJahr: number | null; hypothek: number; kostenJahr: number; tragbarkeitProzent: number; tragbar: boolean;
  maxKaufpreisNachEinkommen: number; saeule3aMoeglich: number;
}

export type Ergebnis =
  | { art: 'risiko' | 'familie'; szenarien: Szenario[] }
  | { art: 'pensionierung'; pension: Pensionsergebnis }
  | { art: 'eigenheim'; eigenheim: Eigenheimergebnis };

export interface Pruefung {
  bereit: boolean;
  vorhanden: Angabe[];
  fehlend: Angabe[];
  optional: Angabe[];
  annahmen: string[];
  hinweise: string[];
  request: unknown;
}

export interface Rechnung {
  id: string;
  art: 'risiko' | 'familie' | 'eigenheim' | 'pensionierung';
  titel: string;
  planId: string | null;
  extern: boolean;
  status: 'unvollstaendig' | 'bereit' | 'berechnet' | 'veraltet' | 'fehlgeschlagen';
  pruefung: Pruefung;
  ergebnis: Ergebnis | null;
  zeitpunkt: string | null;
  fehler: string | null;
}

export interface OffenerPunkt { thema: string; label: string; warum: string }
export interface Thema { id: string; titel: string; status: 'offen' | 'teilweise' | 'geklaert'; anlass: string | null; zusammenfassung: string; offen: OffenerPunkt[]; rechnungen: string[] }
export interface AnliegenStand { id: string; text: string; thema: string; status: 'offen' | 'in_klaerung' | 'ergebnis'; themen: string[]; rechnungen: string[] }
export interface Luecke { text: string; betrag: number; einheit: 'pro_jahr' | 'kapital'; quelle: string }

export type Aktion = 'nachfragen' | 'erklaeren' | 'szenario_zeigen' | 'empfehlung_vorbereiten' | 'beratungsperson';
export interface Schritt {
  aktion: Aktion;
  quelle: 'planer' | 'fallback';
  frage: string | null;
  begruendung: string;
  fokus: OffenerPunkt | null;
  rechnungen: string[];
  erlaubt: Aktion[];
  nichtErlaubt: { aktion: Aktion | 'szenario_berechnen'; grund: string }[];
}

export interface Protokolleintrag { feld: string; text: string; grund?: string }

export interface Beratungsstand {
  phase: 'start' | Aktion;
  schritt: Schritt | null;
  profil: Profil;
  stand: {
    anliegen: AnliegenStand[];
    themen: Thema[];
    rechnungen: Rechnung[];
    empfehlung: { erlaubt: boolean; fehlt: string[]; beduerfnisse: string[]; vorhandeneLeistungen: string[]; luecken: Luecke[] };
    menschlicheBeratung: string[];
  };
  letzteNachricht: { uebernommen: Protokolleintrag[]; abgelehnt: Protokolleintrag[] };
}
