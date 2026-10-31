import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import type { SzenarioVergleich } from './szenario.model';

@Component({
  selector: 'app-szenario', imports: [FormsModule],
  templateUrl: './szenario.html', styleUrl: './szenario.scss',
})
export class SzenarioPanel {
  readonly stand = input<Beratungsstand | null>(null);
  readonly vergleich = input<SzenarioVergleich | null>(null);
  readonly disabled = input(false);
  readonly busy = input(false);
  readonly fehler = input('');
  readonly berechnen = output<number>();
  readonly uebernehmen = output<void>();
  readonly verwerfen = output<void>();
  protected offen = false;
  protected jahresbedarf: number | null = null;
  protected readonly chf = (v: number | null) => v === null ? 'Noch unbekannt' : `CHF ${v.toLocaleString('de-CH', { maximumFractionDigits: 2 })}`;
  protected readonly bereit = computed(() => {
    const s = this.stand();
    return s?.pensionierung.phase === 'berechnet' && !s.pensionierung.ergebnis?.veraltet
      && ['berechnet', 'kein_bedarf'].includes(s.sparen.phase);
  });
  protected readonly spalten = computed(() => {
    const v = this.vergleich();
    return v ? [{ titel: 'Bisheriges Ziel', werte: v.ausgangslage }, { titel: 'Alternative', werte: v.alternative }] : [];
  });
  protected readonly skala = computed(() => {
    const v = this.vergleich();
    return v ? Math.ceil(Math.max(1, v.ausgangslage.sparbedarfMonat, v.alternative.sparbedarfMonat, v.ausgangslage.budget.verfuegbarMonat ?? 0) * 1.15) : 1;
  });
  protected oeffnen() {
    this.offen = true;
    this.jahresbedarf = Math.max(0, (this.stand()?.pensionierung.ergebnis?.werte.IncomeNeed ?? 70000) - 5000);
  }
  protected gueltig() { return this.jahresbedarf !== null && Number.isFinite(this.jahresbedarf) && this.jahresbedarf >= 0 && this.jahresbedarf <= 1_000_000; }
  protected absenden() { if (this.gueltig() && !this.disabled()) this.berechnen.emit(this.jahresbedarf!); }
  protected aendern() { this.verwerfen.emit(); }
  protected schliessen() { this.verwerfen.emit(); this.offen = false; }
}
