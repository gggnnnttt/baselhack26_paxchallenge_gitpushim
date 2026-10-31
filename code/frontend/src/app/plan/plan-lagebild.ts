import { Component, computed, input, output, signal } from '@angular/core';
import type { Beratungsstand, Saeule } from '../beratungsstand/beratungsstand.model';

const EINLEITUNG = {
  verstehen: 'Erzähl Pax von dir. Die drei Säulen füllen sich, je besser Pax deine Situation kennt.',
  rechnen: 'Pax kennt deine drei Säulen und rechnet jetzt für dich.',
  empfehlen: '',
} as const;

// Where the money of each pillar comes from, in one word the customer understands.
const HERKUNFT: Record<Saeule['nummer'], string> = { 1: 'vom Staat', 2: 'über die Arbeit', 3: 'selbst vorgesorgt' };
const PARTNER = 'Partner/in: ';

/**
 * What Pax understood, at a glance: the three pillars of Swiss provision fill up as the conversation goes on,
 * the details behind them fold away. Below, what Pax recognised. Once everything is understood it leads to
 * the recommendations, which have their own page.
 */
@Component({
  selector: 'app-plan-lagebild',
  templateUrl: './plan-lagebild.html',
  styleUrl: './plan-lagebild.scss',
})
export class PlanLagebild {
  readonly stand = input<Beratungsstand | null>(null);
  readonly empfehlungen = output<void>();

  protected readonly lagebild = computed(() => this.stand()?.lagebild ?? null);
  protected readonly einleitung = computed(() => EINLEITUNG[this.lagebild()?.phase ?? 'verstehen']);
  protected readonly details = signal(false);
  protected readonly herkunft = HERKUNFT;

  // How full a pillar is drawn: the share of its facts that are known.
  protected fuellung(s: Saeule): number {
    const gesamt = s.bekannt.length + s.offen.length;
    return gesamt ? Math.max(0.06, s.bekannt.length / gesamt) : 0.06;
  }

  // The facts of a pillar, the customer's own first and the partner's under their own heading.
  protected gruppen(s: Saeule): { wer: string; fakten: string[] }[] {
    const eigene = s.bekannt.filter((b) => !b.startsWith(PARTNER));
    const partner = s.bekannt.filter((b) => b.startsWith(PARTNER)).map((b) => b.slice(PARTNER.length));
    return [
      ...(eigene.length ? [{ wer: '', fakten: eigene }] : []),
      ...(partner.length ? [{ wer: 'Partner/in', fakten: partner }] : []),
    ];
  }
}
