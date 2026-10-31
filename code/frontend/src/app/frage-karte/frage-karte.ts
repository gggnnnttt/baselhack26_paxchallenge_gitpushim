import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

// Mirrors Frage in backend/src/beratung/antwort.ts.
export interface Frage {
  text: string;
  eingabe: 'ja_nein' | 'auswahl' | 'mehrfach' | 'betrag' | 'zahl' | 'jahr' | 'text';
  optionen: string[];
  einheit: string | null;
  min: number | null;
  max: number | null;
}

/**
 * Pax's open question as a control: buttons, a slider or a number field instead of typing.
 * The choice is sent as a short chat message, so it is checked like anything typed.
 */
@Component({
  selector: 'app-frage-karte',
  imports: [FormsModule],
  templateUrl: './frage-karte.html',
  styleUrl: './frage-karte.scss',
})
export class FrageKarte {
  readonly frage = input.required<Frage>();
  readonly gesperrt = input(false);
  readonly antwort = output<string>();

  protected readonly gewaehlt = signal<string[]>([]);
  protected readonly wert = signal<number | null>(null);
  // A small range (e.g. 0–100 %) is easier to set with a slider.
  protected readonly regler = computed(() => {
    const { eingabe, min, max } = this.frage();
    return eingabe === 'zahl' && min !== null && max !== null && max > min && max - min <= 200;
  });

  constructor() {
    effect(() => {
      const f = this.frage();
      this.gewaehlt.set([]);
      this.wert.set(this.regler() ? Math.round((f.min! + f.max!) / 2) : null);
    });
  }

  protected senden(text: string) {
    if (!this.gesperrt()) this.antwort.emit(text);
  }

  protected umschalten(option: string) {
    this.gewaehlt.update(g => (g.includes(option) ? g.filter(o => o !== option) : [...g, option]));
  }

  protected mehrfachSenden() {
    const g = this.gewaehlt();
    if (g.length) this.senden(g.length === 1 ? g[0] : `${g.slice(0, -1).join(', ')} und ${g.at(-1)}`);
  }

  protected zahlSenden() {
    const wert = this.wert();
    if (wert === null || !Number.isFinite(wert)) return;
    const { eingabe, einheit } = this.frage();
    if (eingabe === 'jahr') return this.senden(String(wert));
    const zahl = wert.toLocaleString('de-CH');
    this.senden(eingabe === 'betrag' ? `${zahl} ${einheit ?? 'CHF'}` : `${zahl}${einheit ? ` ${einheit}` : ''}`);
  }
}
