import { Component, input, output } from '@angular/core';
import { FrageKarte, type Frage } from '../frage-karte/frage-karte';
import { MarkdownPipe } from '../markdown.pipe';
import { PaxAvatar } from '../pax-avatar/pax-avatar';

export interface Message {
  // 'ereignis': a timeline change, shown as a note between the chat messages.
  role: 'user' | 'assistant' | 'ereignis';
  content: string;
  // Pax's open question, answered with the controls of the question card.
  frage?: Frage | null;
}

/** The conversation: Pax's greeting and replies (with the open question as controls), the customer's turns and timeline notes. */
@Component({
  selector: 'app-chat-verlauf',
  imports: [FrageKarte, MarkdownPipe, PaxAvatar],
  templateUrl: './chat-verlauf.html',
  styleUrl: './chat-verlauf.scss',
})
export class ChatVerlauf {
  readonly messages = input.required<Message[]>();
  readonly begruessung = input.required<string>();
  readonly loading = input(false);
  readonly talking = input(false);
  readonly error = input('');
  // An answer chosen on the question card.
  readonly antwort = output<string>();
}
