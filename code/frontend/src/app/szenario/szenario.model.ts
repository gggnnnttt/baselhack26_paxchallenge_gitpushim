import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
export interface Vergleichswerte {
  bedarfJahr: number; renteneinkommenJahr: number; vermoegensverzehrJahr: number;
  einkommenslueckeJahr: number; kapitalluecke: number; sparbedarfMonat: number;
  budget: Beratungsstand['budget']; zeitpunkt: string;
}
export interface SzenarioVergleich {
  id: string; revision: number; ausgangslage: Vergleichswerte; alternative: Vergleichswerte; hinweise: string[];
}
