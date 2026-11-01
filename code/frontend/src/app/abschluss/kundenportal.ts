import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { istTermin, monatJahr, type Antrag } from './abschluss.model';
import type { ProtokollTexte } from './protokoll-pdf';

/**
 * Step 4, a mock of the Pax customer portal: the submitted application, one policy per package,
 * and the advice record that explains every recommendation (traceability for customer and auditors).
 * The specialist's release is only simulated; in reality it happens at Pax.
 */
@Component({
  selector: 'app-kundenportal',
  imports: [DatePipe],
  templateUrl: './kundenportal.html',
  styleUrl: './kundenportal.scss',
})
export class Kundenportal {
  readonly antrag = input.required<Antrag>();
  // The Müller demo household is loaded: the portal greets it by its persona name, which stays in the browser.
  readonly demo = input(false);
  // For the advice record (PDF): the current advisory state with the pillar chart.
  readonly stand = input<Beratungsstand | null>(null);
  readonly sessionId = input<string | undefined>(undefined);
  readonly revision = input(0);
  readonly beratung = output<void>();
  readonly neu = output<void>();

  protected readonly istTermin = istTermin;
  protected readonly monatJahr = monatJahr;
  protected readonly freigegeben = signal(false);
  private readonly protokoll = viewChild.required<ElementRef<HTMLDialogElement>>('protokoll');
  private readonly http = inject(HttpClient);

  // The model's texts for the advice record; loaded once per application and shown in the dialog and the PDF.
  protected readonly texte = signal<ProtokollTexte | null>(null);
  protected readonly texteLaden = signal(false);
  private texteAnfrage: Promise<ProtokollTexte | null> | null = null;
  protected readonly pdfStatus = signal<'bereit' | 'erstellt' | 'fehler'>('bereit');

  constructor() {
    // A new application gets its own texts.
    effect(() => { this.antrag(); this.texteAnfrage = null; this.texte.set(null); });
  }

  protected readonly policen = computed(() => this.antrag().pakete.filter((p) => !istTermin(p)));
  protected readonly termin = computed(() => this.antrag().pakete.find(istTermin) ?? null);

  // The way of this application; the last two steps belong to Pax, not to the software.
  protected readonly schritte = computed(() => {
    const a = this.antrag();
    const frei = this.freigegeben();
    return [
      { text: 'Beratung mit Pax', zeit: null as Date | null, stand: 'erledigt' },
      { text: 'Empfehlung ausgewählt', zeit: a.gewaehltAm, stand: 'erledigt' },
      { text: 'Antrag eingereicht', zeit: a.eingereichtAm, stand: 'erledigt' },
      { text: 'Prüfung durch eine Pax-Fachperson', zeit: null, stand: frei ? 'erledigt' : 'aktiv' },
      { text: this.policen().length ? 'Police aktiv' : 'Termin bestätigt', zeit: null, stand: frei ? 'erledigt' : 'offen' },
    ];
  });

  protected policennummer(i: number): string {
    return `${this.antrag().nummer}-${String(i + 1).padStart(2, '0')}`;
  }

  protected grundlage(id: string): string | null {
    return this.texte()?.pakete.find((p) => p.id === id)?.grundlage ?? null;
  }

  protected protokollOeffnen() {
    this.protokoll().nativeElement.showModal();
    void this.ladeTexte();
  }

  /** The texts are written by the model for the chosen packages; without them the record still has the recommendations' own texts. */
  private ladeTexte(): Promise<ProtokollTexte | null> {
    const sessionId = this.sessionId();
    if (!sessionId) return Promise.resolve(null);
    this.texteAnfrage ??= (async () => {
      this.texteLaden.set(true);
      try {
        const a = this.antrag();
        const t = await firstValueFrom(this.http.post<ProtokollTexte>('/api/protokoll', { sessionId, revision: a.revision, pakete: a.pakete.map((p) => p.id) }));
        if (this.antrag() === a) this.texte.set(t);
        return t;
      } catch {
        this.texteAnfrage = null;
        return null;
      } finally {
        this.texteLaden.set(false);
      }
    })();
    return this.texteAnfrage;
  }

  private async grafikText(): Promise<string | null> {
    const sessionId = this.sessionId();
    if (!sessionId || !this.stand()?.grafik.length) return null;
    try {
      const r = await firstValueFrom(this.http.post<{ revision: number; text: string | null }>('/api/grafik', { sessionId }));
      return r.revision === this.revision() ? r.text : null;
    } catch {
      return null;
    }
  }

  /** Creates the advice record as a real A4 PDF file and downloads it (no print dialog, no browser header or footer). */
  protected async alsPdf() {
    if (this.pdfStatus() === 'erstellt') return;
    this.pdfStatus.set('erstellt');
    try {
      const [texte, grafikText, { protokollHerunterladen }] = await Promise.all([this.ladeTexte(), this.grafikText(), import('./protokoll-pdf')]);
      await protokollHerunterladen({
        antrag: this.antrag(), stand: this.stand(), freigegeben: this.freigegeben(), demo: this.demo(),
        texte, grafikText, erstellt: new Date(),
      });
      this.pdfStatus.set('bereit');
    } catch {
      this.pdfStatus.set('fehler');
    }
  }

  protected protokollSchliessen() {
    this.protokoll().nativeElement.close();
  }
}
