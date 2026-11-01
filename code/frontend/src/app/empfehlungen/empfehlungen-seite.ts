import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { EmpfehlungenAntwort } from './empfehlungen.model';
import type { Auswahl } from '../abschluss/abschluss.model';
import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import type { Beratungsstand, Erkenntnis } from '../beratungsstand/beratungsstand.model';
import { PaxAvatar, type PaxAvatarState } from '../pax-avatar/pax-avatar';

const PARTNER = 'Partner/in: ';

@Component({
  selector: 'app-empfehlungen-seite',
  imports: [PaxAvatar],
  templateUrl: './empfehlungen-seite.html',
  styleUrl: './empfehlungen-seite.scss',
})
export class EmpfehlungenSeite {
  readonly stand = input<Beratungsstand | null>(null);
  readonly sessionId = input<string>();
  readonly revision = input<number>(0);
  // Packages chosen before, e.g. when the customer comes back from the application step.
  readonly vorauswahl = input<string[]>([]);
  readonly abschliessen = output<Auswahl>();
  protected readonly gewaehlt = signal(new Set<string>());
  protected readonly anzahl = computed(() => this.gewaehlt().size);
  protected readonly ergebnis = signal<EmpfehlungenAntwort | null>(null);
  protected readonly laden = signal(false);
  protected readonly fehler = signal('');
  protected readonly bestaetigt = signal(false);
  private readonly http = inject(HttpClient);
  private anfrage = 0;
  readonly zurueck = output<void>();

  // Pax "says" its line when the page opens.
  protected readonly avatar = signal<PaxAvatarState>('talking');
  private readonly timer = setTimeout(() => this.avatar.set('idle'), 2600);

  private readonly lagebild = computed(() => this.stand()?.lagebild ?? null);

  protected readonly gutes = computed(() => this.lagebild()?.erkenntnisse.filter((e) => e.art === 'gut') ?? []);
  // What Pax recognised: written by the model with the recommendations, otherwise its insights from the conversation.
  protected readonly hinweise = computed(() => {
    const ki = this.ergebnis()?.erkenntnisse ?? [];
    return ki.length ? ki.map((text): Erkenntnis => ({ art: 'hinweis', text, quelle: 'ki' })) : this.lagebild()?.erkenntnisse.filter((e) => e.art === 'hinweis') ?? [];
  });

  // Each pillar in one line: the customer's own facts; the partner's are only mentioned.
  protected readonly saeulen = computed(() =>
    (this.lagebild()?.saeulen ?? []).map((s) => {
      const eigene = s.bekannt.filter((b) => !b.startsWith(PARTNER));
      const partner = s.bekannt.length > eigene.length;
      return { nummer: s.nummer, name: s.untertitel, text: [eigene.join(', '), partner ? 'Angaben zu Partner/in' : ''].filter(Boolean).join('; ') };
    }),
  );

  constructor() {
    effect(() => { this.sessionId(); this.revision(); void this.ladeEmpfehlungen(); });
    inject(DestroyRef).onDestroy(() => { clearTimeout(this.timer); this.anfrage++; });
  }

  protected async ladeEmpfehlungen() {
    const id = ++this.anfrage;
    this.ergebnis.set(null); this.fehler.set(''); this.bestaetigt.set(false);
    if (!this.sessionId()) { this.fehler.set('Beginnen Sie zuerst eine Beratung, damit Pax Ihre Situation kennt.'); return; }
    this.laden.set(true);
    try {
      const result = await firstValueFrom(this.http.post<EmpfehlungenAntwort>('/api/empfehlungen', { sessionId: this.sessionId() }));
      if (id === this.anfrage) {
        if (result.revision !== this.revision()) throw new Error('Veraltete Empfehlungen');
        this.ergebnis.set(result);
        // A single package is chosen already; with several the earlier choice is kept, if it still applies.
        const ids = result.empfehlungen.map((e) => e.id);
        const frueher = this.vorauswahl().filter((id) => ids.includes(id));
        this.gewaehlt.set(new Set(ids.length === 1 ? ids : frueher));
      }
    } catch {
      if (id === this.anfrage) this.fehler.set('Die Empfehlungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
    } finally { if (id === this.anfrage) this.laden.set(false); }
  }

  protected umschalten(id: string) {
    this.gewaehlt.update((g) => {
      const neu = new Set(g);
      if (!neu.delete(id)) neu.add(id);
      return neu;
    });
  }

  protected weiter() {
    const r = this.ergebnis();
    if (!r || !this.anzahl()) return;
    this.abschliessen.emit({
      pakete: r.empfehlungen.filter((e) => this.gewaehlt().has(e.id)),
      regelHinweis: r.regelHinweis,
      statusText: r.statusText,
      revision: r.revision,
      gewaehltAm: new Date(),
    });
  }

  protected track(e: Erkenntnis) {
    return e.text;
  }
}
