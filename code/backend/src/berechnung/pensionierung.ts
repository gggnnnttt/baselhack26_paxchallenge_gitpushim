import { z } from 'zod';
import { erwachsene, istPaar, personLabel, sparbetragJahr, type Plan, type Profil } from '../profil/profil.js';
import { abschliessen, basisVollstaendig, bedarfText, chf, neuePruefung, pruefeBasisPerson, pruefeBeziehung, type PersonBasis, type Pruefung } from './basis.js';

// Request and response of APICalc_calculateRetirement (APICalc-swagger.yaml v1.2).
// `Saving` was verified against the API as CHF per year until retirement; InterestRate defaults to 0.
const RetirementPerson = z.object({
  Sex: z.union([z.literal(1), z.literal(2)]),
  BirthYear: z.number().int(),
  GrossIncome: z.number().nonnegative(),
  WithBVG: z.boolean(),
  DesiredRetirementAge: z.number().int().optional(),
}).strict();

export const RetirementRequest = z.object({
  Relationship: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  RelationshipSinceYear: z.number().int(),
  Person1: RetirementPerson,
  Person2: RetirementPerson.optional(),
  CurrentFortune: z.number().nonnegative().optional(),
  Saving: z.number().nonnegative().optional(),
  NeedInPcRetirement: z.boolean(),
  NeedRetirement: z.number().nonnegative(),
}).strict();

const zahl = z.number().optional();
export const RetirementResponse = z.object({ response: z.object({
  ErrorCode: zahl, GrossIncome: zahl, IncomeNeed: zahl, IncomeGap: zahl, IncomeTotal: zahl, IncomePillar1: zahl, IncomePillar2: zahl,
  IncomeWithdrawal: zahl, AvailableFortune: zahl, CapitalNeed: zahl, CapitalGap: zahl,
}) });

export type RetirementRequest = z.infer<typeof RetirementRequest>;
export type RetirementResponse = z.infer<typeof RetirementResponse>;

