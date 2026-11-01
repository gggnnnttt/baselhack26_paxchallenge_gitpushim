import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { istTermin, monatJahr, type Antrag, type Auswahl } from './abschluss.model';

/**
 * Step 3: the customer checks the chosen packages, picks a start and submits a demo application.
 * Nothing is sent anywhere: a Pax specialist would review the application before any contract exists.
 */
@Component({
  selector: 'app-abschluss-seite',
  imports: [FormsModule],
  templateUrl: './abschluss-seite.html',
  styleUrl: './abschluss-seite.scss',
})
export class AbschlussSeite {
  readonly auswahl = input.required<Auswahl>();
  readonly zurueck = output<void>();
  readonly eingereicht = output<Antrag>();

  protected readonly istTermin = istTermin;
  protected readonly monatJahr = monatJahr;

  // A contract starts on the first of a month: the next six months are offered.
  protected readonly beginne = (() => {
    const heute = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(heute.getFullYear(), heute.getMonth() + 1 + i, 1);
      return { jahr: d.getFullYear(), monat: d.getMonth() + 1 };
    });
  })();
  protected beginnIndex = 0;

  protected gelesen = false;
  protected demoVerstanden = false;
  protected angemessenheit = false;
  protected readonly versucht = signal(false);

  protected readonly versicherungen = computed(() => this.auswahl().pakete.filter((p) => !istTermin(p)));
  protected readonly termin = computed(() => this.auswahl().pakete.some(istTermin));
  // Fund-linked products need an appropriateness check before a contract (Angemessenheitsprüfung).
  protected readonly qualifiziert = computed(() => this.auswahl().pakete.some((p) => !!p.hinweis));

  protected bereit(): boolean {
    return this.gelesen && this.demoVerstanden && (!this.qualifiziert() || this.angemessenheit);
  }

  protected einreichen() {
    this.versucht.set(true);
    if (!this.bereit()) return;
    const nummer = `DEMO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
    this.eingereicht.emit({ ...this.auswahl(), nummer, beginn: this.beginne[this.beginnIndex], eingereichtAm: new Date() });
  }
}
