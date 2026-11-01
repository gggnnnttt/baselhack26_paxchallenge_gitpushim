import { Component, computed, effect, input, output, signal } from '@angular/core';
import { JsonPipe, NgTemplateOutlet } from '@angular/common';
import type { Bedarf, Beratungsstand, Einkommen, Fakt, Herkunft, Person } from './beratungsstand.model';
import { WertKorrektur } from './wert-korrektur';
import { chf } from '../format';

interface Zeile { label: string; wert: string; herkunft?: Herkunft }

const einkommen = (e: Einkommen) =>
  `${chf(e.betrag)} / ${e.einheit === 'chf_jahr' ? 'Jahr' : 'Monat'} ${e.basis ?? '(brutto/netto offen)'}${e.monatsloehne ? `, ${e.monatsloehne}×` : ''}`;
const bedarf = (b: Bedarf) => (b.einheit === 'prozent' ? `${b.hoehe} % des Einkommens` : `${chf(b.hoehe)} / Jahr`);
const ERWERB = { angestellt: 'angestellt', selbststaendig: 'selbstständig', nicht_erwerbstaetig: 'nicht erwerbstätig' } as const;

function zeile<T>(label: string, fakt: Fakt<T> | undefined, format: (wert: T) => string): Zeile[] {
  return fakt ? [{ label, wert: format(fakt.wert), herkunft: fakt }] : [];
}

function personZeilen(person: Person): Zeile[] {
  return [
    ...zeile('Geschlecht', person.geschlecht, w => w === 'maennlich' ? 'männlich' : 'weiblich'),
    ...zeile('Jahrgang', person.geburtsjahr, String),
    ...zeile('Erwerb', person.erwerb, w => ERWERB[w]),
    ...zeile('Pensum', person.pensumProzent, w => `${w} %`),
    ...zeile('Einkommen', person.einkommen, einkommen),
    ...zeile('Pensionskasse', person.bvgVersichert, w => (w ? 'ja' : 'nein')),
    ...zeile('Bedarf Erwerbsunfähigkeit', person.bedarfInvaliditaet, bedarf),
    // A private disability pension ("Erwerbsunfähigkeitsrente"), written out: "EU" reads like the European Union.
    ...zeile('Private Erwerbsunfähigkeitsrente', person.privateEu?.vorhanden, w => w ? 'ja' : 'nein'),
    ...zeile('Erwerbsunfähigkeitsrente pro Jahr', person.privateEu?.jahresrente, w => `${chf(w)} / Jahr`),
    ...zeile('Erwerbsunfähigkeitsrente deckt', person.privateEu?.deckung, w => ({ krankheit: 'Krankheit', unfall: 'Unfall', beides: 'Krankheit und Unfall' })[w]),
    ...zeile('Wartefrist bis zur Rente', person.privateEu?.wartefristMonate, w => `${w} Monate`),
    ...zeile('Rente endet mit', person.privateEu?.leistungsendeAlter, w => `Alter ${w}`),
    ...zeile('Rente zusätzlich zu IV und PK', person.privateEu?.zusaetzlichBestaetigt, w => w ? 'laut Angabe ja' : 'nicht bestätigt'),
    ...zeile('Mehrere solche Verträge', person.privateEu?.mehrereVertraege, w => w ? 'ja, Prüfung nötig' : 'nein, genau einer'),
    ...zeile('Pensionierungsalter', person.pensionierungsalter, w => `${w} Jahre`),
    ...zeile('PK-Altersrente', person.pkAltersrente, w => `${chf(w)} / Jahr`),
    ...zeile('PK-Guthaben', person.pkGuthaben, chf),
    ...zeile('Bedarf Todesfall', person.bedarfTodesfall, bedarf),
  ];
}

@Component({
  selector: 'app-beratungsstand',
  imports: [JsonPipe, NgTemplateOutlet, WertKorrektur],
  templateUrl: './beratungsstand.html',
  styleUrl: './beratungsstand.scss',
})
export class BeratungsstandPanel {
  readonly stand = input<Beratungsstand | null>(null);
  // While a reply is pending no correction can be sent.
  readonly gesperrt = input(false);
  // A correction phrased as a chat message, and a missing value the customer wants to answer.
  readonly korrektur = output<string>();
  readonly frage = output<string>();

  // "Bereich|Label" of the value being corrected, and of the values that just changed.
  protected readonly wartend = signal<string | null>(null);
  protected readonly geaendert = signal(new Set<string>());
  private vorher = new Map<string, string>();
  private leuchten: ReturnType<typeof setTimeout> | undefined;

