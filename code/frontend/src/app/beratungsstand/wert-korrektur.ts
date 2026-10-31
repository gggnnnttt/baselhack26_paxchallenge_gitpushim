import { Component, ElementRef, Injector, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * One value of the advisory state that the customer can correct in place.
 * The correction is phrased as a chat message, so it passes the same checks as anything said in the chat
 * and Pax confirms it in the conversation.
 */
@Component({
  selector: 'app-wert-korrektur',
  imports: [FormsModule],
  templateUrl: './wert-korrektur.html',
  styleUrl: './wert-korrektur.scss',
})
export class WertKorrektur {
  readonly label = input.required<string>();
  readonly wert = input.required<string>();
  // Whose value this is, e.g. "Person A (du)"; the same names Pax uses in its context.
  readonly bereich = input.required<string>();
  readonly gesperrt = input(false);
  readonly korrektur = output<string>();

  private readonly injector = inject(Injector);
  private readonly feld = viewChild<ElementRef<HTMLInputElement>>('feld');
  protected readonly bearbeiten = signal(false);
  protected entwurf = '';

  protected start() {
    this.entwurf = this.wert();
    this.bearbeiten.set(true);
    afterNextRender(() => this.feld()?.nativeElement.select(), { injector: this.injector });
  }

  protected korrigieren() {
    const neu = this.entwurf.trim();
    if (!neu || neu === this.wert()) return;
    this.korrektur.emit(`Korrektur zu ${this.bereich()}: ${this.label()} ist ${neu}, nicht ${this.wert()}.`);
    this.bearbeiten.set(false);
  }

  protected entfernen() {
    this.korrektur.emit(`Korrektur zu ${this.bereich()}: Die Angabe „${this.label()}: ${this.wert()}“ stimmt nicht, bitte entfernen.`);
    this.bearbeiten.set(false);
  }

  protected abbrechen() {
    this.bearbeiten.set(false);
  }
}
