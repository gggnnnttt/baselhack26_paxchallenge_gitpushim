import { istPaar, personLabel, type Bedarf, type Einkommen, type Person, type PersonId, type Profil } from '../profil/profil.js';

/** One input of a calculation: present, missing (with why), or derived by the backend. */
export interface Angabe { label: string; wert?: string; quelle?: 'aussage' | 'ableitung' | 'backend' | 'annahme'; warum?: string }

/** Result of checking one calculation's inputs. The request exists only when nothing required is missing. */
export interface Pruefung<Req = unknown> {
  bereit: boolean;
  vorhanden: Angabe[];
  fehlend: Angabe[];
  // Not required, but would make the result more precise. Never asked for in bulk.
  optional: Angabe[];
  // Assumptions the backend made explicitly; shown with every result.
  annahmen: string[];
  hinweise: string[];
  request: Req | null;
  requestJson: string | null;
}

export const neuePruefung = <Req>(): Pruefung<Req> => ({ bereit: false, vorhanden: [], fehlend: [], optional: [], annahmen: [], hinweise: [], request: null, requestJson: null });
export const abschliessen = <Req>(p: Pruefung<Req>, request: Req): Pruefung<Req> => ({ ...p, bereit: true, request, requestJson: JSON.stringify(request) });

export const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;
export const bedarfText = (bedarf: Bedarf) => (bedarf.einheit === 'prozent' ? `${bedarf.hoehe} % des heutigen Einkommens` : `${chf(bedarf.hoehe)} pro Jahr`);

export const BEZIEHUNG_API = { ledig: 1, geschieden: 1, verwitwet: 1, verheiratet: 2, konkubinat: 3, eingetragene_partnerschaft: 4 } as const;
const BEZIEHUNG_SEIT = { verheiratet: 'Jahr der Heirat', konkubinat: 'Seit welchem Jahr ihr zusammenlebt', eingetragene_partnerschaft: 'Jahr der Eintragung der Partnerschaft' } as const;

export interface BeziehungBasis { Relationship: 1 | 2 | 3 | 4; RelationshipSinceYear: number }

/** Relationship fields shared by calculateRisk and calculateRetirement. */
export function pruefeBeziehung(profil: Profil, jahr: number, p: Pruefung<unknown>): BeziehungBasis | null {
  const beziehung = profil.haushalt.beziehung;
  if (!beziehung) {
    p.fehlend.push({ label: 'Beziehungsstatus (ledig, verheiratet, Konkubinat, eingetragene Partnerschaft …)', warum: 'Bestimmt, ob Leistungen für eine hinterbliebene Partnerin oder einen hinterbliebenen Partner berechnet werden.' });
    return null;
  }
  p.vorhanden.push({ label: 'Beziehungsstatus', wert: beziehung.wert.replace('_', ' '), quelle: beziehung.quelle });
  if (beziehung.wert === 'geschieden' || beziehung.wert === 'verwitwet') p.hinweise.push(`Beziehungsstatus „${beziehung.wert}“ wird als „Single“ übermittelt; Ansprüche aus einer früheren Ehe sind nicht berücksichtigt.`);
  if (!istPaar(profil)) {
    p.hinweise.push('Für Alleinstehende verlangt APICalc ebenfalls ein Beziehungsjahr; die Bedeutung ist nicht dokumentiert. Übermittelt wird das aktuelle Jahr.');
    return { Relationship: BEZIEHUNG_API[beziehung.wert], RelationshipSinceYear: jahr };
  }
  const label = BEZIEHUNG_SEIT[beziehung.wert as keyof typeof BEZIEHUNG_SEIT];
  const seit = profil.haushalt.beziehungSeitJahr;
  if (!seit) {
    p.fehlend.push({ label, warum: 'Pflichtangabe der Berechnung (RelationshipSinceYear).' });
    return null;
  }
  p.vorhanden.push({ label, wert: String(seit.wert), quelle: seit.quelle });
  return { Relationship: BEZIEHUNG_API[beziehung.wert], RelationshipSinceYear: seit.wert };
}

export interface PersonBasis { Sex: 1 | 2; BirthYear: number; GrossIncome: number; WithBVG: boolean }

