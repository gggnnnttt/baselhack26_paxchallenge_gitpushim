import { Component, DestroyRef, effect, inject, input, signal } from '@angular/core';

// Things people actually say when they start; they show that plain words are enough.
const BEISPIELE = [
  'Wir sind verheiratet, haben ein Kind und möchten in ein paar Jahren ein Haus kaufen.',
  'Ich weiss nicht, wo ich mich noch versichern soll.',
  'Was passiert mit meiner Familie, wenn ich nicht mehr arbeiten kann?',
  'Ich bin selbstständig und habe keine Pensionskasse.',
  'Reicht mein Geld, wenn ich mit 60 aufhören möchte?',
];

const TIPPEN_MS = 22;
const LOESCHEN_MS = 12;
// Long enough to read the whole sentence before it is deleted.
const STEHEN_MS = 3500;
const PAUSE_MS = 400;

/**
 * Example sentences typed into the empty input, deleted and replaced by the next one.
 * Decorative only: the input keeps its own label for screen readers.
 */
@Component({
  selector: 'app-beispiel-text',
  templateUrl: './beispiel-text.html',
  styleUrl: './beispiel-text.scss',
  host: { 'aria-hidden': 'true' },
})
export class BeispielText {
  // Typing runs only while the input is empty and not focused.
  readonly aktiv = input(true);

  private readonly reduziert = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  protected readonly text = signal(this.reduziert ? BEISPIELE[0] : '');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private beispiel = 0;

  constructor() {
    effect(() => {
      clearTimeout(this.timer);
      if (this.aktiv() && !this.reduziert) this.tippen(0);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private tippen(laenge: number) {
    const satz = BEISPIELE[this.beispiel];
    this.text.set(satz.slice(0, laenge));
    if (laenge < satz.length) {
      // A little irregular, like a person typing.
      this.timer = setTimeout(() => this.tippen(laenge + 1), TIPPEN_MS + Math.random() * 18);
    } else {
      this.timer = setTimeout(() => this.loeschen(laenge), STEHEN_MS);
    }
  }

  private loeschen(laenge: number) {
    this.text.set(BEISPIELE[this.beispiel].slice(0, laenge));
    if (laenge > 0) {
      this.timer = setTimeout(() => this.loeschen(laenge - 1), LOESCHEN_MS);
    } else {
      this.beispiel = (this.beispiel + 1) % BEISPIELE.length;
      this.timer = setTimeout(() => this.tippen(0), PAUSE_MS);
    }
  }
}
