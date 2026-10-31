import { Component, computed, input } from '@angular/core';
import { JsonPipe, NgTemplateOutlet } from '@angular/common';
import type { Aktion, Bedarf, Beratungsstand, Einkommen, Fakt, Herkunft, Person, Rechnung } from './beratungsstand.model';

interface Zeile { label: string; wert: string; herkunft?: Herkunft }

const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;
const einkommen = (e: Einkommen) =>
  `${chf(e.betrag)} / ${e.einheit === 'chf_jahr' ? 'Jahr' : 'Monat'} ${e.basis ?? '(brutto/netto offen)'}${e.monatsloehne ? `, ${e.monatsloehne}×` : ''}`;
const bedarf = (b: Bedarf) => (b.einheit === 'prozent' ? `${b.hoehe} % des Einkommens` : `${chf(b.hoehe)} / Jahr`);
const janein = (w: boolean) => (w ? 'ja' : 'nein');
const keineOder = (w: number, suffix = '') => (w === 0 ? 'keine' : `${chf(w)}${suffix}`);
const ERWERB = { angestellt: 'angestellt', selbststaendig: 'selbstständig', nicht_erwerbstaetig: 'nicht erwerbstätig' } as const;

export const AKTION_LABEL: Record<Aktion, string> = {
  nachfragen: 'Nachfragen',
  erklaeren: 'Erklären',
  szenario_zeigen: 'Szenario zeigen',
  empfehlung_vorbereiten: 'Empfehlung vorbereiten',
  beratungsperson: 'Persönliche Beratung',
};
const STATUS_LABEL: Record<Rechnung['status'], string> = {
  unvollstaendig: 'Angaben fehlen',
  bereit: 'bereit (kein APICalc-Zugang)',
  berechnet: 'berechnet',
  veraltet: 'veraltet',
  fehlgeschlagen: 'fehlgeschlagen',
};

function zeile<T>(label: string, fakt: Fakt<T> | undefined, format: (wert: T) => string): Zeile[] {
  return fakt ? [{ label, wert: format(fakt.wert), herkunft: fakt }] : [];
}

function personZeilen(person: Person): Zeile[] {
  return [
    ...zeile('Geschlecht', person.geschlecht, w => (w === 'maennlich' ? 'männlich' : 'weiblich')),
    ...zeile('Jahrgang', person.geburtsjahr, String),
    ...zeile('Erwerb', person.erwerb, w => ERWERB[w]),
    ...zeile('Pensum', person.pensumProzent, w => `${w} %`),
    ...zeile('Einkommen', person.einkommen, einkommen),
    ...zeile('2. Säule', person.bvgVersichert, w => (w ? 'Pensionskasse' : 'keine Pensionskasse')),
    ...zeile('3. Säule', person.saeule3a, w => (w ? 'Säule 3a' : 'keine Säule 3a')),
    ...zeile('Guthaben 3a', person.saeule3aGuthaben, chf),
    ...zeile('Todesfallkapital privat', person.todesfallkapital, w => keineOder(w)),
    ...zeile('EU-Rente privat', person.erwerbsunfaehigkeitsrente, w => keineOder(w, ' / Jahr')),
    ...zeile('Bedarf Erwerbsunfähigkeit', person.bedarfInvaliditaet, bedarf),
    ...zeile('Bedarf Todesfall', person.bedarfTodesfall, bedarf),
  ];
}

@Component({
  selector: 'app-beratungsstand',
  imports: [JsonPipe, NgTemplateOutlet],
  templateUrl: './beratungsstand.html',
  styleUrl: './beratungsstand.scss',
})
export class BeratungsstandPanel {
  readonly stand = input<Beratungsstand | null>(null);

  protected readonly chf = chf;
  protected readonly aktionLabel = AKTION_LABEL;
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly haushalt = computed<Zeile[]>(() => {
    const h = this.stand()?.profil.haushalt;
    if (!h) return [];
    return [
      ...zeile('Beziehung', h.beziehung, w => w.replace('_', ' ')),
      ...zeile('Seit', h.beziehungSeitJahr, String),
      ...zeile('Kinder', h.hatKinder, w => (w ? 'ja' : 'keine')),
      ...zeile('Gemeinsamer Haushalt', h.gemeinsamerHaushalt, janein),
      ...zeile('Wohnen', h.wohnen, w => (w === 'miete' ? 'Miete' : 'Eigentum')),
      ...zeile('Hypothek', h.hypothek, chf),
      ...zeile('Ersparnisse', h.vermoegen, chf),
      ...zeile('Sparbetrag', h.sparbetrag, w => `${chf(w.betrag)} / ${w.einheit === 'chf_monat' ? 'Monat' : 'Jahr'}`),
      ...zeile('Bedarf im Alter', h.bedarfAlter, bedarf),
    ];
  });

  protected readonly personen = computed(() => {
    const p = this.stand()?.profil.personen;
    if (!p) return [];
    return [
      { titel: 'Person A (du)', zeilen: personZeilen(p.A) },
      ...(p.B ? [{ titel: 'Person B (Partner/in)', zeilen: personZeilen(p.B) }] : []),
    ].filter(person => person.zeilen.length > 0);
  });

  protected readonly kinder = computed(() => (this.stand()?.profil.kinder ?? []).map((kind, index) => ({
    titel: `${kind.bezeichnung} ${index + 1}`,
    herkunft: kind.herkunft,
    zeilen: [
      ...zeile('Jahrgang', kind.geburtsjahr, String),
      ...zeile('Elternteil', kind.elternteil, w => (w === 'beide' ? 'gemeinsames Kind' : `nur Person ${w}`)),
      ...zeile('Alleiniges Sorgerecht', kind.alleinigesSorgerecht, janein),
    ],
  })));

  protected readonly plaene = computed(() => (this.stand()?.profil.plaene ?? []).map(plan => ({
    titel: plan.beschreibung,
    untertitel: `${plan.art} · ${plan.person === 'haushalt' ? 'Haushalt' : `Person ${plan.person}`}`,
    herkunft: plan.herkunft,
    zeilen: [
      ...zeile('Zeitpunkt', plan.zeitpunkt, w => `${w.monat ? `${String(w.monat).padStart(2, '0')}/` : ''}${w.jahr}${w.text ? ` („${w.text}“)` : ''}`),
      ...zeile('Pensum', plan.pensumProzent, w => `${w} %`),
      ...zeile('Einkommen', plan.einkommen, einkommen),
      ...zeile('Alter', plan.alter, String),
      ...zeile('Kaufpreis', plan.kaufpreis, chf),
      ...zeile('Sicherheit', plan.sicherheit, String),
    ],
  })));

  /** Calculations that have a result, and those that are still being prepared. */
  protected readonly ergebnisse = computed(() => (this.stand()?.stand.rechnungen ?? []).filter(r => r.ergebnis));
  protected readonly inArbeit = computed(() => (this.stand()?.stand.rechnungen ?? []).filter(r => !r.ergebnis && (r.pruefung.vorhanden.length > 0 || r.planId)));

  protected herkunftText(herkunft: Herkunft): string {
    return `„${herkunft.beleg}“ (Nachricht ${Math.floor(herkunft.nachricht / 2) + 1})${herkunft.begruendung ? ` – abgeleitet: ${herkunft.begruendung}` : ''}`;
  }

  protected betrag(wert: number | undefined): string {
    return wert === undefined ? '–' : chf(wert);
  }

  protected istNeu(r: Rechnung): boolean {
    return this.stand()?.schritt?.rechnungen.includes(r.id) ?? false;
  }
}
