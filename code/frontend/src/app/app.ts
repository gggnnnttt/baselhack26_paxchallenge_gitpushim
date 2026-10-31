import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly http = inject(HttpClient);

  protected readonly messages = signal<Message[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected input = '';

  protected async send() {
    const text = this.input.trim();
    if (!text || this.loading()) return;

    this.input = '';
    this.error.set('');
    this.messages.update((m) => [...m, { role: 'user', content: text }]);
    this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.post<{ reply: string }>('/api/chat', { messages: this.messages() }),
      );
      this.messages.update((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      this.error.set(err?.error?.error ?? 'Backend nicht erreichbar');
    } finally {
      this.loading.set(false);
    }
  }
}
