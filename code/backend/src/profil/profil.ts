import { z } from 'zod';

// Every stored value records where it came from: the quoted user message, and why it was derived if it was not said directly.
const herkunft = {
  quelle: z.enum(['aussage', 'ableitung']),
  beleg: z.string().min(1).max(300),
  begruendung: z.string().max(300).nullable(),
  nachricht: z.number().int().min(0),
};
export const Herkunft = z.object(herkunft).strict();
const fakt = <T extends z.ZodType>(wert: T) => z.object({ wert, ...herkunft }).strict();

export const Einkommen = z.object({
  betrag: z.number().positive(),
  einheit: z.enum(['chf_jahr', 'chf_monat']),
  basis: z.enum(['brutto', 'netto']).nullable(),
  monatsloehne: z.union([z.literal(12), z.literal(13)]).nullable(),
}).strict();

export const Bedarf = z.object({
  hoehe: z.number().nonnegative(),
  einheit: z.enum(['prozent', 'chf_jahr']),
}).strict();

export const Sparbetrag = z.object({
  betrag: z.number().nonnegative(),
  einheit: z.enum(['chf_jahr', 'chf_monat']),
}).strict();

export const BEZIEHUNGEN = ['ledig', 'verheiratet', 'eingetragene_partnerschaft', 'konkubinat', 'geschieden', 'verwitwet'] as const;
export const ERWERB = ['angestellt', 'selbststaendig', 'nicht_erwerbstaetig'] as const;
export const PLANARTEN = ['wiedereinstieg', 'pensumaenderung', 'stellenwechsel', 'familienzuwachs', 'wohneigentum', 'fruehpensionierung', 'pensionierung', 'sonstiges'] as const;
// What a concern is about. Used to follow each concern through the advisory and to decide which topics are relevant.
export const ANLIEGEN_THEMEN = ['absicherung', 'familie', 'eigenheim', 'pensionierung', 'sparen', 'sonstiges'] as const;

// Today's situation only. Future intentions belong in `plaene`.
export const Person = z.object({
  geschlecht: fakt(z.enum(['weiblich', 'maennlich'])).optional(),
  geburtsjahr: fakt(z.number().int()).optional(),
  erwerb: fakt(z.enum(ERWERB)).optional(),
  pensumProzent: fakt(z.number().int().min(0).max(100)).optional(),
  einkommen: fakt(Einkommen).optional(),
  // 2nd pillar: insured with a pension fund.
  bvgVersichert: fakt(z.boolean()).optional(),
  // 3rd pillar: has a pillar 3a account or policy, and its approximate balance.
  saeule3a: fakt(z.boolean()).optional(),
  saeule3aGuthaben: fakt(z.number().nonnegative()).optional(),
  // Existing private cover (outside the pension fund). 0 means: explicitly none.
  todesfallkapital: fakt(z.number().nonnegative()).optional(),
  erwerbsunfaehigkeitsrente: fakt(z.number().nonnegative()).optional(),
  // Income the household needs if this person can no longer work / dies.
  bedarfInvaliditaet: fakt(Bedarf).optional(),
  bedarfTodesfall: fakt(Bedarf).optional(),
}).strict();

export const Kind = z.object({
  id: z.string(),
  bezeichnung: z.enum(['Tochter', 'Sohn', 'Kind']),
  herkunft: Herkunft,
  geburtsjahr: fakt(z.number().int()).optional(),
  elternteil: fakt(z.enum(['beide', 'A', 'B'])).optional(),
  alleinigesSorgerecht: fakt(z.boolean()).optional(),
}).strict();

// Structured so that a later timeline can place and move plans; `text` keeps the customer's wording.
export const Zeitpunkt = z.object({
  jahr: z.number().int(),
  monat: z.number().int().min(1).max(12).nullable(),
  text: z.string().max(80).nullable(),
}).strict();

