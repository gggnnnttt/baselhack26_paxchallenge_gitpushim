import { Component, input, output } from '@angular/core';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';

/** The rule-based action plan of the backend as numbered steps, and a possible Pax solution per need. */
@Component({
  selector: 'app-plan-schritte',
  templateUrl: './plan-schritte.html',
  styleUrl: './plan-schritte.scss',
})
export class PlanSchritte {
  readonly stand = input<Beratungsstand | null>(null);
  readonly gesperrt = input(false);
  // A step or product case prepares a chat message; the customer checks and sends it.
  readonly aktion = output<string>();

  protected hatHandlung(id: string): boolean {
    return this.stand()?.handlungsplan.karten.some(k => k.id === id) ?? false;
  }
}
