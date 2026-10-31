import { z } from 'zod';
import { istPaar, personLabel, type Profil, type PersonId } from '../profil/profil.js';
import { bruttoJahr, type Angabe } from './risiko.js';

// APICalc v1.2. First release deliberately uses zero future saving and zero interest:
// the specification does not explain the unit of Saving. Never guess a non-zero value.
const PersonRequest = z.object({
  Sex: z.union([z.literal(1), z.literal(2)]), BirthYear: z.number().int(),
  GrossIncome: z.number().nonnegative(), WithBVG: z.boolean(),
  DesiredRetirementAge: z.number().int().min(50).max(80),
  RetirementPillar2: z.object({ Pension: z.number().nonnegative(), CurrentCapital: z.number().nonnegative() }).strict(),
}).strict();
export const RetirementRequest = z.object({
  Relationship: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  RelationshipSinceYear: z.number().int(), Person1: PersonRequest, Person2: PersonRequest.optional(),
  CurrentFortune: z.number().nonnegative(), InterestRate: z.literal(0), Saving: z.literal(0),
  NeedInPcRetirement: z.boolean(), NeedRetirement: z.number().nonnegative(), LiveSpan: z.literal(88),
}).strict();
export const RetirementResponse = z.object({ response: z.object({
  ErrorCode: z.number().int(),
  GrossIncome: z.number().optional(), IncomeNeed: z.number().optional(), IncomeGap: z.number().optional(),
  IncomeTotal: z.number().optional(), IncomePillar1: z.number().optional(), IncomePillar2: z.number().optional(),
  IncomeWithdrawal: z.number().optional(), AvailableFortune: z.number().optional(),
  CapitalNeed: z.number().optional(), CapitalGap: z.number().optional(),
}).superRefine((value, ctx) => {
  if (value.ErrorCode === 1) for (const key of ['IncomeNeed', 'IncomeGap', 'IncomeTotal', 'IncomePillar1', 'IncomePillar2', 'IncomeWithdrawal', 'AvailableFortune', 'CapitalNeed', 'CapitalGap'] as const) {
    if (value[key] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Erfolgreiche Berechnung ohne Ergebnisfeld.' });
  }
}) });
export type RetirementRequest = z.infer<typeof RetirementRequest>;
export type RetirementResponse = z.infer<typeof RetirementResponse>;
export interface PensionierungsRechner { berechnePensionierung(request: RetirementRequest): Promise<RetirementResponse> }
export interface PensionierungsPruefung {
  bereit: boolean; vorhanden: Angabe[]; fehlend: Angabe[]; hinweise: string[];
  request: RetirementRequest | null; requestJson: string | null;
}
export type PensionierungsPhase = 'erfassung' | 'bereit' | 'berechnet' | 'fehlgeschlagen';
export interface PensionierungsStand {
  phase: PensionierungsPhase; pruefung: PensionierungsPruefung;
  berechnung: { requestJson: string; antwort: RetirementResponse; zeitpunkt: string } | null;
  fehler: string | null;
}
const beziehungen = { ledig: 1, geschieden: 1, verwitwet: 1, verheiratet: 2, konkubinat: 3, eingetragene_partnerschaft: 4 } as const;
export function pruefePensionierung(profil: Profil, jahr: number): PensionierungsPruefung {
  const vorhanden: Angabe[] = [], fehlend: Angabe[] = [];
  const hinweise = [
    'Basisrechnung: keine weiteren Sparbeiträge, 0 % Verzinsung in Aufbau und Verzehr, Planungshorizont Alter 88. Keine Renditeprognose.',
    'Nur ausdrücklich für die Pensionierung vorgesehenes Vermögen ohne PK-Guthaben verwenden. Mittel für Eigenheim und Notreserve nicht nochmals mitzählen.',
    'AHV-Beitragsverlauf, Steuern, Inflation, Bezugsregeln einzelner 3a-Verträge und zukünftige Gesetzesänderungen sind nicht individuell erfasst.',
    'PK-Altersrente und Guthaben werden als Eingaben übernommen. Bezugsalter der PK-Rente und Behandlung unterschiedlicher Pensionierungsalter mit Pax/Logismata bestätigen.',
  ];
  const fehlt = (label: string, warum: string) => fehlend.push({ label, warum });
  const da = (label: string, wert: string) => vorhanden.push({ label, wert });
  const h = profil.haushalt, paar = istPaar(profil);
  if (!h.beziehung) fehlt('Beziehungsstatus', 'Bestimmt die Berechnung für eine Person oder einen Haushalt.');
  else da('Beziehung', h.beziehung.wert);
  if (paar && !h.beziehungSeitJahr) fehlt('Jahr der Heirat / Beginn der Partnerschaft', 'RelationshipSinceYear ist eine API-Pflichtangabe.');
  if (h.beziehungSeitJahr) da('Beziehungsjahr', String(h.beziehungSeitJahr.wert));
  if (h.beziehung && !paar) hinweise.push('Für Alleinstehende wird das aktuelle Jahr als undokumentiertes Beziehungsjahr gesendet; frühere Eheansprüche sind nicht abgebildet.');
  const personen: Partial<Record<PersonId, z.infer<typeof PersonRequest>>> = {};
  for (const id of (paar ? ['A', 'B'] : ['A']) as PersonId[]) {
    const p = profil.personen[id] ?? {}, label = personLabel(id);
    if (!p.geschlecht) fehlt(`Geschlecht ${label}`, 'API-Pflichtangabe.');
    if (!p.geburtsjahr) fehlt(`Geburtsjahr ${label}`, 'Bestimmt die Zeit bis zur Pensionierung.');
    const brutto = p.einkommen ? bruttoJahr(p.einkommen.wert) : p.erwerb?.wert === 'nicht_erwerbstaetig' ? 0 : 'Bruttojahreseinkommen';
    if (typeof brutto !== 'number') fehlt(`${brutto} (${label})`, 'Einkommen wird nicht aus einem Nettobetrag geschätzt.');
    const bvg = p.bvgVersichert?.wert;
    if (bvg === undefined) fehlt(`Pensionskassenanschluss ${label}`, 'Bitte ausdrücklich bestätigen, auch bei Nichterwerbstätigkeit.');
    if (!p.pensionierungsalter) fehlt(`Gewünschtes Pensionierungsalter ${label}`, 'Wird als Szenario erfasst, nicht als heutige Erwerbsaufgabe.');
    else da(`Pensionierungsalter ${label}`, String(p.pensionierungsalter.wert));
    if (bvg === true && !p.pkAltersrente) fehlt(`PK-Altersrente ${label} in CHF pro Jahr`, 'Individueller Wert statt einer stillen Schätzung.');
    if (bvg === true && !p.pkGuthaben) fehlt(`Aktuelles PK-Guthaben ${label}`, 'Wird getrennt vom privaten Vermögen berücksichtigt.');
    if (bvg === false && ((p.pkAltersrente?.wert ?? 0) > 0 || (p.pkGuthaben?.wert ?? 0) > 0)) fehlt(`PK-Situation ${label} klären`, 'Ohne PK-Anschluss erfasste PK-/Freizügigkeitswerte können noch nicht korrekt zugeordnet werden.');
    if (p.pkAltersrente) da(`PK-Altersrente ${label}`, `CHF ${p.pkAltersrente.wert}/Jahr`);
    if (p.pkGuthaben) da(`PK-Guthaben ${label}`, `CHF ${p.pkGuthaben.wert}`);
    if (bvg && p.pkGuthaben?.wert === 0) hinweise.push(`${label}: CurrentCapital=0 führt laut API zu einer Approximation des PK-Guthabens.`);
    if (p.geschlecht && p.geburtsjahr && typeof brutto === 'number' && bvg !== undefined && p.pensionierungsalter) {
      personen[id] = { Sex: p.geschlecht.wert === 'maennlich' ? 1 : 2, BirthYear: p.geburtsjahr.wert,
        GrossIncome: brutto, WithBVG: bvg, DesiredRetirementAge: p.pensionierungsalter.wert,
        RetirementPillar2: { Pension: p.pkAltersrente?.wert ?? 0, CurrentCapital: p.pkGuthaben?.wert ?? 0 } };
    }
  }
  if (!h.bedarfPensionierung) fehlt('Gewünschtes Haushaltsbudget im Ruhestand', 'Als CHF pro Jahr oder Prozent des heutigen Einkommens angeben.');
  else da('Bedarf im Ruhestand', `${h.bedarfPensionierung.wert.hoehe} ${h.bedarfPensionierung.wert.einheit === 'prozent' ? '%' : 'CHF/Jahr'}`);
  if (!h.vermoegenPensionierung) fehlt('Heutiges privates Vermögen für die Pensionierung', 'Ohne PK-Guthaben, Hausbudget und Reserve; auch CHF 0 ausdrücklich angeben.');
  else da('Privates Vorsorgevermögen', `CHF ${h.vermoegenPensionierung.wert}`);
  if (h.pensionierungBasisBestaetigt?.wert !== true) fehlt('Annahmen der Basisrechnung bestätigen', 'Keine weiteren Sparbeiträge, 0 % Verzinsung und Planung bis Alter 88. Diese Modellannahmen müssen ausdrücklich akzeptiert werden.');
  else da('Basisannahmen bestätigt', '0 % Zins; keine weiteren Sparbeiträge; Planung bis 88');
  if (fehlend.length || !h.beziehung || !personen.A || !h.bedarfPensionierung || !h.vermoegenPensionierung) return { bereit: false, vorhanden, fehlend, hinweise, request: null, requestJson: null };
  const request = RetirementRequest.parse({ Relationship: beziehungen[h.beziehung.wert],
    RelationshipSinceYear: paar ? h.beziehungSeitJahr!.wert : jahr, Person1: personen.A,
    ...(paar ? { Person2: personen.B } : {}), CurrentFortune: h.vermoegenPensionierung.wert,
    InterestRate: 0, Saving: 0, NeedInPcRetirement: h.bedarfPensionierung.wert.einheit === 'prozent',
    NeedRetirement: h.bedarfPensionierung.wert.hoehe, LiveSpan: 88 });
  return { bereit: true, vorhanden, fehlend, hinweise, request, requestJson: JSON.stringify(request) };
}
export const startePensionierung = (profil: Profil, jahr: number): PensionierungsStand => ({
  phase: 'erfassung', pruefung: pruefePensionierung(profil, jahr), berechnung: null, fehler: null,
});
export async function aktualisierePensionierung(vorher: PensionierungsStand, profil: Profil, jahr: number, rechner: PensionierungsRechner | null): Promise<PensionierungsStand> {
  const pruefung = pruefePensionierung(profil, jahr);
  const stand: PensionierungsStand = { ...vorher, pruefung, fehler: null };
  if (!pruefung.bereit) return { ...stand, phase: 'erfassung' };
  if (vorher.berechnung?.requestJson === pruefung.requestJson) return { ...stand, phase: 'berechnet' };
  if (!rechner) return { ...stand, phase: 'bereit' };
  try {
    const antwort = RetirementResponse.parse(await rechner.berechnePensionierung(pruefung.request!));
    if (antwort.response.ErrorCode !== 1) {
      const fehler = ({ 2: 'Interner Berechnungsfehler.', 8: 'Person A ist bereits oder bald pensioniert.', 9: 'Person B ist bereits oder bald pensioniert.' } as Record<number, string>)[antwort.response.ErrorCode] ?? 'Unbekannter fachlicher Berechnungsfehler.';
      return { ...stand, phase: 'fehlgeschlagen', fehler };
    }
    return { ...stand, phase: 'berechnet', berechnung: { requestJson: pruefung.requestJson!, antwort, zeitpunkt: new Date().toISOString() } };
  } catch {
    // Never retain arbitrary provider exception text (may contain credentials or response data).
    return { ...stand, phase: 'fehlgeschlagen', fehler: 'Pensionierungsberechnung nicht verfügbar oder Antwort ungültig. Zugang und Verbindung prüfen.' };
  }
}
