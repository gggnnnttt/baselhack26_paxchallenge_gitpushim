import { z } from 'zod';
import type { PensionierungsStand } from './pensionierung.js';

// APICalc_calculateSaving: goal 2 solves the periodic investment. Zero interest
// keeps this additional scenario consistent with the confirmed retirement baseline.
export const SavingRequest = z.object({
  SavingGoal: z.literal(2), Duration: z.number().int().positive(),
  InitialInvestment: z.literal(0), InvestmentMonthly: z.literal(true),
  InterestRate: z.literal(0), EndCapital: z.number().positive(),
}).strict();
export const SavingResponse = z.object({ response: z.object({
  PeriodicInvestment: z.number().nonnegative(), GrossCapital: z.number().nonnegative(),
  Deposits: z.number().nonnegative(), Interest: z.number(), InterestRate: z.literal(0),
  DurationYears: z.number().int().nonnegative().optional(),
  DurationMonths: z.number().int().min(0).max(11).optional(),
}) });
export type SavingRequest = z.infer<typeof SavingRequest>;
export type SavingResponse = z.infer<typeof SavingResponse>;
export interface SparRechner { berechneSparen(request: SavingRequest): Promise<SavingResponse> }
export interface SparStand {
  phase: 'wartet' | 'bereit' | 'berechnet' | 'kein_bedarf' | 'nicht_moeglich' | 'fehlgeschlagen';
  phaseText: string; hinweise: string[]; fehler: string | null;
  zielkapital: number | null; zieljahr: number | null; dauerJahre: number | null;
  request: SavingRequest | null;
  ergebnis: { zeitpunkt: string; monatlicherSparbetrag: number; einzahlungen: number; endkapital: number } | null;
  // Cache also includes the retirement source, so changed assumptions cannot reuse old results.
  grundlageJson: string | null;
}
export function starteSparen(): SparStand {
  return { phase: 'wartet', phaseText: 'Ein aktuelles Pensionierungsergebnis wird benötigt.', hinweise: [
    'Zusätzliches Sparszenario mit 0 % Verzinsung, ohne Kosten, Steuern oder Inflation. Keine Produkt- oder Renditezusage.',
    'Startkapital CHF 0: Das vorhandene private Vorsorgevermögen ist bereits in der Kapitallücke berücksichtigt und wird nicht nochmals angerechnet.',
    'Spardauer näherungsweise in ganzen Jahren aus Jahrgang und Pensionierungsalter; bei Paaren bis zum ersten Rentenfall. Kein taggenauer Sparplan.',
    'Der Sparbetrag ist ein rechnerischer Zielbetrag. Der getrennte Budgetabgleich prüft nur die Passung zur Selbstauskunft, keine umfassende Tragbarkeit.',
    'Die API kann die monatliche Rate runden. Deshalb wird auch das daraus resultierende Endkapital ausgewiesen; es kann etwas über dem Ziel liegen.',
    'Das Szenario wird nicht als bereits vereinbarter Sparbeitrag in die Pensionierungs-Basisrechnung zurückgeschrieben.',
  ], fehler: null, zielkapital: null, zieljahr: null, dauerJahre: null, request: null, ergebnis: null, grundlageJson: null };
}
export async function aktualisiereSparen(vorher: SparStand, pensionierung: PensionierungsStand, jahr: number, rechner: SparRechner | null): Promise<SparStand> {
  const stand = starteSparen();
  const p = pensionierung.berechnung, request = pensionierung.pruefung.request;
  if (pensionierung.phase !== 'berechnet' || !p || !request || p.requestJson !== pensionierung.pruefung.requestJson) return stand;
  const zielkapital = p.antwort.response.CapitalGap;
  if (zielkapital === undefined || !Number.isFinite(zielkapital)) return { ...stand, phase: 'fehlgeschlagen', phaseText: 'Kapitallücke ist nicht verfügbar.', fehler: 'Keine gültige Kapitallücke im Pensionierungsergebnis.' };
  const zieljahr = Math.min(...[request.Person1, ...(request.Person2 ? [request.Person2] : [])].map(person => person.BirthYear + person.DesiredRetirementAge));
  const dauerJahre = zieljahr - jahr;
  const basis = { ...stand, zielkapital: Math.max(0, zielkapital), zieljahr, dauerJahre };
  if (zielkapital <= 0) return { ...basis, phase: 'kein_bedarf', phaseText: 'Keine zusätzliche Sparrate zur Deckung dieser modellierten Kapitallücke nötig.' };
  if (dauerJahre <= 0) return { ...basis, phase: 'nicht_moeglich', phaseText: 'Bis zum Zielzeitpunkt bleibt kein volles Sparjahr. Eine monatliche Sparrate kann so nicht abgeleitet werden.' };
  const sparRequest = SavingRequest.parse({ SavingGoal: 2, Duration: dauerJahre, InitialInvestment: 0, InvestmentMonthly: true, InterestRate: 0, EndCapital: zielkapital });
  const grundlageJson = JSON.stringify({ request: sparRequest, pensionierung: p.requestJson });
  if (vorher.phase === 'berechnet' && vorher.grundlageJson === grundlageJson) return vorher;
  const bereit = { ...basis, request: sparRequest, grundlageJson };
  if (!rechner) return { ...bereit, phase: 'bereit', phaseText: 'Sparberechnung vorbereitet – Rechner nicht konfiguriert.' };
  try {
    const result = SavingResponse.parse(await rechner.berechneSparen(sparRequest)).response;
    // With no initial investment or interest, monthly deposits must finance the target.
    // Reject valid-looking but unrelated/incorrect responses rather than explain them as a plan.
    const monate = dauerJahre * 12;
    // Live API rounds the rate to whole CHF (e.g. 335 rather than 334.856...);
    // tolerate at most CHF 1 extra per month, but do not silently accept underfunding.
    if (Math.abs(result.PeriodicInvestment * monate - result.Deposits) > 1
      || result.GrossCapital < zielkapital - 1 || result.GrossCapital > zielkapital + monate + 1
      || Math.abs(result.Interest) > 0.01
      || Math.abs(result.Deposits - result.GrossCapital) > 1) throw new Error('Unplausible Sparantwort.');
    return { ...bereit, phase: 'berechnet', phaseText: 'Monatlicher Sparbedarf aus der Pensionierungs-Kapitallücke berechnet.',
      ergebnis: { zeitpunkt: new Date().toISOString(), monatlicherSparbetrag: result.PeriodicInvestment,
        einzahlungen: result.Deposits, endkapital: result.GrossCapital } };
  } catch {
    return { ...bereit, phase: 'fehlgeschlagen', phaseText: 'Sparberechnung fehlgeschlagen.', fehler: 'Sparrechner nicht erreichbar oder Antwort ungültig. Es wird kein geschätzter Ersatzbetrag angezeigt.' };
  }
}
