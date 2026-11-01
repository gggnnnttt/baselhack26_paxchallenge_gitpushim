import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { GrafikZeile } from '../beratungsstand/beratungsstand.model';
import { chf } from '../format';

// The parts of a bar, in pillar order. Colours from the Pax tokens, checked with the dataviz validator.
export const TEILE = [
  { key: 'ersteSaeule', name: '1. Säule (AHV/IV)', klasse: 't1' },
  { key: 'zweiteSaeule', name: '2. Säule (Pensionskasse)', klasse: 't2' },
  { key: 'weiteres', name: 'Partnereinkommen und Vermögen', klasse: 't3' },
  { key: 'luecke', name: 'Lücke', klasse: 'luecke' },
] as const;

const WER: Record<GrafikZeile['wer'], string> = { Sie: 'betrifft Sie', 'Partner/in': 'betrifft Ihren Partner oder Ihre Partnerin', Haushalt: 'für Ihren Haushalt' };

/**
 * "Was fehlt im Ernstfall?": one bar per scenario on a shared scale. The pillars stack from the left,
 * the gap is hatched, the line marks the yearly need. Numbers come from APICalc; the explanation below
 * is written by the model for the current state of the advice.
 */
@Component({
  selector: 'app-saeulen-grafik',
  templateUrl: './saeulen-grafik.html',
  styleUrl: './saeulen-grafik.scss',
})
export class SaeulenGrafik {
  readonly zeilen = input<GrafikZeile[]>([]);
  readonly sessionId = input<string | undefined>(undefined);
  readonly revision = input(0);
  // Compact: smaller headings, e.g. in the narrow Lagebild column.
  readonly kompakt = input(false);
  // Without its own heading, e.g. in the advice record, where the section has one.
  readonly mitTitel = input(true);

  protected readonly teile = TEILE;
  protected readonly chf = chf;
  protected readonly wer = WER;
  protected readonly tabelle = signal(false);
  protected readonly aktiv = signal<string | null>(null);

  protected readonly erklaerung = signal<string | null>(null);
  protected readonly laedt = signal(false);
  protected readonly fehler = signal(false);
  private anfrage = 0;
  private readonly http = inject(HttpClient);

  // One scale for all bars: the largest of need and total, rounded up to a clean tick.
  protected readonly skala = computed(() => {
    const max = Math.max(1, ...this.zeilen().map(z => Math.max(z.bedarf, z.ersteSaeule + z.zweiteSaeule + z.weiteres + z.luecke)));
    const schritt = max > 100_000 ? 50_000 : 20_000;
    return Math.ceil(max / schritt) * schritt;
  });
  protected readonly ticks = computed(() => {
    const s = this.skala();
    return [0, s / 2, s].map(wert => ({ wert, pos: (wert / s) * 100, text: wert >= 1000 ? `${wert / 1000}k` : String(wert) }));
  });

  constructor() {
    effect(() => {
      const id = this.sessionId();
      const r = this.revision();
      if (this.zeilen().length && id) void this.erklaeren(id, r);
      else { this.anfrage++; this.erklaerung.set(null); this.laedt.set(false); }
    });
    inject(DestroyRef).onDestroy(() => this.anfrage++);
  }

  protected breite(wert: number): number {
    return (wert / this.skala()) * 100;
  }

  protected beschreibung(z: GrafikZeile): string {
    const teile = TEILE.filter(t => t.key !== 'luecke' && z[t.key] > 0).map(t => `${t.name} ${chf(z[t.key])}`).join(', ');
    return `${z.titel}, ${WER[z.wer]}: Bedarf ${chf(z.bedarf)} pro Jahr. ${teile || 'Keine Leistungen'}. ${z.luecke > 0 ? `Lücke ${chf(z.luecke)} pro Jahr.` : 'Keine Lücke.'}`;
  }

  protected async erklaeren(sessionId: string, revision: number) {
    const id = ++this.anfrage;
    this.laedt.set(true);
    this.fehler.set(false);
    try {
      const r = await firstValueFrom(this.http.post<{ revision: number; text: string | null }>('/api/grafik', { sessionId }));
      if (id !== this.anfrage) return;
      // An answer for an older state of the advice is not shown.
      this.erklaerung.set(r.revision === revision ? r.text : null);
    } catch {
      if (id === this.anfrage) { this.erklaerung.set(null); this.fehler.set(true); }
    } finally {
      if (id === this.anfrage) this.laedt.set(false);
    }
  }

  protected nochmal() {
    const id = this.sessionId();
    if (id) void this.erklaeren(id, this.revision());
  }
}
