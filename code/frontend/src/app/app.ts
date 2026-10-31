import { Component, ElementRef, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BeratungsstandPanel } from './beratungsstand/beratungsstand';
import type { Beratungsstand } from './beratungsstand/beratungsstand.model';
import { ChatEingabe } from './chat/chat-eingabe';
import { ChatVerlauf, type Message } from './chat/chat-verlauf';
import type { Frage } from './frage-karte/frage-karte';
import { PaxAvatar, type PaxAvatarState } from './pax-avatar/pax-avatar';
import { PlanSchritte } from './plan/plan-schritte';
import { PlanZahlen } from './plan/plan-zahlen';
import { SzenarioPanel } from './szenario/szenario';
import type { SzenarioVergleich } from './szenario/szenario.model';
import { Zeitstrahl } from './zeitstrahl/zeitstrahl';
import type { ZeitstrahlAktion } from './zeitstrahl/zeitstrahl.model';

type PlanReiter = 'schritte' | 'weg' | 'zahlen';

interface ChatAntwort { reply: string; frage: Frage | null; sessionId: string; revision: number; beratungsstand: Beratungsstand }

// Pax's speech bubble on the start screen, kept as its first message once the conversation runs. Not sent to the backend.
const BEGRUESSUNG = 'Erzähl mir kurz, wie du lebst und was du vorhast. Ich zeige dir, wo du bei der Vorsorge stehst.';

// Common situations on the start screen; a click starts the message, the customer adds the details.

// Below this width the profile starts collapsed, so the conversation keeps its room.
const PROFIL_OFFEN_AB = 1680;

