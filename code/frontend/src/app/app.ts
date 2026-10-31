import { Component, ElementRef, afterRenderEffect, computed, inject, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarkdownPipe } from './markdown.pipe';
import { firstValueFrom } from 'rxjs';
import { BeratungsstandPanel } from './beratungsstand/beratungsstand';
import type { Beratungsstand } from './beratungsstand/beratungsstand.model';
import { PaxAvatar, type PaxAvatarState } from './pax-avatar/pax-avatar';
import { BeispielText } from './beispiel-text/beispiel-text';
import { Zeitstrahl } from './zeitstrahl/zeitstrahl';
import type { ZeitstrahlAktion } from './zeitstrahl/zeitstrahl.model';

interface Message {
  // 'ereignis': a timeline change, shown as a note between the chat messages.
  role: 'user' | 'assistant' | 'ereignis';
  content: string;
}

interface ChatAntwort { reply: string; sessionId: string; beratungsstand: Beratungsstand }

// Pax's speech bubble on the start screen, kept as its first message once the conversation runs. Not sent to the backend.
const BEGRUESSUNG = 'Erzähl mir kurz, wie du lebst und was du vorhast. Ich zeige dir, wo du bei der Vorsorge stehst.';

@Component({
  imports: [FormsModule, NgTemplateOutlet, BeratungsstandPanel, MarkdownPipe, PaxAvatar, Zeitstrahl, BeispielText],
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
  protected readonly fokussiert = signal(false);
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
    feld.style.height = 'auto';
    feld.style.height = `${Math.min(feld.scrollHeight, 160)}px`;
  }

  // A correction from the advisory state goes through the chat like anything the customer says.
  protected korrigieren(text: string) {
    void this.senden(text);
  }

  // A missing value was clicked: start the answer in the input.
  protected nachfragen(label: string) {
    this.input = `${label}: `;
    const feld = this.eingabe()?.nativeElement;
    feld?.focus();
    setTimeout(() => feld?.setSelectionRange(this.input.length, this.input.length));
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
      this.messages.update((m) => [...m, { role: 'assistant', content: res.reply }]);
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
        { role: 'assistant', content: res.reply },
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