  protected readonly haushalt = computed<Zeile[]>(() => {
    const h = this.stand()?.profil.haushalt;
    if (!h) return [];
    return [
      ...zeile('Beziehung', h.beziehung, w => w.replace('_', ' ')),
      ...zeile('Seit', h.beziehungSeitJahr, String),
      ...zeile('Kinder', h.hatKinder, w => (w ? 'ja' : 'keine')),
      ...zeile('Gemeinsamer Haushalt', h.gemeinsamerHaushalt, w => (w ? 'ja' : 'nein')),
      ...zeile('Bedarf im Ruhestand', h.bedarfPensionierung, bedarf),
      ...zeile('Privates Vorsorgevermögen', h.vermoegenPensionierung, chf),
      ...zeile('Zusätzliches Monatsbudget Pensionierung', h.budgetPensionierungMonat, w => `${chf(w)} / Monat (Selbstauskunft)`),
      ...zeile('Basisannahmen bestätigt', h.pensionierungBasisBestaetigt, w => w ? 'ja' : 'nein'),
    ];
  });

  protected readonly personen = computed(() => {
    const p = this.stand()?.profil.personen;
    if (!p) return [];
    return [
      { titel: 'Person A (Sie)', zeilen: personZeilen(p.A) },
      ...(p.B ? [{ titel: 'Person B (Partner/in)', zeilen: personZeilen(p.B) }] : []),
    ].filter(person => person.zeilen.length > 0);
  });

  protected readonly kinder = computed(() => (this.stand()?.profil.kinder ?? []).map((kind, index) => ({
    titel: `${kind.bezeichnung} ${index + 1}`,
    herkunft: kind.herkunft,
    zeilen: [
      ...zeile('Jahrgang', kind.geburtsjahr, String),
      ...zeile('Elternteil', kind.elternteil, w => (w === 'beide' ? 'gemeinsames Kind' : `nur Person ${w}`)),
      ...zeile('Alleiniges Sorgerecht', kind.alleinigesSorgerecht, w => (w ? 'ja' : 'nein')),
    ],
  })));

  protected readonly plaene = computed(() => (this.stand()?.profil.plaene ?? []).map(plan => ({
    titel: plan.beschreibung,
    untertitel: `${plan.art}, ${plan.person === 'haushalt' ? 'Haushalt' : `Person ${plan.person}`}`,
    herkunft: plan.herkunft,
    zeilen: [
      ...zeile('Zeitpunkt', plan.zeitpunkt, w => `${w.monat ? `${String(w.monat).padStart(2, '0')}/` : ''}${w.jahr}${w.text ? ` („${w.text}“)` : ''}`),
      ...zeile('Pensum', plan.pensumProzent, w => `${w} %`),
      ...zeile('Einkommen', plan.einkommen, einkommen),
      ...zeile('Sicherheit', plan.sicherheit, String),
    ],
  })));

  private readonly werte = computed(() => new Map([
    ...this.haushalt().map(z => [`Haushalt|${z.label}`, z.wert] as const),
    ...this.personen().flatMap(p => p.zeilen.map(z => [`${p.titel}|${z.label}`, z.wert] as const)),
    ...this.kinder().flatMap(k => k.zeilen.map(z => [`${k.titel}|${z.label}`, z.wert] as const)),
    ...this.plaene().flatMap(p => p.zeilen.map(z => [`Plan „${p.titel}“|${z.label}`, z.wert] as const)),
  ]));

  // What the calculations still need, per calculation; each label starts the answer in the chat.
  protected readonly fehlend = computed(() => {
    const s = this.stand();
    if (!s) return [];
    return [
      { titel: 'Für die Absicherung', angaben: s.risiko.fehlend },
      { titel: 'Für die Pensionierung', angaben: s.pensionierung.fehlend },
    ].filter(g => g.angaben.length);
  });

  // Shown in the header, so the panel stays informative when it is collapsed.
  protected readonly zusammenfassung = computed(() => {
    const anzahl = this.werte().size;
    const offen = this.fehlend().reduce((summe, g) => summe + g.angaben.length, 0);
    if (!anzahl) return 'Noch nichts erfasst';
    return `${anzahl} ${anzahl === 1 ? 'Angabe' : 'Angaben'}${offen ? `, ${offen} noch offen` : ''}`;
  });


  constructor() {
    // Values that are new or different light up briefly, whether they came from the chat or a correction.
    effect(() => {
      const werte = this.werte();
      const neu = [...werte].filter(([key, wert]) => this.vorher.get(key) !== wert).map(([key]) => key);
      this.vorher = werte;
      if (!neu.length) return;
      this.geaendert.set(new Set(neu));
      clearTimeout(this.leuchten);
      this.leuchten = setTimeout(() => this.geaendert.set(new Set()), 2500);
    });
    effect(() => {
      if (!this.gesperrt()) this.wartend.set(null);
    });
  }

  protected korrigieren(key: string, text: string) {
    this.wartend.set(key);
    this.korrektur.emit(text);
  }

  protected herkunftText(herkunft: Herkunft): string {
    return `„${herkunft.beleg}“ (Nachricht ${Math.floor(herkunft.nachricht / 2) + 1})${herkunft.begruendung ? ` – abgeleitet: ${herkunft.begruendung}` : ''}`;
  }
}