export const Plan = z.object({
  id: z.string(),
  art: z.enum(PLANARTEN),
  person: z.enum(['A', 'B', 'haushalt']),
  beschreibung: z.string().min(1).max(200),
  herkunft: Herkunft,
  zeitpunkt: fakt(Zeitpunkt).optional(),
  pensumProzent: fakt(z.number().int().min(0).max(100)).optional(),
  einkommen: fakt(Einkommen).optional(),
  sicherheit: fakt(z.enum(['fest', 'geplant', 'unsicher'])).optional(),
  // Retirement plans: desired age of stopping work.
  alter: fakt(z.number().int().min(50).max(75)).optional(),
  // Home ownership plans: approximate purchase price.
  kaufpreis: fakt(z.number().positive()).optional(),
}).strict();

export const Anliegen = z.object({
  id: z.string(),
  text: z.string().min(1).max(300),
  thema: z.enum(ANLIEGEN_THEMEN),
  herkunft: Herkunft,
}).strict();

export const Profil = z.object({
  anliegen: z.array(Anliegen).max(10),
  haushalt: z.object({
    beziehung: fakt(z.enum(BEZIEHUNGEN)).optional(),
    beziehungSeitJahr: fakt(z.number().int()).optional(),
    hatKinder: fakt(z.boolean()).optional(),
    gemeinsamerHaushalt: fakt(z.boolean()).optional(),
    wohnen: fakt(z.enum(['miete', 'eigentum'])).optional(),
    hypothek: fakt(z.number().nonnegative()).optional(),
    // Freely available savings today and what the household can save regularly.
    vermoegen: fakt(z.number().nonnegative()).optional(),
    sparbetrag: fakt(Sparbetrag).optional(),
    // Income the household wants in retirement.
    bedarfAlter: fakt(Bedarf).optional(),
  }).strict(),
  personen: z.object({ A: Person, B: Person.optional() }).strict(),
  kinder: z.array(Kind).max(10),
  plaene: z.array(Plan).max(20),
  naechsteId: z.object({ anliegen: z.number().int(), kind: z.number().int(), plan: z.number().int() }).strict(),
}).strict();

export type Herkunft = z.infer<typeof Herkunft>;
export type Einkommen = z.infer<typeof Einkommen>;
export type Bedarf = z.infer<typeof Bedarf>;
export type Sparbetrag = z.infer<typeof Sparbetrag>;
export type Zeitpunkt = z.infer<typeof Zeitpunkt>;
export type Person = z.infer<typeof Person>;
export type Kind = z.infer<typeof Kind>;
export type Plan = z.infer<typeof Plan>;
export type Anliegen = z.infer<typeof Anliegen>;
export type AnliegenThema = (typeof ANLIEGEN_THEMEN)[number];
export type Profil = z.infer<typeof Profil>;
export type PersonId = 'A' | 'B';

export const leeresProfil = (): Profil => ({
  anliegen: [],
  haushalt: {},
  personen: { A: {} },
  kinder: [],
  plaene: [],
  naechsteId: { anliegen: 1, kind: 1, plan: 1 },
});

export const PAAR_BEZIEHUNGEN: ReadonlySet<string> = new Set(['verheiratet', 'eingetragene_partnerschaft', 'konkubinat']);
export const istPaar = (profil: Profil) => PAAR_BEZIEHUNGEN.has(profil.haushalt.beziehung?.wert ?? '');
export const personLabel = (id: PersonId) => (id === 'A' ? 'Person A (du)' : 'Person B (Partner/in)');
export const kindLabel = (profil: Profil, kind: Kind) => `${kind.bezeichnung} ${profil.kinder.indexOf(kind) + 1}`;
/** Adults that belong to the household calculation: A, and B only in a couple relationship. */
export const erwachsene = (profil: Profil): PersonId[] => (istPaar(profil) ? ['A', 'B'] : ['A']);
export const sparbetragJahr = (s: Sparbetrag) => (s.einheit === 'chf_jahr' ? s.betrag : s.betrag * 12);