@Component({
  imports: [FormsModule, NgTemplateOutlet, BeratungsstandPanel, ChatEingabe, ChatVerlauf, PaxAvatar, PlanSchritte, PlanZahlen, SzenarioPanel, Zeitstrahl],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly http = inject(HttpClient);

  // Acknowledgement is kept in memory only; the notice is shown again after a reload.
  protected readonly accepted = signal(false);
  protected acknowledged = false;
  protected readonly messages = signal<Message[]>([]);
  protected readonly stand = signal<Beratungsstand | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected readonly talking = signal(false);
  protected readonly avatarState = computed<PaxAvatarState>(() =>
    this.loading() ? 'thinking' : this.talking() ? 'talking' : 'idle',
  );
  protected readonly begruessung = BEGRUESSUNG;
  // The start screen shows only Pax and the input; the conversation view takes over with the first message.
  protected readonly gestartet = computed(() => this.messages().length > 0 || this.loading());
  protected readonly status = computed(() =>
    this.loading() ? 'denkt nach …' : this.talking() ? 'antwortet' : 'dein Vorsorge-Berater',
  );
  // How far the risk calculation is: the values it has against the values it still needs.
  protected readonly fortschritt = computed(() => {
    const s = this.stand();
    if (!s) return null;
    const vorhanden = s.risiko.vorhanden.length;
    const fehlend = s.risiko.fehlend.length;
    const angaben = (n: number) => `${n} ${n === 1 ? 'Angabe' : 'Angaben'}`;
    const fertig = s.phase === 'berechnet';
    const text = fehlend ? `Noch ${angaben(fehlend)} bis zur Berechnung` : fertig ? 'Berechnung liegt vor' : 'Alle Angaben erfasst';
    return { anteil: fertig ? 1 : vorhanden / Math.max(1, vorhanden + fehlend), text, fertig };
  });
  // The plan in the middle column. A count shows the steps, a dot marks new results while the tab is not shown.
  protected readonly planReiter = signal<PlanReiter>('weg');
  protected readonly zahlenNeu = signal(false);
  private readonly planSpalte = viewChild<ElementRef<HTMLElement>>('planSpalte');
  private readonly reiterScroll = new Map<PlanReiter, number>();
  protected readonly reiter = computed(() => [
    { id: 'schritte' as const, label: 'Nächste Schritte', anzahl: this.stand()?.handlungsplan.karten.length ?? 0, neu: false },
    { id: 'weg' as const, label: 'Lebensweg', anzahl: 0, neu: false },
    { id: 'zahlen' as const, label: 'Zahlen', anzahl: 0, neu: this.zahlenNeu() },
  ]);
  private readonly ergebnisse = computed(() => {
    const s = this.stand();
    return [s?.risiko.ergebnis?.zeitpunkt, s?.pensionierung.ergebnis?.zeitpunkt, s?.sparen.ergebnis?.zeitpunkt].join('|');
  });
  // The left sidebar; while it is collapsed a dot marks new values from Pax.
  protected readonly profilOffen = signal(typeof window === 'undefined' || window.innerWidth >= PROFIL_OFFEN_AB);
  protected readonly profilNeu = signal(false);
  private readonly verlauf = viewChild<ElementRef<HTMLElement>>('verlauf');
  private readonly eingabe = viewChild(ChatEingabe);
  private sessionId: string | undefined;
  // Counts accepted profile changes; a scenario comparison is only valid for the revision it was computed on.
  private revision = 0;
  protected readonly vergleich = signal<SzenarioVergleich | null>(null);
  protected readonly szenarioFehler = signal('');
  protected readonly szenarioBusy = signal(false);

  protected verwerfeSzenario() {
    this.vergleich.set(null);
    this.szenarioFehler.set('');
  }

  protected async berechneSzenario(jahresbedarf: number) {
    if (this.loading() || !this.sessionId) return;
    this.verwerfeSzenario();
    this.loading.set(true);
    this.szenarioBusy.set(true);
    try {
      this.vergleich.set(await firstValueFrom(this.http.post<SzenarioVergleich>('/api/szenario', {
        sessionId: this.sessionId, revision: this.revision, jahresbedarf,
      })));
    } catch (err: any) { this.szenarioFehler.set(err?.error?.error ?? 'Die Alternative konnte nicht berechnet werden.'); }
    finally { this.loading.set(false); this.szenarioBusy.set(false); }
  }

  protected async uebernehmeSzenario() {
    const v = this.vergleich();
    if (this.loading() || !v || !this.sessionId) return;
    this.loading.set(true);
    this.szenarioFehler.set('');
    try {
      const res = await firstValueFrom(this.http.post<ChatAntwort & { userMessage: string }>('/api/szenario/uebernehmen', {
        sessionId: this.sessionId, revision: this.revision, szenarioId: v.id,
      }));
      this.revision = res.revision;
      this.stand.set(res.beratungsstand);
      this.messages.update(m => [...m, { role: 'user', content: res.userMessage }, { role: 'assistant', content: res.reply, frage: res.frage }]);
      this.verwerfeSzenario();
      this.startTalking(res.reply);
    } catch (err: any) { this.szenarioFehler.set(err?.error?.error ?? 'Das Ziel konnte nicht übernommen werden.'); }
    finally { this.loading.set(false); }
  }

  private talkingTimer: ReturnType<typeof setTimeout> | undefined;
  // Timeline changes are collected briefly and sent together, so dragging several plans gives one reply.
  private wartend: ZeitstrahlAktion[] = [];
  private unterwegs = 0;
  private zeitstrahlTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly ausstehend = signal(0);

  constructor() {
    effect(() => {
      if (this.ergebnisse() !== '||' && untracked(this.planReiter) !== 'zahlen') this.zahlenNeu.set(true);
    });
    effect(() => {
      if (this.stand() && !untracked(this.profilOffen)) this.profilNeu.set(true);
    });
    // Keep the newest message in view.
    afterRenderEffect(() => {
      this.messages();
      this.loading();
      const verlauf = this.verlauf()?.nativeElement;
      verlauf?.scrollTo({ top: verlauf.scrollHeight, behavior: 'smooth' });
    });
  }

  protected start() {
    if (!this.acknowledged) return;
    this.accepted.set(true);
    // Pax "says" its greeting when the start screen appears.
    this.startTalking(BEGRUESSUNG);
  }

  // The tabs share one scrolling column; each tab gets back the position it was left at.
  protected reiterWaehlen(id: PlanReiter) {
    const spalte = this.planSpalte()?.nativeElement;
    if (spalte) this.reiterScroll.set(this.planReiter(), spalte.scrollTop);
    this.planReiter.set(id);
    if (id === 'zahlen') this.zahlenNeu.set(false);
    setTimeout(() => spalte?.scrollTo({ top: this.reiterScroll.get(id) ?? 0 }));
  }

  // Arrow keys move between the tabs, as in any tab list.
  protected reiterTaste(event: KeyboardEvent) {
    const ids = this.reiter().map((r) => r.id);
    const schritt = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!schritt) return;
    event.preventDefault();
    const neu = ids[(ids.indexOf(this.planReiter()) + schritt + ids.length) % ids.length];
    this.reiterWaehlen(neu);
    document.getElementById(`reiter-${neu}`)?.focus();
  }

  protected profilUmschalten() {
    this.profilOffen.update((offen) => !offen);
    this.profilNeu.set(false);
  }

  protected profilZeigen() {
    this.profilOffen.set(true);
    this.profilNeu.set(false);
  }

  // A correction from the advisory state goes through the chat like anything the customer says.
  protected korrigieren(text: string) {
    void this.senden(text);
  }

  // An answer chosen on the question card.
  protected beantworten(text: string) {
    void this.senden(text);
  }

  // A missing value was clicked: start the answer in the input.
  protected nachfragen(label: string) {
    this.vorschlagen(`${label}: `);
  }

  // Starts a sentence in the input, e.g. "Wir haben ein Kind, Jahrgang ", for the customer to finish.
  protected vorschlagen(text: string) {
    this.eingabe()?.vorschlagen(text);
  }

  protected async deleteChat() {
    if (this.loading()) return;
    this.error.set('');
    this.info.set('');
    if (this.sessionId) {
      try {
        await firstValueFrom(this.http.delete('/api/chat', { body: { sessionId: this.sessionId } }));
      } catch {
        this.error.set('Der Chat konnte im Backend nicht gelöscht werden. Bitte erneut versuchen.');
        return;
      }
    }
    this.sessionId = undefined;
    this.stopTalking();
    clearTimeout(this.zeitstrahlTimer);
    this.wartend = [];
    this.ausstehend.set(0);
    this.revision = 0;
    this.verwerfeSzenario();
    this.planReiter.set('weg');
    this.zahlenNeu.set(false);
    this.messages.set([]);
    this.stand.set(null);
    this.eingabe()?.leeren();
    this.info.set('Chat im Browser und im Backend gelöscht. Eine Löschung beim Modellanbieter ist damit nicht garantiert.');
  }

  // What the customer typed and sent.
  protected abschicken(text: string) {
    void this.senden(text);
  }

  private async senden(text: string) {
    if (this.loading()) return;
    this.verwerfeSzenario();
    this.error.set('');
    this.info.set('');
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<ChatAntwort>('/api/chat', {
          message: text,
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
      this.sessionId = res.sessionId;
      this.revision = res.revision;
      this.messages.update((m) => [...m, { role: 'assistant', content: res.reply, frage: res.frage }]);
      this.stand.set(res.beratungsstand);
      this.startTalking(res.reply);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Backend nicht erreichbar');
    } finally {
      this.loading.set(false);
      void this.zeitstrahlSenden();
    }
  }

  protected zeitstrahlAktion(aktion: ZeitstrahlAktion) {
    // A newer change of the same plan replaces the queued one.
    this.wartend = [...this.wartend.filter((a) => aktion.plan === null || a.plan !== aktion.plan), aktion];
    this.ausstehend.set(this.wartend.length + this.unterwegs);
    clearTimeout(this.zeitstrahlTimer);
    this.zeitstrahlTimer = setTimeout(() => void this.zeitstrahlSenden(), 600);
  }

  // Also called when a chat reply finished, because the backend handles one request per session at a time.
  private async zeitstrahlSenden() {
    if (this.loading() || !this.wartend.length) return;
    const aktionen = this.wartend.splice(0, 10);
    this.unterwegs = aktionen.length;
    this.error.set('');
    this.info.set('');
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ChatAntwort>('/api/zeitstrahl', {
          aktionen,
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
      this.sessionId = res.sessionId;
      this.revision = res.revision;
      this.verwerfeSzenario();
      const { uebernommen, abgelehnt } = res.beratungsstand.letzteNachricht;
      this.messages.update((m) => [
        ...m,
        ...uebernommen.map((e): Message => ({ role: 'ereignis', content: e.text })),
        ...abgelehnt.map((e): Message => ({ role: 'ereignis', content: `Nicht übernommen: ${e.text} – ${e.grund}` })),
        { role: 'assistant', content: res.reply, frage: res.frage },
      ]);
      this.stand.set(res.beratungsstand);
      this.startTalking(res.reply);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Backend nicht erreichbar');
    } finally {
      this.unterwegs = 0;
      this.ausstehend.set(this.wartend.length);
      this.loading.set(false);
      void this.zeitstrahlSenden();
    }
  }

  // The avatar "talks" a little longer for longer replies.
  private startTalking(reply: string) {
    this.stopTalking();
    this.talking.set(true);
    const duration = Math.min(4000, Math.max(1200, reply.length * 20));
    this.talkingTimer = setTimeout(() => this.talking.set(false), duration);
  }

  private stopTalking() {
    clearTimeout(this.talkingTimer);
    this.talking.set(false);
  }
}
