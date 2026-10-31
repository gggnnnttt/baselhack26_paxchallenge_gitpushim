import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  imports: [FormsModule, NgTemplateOutlet],
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
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected input = '';
  private sessionId: string | undefined;

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
    this.messages.set([]);
    this.input = '';
    this.info.set('Chat im Browser und im Backend gelöscht. Eine Löschung beim Modellanbieter ist damit nicht garantiert.');
  }

  protected async send() {
    const text = this.input.trim();
    if (!text || this.loading()) return;

    this.input = '';
    this.error.set('');
    this.info.set('');
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<{ reply: string; sessionId: string }>('/api/chat', {
          message: text,
          ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        }),
      );
      this.sessionId = res.sessionId;
      this.messages.update((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Backend nicht erreichbar');
    } finally {
      this.loading.set(false);
    }
  }
}
