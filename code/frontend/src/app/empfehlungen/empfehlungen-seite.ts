import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import type { Beratungsstand, Erkenntnis } from '../beratungsstand/beratungsstand.model';
import { PaxAvatar, type PaxAvatarState } from '../pax-avatar/pax-avatar';

const BEDARF = {
  absicherung: { titel: 'Einkommen bei Invalidität und Tod absichern', paket: 'Das passende Paket zur Absicherung stellt Pax hier zusammen.' },
  pensionierung: { titel: 'Die Lücke im Ruhestand schliessen', paket: 'Das passende Paket für deinen Ruhestand stellt Pax hier zusammen.' },
} as const;
type Bedarf = keyof typeof BEDARF;

const PARTNER = 'Partner/in: ';

/**
 * The page Pax leads to once it understands enough to recommend: Pax itself, the recommendations with the
 * reasons from the customer's situation, and a short summary of what Pax understood. The packages are
 * placeholders until the package logic exists.
 */
@Component({
  selector: 'app-empfehlungen-seite',
  imports: [PaxAvatar],
  templateUrl: './empfehlungen-seite.html',
  styleUrl: './empfehlungen-seite.scss',
})
export class EmpfehlungenSeite {
  readonly stand = input<Beratungsstand | null>(null);
  readonly zurueck = output<void>();

  // Pax "says" its line when the page opens.
  protected readonly avatar = signal<PaxAvatarState>('talking');
  private readonly timer = setTimeout(() => this.avatar.set('idle'), 2600);

  private readonly lagebild = computed(() => this.stand()?.lagebild ?? null);

  // One recommendation per need with a gap, in the order of what matters most to the customer.
  // A savings gap belongs to the retirement, so it is a second reason there.
  protected readonly empfehlungen = computed(() => {
    const l = this.lagebild();
    if (!l) return [];
    const reihenfolge: Bedarf[] = l.fokus === 'pensionierung' ? ['pensionierung', 'absicherung'] : ['absicherung', 'pensionierung'];
    const gruende = (b: Bedarf) => l.erkenntnisse.filter((e) => e.art === 'luecke' && (e.thema === b || (b === 'pensionierung' && e.thema === 'sparen')));
    return reihenfolge.map((b) => ({ id: b, ...BEDARF[b], gruende: gruende(b) })).filter((e) => e.gruende.length);
  });
  protected readonly gutes = computed(() => this.lagebild()?.erkenntnisse.filter((e) => e.art === 'gut') ?? []);
  protected readonly hinweise = computed(() => this.lagebild()?.erkenntnisse.filter((e) => e.art === 'hinweis') ?? []);

  // Each pillar in one line: the customer's own facts; the partner's are only mentioned.
  protected readonly saeulen = computed(() =>
    (this.lagebild()?.saeulen ?? []).map((s) => {
      const eigene = s.bekannt.filter((b) => !b.startsWith(PARTNER));
      const partner = s.bekannt.length > eigene.length;
      return { nummer: s.nummer, name: s.untertitel, text: [eigene.join(', '), partner ? 'Angaben zu Partner/in' : ''].filter(Boolean).join('; ') };
    }),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected track(e: Erkenntnis) {
    return e.text;
  }
}