/** Retirement at the regular age, or with the desired age from a retirement plan. */
export function pruefePensionierung(profil: Profil, jahr: number, plan: Plan | null = null): Pruefung<RetirementRequest> {
  const p = neuePruefung<RetirementRequest>();
  const beziehung = pruefeBeziehung(profil, jahr, p);
  const personen = erwachsene(profil).map(id => {
    const basis: Partial<PersonBasis> & { DesiredRetirementAge?: number } = pruefeBasisPerson(profil.personen[id] ?? {}, id, p);
    if (plan && (plan.person === id || plan.person === 'haushalt')) {
      const geburtsjahr = profil.personen[id]?.geburtsjahr?.wert;
      if (plan.alter) {
        basis.DesiredRetirementAge = plan.alter.wert;
        p.vorhanden.push({ label: `Gewünschtes Pensionierungsalter ${personLabel(id)}`, wert: String(plan.alter.wert), quelle: plan.alter.quelle });
      } else if (plan.zeitpunkt && geburtsjahr) {
        basis.DesiredRetirementAge = plan.zeitpunkt.wert.jahr - geburtsjahr;
        p.vorhanden.push({ label: `Gewünschtes Pensionierungsalter ${personLabel(id)}`, wert: `${basis.DesiredRetirementAge} (aus ${plan.zeitpunkt.wert.jahr} − Jahrgang ${geburtsjahr})`, quelle: 'backend' });
      } else {
        p.fehlend.push({ label: `Gewünschtes Pensionierungsalter ${personLabel(id)}`, warum: 'Bestimmt, ab wann Renten fliessen und wie lange Vermögen reichen muss.' });
      }
    }
    return basis;
  });

  const bedarf = profil.haushalt.bedarfAlter;
  if (bedarf) p.vorhanden.push({ label: 'Gewünschtes Einkommen im Alter', wert: bedarf.wert.einheit === 'prozent' ? `${bedarf.wert.hoehe} % des heutigen Haushaltseinkommens` : bedarfText(bedarf.wert), quelle: bedarf.quelle });
  else p.fehlend.push({ label: 'Gewünschtes Einkommen im Alter (in % des heutigen Einkommens oder CHF pro Jahr)', warum: 'Ohne Bedarf im Alter lässt sich keine Vorsorgelücke bestimmen. Viele planen mit 70–80 % des heutigen Einkommens.' });

  // Assets: freely available savings plus known pillar 3a balances. Missing values are named, not assumed.
  let vermoegen = 0;
  const vermoegenTeile: string[] = [];
  if (profil.haushalt.vermoegen) {
    vermoegen += profil.haushalt.vermoegen.wert;
    vermoegenTeile.push(`Ersparnisse ${chf(profil.haushalt.vermoegen.wert)}`);
  } else {
    p.optional.push({ label: 'Heutige Ersparnisse', warum: 'Vorhandenes Vermögen kann eine Lücke im Alter verkleinern.' });
  }
  for (const id of erwachsene(profil)) {
    const person = profil.personen[id];
    if (person?.saeule3aGuthaben) {
      vermoegen += person.saeule3aGuthaben.wert;
      vermoegenTeile.push(`Säule 3a ${personLabel(id)} ${chf(person.saeule3aGuthaben.wert)}`);
    } else if (person?.saeule3a?.wert) {
      p.optional.push({ label: `Guthaben Säule 3a ${personLabel(id)}`, warum: 'Das 3a-Guthaben steht im Alter zur Verfügung.' });
    } else if (!person?.saeule3a) {
      p.optional.push({ label: `Ob ${personLabel(id)} eine Säule 3a hat`, warum: 'Die 3. Säule gehört zur Altersvorsorge.' });
    }
  }
  const sparen = profil.haushalt.sparbetrag ? sparbetragJahr(profil.haushalt.sparbetrag.wert) : undefined;
  if (sparen !== undefined) p.vorhanden.push({ label: 'Sparbetrag bis zur Pensionierung', wert: `${chf(sparen)} pro Jahr`, quelle: profil.haushalt.sparbetrag!.quelle });
  else p.optional.push({ label: 'Regelmässiger Sparbetrag', warum: 'Was bis zur Pensionierung angespart wird, steht im Alter zur Verfügung.' });
  if (vermoegenTeile.length) p.vorhanden.push({ label: 'Vermögen heute', wert: `${chf(vermoegen)} (${vermoegenTeile.join(', ')})`, quelle: 'backend' });

  p.annahmen.push('Kein Zins auf Ersparnissen (APICalc-Standard); Sparbetrag bleibt bis zur Pensionierung gleich.');
  if (p.optional.length) p.hinweise.push(`Nicht berücksichtigt, weil unbekannt: ${p.optional.map(a => a.label).join(', ')}. Das Ergebnis kann die Lücke daher überschätzen.`);
  p.hinweise.push('Pensionskassenleistungen schätzt APICalc ohne Vorsorgeausweis. Pläne wie Pensumänderungen sind nicht berücksichtigt; es gilt das heutige Einkommen.');

  const vollstaendig = personen.every(basisVollstaendig);
  if (!beziehung || !bedarf || p.fehlend.length > 0 || !vollstaendig) return p;
  const [person1, person2] = personen as (PersonBasis & { DesiredRetirementAge?: number })[];
  return abschliessen(p, RetirementRequest.parse({
    ...beziehung,
    Person1: person1,
    ...(istPaar(profil) && person2 ? { Person2: person2 } : {}),
    ...(vermoegenTeile.length ? { CurrentFortune: vermoegen } : {}),
    ...(sparen !== undefined ? { Saving: sparen } : {}),
    NeedInPcRetirement: bedarf.wert.einheit === 'prozent',
    NeedRetirement: bedarf.wert.hoehe,
  }));
}

export interface Pensionsergebnis {
  fehler: string | null;
  einkommenHeute?: number; bedarf?: number; einnahmen?: number; ersteSaeule?: number; zweiteSaeule?: number;
  vermoegensverzehr?: number; luecke?: number; verfuegbaresVermoegen?: number; noetigesVermoegen?: number; kapitalLuecke?: number;
}

const FEHLER: Record<number, string> = { 2: 'interner Fehler der Berechnung', 8: 'Person A ist bereits oder bald pensioniert', 9: 'Person B ist bereits oder bald pensioniert' };

export const pensionsergebnis = ({ response: r }: RetirementResponse): Pensionsergebnis => ({
  fehler: r.ErrorCode && r.ErrorCode !== 1 ? FEHLER[r.ErrorCode] ?? `Fehlercode ${r.ErrorCode}` : null,
  einkommenHeute: r.GrossIncome, bedarf: r.IncomeNeed, einnahmen: r.IncomeTotal, ersteSaeule: r.IncomePillar1, zweiteSaeule: r.IncomePillar2,
  vermoegensverzehr: r.IncomeWithdrawal, luecke: r.IncomeGap, verfuegbaresVermoegen: r.AvailableFortune, noetigesVermoegen: r.CapitalNeed, kapitalLuecke: r.CapitalGap,
});
