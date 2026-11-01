import type { Profil } from '../beratungsstand/beratungsstand.model';

export type Plan = Profil['plaene'][number];
export type PlanPerson = Plan['person'];

// Mirrors ZeitstrahlAktion in backend/src/beratung/zeitstrahl.ts.
export interface PlanSpeichern {
  typ: 'speichern';
  plan: string | null;
  art: PlanArt;
  person: PlanPerson;
  beschreibung: string;
  jahr: number | null;
  monat: number | null;
  notiz: string;
}
export type ZeitstrahlAktion = PlanSpeichern | { typ: 'entfernen'; plan: string };

// Same order and keys as PLANARTEN in backend/src/profil/profil.ts. Icons are 24×24 stroke paths.
export const PLANARTEN = {
  wohneigentum: { label: 'Wohneigentum', vorschlag: 'Haus kaufen', icon: 'M3 11 12 3l9 8M5 9.5V21h14V9.5M10 21v-6h4v6' },
  familienzuwachs: { label: 'Familienzuwachs', vorschlag: 'Weiteres Kind', icon: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z' },
  wiedereinstieg: { label: 'Wiedereinstieg', vorschlag: 'Wieder arbeiten', icon: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16' },
  pensumaenderung: { label: 'Pensumänderung', vorschlag: 'Pensum ändern', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2' },
  stellenwechsel: { label: 'Stellenwechsel', vorschlag: 'Neue Stelle', icon: 'M4 8h14l-4-4M20 16H6l4 4' },
  fruehpensionierung: { label: 'Frühpensionierung', vorschlag: 'Früher in Pension', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2' },
  pensionierung: { label: 'Pensionierung', vorschlag: 'Pensionierung', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5' },
  sonstiges: { label: 'Sonstiges', vorschlag: '', icon: 'M5 21V4h11l-2 4 2 4H5' },
} as const;
export type PlanArt = keyof typeof PLANARTEN;
export const PLANART_LISTE = Object.keys(PLANARTEN) as PlanArt[];

export const PERSONEN: Record<PlanPerson, string> = { A: 'Sie', B: 'Partner/in', haushalt: 'Haushalt' };

export const zuSpeichern = (plan: Plan, werte: Partial<PlanSpeichern> = {}): PlanSpeichern => ({
  typ: 'speichern',
  plan: plan.id,
  art: plan.art as PlanArt,
  person: plan.person,
  beschreibung: plan.beschreibung,
  jahr: plan.zeitpunkt?.wert.jahr ?? null,
  monat: plan.zeitpunkt?.wert.monat ?? null,
  notiz: plan.notiz ?? '',
  ...werte,
});
