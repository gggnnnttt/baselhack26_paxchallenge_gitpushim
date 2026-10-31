import { z } from 'zod';
import { BEZIEHUNGEN, ERWERB, PLANARTEN, Profil, type Bedarf, type Einkommen, type Herkunft, type Kind, type Person, type Plan } from './profil.js';

// Change proposals produced by the model. All keys are required (nullable) so the schema works with strict structured outputs.
export const FELDER = [
  'anliegen', 'beziehung', 'beziehung_seit_jahr', 'hat_kinder', 'gemeinsamer_haushalt',
  'geschlecht', 'geburtsjahr', 'erwerb', 'pensum', 'einkommen', 'bvg_versichert', 'bedarf_invaliditaet', 'bedarf_todesfall',
  'kind', 'kind_geburtsjahr', 'kind_elternteil', 'kind_alleiniges_sorgerecht',
  'plan', 'plan_zeitpunkt', 'plan_pensum', 'plan_einkommen', 'plan_sicherheit',
] as const;

export const Aenderung = z.object({
  aktion: z.enum(['setzen', 'entfernen']),
  feld: z.enum(FELDER),
  person: z.enum(['A', 'B']).nullable(),
  ziel: z.string().max(20).nullable(),
  text: z.string().max(300).nullable(),
  zahl: z.number().nullable(),
  monat: z.number().nullable(),
  ja_nein: z.boolean().nullable(),
  einheit: z.enum(['prozent', 'chf_jahr', 'chf_monat']).nullable(),
  einkommensbasis: z.enum(['brutto', 'netto']).nullable(),
  monatsloehne: z.number().nullable(),
  planart: z.enum(PLANARTEN).nullable(),
  quelle: z.enum(['aussage', 'ableitung']),
  beleg: z.string().max(300),
  begruendung: z.string().max(300).nullable(),
}).strict();

export const Extraktion = z.object({ aenderungen: z.array(Aenderung).max(30) }).strict();
export type Aenderung = z.infer<typeof Aenderung>;

export interface Protokolleintrag { feld: string; text: string; grund?: string }
export interface Anwendung { profil: Profil; uebernommen: Protokolleintrag[]; abgelehnt: Protokolleintrag[] }
export interface Nachricht { text: string; index: number; jahr: number }

class Ablehnung extends Error {}
const ablehnen = (grund: string): never => { throw new Ablehnung(grund); };

