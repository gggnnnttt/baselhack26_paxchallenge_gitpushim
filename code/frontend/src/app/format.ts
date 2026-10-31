// Number and date formats shared by the advisory views.
export const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;

export const betrag = (wert: number | undefined | null) => (wert === undefined || wert === null ? '–' : chf(wert));

// Monthly saving amounts are shown with centimes, as the calculator returns them.
export const sparbetrag = (wert: number) =>
  `CHF ${wert.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function datum(zeitpunkt: string): string {
  const d = new Date(zeitpunkt);
  return Number.isNaN(d.getTime()) ? zeitpunkt : d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
}
