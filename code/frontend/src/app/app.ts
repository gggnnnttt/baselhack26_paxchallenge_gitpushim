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
import { EmpfehlungenSeite } from './empfehlungen/empfehlungen-seite';
import { PlanLagebild } from './plan/plan-lagebild';
import { Zeitstrahl } from './zeitstrahl/zeitstrahl';
import type { ZeitstrahlAktion } from './zeitstrahl/zeitstrahl.model';

type PlanReiter = 'lagebild' | 'weg';

interface ChatAntwort { reply: string; frage: Frage | null; sessionId: string; revision: number; beratungsstand: Beratungsstand }

// Pax's speech bubble on the start screen, kept as its first message once the conversation runs. Not sent to the backend.
const BEGRUESSUNG = 'Erzähl mir kurz, wie du lebst und was du vorhast. Ich zeige dir, wo du bei der Vorsorge stehst.';

// Common situations on the start screen; a click starts the message, the customer adds the details.

// Below this width the profile starts collapsed, so the conversation keeps its room.
const PROFIL_OFFEN_AB = 1680;

@Component({
  imports: [FormsModule, NgTemplateOutlet, BeratungsstandPanel, ChatEingabe, ChatVerlauf, EmpfehlungenSeite, PaxAvatar, PlanLagebild, Zeitstrahl],
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
  // How well Pax knows the customer, in their words: no calculation steps, only the way to the recommendations.
  protected readonly fortschritt = computed(() => {
    const l = this.stand()?.lagebild;
    if (!l) return null;
    const fertig = l.phase === 'empfehlen';
    const text = fertig ? 'Deine Empfehlungen sind bereit' : l.phase === 'rechnen' ? 'Pax rechnet für dich' : 'Pax lernt dich kennen';
    return { anteil: fertig ? 1 : Math.min(0.95, l.verstanden), text, fertig };
  });
  // The plan in the middle column; each tab keeps its own scroll position.
  protected readonly planReiter = signal<PlanReiter>('lagebild');
  private readonly planSpalte = viewChild<ElementRef<HTMLElement>>('planSpalte');
  private readonly reiterScroll = new Map<PlanReiter, number>();
  protected readonly reiter = [
    { id: 'lagebild' as const, label: 'Lagebild' },
    { id: 'weg' as const, label: 'Lebensweg' },
  ];
  // Once Pax understands enough to recommend, it leads to its own page with the recommendations.
  protected readonly seite = signal<'beratung' | 'empfehlungen'>('beratung');
  protected readonly empfehlungBereit = computed(() => this.stand()?.lagebild.phase === 'empfehlen');
  // The left sidebar; while it is collapsed a dot marks new values from Pax.
  protected readonly profilOffen = signal(typeof window === 'undefined' || window.innerWidth >= PROFIL_OFFEN_AB);
  protected readonly profilNeu = signal(false);
  private readonly verlauf = viewChild<ElementRef<HTMLElement>>('verlauf');
  private readonly eingabe = viewChild(ChatEingabe);
  private sessionId: string | undefined;

  private talkingTimer: ReturnType<typeof setTimeout> | undefined;
  // Timeline changes are collected briefly and sent together, so dragging several plans gives one reply.
  private wartend: ZeitstrahlAktion[] = [];
  private unterwegs = 0;
  private zeitstrahlTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly ausstehend = signal(0);

  constructor() {
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
  protected seiteWechseln(seite: 'beratung' | 'empfehlungen') {
    this.seite.set(seite);
    window.scrollTo({ top: 0 });
  }

  protected reiterWaehlen(id: PlanReiter) {
    const spalte = this.planSpalte()?.nativeElement;
    if (spalte) this.reiterScroll.set(this.planReiter(), spalte.scrollTop);
    this.planReiter.set(id);
    setTimeout(() => spalte?.scrollTo({ top: this.reiterScroll.get(id) ?? 0 }));
  }

  // Arrow keys move between the tabs, as in any tab list.
  protected reiterTaste(event: KeyboardEvent) {
    const ids = this.reiter.map((r) => r.id);
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

  // The progress in the chat header leads to what it describes: the recommendations or the Lagebild.
  protected fortschrittOeffnen() {
    if (this.fortschritt()?.fertig) this.seiteWechseln('empfehlungen');
    else this.reiterWaehlen('lagebild');
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
    this.planReiter.set('lagebild');
    this.seite.set('beratung');
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
