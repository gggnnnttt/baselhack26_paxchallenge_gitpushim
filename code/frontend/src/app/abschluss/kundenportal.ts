import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { ProtokollDokument } from './protokoll-dokument';
import { DatePipe } from '@angular/common';
import { istTermin, monatJahr, type Antrag } from './abschluss.model';

/**
 * Step 4, a mock of the Pax customer portal: the submitted application, one policy per package,
 * and the advice record that explains every recommendation (traceability for customer and auditors).
 * The specialist's release is only simulated; in reality it happens at Pax.
 */
@Component({
  selector: 'app-kundenportal',
  imports: [DatePipe, ProtokollDokument],
  templateUrl: './kundenportal.html',
  styleUrl: './kundenportal.scss',
})
export class Kundenportal {
  readonly antrag = input.required<Antrag>();
  // The Müller demo household is loaded: the portal greets it by its persona name, which stays in the browser.
  readonly demo = input(false);
  // For the printable advice record: the current advisory state with the pillar chart.
  readonly stand = input<Beratungsstand | null>(null);
  readonly sessionId = input<string | undefined>(undefined);
  readonly revision = input(0);
  readonly beratung = output<void>();
  readonly neu = output<void>();

  protected readonly istTermin = istTermin;
  protected readonly monatJahr = monatJahr;
  protected readonly freigegeben = signal(false);
  private readonly protokoll = viewChild.required<ElementRef<HTMLDialogElement>>('protokoll');
  private readonly dokument = viewChild.required(ProtokollDokument);

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

  protected protokollOeffnen() {
    this.protokoll().nativeElement.showModal();
  }

  // Opens the print dialog with the advice record alone; there it can be saved as PDF.
  protected alsPdf() {
    if (this.protokoll().nativeElement.open) this.protokoll().nativeElement.close();
    this.dokument().drucken();
  }

  protected protokollSchliessen() {
    this.protokoll().nativeElement.close();
  }
}
