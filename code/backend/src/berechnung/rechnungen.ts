import type { Plan, Profil } from '../profil/profil.js';
import type { Rechner } from './apicalc.js';
import type { Pruefung } from './basis.js';
import { berechneEigenheim, pruefeEigenheim, type EigenheimRequest, type Eigenheimergebnis } from './eigenheim.js';
import { FAMILIEN_PLANARTEN, pruefeFamilienSzenario } from './familie.js';
import { pensionsergebnis, pruefePensionierung, type Pensionsergebnis, type RetirementRequest } from './pensionierung.js';
import { pruefeRisiko, szenarien, type RiskRequest, type Szenario } from './risiko.js';

export type RechnungsArt = 'risiko' | 'familie' | 'eigenheim' | 'pensionierung';

/** One calculation the profile makes possible: today's risk, retirement, and one scenario per plan. */
export interface Rechnung {
  id: string;
  art: RechnungsArt;
  titel: string;
  planId: string | null;
  // APICalc calculations need access; the home ownership scenario runs locally.
  extern: boolean;
  pruefung: Pruefung<unknown>;
}

export type Ergebnis =
  | { art: 'risiko' | 'familie'; szenarien: Szenario[] }
  | { art: 'pensionierung'; pension: Pensionsergebnis }
  | { art: 'eigenheim'; eigenheim: Eigenheimergebnis };

/** Stored per calculation id. A result belongs to exactly the request it was computed from. */
export interface Gespeichert { requestJson: string; zeitpunkt: string; ergebnis: Ergebnis | null; fehler: string | null }

export const PENSIONS_PLANARTEN: ReadonlySet<Plan['art']> = new Set(['fruehpensionierung', 'pensionierung']);

export function alleRechnungen(profil: Profil, jahr: number): Rechnung[] {
  const liste: Rechnung[] = [
    { id: 'risiko', art: 'risiko', titel: 'Absicherung heute bei Erwerbsunfähigkeit und Tod', planId: null, extern: true, pruefung: pruefeRisiko(profil, jahr) },
    { id: 'pensionierung', art: 'pensionierung', titel: 'Pensionierung im ordentlichen Alter', planId: null, extern: true, pruefung: pruefePensionierung(profil, jahr) },
  ];
  for (const plan of profil.plaene) {
    if (FAMILIEN_PLANARTEN.has(plan.art)) {
      liste.push({ id: `familie:${plan.id}`, art: 'familie', titel: `Szenario: ${plan.beschreibung}`, planId: plan.id, extern: true, pruefung: pruefeFamilienSzenario(profil, plan, jahr) });
    } else if (plan.art === 'wohneigentum') {
      liste.push({ id: `eigenheim:${plan.id}`, art: 'eigenheim', titel: `Szenario: ${plan.beschreibung}`, planId: plan.id, extern: false, pruefung: pruefeEigenheim(profil, plan, jahr) });
    } else if (PENSIONS_PLANARTEN.has(plan.art)) {
      liste.push({ id: `pensionierung:${plan.id}`, art: 'pensionierung', titel: `Szenario: ${plan.beschreibung}`, planId: plan.id, extern: true, pruefung: pruefePensionierung(profil, jahr, plan) });
    }
  }
  return liste;
}

export async function fuehreAus(rechnung: Rechnung, rechner: Rechner | null): Promise<Ergebnis> {
  const request = rechnung.pruefung.request;
  if (!request) throw new Error('Die Angaben für diese Berechnung sind unvollständig.');
  switch (rechnung.art) {
    case 'eigenheim':
      return { art: 'eigenheim', eigenheim: berechneEigenheim(request as EigenheimRequest) };
    case 'risiko':
    case 'familie':
      if (!rechner) throw new Error('APICalc ist nicht konfiguriert.');
      return { art: rechnung.art, szenarien: szenarien(await rechner.berechneRisiko(request as RiskRequest)) };
    case 'pensionierung':
      if (!rechner) throw new Error('APICalc ist nicht konfiguriert.');
      return { art: 'pensionierung', pension: pensionsergebnis(await rechner.berechnePensionierung(request as RetirementRequest)) };
  }
}
