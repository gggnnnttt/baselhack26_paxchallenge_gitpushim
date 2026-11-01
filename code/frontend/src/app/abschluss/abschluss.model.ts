import type { EmpfehlungenAntwort } from '../empfehlungen/empfehlungen.model';

export type Empfehlung = EmpfehlungenAntwort['empfehlungen'][number];

// The packages the customer chose on the recommendations page, with the reasoning Pax gave for them.
export interface Auswahl {
  pakete: Empfehlung[];
  regelHinweis: string;
  statusText: string;
  revision: number;
  gewaehltAm: Date;
}

// A demo application: nothing leaves the browser, no contract is created.
export interface Antrag extends Auswahl {
  nummer: string;
  beginn: { jahr: number; monat: number };
  eingereichtAm: Date;
}

// The pages of the flow: advice → recommendation → application → policy in the customer portal.
export type Seite = 'beratung' | 'empfehlungen' | 'abschluss' | 'portal';

export const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const monatJahr = (b: { jahr: number; monat: number }) => `${MONATE[b.monat - 1]} ${b.jahr}`;

// Pension products, insurance and the advice appointment read differently in the portal.
export const istTermin = (p: Empfehlung) => p.produkt.id === 'pax-beratung';
