import type { Profil } from '../profil/profil.js';
import type { SparStand } from './sparen.js';

export interface BudgetAbgleich {
  status: 'wartet' | 'offen' | 'ausreichend' | 'unterdeckung' | 'kein_bedarf';
  statusText: string;
  sparbedarfMonat: number | null;
  verfuegbarMonat: number | null;
  fehlbetragMonat: number | null;
  restbudgetMonat: number | null;
  hinweise: string[];
}

// Derived from the current saving result and the customer's declared additional
// household budget. No independent API call or inferred disposable income.
export function gleicheBudgetAb(profil: Profil, sparen: SparStand): BudgetAbgleich {
  const budget = profil.haushalt.budgetPensionierungMonat?.wert;
  const result: BudgetAbgleich = {
    status: 'wartet', statusText: 'Ein aktueller monatlicher Sparbedarf wird für den Budgetabgleich benötigt.',
    sparbedarfMonat: null, verfuegbarMonat: budget ?? null, fehlbetragMonat: null, restbudgetMonat: null,
    hinweise: [
      'Erster Budgetabgleich anhand einer Selbstauskunft, keine umfassende Tragfähigkeitsprüfung.',
      'Das Budget ist zusätzlich nach laufenden Ausgaben, bestehenden Sparverpflichtungen und einer Reserve für die Pensionierung verfügbar. Vorhandenes Kapital wird nicht nochmals angerechnet.',
      'Ein passender Monatsbetrag bestätigt weder dauerhaftes Einkommen noch die Eignung eines Produkts oder eine garantierte Zielerreichung.',
    ],
  };
  if (sparen.phase === 'kein_bedarf') return { ...result, status: 'kein_bedarf', statusText: 'Für dieses Modellziel ist kein zusätzlicher Sparbetrag nötig. Daraus folgt keine vollständige finanzielle Absicherung.', sparbedarfMonat: 0, fehlbetragMonat: 0 };
  if (sparen.phase !== 'berechnet' || !sparen.ergebnis) return result;
  const rate = sparen.ergebnis.monatlicherSparbetrag;
  if (!Number.isFinite(rate) || rate < 0) return result;
  // Compare cents, matching monetary display rather than binary floating point.
  const rateCents = Math.round(rate * 100);
  result.sparbedarfMonat = rateCents / 100;
  if (budget === undefined) return { ...result, status: 'offen', statusText: 'Der Sparbedarf liegt vor. Das zusätzlich verfügbare Monatsbudget ist noch nicht bekannt.' };
  const differenz = Math.round(budget * 100) - rateCents;
  return { ...result, status: differenz >= 0 ? 'ausreichend' : 'unterdeckung',
    statusText: differenz >= 0 ? 'Der Sparbedarf liegt innerhalb deines angegebenen zusätzlichen Monatsbudgets.' : 'Dein angegebenes zusätzliches Monatsbudget reicht für diesen Sparbedarf noch nicht aus.',
    fehlbetragMonat: Math.max(0, -differenz) / 100, restbudgetMonat: Math.max(0, differenz) / 100 };
}
