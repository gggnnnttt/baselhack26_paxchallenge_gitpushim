import { SzenarioPanel } from './szenario/szenario';
import type { SzenarioVergleich } from './szenario/szenario.model';
import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { BeratungsstandPanel } from './beratungsstand/beratungsstand';
import type { Beratungsstand } from './beratungsstand/beratungsstand.model';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  imports: [FormsModule, NgTemplateOutlet, BeratungsstandPanel, SzenarioPanel],
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
  protected input = '';
  private sessionId: string | undefined;
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
      const res = await firstValueFrom(this.http.post<{ reply: string; userMessage: string; revision: number; beratungsstand: Beratungsstand }>('/api/szenario/uebernehmen', {
        sessionId: this.sessionId, revision: this.revision, szenarioId: v.id,
      }));
      this.revision = res.revision;
      this.stand.set(res.beratungsstand);
      this.messages.update(m => [...m, { role: 'user', content: res.userMessage }, { role: 'assistant', content: res.reply }]);
      this.verwerfeSzenario();
      this.info.set('Das alternative Ruhestandsziel wurde übernommen. Der Beratungsstand ist aktualisiert.');
    } catch (err: any) { this.szenarioFehler.set(err?.error?.error ?? 'Das Ziel konnte nicht übernommen werden.'); }
    finally { this.loading.set(false); }
  }

  protected start() {
    if (this.acknowledged) this.accepted.set(true);
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
    this.revision = 0;
    this.verwerfeSzenario();
    this.messages.set([]);
    this.stand.set(null);
    this.input = '';
    this.info.set('Chat im Browser und im Backend gelöscht. Eine Löschung beim Modellanbieter ist damit nicht garantiert.');
  }

  protected bereiteAktionVor(nachricht: string) {
    if (this.loading()) return;
    this.input = nachricht;
    this.info.set('Nachrichtenvorschlag eingefügt. Prüfe oder ändere ihn und klicke auf „Senden“.');
  }

  protected async send() {
    const text = this.input.trim();
    if (!text || this.loading()) return;

    this.input = '';
    this.verwerfeSzenario();
    this.error.set('');
    this.info.set('');
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<{ reply: string; sessionId: string; revision: number; beratungsstand: Beratungsstand }>('/api/chat', {
          message: text,
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
      this.sessionId = res.sessionId;
      this.revision = res.revision;
      this.messages.update((m) => [...m, { role: 'assistant', content: res.reply }]);
      this.stand.set(res.beratungsstand);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Backend nicht erreichbar');
    } finally {
      this.loading.set(false);
    }
  }
}
