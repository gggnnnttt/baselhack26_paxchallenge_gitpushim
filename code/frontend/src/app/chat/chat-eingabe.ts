import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BeispielText } from '../beispiel-text/beispiel-text';

const EINSTIEGE = ['Wir erwarten ein Kind', 'Ich mache mich selbstständig', 'Wir möchten ein Haus kaufen', 'Ich möchte früher in Pension'];

/**
 * The input of the conversation: grows with its text, Enter sends, Shift+Enter starts a new line.
 * On the start screen it shows typed examples and a few entry suggestions.
 */
@Component({
  selector: 'app-chat-eingabe',
  imports: [FormsModule, BeispielText],
  templateUrl: './chat-eingabe.html',
  styleUrl: './chat-eingabe.scss',
  host: { '[class.gestartet]': 'gestartet()' },
})
export class ChatEingabe {
  readonly gestartet = input(false);
  readonly gesperrt = input(false);
  readonly senden = output<string>();

  protected readonly einstiege = EINSTIEGE;
  // A signal, because the page also writes into the input (suggestions) and the app runs without zone.js.
  protected readonly text = signal('');
  protected readonly fokussiert = signal(false);
  private readonly feld = viewChild<ElementRef<HTMLTextAreaElement>>('eingabe');

  /** Starts a sentence in the input, e.g. "Wir haben ein Kind, Jahrgang ", for the customer to finish. */
  vorschlagen(text: string) {
    this.text.set(text);
    const feld = this.feld()?.nativeElement;
    feld?.focus();
    setTimeout(() => {
      feld?.setSelectionRange(text.length, text.length);
      this.hoeheAnpassen();
    });
  }

  leeren() {
    this.text.set('');
    setTimeout(() => this.hoeheAnpassen());
  }

  protected abschicken() {
    const text = this.text().trim();
    if (!text || this.gesperrt()) return;
    this.leeren();
    this.senden.emit(text);
  }

  protected taste(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.abschicken();
  }

  // The input grows with its text up to a few lines.
  protected hoeheAnpassen() {
    const feld = this.feld()?.nativeElement;
    if (!feld) return;
    // Empty: no fixed height, so the CSS of the current view applies (the start screen's input is taller).
    if (!feld.value) {
      feld.style.height = '';
      return;
    }
    feld.style.height = 'auto';
    feld.style.height = `${Math.min(feld.scrollHeight, 160)}px`;
  }
}
