import { Component, DestroyRef, ElementRef, computed, inject, input } from '@angular/core';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { SaeulenGrafik } from '../grafik/saeulen-grafik';
import { istTermin, monatJahr, type Antrag } from './abschluss.model';

const PARTNER = 'Partner/in: ';

/**
 * The advice record as a printable A4 document (saved as PDF from the browser's print dialog):
 * situation, the pillar chart with the model's explanation, every recommendation with its reasoning and
 * evidence, the hand-over criteria, and who decides. Hidden on screen; printed on its own.
 */
@Component({
  selector: 'app-protokoll-dokument',
  imports: [SaeulenGrafik],
  templateUrl: './protokoll-dokument.html',
  styleUrl: './protokoll-dokument.scss',
})
export class ProtokollDokument {
  readonly antrag = input.required<Antrag>();
  readonly stand = input<Beratungsstand | null>(null);
  readonly sessionId = input<string | undefined>(undefined);
  readonly revision = input(0);
  readonly freigegeben = input(false);
  readonly demo = input(false);

  protected readonly istTermin = istTermin;
  protected readonly monatJahr = monatJahr;
  protected readonly erstellt = new Date().toLocaleString('de-CH', { dateStyle: 'long', timeStyle: 'short' });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly saeulen = computed(() => (this.stand()?.lagebild.saeulen ?? []).map((s) => ({
    titel: `${s.titel}: ${s.untertitel}`,
    sie: s.bekannt.filter((b) => !b.startsWith(PARTNER)),
    partner: s.bekannt.filter((b) => b.startsWith(PARTNER)).map((b) => b.slice(PARTNER.length)),
    offen: s.offen,
  })));
  // The model's insights from the recommendations page, then those from the conversation, without repeats.
  protected readonly kiErkenntnisse = computed(() => [...new Set([
    ...this.antrag().erkenntnisse,
    ...(this.stand()?.lagebild.erkenntnisse.filter((e) => e.quelle === 'ki').map((e) => e.text) ?? []),
  ])].map((text) => ({ text })));
  protected readonly berechnet = computed(() => this.stand()?.lagebild.erkenntnisse.filter((e) => e.quelle !== 'ki') ?? []);

  constructor() {
    // If printing is cancelled or the page changes, the document goes back to its place.
    const zurueck = () => this.zuruecklegen();
    window.addEventListener('afterprint', zurueck);
    inject(DestroyRef).onDestroy(() => { window.removeEventListener('afterprint', zurueck); this.zuruecklegen(); });
  }

  private platz: { parent: Node; next: Node | null } | null = null;

  /**
   * Prints only this document: it moves to <body> for the print, where the print styles hide everything else,
   * and returns afterwards. The browser's print dialog offers "Als PDF speichern".
   */
  drucken() {
    const el = this.host.nativeElement;
    if (!this.platz && el.parentNode) {
      this.platz = { parent: el.parentNode, next: el.nextSibling };
      document.body.appendChild(el);
    }
    document.body.classList.add('protokoll-druck');
    const titel = document.title;
    document.title = `Pax Beratungsprotokoll ${this.antrag().nummer}`;
    // Give the chart and the explanation one frame to lay out in the print position.
    requestAnimationFrame(() => {
      window.print();
      document.title = titel;
    });
  }

  private zuruecklegen() {
    document.body.classList.remove('protokoll-druck');
    if (!this.platz) return;
    const { parent, next } = this.platz;
    this.platz = null;
    parent.insertBefore(this.host.nativeElement, next && next.parentNode === parent ? next : null);
  }
}