export const normalisiere = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[’‘`´]/g, "'").replace(/[“”„«»]/g, '"').replace(/\s+/g, ' ').trim();

/**
 * Applies proposals to a copy of the profile. A proposal is only accepted if its quote occurs in the
 * current user message and its value passes the field rules. Valid JSON alone proves nothing.
 */
export function wendeAenderungenAn(ausgang: Profil, aenderungen: readonly Aenderung[], nachricht: Nachricht): Anwendung {
  const profil = structuredClone(ausgang);
  const neueIds = new Map<string, string>();
  const text = normalisiere(nachricht.text);
  const uebernommen: Protokolleintrag[] = [];
  const abgelehnt: Protokolleintrag[] = [];
  for (const aenderung of aenderungen) {
    const eintrag = { feld: aenderung.feld, text: beschreibe(aenderung) };
    try {
      wende(profil, aenderung, pruefeHerkunft(aenderung, text, nachricht.index), neueIds, nachricht.jahr);
      uebernommen.push(eintrag);
    } catch (error) {
      if (!(error instanceof Ablehnung)) throw error;
      abgelehnt.push({ ...eintrag, grund: error.message });
    }
  }
  return { profil: Profil.parse(profil), uebernommen, abgelehnt };
}

function pruefeHerkunft(aenderung: Aenderung, nachricht: string, index: number): Herkunft {
  const beleg = aenderung.beleg.trim();
  if (!beleg) ablehnen('Kein Beleg aus der Nachricht.');
  if (!nachricht.includes(normalisiere(beleg))) ablehnen('Der Beleg steht nicht in der Nachricht.');
  const begruendung = aenderung.begruendung?.trim() || null;
  if (aenderung.quelle === 'ableitung' && !begruendung) ablehnen('Ableitung ohne Begründung.');
  return { quelle: aenderung.quelle, beleg, begruendung, nachricht: index };
}

function beschreibe(a: Aenderung): string {
  const ziel = [a.person && `Person ${a.person}`, a.ziel].filter(Boolean).join(' ');
  const wert = a.aktion === 'entfernen' ? 'entfernt'
    : [a.planart, a.text, a.zahl, a.monat && `Monat ${a.monat}`, a.ja_nein === null ? null : a.ja_nein ? 'ja' : 'nein', a.einheit, a.einkommensbasis, a.monatsloehne && `${a.monatsloehne} Monatslöhne`]
      .filter(value => value !== null && value !== undefined && value !== '').join(' ');
  return `${a.feld}${ziel ? ` (${ziel})` : ''}: ${wert}`;
}

const ganzzahl = (a: Aenderung, min: number, max: number, name: string): number => {
  if (a.zahl === null || !Number.isInteger(a.zahl) || a.zahl < min || a.zahl > max) return ablehnen(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  return a.zahl;
};
const auswahl = <T extends string>(a: Aenderung, werte: readonly T[], name: string): T => {
  if (a.text === null || !werte.includes(a.text as T)) return ablehnen(`${name}: erlaubt sind ${werte.join(', ')}.`);
  return a.text as T;
};
const janein = (a: Aenderung, name: string): boolean => (a.ja_nein === null ? ablehnen(`${name}: ja/nein fehlt.`) : a.ja_nein);

const einkommen = (a: Aenderung): Einkommen => {
  if (a.zahl === null || a.zahl <= 0 || a.zahl > 10_000_000) return ablehnen('Einkommen braucht einen positiven Betrag in CHF.');
  if (a.einheit !== 'chf_jahr' && a.einheit !== 'chf_monat') return ablehnen('Einkommen braucht die Einheit chf_jahr oder chf_monat.');
  if (a.monatsloehne !== null && a.monatsloehne !== 12 && a.monatsloehne !== 13) return ablehnen('Monatslöhne: nur 12 oder 13.');
  return { betrag: a.zahl, einheit: a.einheit, basis: a.einkommensbasis, monatsloehne: a.einheit === 'chf_monat' ? a.monatsloehne as 12 | 13 | null : null };
};

const bedarf = (a: Aenderung): Bedarf => {
  if (a.einheit === 'prozent') {
    if (a.zahl === null || a.zahl < 0 || a.zahl > 100) return ablehnen('Bedarf in Prozent muss zwischen 0 und 100 liegen.');
    return { hoehe: a.zahl, einheit: 'prozent' };
  }
  if (a.einheit === 'chf_jahr') {
    if (a.zahl === null || a.zahl < 0 || a.zahl > 10_000_000) return ablehnen('Bedarf in CHF pro Jahr ist ungültig.');
    return { hoehe: a.zahl, einheit: 'chf_jahr' };
  }
  return ablehnen('Bedarf braucht die Einheit prozent oder chf_jahr.');
};

// Validates the value before Person B is created, so a rejected proposal leaves no empty person behind.
function personFeld<K extends keyof Person>(profil: Profil, a: Aenderung, feld: K, wert: () => Person[K]): void {
  if (!a.person) return ablehnen('Person A oder B fehlt.');
  if (a.aktion === 'entfernen') {
    delete profil.personen[a.person]?.[feld];
    return;
  }
  const neu = wert();
  (profil.personen[a.person] ??= {})[feld] = neu;
}

function kindFinden(profil: Profil, a: Aenderung, neueIds: Map<string, string>): Kind {
  if (!a.ziel) return ablehnen('Kind-Kennung fehlt.');
  const id = neueIds.get(a.ziel) ?? a.ziel;
  return profil.kinder.find(kind => kind.id === id) ?? ablehnen(`Kind ${a.ziel} ist nicht bekannt.`);
}

function planFinden(profil: Profil, a: Aenderung, neueIds: Map<string, string>): Plan {
  if (!a.ziel) return ablehnen('Plan-Kennung fehlt.');
  const id = neueIds.get(`plan:${a.ziel}`) ?? a.ziel;
  return profil.plaene.find(plan => plan.id === id) ?? ablehnen(`Plan ${a.ziel} ist nicht bekannt.`);
}

const istNeu = (ziel: string | null) => ziel !== null && /^neu\d{1,2}$/.test(ziel);

function wende(profil: Profil, a: Aenderung, herkunft: Herkunft, neueIds: Map<string, string>, jahr: number): void {
  const setzen = a.aktion === 'setzen';
  const fakt = <T>(wert: T) => ({ wert, ...herkunft });
  switch (a.feld) {
    case 'anliegen': {
      if (!setzen) {
        const index = profil.anliegen.findIndex(anliegen => anliegen.id === a.ziel);
        if (index < 0) ablehnen(`Anliegen ${a.ziel ?? ''} ist nicht bekannt.`);
        profil.anliegen.splice(index, 1);
        return;
      }
      const text = a.text?.trim() || ablehnen('Anliegen braucht einen Text.');
      if (profil.anliegen.length >= 10) ablehnen('Es sind bereits 10 Anliegen erfasst.');
      profil.anliegen.push({ id: `a${profil.naechsteId.anliegen++}`, text, herkunft });
      return;
    }
    case 'beziehung':
      if (setzen) profil.haushalt.beziehung = fakt(auswahl(a, BEZIEHUNGEN, 'Beziehung'));
      else delete profil.haushalt.beziehung;
      return;
    case 'beziehung_seit_jahr':
      if (setzen) profil.haushalt.beziehungSeitJahr = fakt(ganzzahl(a, 1940, jahr, 'Jahr'));
      else delete profil.haushalt.beziehungSeitJahr;
      return;
    case 'hat_kinder':
      if (setzen) profil.haushalt.hatKinder = fakt(janein(a, 'Kinder'));
      else delete profil.haushalt.hatKinder;
      return;
    case 'gemeinsamer_haushalt':
      if (setzen) profil.haushalt.gemeinsamerHaushalt = fakt(janein(a, 'Gemeinsamer Haushalt'));
      else delete profil.haushalt.gemeinsamerHaushalt;
      return;
    case 'geschlecht':
      personFeld(profil, a, 'geschlecht', () => fakt(auswahl(a, ['weiblich', 'maennlich'] as const, 'Geschlecht')));
      return;
    case 'geburtsjahr':
      personFeld(profil, a, 'geburtsjahr', () => fakt(ganzzahl(a, 1900, jahr, 'Geburtsjahr')));
      return;
    case 'erwerb':
      personFeld(profil, a, 'erwerb', () => fakt(auswahl(a, ERWERB, 'Erwerb')));
      return;
    case 'pensum':
      personFeld(profil, a, 'pensumProzent', () => fakt(ganzzahl(a, 0, 100, 'Pensum')));
      return;
    case 'einkommen':
      personFeld(profil, a, 'einkommen', () => fakt(einkommen(a)));
      return;
    case 'bvg_versichert':
      personFeld(profil, a, 'bvgVersichert', () => fakt(janein(a, 'Pensionskasse')));
      return;
    case 'bedarf_invaliditaet':
      personFeld(profil, a, 'bedarfInvaliditaet', () => fakt(bedarf(a)));
      return;
    case 'bedarf_todesfall':
      personFeld(profil, a, 'bedarfTodesfall', () => fakt(bedarf(a)));
      return;
    case 'kind': {
      if (setzen && istNeu(a.ziel) && !neueIds.has(a.ziel!)) {
        if (profil.kinder.length >= 10) ablehnen('Es sind bereits 10 Kinder erfasst.');
        const id = `k${profil.naechsteId.kind++}`;
        neueIds.set(a.ziel!, id);
        profil.kinder.push({ id, bezeichnung: bezeichnung(a), herkunft });
        return;
      }
      const kind = kindFinden(profil, a, neueIds);
      if (setzen) kind.bezeichnung = bezeichnung(a);
      else profil.kinder.splice(profil.kinder.indexOf(kind), 1);
      return;
    }
    case 'kind_geburtsjahr': {
      const kind = kindFinden(profil, a, neueIds);
      if (setzen) kind.geburtsjahr = fakt(ganzzahl(a, 1940, jahr, 'Geburtsjahr des Kindes'));
      else delete kind.geburtsjahr;
      return;
    }
    case 'kind_elternteil': {
      const kind = kindFinden(profil, a, neueIds);
      if (setzen) kind.elternteil = fakt(auswahl(a, ['beide', 'A', 'B'] as const, 'Elternteil'));
      else delete kind.elternteil;
      return;
    }
    case 'kind_alleiniges_sorgerecht': {
      const kind = kindFinden(profil, a, neueIds);
      if (setzen) kind.alleinigesSorgerecht = fakt(janein(a, 'Alleiniges Sorgerecht'));
      else delete kind.alleinigesSorgerecht;
      return;
    }
    case 'plan': {
      if (setzen && istNeu(a.ziel) && !neueIds.has(`plan:${a.ziel}`)) {
        if (profil.plaene.length >= 20) ablehnen('Es sind bereits 20 Pläne erfasst.');
        const beschreibung = a.text?.trim().slice(0, 200) || ablehnen('Plan braucht eine kurze Beschreibung.');
        const id = `p${profil.naechsteId.plan++}`;
        neueIds.set(`plan:${a.ziel}`, id);
        profil.plaene.push({ id, art: a.planart ?? 'sonstiges', person: a.person ?? 'haushalt', beschreibung, herkunft });
        return;
      }
      const plan = planFinden(profil, a, neueIds);
      if (!setzen) {
        profil.plaene.splice(profil.plaene.indexOf(plan), 1);
        return;
      }
      if (a.text?.trim()) plan.beschreibung = a.text.trim().slice(0, 200);
      if (a.planart) plan.art = a.planart;
      if (a.person) plan.person = a.person;
      return;
    }
    case 'plan_zeitpunkt': {
      const plan = planFinden(profil, a, neueIds);
      if (!setzen) {
        delete plan.zeitpunkt;
        return;
      }
      const monat = a.monat === null ? null : Number.isInteger(a.monat) && a.monat >= 1 && a.monat <= 12 ? a.monat : ablehnen('Monat muss zwischen 1 und 12 liegen.');
      plan.zeitpunkt = fakt({ jahr: ganzzahl(a, jahr, jahr + 70, 'Jahr des Plans'), monat, text: a.text?.trim().slice(0, 80) || null });
      return;
    }
    case 'plan_pensum': {
      const plan = planFinden(profil, a, neueIds);
      if (setzen) plan.pensumProzent = fakt(ganzzahl(a, 0, 100, 'Pensum'));
      else delete plan.pensumProzent;
      return;
    }
    case 'plan_einkommen': {
      const plan = planFinden(profil, a, neueIds);
      if (setzen) plan.einkommen = fakt(einkommen(a));
      else delete plan.einkommen;
      return;
    }
    case 'plan_sicherheit': {
      const plan = planFinden(profil, a, neueIds);
      if (setzen) plan.sicherheit = fakt(auswahl(a, ['fest', 'geplant', 'unsicher'] as const, 'Sicherheit'));
      else delete plan.sicherheit;
      return;
    }
  }
}

const bezeichnung = (a: Aenderung): Kind['bezeichnung'] => (a.text === 'Tochter' || a.text === 'Sohn' ? a.text : 'Kind');
