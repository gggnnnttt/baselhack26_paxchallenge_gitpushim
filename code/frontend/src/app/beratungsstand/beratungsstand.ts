import { Component, computed, effect, input, output, signal } from '@angular/core';
import { JsonPipe, NgTemplateOutlet } from '@angular/common';
import type { Bedarf, Beratungsstand, Einkommen, Fakt, Herkunft, Person } from './beratungsstand.model';
import { WertKorrektur } from './wert-korrektur';

interface Zeile { label: string; wert: string; herkunft?: Herkunft }
interface Balken {
  titel: string;
  fehler: string | null;
  bedarf?: number;
  einnahmen?: number;
  luecke: number;
  einnahmenAnteil: number;
  lueckeAnteil: number;
  // How much of the capitalised gap the household's assets could carry; own comparison, not APICalc.
  vermoegen: string | null;
  tooltip: string;
}

const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;
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

  protected readonly chf = chf;

  protected readonly haushalt = computed<Zeile[]>(() => {
    const h = this.stand()?.profil.haushalt;
    if (!h) return [];
    return [
      ...zeile('Beziehung', h.beziehung, w => w.replace('_', ' ')),
      ...zeile('Seit', h.beziehungSeitJahr, String),
      ...zeile('Kinder', h.hatKinder, w => (w ? 'ja' : 'keine')),
      ...zeile('Gemeinsamer Haushalt', h.gemeinsamerHaushalt, w => (w ? 'ja' : 'nein')),
      ...zeile('Vermögen', h.vermoegen, chf),
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
      ...zeile('Alleiniges Sorgerecht', kind.alleinigesSorgerecht, w => (w ? 'ja' : 'nein')),
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
      ...zeile('Sicherheit', plan.sicherheit, String),
    ],
  })));

  private readonly werte = computed(() => new Map([
    ...this.haushalt().map(z => [`Haushalt|${z.label}`, z.wert] as const),
    ...this.personen().flatMap(p => p.zeilen.map(z => [`${p.titel}|${z.label}`, z.wert] as const)),
    ...this.kinder().flatMap(k => k.zeilen.map(z => [`${k.titel}|${z.label}`, z.wert] as const)),
    ...this.plaene().flatMap(p => p.zeilen.map(z => [`Plan „${p.titel}“|${z.label}`, z.wert] as const)),
  ]));

  // Shown in the header, so the panel stays informative when it is collapsed.
  protected readonly zusammenfassung = computed(() => {
    const anzahl = this.werte().size;
    const s = this.stand();
    const fehlend = (s?.risiko.fehlend.length ?? 0) + (s?.offen?.length ?? 0);
    if (!anzahl) return 'Noch nichts erfasst';
    return `${anzahl} ${anzahl === 1 ? 'Angabe' : 'Angaben'}${fehlend ? `, ${fehlend} noch offen` : ''}`;
  });

  // The result grouped by person; all bars share one scale so they can be compared.
  protected readonly ergebnis = computed(() => {
    const szenarien = this.stand()?.risiko.ergebnis?.szenarien ?? [];
    const vermoegen = this.stand()?.profil.haushalt.vermoegen?.wert;
    const skala = Math.max(1, ...szenarien.map(z => Math.max(z.bedarf ?? 0, z.einnahmen ?? 0)));
    const gruppen = new Map<string, Balken[]>();
    for (const z of szenarien) {
      const [titel, person = ''] = z.szenario.split(' – ');
      const luecke = z.fehler ? 0 : z.luecke ?? 0;
      const zeile: Balken = {
        titel,
        fehler: z.fehler,
        bedarf: z.bedarf,
        einnahmen: z.einnahmen,
        luecke,
        einnahmenAnteil: ((z.einnahmen ?? 0) / skala) * 100,
        lueckeAnteil: (luecke / skala) * 100,
        vermoegen: this.vermoegenText(vermoegen, z.fehler ? undefined : z.kapitalisierteLuecke),
        tooltip: z.fehler
          ? z.fehler
          : `Bedarf ${this.betrag(z.bedarf)}\nEinnahmen ${this.betrag(z.einnahmen)} (1. Säule ${this.betrag(z.ersteSaeule)}, 2. Säule ${this.betrag(z.zweiteSaeule)}, Partner/in ${this.betrag(z.partner)})\nLücke ${this.betrag(luecke)}, kapitalisiert ${this.betrag(z.kapitalisierteLuecke)}`,
      };
      gruppen.set(person, [...(gruppen.get(person) ?? []), zeile]);
    }
    return [...gruppen].map(([person, zeilen]) => ({ person: person === 'Person A' ? 'Du' : person === 'Person B' ? 'Partner/in' : person, zeilen }));
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

  private vermoegenText(vermoegen: number | undefined, kapital: number | undefined): string | null {
    if (vermoegen === undefined || !kapital) return null;
    const anteil = Math.min(100, Math.round((vermoegen / kapital) * 100));
    return `Als Kapital fehlen ${chf(kapital)}. Euer Vermögen deckt davon rechnerisch ${anteil} %.`;
  }

  protected datum(zeitpunkt: string): string {
    const d = new Date(zeitpunkt);
    return Number.isNaN(d.getTime()) ? zeitpunkt : d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected betrag(wert: number | undefined): string {
    return wert === undefined ? '–' : chf(wert);
  }
}