/** Sex, birth year, gross income and pension fund: the person fields every APICalc pension calculation needs. */
export function pruefeBasisPerson(person: Person, id: PersonId, p: Pruefung<unknown>): Partial<PersonBasis> {
  const name = personLabel(id);
  const ergebnis: Partial<PersonBasis> = {};

  if (person.geschlecht) {
    ergebnis.Sex = person.geschlecht.wert === 'maennlich' ? 1 : 2;
    p.vorhanden.push({ label: `Geschlecht ${name}`, wert: person.geschlecht.wert === 'maennlich' ? 'männlich' : 'weiblich', quelle: person.geschlecht.quelle });
  } else {
    p.fehlend.push({ label: `Geschlecht ${name}`, warum: 'Pflichtangabe der Berechnung (Sex); Renten der 1. und 2. Säule unterscheiden sich.' });
  }

  if (person.geburtsjahr) {
    ergebnis.BirthYear = person.geburtsjahr.wert;
    p.vorhanden.push({ label: `Geburtsjahr ${name}`, wert: String(person.geburtsjahr.wert), quelle: person.geburtsjahr.quelle });
  } else {
    p.fehlend.push({ label: `Geburtsjahr ${name}`, warum: 'Pflichtangabe; Leistungen hängen vom Alter ab.' });
  }

  const erwerb = person.erwerb?.wert;
  if (person.einkommen) {
    const brutto = bruttoJahr(person.einkommen.wert);
    if (typeof brutto === 'number') {
      ergebnis.GrossIncome = brutto;
      p.vorhanden.push({ label: `Bruttoeinkommen ${name}`, wert: `${chf(brutto)} pro Jahr`, quelle: person.einkommen.quelle });
    } else {
      p.fehlend.push({ label: `${brutto} (${name})`, warum: 'Die Berechnung verlangt das Bruttoeinkommen pro Jahr.' });
    }
  } else if (erwerb === 'nicht_erwerbstaetig') {
    ergebnis.GrossIncome = 0;
    p.vorhanden.push({ label: `Bruttoeinkommen ${name}`, wert: 'CHF 0 (nicht erwerbstätig)', quelle: 'backend' });
  } else {
    p.fehlend.push({ label: `Erwerbssituation und Bruttoeinkommen ${name}`, warum: 'Grundlage für Leistungen und Bedarf.' });
  }

  if (person.bvgVersichert) {
    ergebnis.WithBVG = person.bvgVersichert.wert;
    p.vorhanden.push({ label: `Pensionskasse ${name}`, wert: person.bvgVersichert.wert ? 'versichert' : 'nicht versichert', quelle: person.bvgVersichert.quelle });
  } else if (erwerb === 'nicht_erwerbstaetig') {
    ergebnis.WithBVG = false;
    p.vorhanden.push({ label: `Pensionskasse ${name}`, wert: 'nicht versichert (abgeleitet: nicht erwerbstätig)', quelle: 'backend' });
    p.hinweise.push(`${name}: Ohne Erwerb wird keine Pensionskasse angenommen. Ein Freizügigkeitsguthaben ist nicht berücksichtigt.`);
  } else {
    p.fehlend.push({ label: `Ob ${name} bei einer Pensionskasse versichert ist`, warum: 'Ohne Pensionskasse entfallen Leistungen der 2. Säule.' });
  }
  return ergebnis;
}

export const basisVollstaendig = (b: Partial<PersonBasis>): b is PersonBasis =>
  b.Sex !== undefined && b.BirthYear !== undefined && b.GrossIncome !== undefined && b.WithBVG !== undefined;

export function bruttoJahr(einkommen: Einkommen): number | string {
  if (einkommen.basis === 'netto') return 'Bruttoeinkommen (genannt wurde ein Nettobetrag)';
  if (einkommen.basis === null) return 'Ob das genannte Einkommen brutto oder netto ist';
  if (einkommen.einheit === 'chf_jahr') return einkommen.betrag;
  if (einkommen.monatsloehne === null) return 'Anzahl Monatslöhne (12 oder 13)';
  return einkommen.betrag * einkommen.monatsloehne;
}
