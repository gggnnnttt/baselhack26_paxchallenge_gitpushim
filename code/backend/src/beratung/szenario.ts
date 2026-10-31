import { z } from 'zod';
import type { AblaufStand } from './ablauf.js';
import { gleicheBudgetAb, type BudgetAbgleich } from '../berechnung/budget.js';
import { Profil } from '../profil/profil.js';
import { GuardrailError } from '../guardrails.js';

export const SzenarioAnfrage = z.object({ sessionId: z.string().min(1).max(100), revision: z.number().int().nonnegative(), jahresbedarf: z.number().min(0).max(1_000_000) }).strict();
export const SzenarioUebernahme = z.object({ sessionId: z.string().min(1).max(100), revision: z.number().int().nonnegative(), szenarioId: z.string().uuid() }).strict();
export interface Vergleichswerte {
  bedarfJahr: number; renteneinkommenJahr: number; vermoegensverzehrJahr: number;
  einkommenslueckeJahr: number; kapitalluecke: number; sparbedarfMonat: number;
  budget: BudgetAbgleich; zeitpunkt: string;
}
export interface SzenarioVergleich {
  id: string; revision: number; ausgangslage: Vergleichswerte; alternative: Vergleichswerte;
  hinweise: string[];
}

// Accept only current, successful results from BOTH existing calculators. Unknown is never zero.
export function vergleichswerte(stand: AblaufStand): Vergleichswerte {
  const p = stand.pensionierung;
  const r = p.berechnung?.antwort.response;
  if (p.phase !== 'berechnet' || !p.berechnung || p.berechnung.requestJson !== p.pruefung.requestJson || !r || r.ErrorCode !== 1
    || !['berechnet', 'kein_bedarf'].includes(stand.sparen.phase)) {
    throw new GuardrailError('Für den Vergleich werden eine aktuelle Pensionierungs- und Sparberechnung benötigt.', 409);
  }
  const values = [r.IncomeNeed, r.IncomeTotal, r.IncomeWithdrawal, r.IncomeGap, r.CapitalGap];
  if (values.some(v => v === undefined || !Number.isFinite(v))) throw new GuardrailError('Das Berechnungsergebnis ist nicht vollständig. Bitte neu berechnen.', 503);
  const budget = gleicheBudgetAb(stand.kontext.profil, stand.sparen);
  if (budget.sparbedarfMonat === null) throw new GuardrailError('Der Sparbedarf konnte nicht berechnet werden.', 503);
  return { bedarfJahr: r.IncomeNeed!, renteneinkommenJahr: r.IncomeTotal! - r.IncomeWithdrawal!,
    vermoegensverzehrJahr: r.IncomeWithdrawal!, einkommenslueckeJahr: r.IncomeGap!, kapitalluecke: Math.max(0, r.CapitalGap!),
    sparbedarfMonat: budget.sparbedarfMonat, budget, zeitpunkt: p.berechnung.zeitpunkt };
}

export function szenarioProfil(stand: AblaufStand, jahresbedarf: number, nachricht: number) {
  const profil = structuredClone(stand.kontext.profil);
  const beleg = `Ich übernehme das berechnete Pensionierungsziel mit CHF ${jahresbedarf} Bedarf pro Jahr. Alle anderen Angaben bleiben gleich.`;
  profil.haushalt.bedarfPensionierung = {
    wert: { hoehe: jahresbedarf, einheit: 'chf_jahr' }, quelle: 'aussage', beleg,
    begruendung: null, nachricht,
  };
  return { profil: Profil.parse(profil), beleg };
}
