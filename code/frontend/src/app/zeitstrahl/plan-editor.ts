import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PERSONEN, PLANART_LISTE, PLANARTEN, type PlanArt, type PlanPerson, type PlanSpeichern, type ZeitstrahlAktion } from './zeitstrahl.model';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Dialog to add or edit one plan of the timeline. */
@Component({
  selector: 'app-plan-editor',
  imports: [FormsModule],
  templateUrl: './plan-editor.html',
  styleUrl: './plan-editor.scss',
})
export class PlanEditor {
  readonly personen = input.required<PlanPerson[]>();
  readonly jahrVon = input.required<number>();
  readonly aktion = output<ZeitstrahlAktion>();

  protected readonly PLANARTEN = PLANARTEN;
  protected readonly PERSONEN = PERSONEN;
  protected readonly arten = PLANART_LISTE;
  protected readonly monate = MONATE.map((name, i) => ({ nr: i + 1, name }));

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  // A signal, because oeffnen() is called by the timeline and the app runs without zone.js.
  // The form fields then edit this object in place.
  protected readonly entwurf = signal<PlanSpeichern | null>(null);
  protected mitDatum = true;
  protected fehler = '';

  oeffnen(entwurf: PlanSpeichern) {
    this.mitDatum = entwurf.jahr !== null;
    this.fehler = '';
    // Undated plans get a suggestion in case the customer adds a date.
    this.entwurf.set({ ...entwurf, jahr: entwurf.jahr ?? this.jahrVon() + 1 });
    this.dialog().nativeElement.showModal();
  }

  protected artWaehlen(entwurf: PlanSpeichern, art: PlanArt) {
    // Replace the description only while it is still the suggestion of the previous kind.
    const beschreibung = entwurf.beschreibung.trim();
    if (!beschreibung || beschreibung === PLANARTEN[entwurf.art].vorschlag) entwurf.beschreibung = PLANARTEN[art].vorschlag;
    entwurf.art = art;
  }

  protected speichern(entwurf: PlanSpeichern) {
    const beschreibung = entwurf.beschreibung.trim();
    const jahr = entwurf.jahr;
    if (!beschreibung) {
      this.fehler = 'Bitte beschreiben Sie den Plan kurz.';
      return;
    }
    if (this.mitDatum && (jahr === null || !Number.isInteger(jahr) || jahr < this.jahrVon() || jahr > this.jahrVon() + 70)) {
      this.fehler = `Bitte ein Jahr zwischen ${this.jahrVon()} und ${this.jahrVon() + 70} wählen.`;
      return;
    }
    this.aktion.emit({
      ...entwurf,
      beschreibung,
      notiz: entwurf.notiz.trim(),
      jahr: this.mitDatum ? jahr : null,
      monat: this.mitDatum ? entwurf.monat : null,
    });
    this.schliessen();
  }

  protected entfernen(entwurf: PlanSpeichern) {
    if (entwurf.plan) this.aktion.emit({ typ: 'entfernen', plan: entwurf.plan });
    this.schliessen();
  }

  protected schliessen() {
    this.dialog().nativeElement.close();
  }
}
