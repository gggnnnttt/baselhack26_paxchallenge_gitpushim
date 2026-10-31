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
// Plans can also be placed by the customer in the timeline, outside the chat; then there is no quote from a message.
const planHerkunft = { ...herkunft, quelle: z.enum(['aussage', 'ableitung', 'zeitstrahl']) };
export const PlanHerkunft = z.object(planHerkunft).strict();
const planFakt = <T extends z.ZodType>(wert: T) => z.object({ wert, ...planHerkunft }).strict();

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

export const BEZIEHUNGEN = ['ledig', 'verheiratet', 'eingetragene_partnerschaft', 'konkubinat', 'geschieden', 'verwitwet'] as const;
export const ERWERB = ['angestellt', 'selbststaendig', 'nicht_erwerbstaetig'] as const;
export const PLANARTEN = ['wiedereinstieg', 'pensumaenderung', 'stellenwechsel', 'familienzuwachs', 'wohneigentum', 'fruehpensionierung', 'pensionierung', 'sonstiges'] as const;

// First release: one existing private disability pension per person. These are
// customer declarations, not verified contractual entitlement or medical data.
export const PrivateEu = z.object({
  vorhanden: fakt(z.boolean()).optional(),
  jahresrente: fakt(z.number().nonnegative()).optional(),
  deckung: fakt(z.enum(['krankheit', 'unfall', 'beides'])).optional(),
  wartefristMonate: fakt(z.number().int().min(0).max(120)).optional(),
  leistungsendeAlter: fakt(z.number().int().min(18).max(100)).optional(),
  zusaetzlichBestaetigt: fakt(z.boolean()).optional(),
  mehrereVertraege: fakt(z.boolean()).optional(),
}).strict();
export type PrivateEu = z.infer<typeof PrivateEu>;

// Today's situation only. Future intentions belong in `plaene`.
export const Person = z.object({
  geschlecht: fakt(z.enum(['weiblich', 'maennlich'])).optional(),
  geburtsjahr: fakt(z.number().int()).optional(),
  erwerb: fakt(z.enum(ERWERB)).optional(),
  pensumProzent: fakt(z.number().int().min(0).max(100)).optional(),
  einkommen: fakt(Einkommen).optional(),
  bvgVersichert: fakt(z.boolean()).optional(),
  // Income the household needs if this person can no longer work / dies.
  bedarfInvaliditaet: fakt(Bedarf).optional(),
  bedarfTodesfall: fakt(Bedarf).optional(),
  // Scenario inputs, not changes to today's employment situation.
  pensionierungsalter: fakt(z.number().int().min(50).max(80)).optional(),
  pkAltersrente: fakt(z.number().nonnegative()).optional(),
  pkGuthaben: fakt(z.number().nonnegative()).optional(),
  privateEu: PrivateEu.optional(),
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
  herkunft: PlanHerkunft,
  zeitpunkt: planFakt(Zeitpunkt).optional(),
  pensumProzent: planFakt(z.number().int().min(0).max(100)).optional(),
  einkommen: planFakt(Einkommen).optional(),
  sicherheit: planFakt(z.enum(['fest', 'geplant', 'unsicher'])).optional(),
  // Free text from the timeline, e.g. "wir wollen dafür nach Baselland ziehen". Customer wording, given to the model as data.
  notiz: z.string().min(1).max(500).optional(),
}).strict();

export const Anliegen = z.object({
  id: z.string(),
  text: z.string().min(1).max(300),
  herkunft: Herkunft,
}).strict();

export const Profil = z.object({
  anliegen: z.array(Anliegen).max(10),
  haushalt: z.object({
    beziehung: fakt(z.enum(BEZIEHUNGEN)).optional(),
    beziehungSeitJahr: fakt(z.number().int()).optional(),
    hatKinder: fakt(z.boolean()).optional(),
    gemeinsamerHaushalt: fakt(z.boolean()).optional(),
    bedarfPensionierung: fakt(Bedarf).optional(),
    vermoegenPensionierung: fakt(z.number().nonnegative()).optional(),
    pensionierungBasisBestaetigt: fakt(z.boolean()).optional(),
    budgetPensionierungMonat: fakt(z.number().nonnegative().max(1_000_000)).optional(),
  }).strict(),
  personen: z.object({ A: Person, B: Person.optional() }).strict(),
  kinder: z.array(Kind).max(10),
  plaene: z.array(Plan).max(20),
  naechsteId: z.object({ anliegen: z.number().int(), kind: z.number().int(), plan: z.number().int() }).strict(),
}).strict();

export type Herkunft = z.infer<typeof Herkunft>;
export type PlanHerkunft = z.infer<typeof PlanHerkunft>;
export type Einkommen = z.infer<typeof Einkommen>;
export type Bedarf = z.infer<typeof Bedarf>;
export type Zeitpunkt = z.infer<typeof Zeitpunkt>;
export type Person = z.infer<typeof Person>;
export type Kind = z.infer<typeof Kind>;
export type Plan = z.infer<typeof Plan>;
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
