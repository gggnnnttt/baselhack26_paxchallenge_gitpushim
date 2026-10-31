import { Component, ElementRef, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownPipe } from './markdown.pipe';
import { firstValueFrom } from 'rxjs';
import { BeratungsstandPanel } from './beratungsstand/beratungsstand';
import type { Beratungsstand } from './beratungsstand/beratungsstand.model';
import { PaxAvatar, type PaxAvatarState } from './pax-avatar/pax-avatar';
import { BeispielText } from './beispiel-text/beispiel-text';
import { FrageKarte, type Frage } from './frage-karte/frage-karte';
import { Zeitstrahl } from './zeitstrahl/zeitstrahl';
import type { ZeitstrahlAktion } from './zeitstrahl/zeitstrahl.model';

interface Message {
  // 'ereignis': a timeline change, shown as a note between the chat messages.
  role: 'user' | 'assistant' | 'ereignis';
  content: string;
  // Pax's open question, answered with the controls of the question card.
  frage?: Frage | null;
}

interface ChatAntwort { reply: string; frage: Frage | null; sessionId: string; beratungsstand: Beratungsstand }

// Pax's speech bubble on the start screen, kept as its first message once the conversation runs. Not sent to the backend.
const BEGRUESSUNG = 'Erzähl mir kurz, wie du lebst und was du vorhast. Ich zeige dir, wo du bei der Vorsorge stehst.';

// Common situations on the start screen; a click starts the message, the customer adds the details.
const EINSTIEGE = ['Wir erwarten ein Kind', 'Ich mache mich selbstständig', 'Wir möchten ein Haus kaufen', 'Ich möchte früher in Pension'];

// Below this width the profile starts collapsed, so the conversation keeps its room.
const PROFIL_OFFEN_AB = 1680;

@Component({
  imports: [FormsModule, NgTemplateOutlet, BeratungsstandPanel, MarkdownPipe, PaxAvatar, Zeitstrahl, BeispielText, FrageKarte],
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
  protected readonly einstiege = EINSTIEGE;
  // The start screen shows only Pax and the input; the conversation view takes over with the first message.
  protected readonly gestartet = computed(() => this.messages().length > 0 || this.loading());
  protected readonly status = computed(() =>
    this.loading() ? 'denkt nach …' : this.talking() ? 'antwortet' : 'dein Vorsorge-Berater',
  );
  protected readonly fokussiert = signal(false);
  // How far the risk calculation is: the values it has against the values it still needs.
  protected readonly fortschritt = computed(() => {
    const s = this.stand();
    if (!s) return null;
    // Values for the advice (e.g. assets) count too: the conversation is only complete with them.
    const vorhanden = s.risiko.vorhanden.length + (s.profil.haushalt.vermoegen ? 1 : 0);
    const fehlend = s.risiko.fehlend.length;
    const offen = s.offen?.length ?? 0;
    const angaben = (n: number) => `${n} ${n === 1 ? 'Angabe' : 'Angaben'}`;
    const berechnet = s.phase === 'berechnet';
    const fertig = berechnet && !offen;
    const text = fehlend
      ? `Noch ${angaben(fehlend)} bis zur Berechnung`
      : berechnet
        ? offen ? `Berechnung liegt vor, ${angaben(offen)} offen` : 'Berechnung liegt vor'
        : offen ? `Noch ${angaben(offen)} offen` : 'Alle Angaben erfasst';
    return { anteil: fertig ? 1 : vorhanden / Math.max(1, vorhanden + fehlend + offen), text, fertig };
  });
  // The left sidebar; while it is collapsed a dot marks new values from Pax.
  protected readonly profilOffen = signal(typeof window === 'undefined' || window.innerWidth >= PROFIL_OFFEN_AB);
  protected readonly profilNeu = signal(false);
  private readonly verlauf = viewChild<ElementRef<HTMLElement>>('verlauf');
  private readonly eingabe = viewChild<ElementRef<HTMLTextAreaElement>>('eingabe');
  protected input = '';
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

  protected profilUmschalten() {
    this.profilOffen.update((offen) => !offen);
    this.profilNeu.set(false);
  }

  protected profilZeigen() {
    this.profilOffen.set(true);
    this.profilNeu.set(false);
  }

  // Enter sends, Shift+Enter starts a new line.
  protected taste(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  // The input grows with its text up to a few lines.
  protected hoeheAnpassen() {
    const feld = this.eingabe()?.nativeElement;
    if (!feld) return;
    // Empty: no fixed height, so the CSS of the current view applies (the start screen's input is taller).
    if (!feld.value) {
      feld.style.height = '';
      return;
    }
    feld.style.height = 'auto';
    feld.style.height = `${Math.min(feld.scrollHeight, 160)}px`;
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
    this.input = text;
    const feld = this.eingabe()?.nativeElement;
    feld?.focus();
    setTimeout(() => {
      feld?.setSelectionRange(this.input.length, this.input.length);
      this.hoeheAnpassen();
    });
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
    this.messages.set([]);
    this.stand.set(null);
    this.input = '';
    this.info.set('Chat im Browser und im Backend gelöscht. Eine Löschung beim Modellanbieter ist damit nicht garantiert.');
  }

  protected send() {
    const text = this.input.trim();
    if (!text || this.loading()) return;
    this.input = '';
    setTimeout(() => this.hoeheAnpassen());
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
