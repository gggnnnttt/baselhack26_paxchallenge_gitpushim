import { randomUUID } from 'node:crypto';
import { GuardrailError, Guardrails } from './guardrails.js';
import { checkScope } from './scope.js';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
// Model payloads are built only from accepted chat turns of the same session.
// Profile or application form values must use a separate data path and never be added here.
export interface ModelRequest { instructions: string; messages: ChatMessage[]; maxOutputTokens: number; responseFormat?: 'scope' }
export interface ModelAdapter { generate(request: ModelRequest): Promise<string> }
interface Session { messages: ChatMessage[]; updated: number; busy: boolean }

// No model SDK or provider-specific checks in this pipeline.
export class ChatService {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly provider: ModelAdapter, private readonly rails: Guardrails, private readonly instructions: string) {
    if (!instructions.trim()) throw new Error('Advisor-Instruktionen fehlen.');
  }

  async reply(body: unknown): Promise<{ reply: string; sessionId: string }> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GuardrailError('Ungültige Nachricht.', 400);
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'message' && key !== 'sessionId')) throw new GuardrailError('Nur Nachricht und Sitzungskennung sind erlaubt.', 400);
    const content = this.rails.checkInput(input['message']);
    if (input['sessionId'] !== undefined && typeof input['sessionId'] !== 'string') throw new GuardrailError('Ungültige Sitzung.', 400);
    const now = Date.now();
    this.removeExpired(now);
    const existingId = input['sessionId'] as string | undefined;
    const existing = existingId ? this.sessions.get(existingId) : undefined;
    if (existingId !== undefined && !existing) throw new GuardrailError('Die Sitzung ist abgelaufen. Bitte starte einen neuen Chat.', 410);
    if (existing?.busy) throw new GuardrailError('Bitte warte auf die laufende Antwort.', 409);
    if (!existing && this.sessions.size >= this.rails.config.maxSessions) throw new GuardrailError('Der Chat ist gerade ausgelastet. Bitte später erneut versuchen.', 503);
    const sessionId = existingId ?? randomUUID();
    const session = existing ?? { messages: [], updated: now, busy: false };
    const userMessage: ChatMessage = { role: 'user', content };
    if (session.messages.length + 2 > this.rails.config.maxHistoryMessages) throw new GuardrailError('Die maximale Gesprächslänge ist erreicht. Bitte starte einen neuen Chat.', 409);
    session.busy = true;
    // Reserve capacity while awaiting the provider. Never persist raw/rejected content.
    this.sessions.set(sessionId, session);
    try {
      const context = [...session.messages.map(message => ({ ...message })), userMessage];
      await checkScope(this.provider, context);
      const candidate = await this.provider.generate({
        instructions: this.instructions,
        messages: context,
        maxOutputTokens: this.rails.config.maxOutputTokens,
      });
      const reply = this.rails.checkOutput(candidate);
      // Deleted while the provider call was running: keep nothing and return nothing.
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      session.messages.push(userMessage, { role: 'assistant', content: reply });
      session.updated = Date.now();
      return { reply, sessionId };
    } catch (error) {
      if (!existing && this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Der Modelldienst ist momentan nicht verfügbar. Bitte versuche es erneut.', 503);
    } finally {
      session.busy = false;
    }
  }

  // Removes the server-side history only. Copies already sent to the model provider are not affected.
  deleteSession(body: unknown): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GuardrailError('Ungültige Anfrage.', 400);
    const input = body as Record<string, unknown>;
    const sessionId = input['sessionId'];
    if (Object.keys(input).some(key => key !== 'sessionId') || typeof sessionId !== 'string' || !sessionId || sessionId.length > 100) {
      throw new GuardrailError('Ungültige Sitzung.', 400);
    }
    // Unknown or expired ids are treated as already deleted.
    this.sessions.delete(sessionId);
  }

  removeExpired(now = Date.now()): void {
    for (const [id, session] of this.sessions) {
      if (!session.busy && now - session.updated > this.rails.config.sessionTtlMinutes * 60000) this.sessions.delete(id);
    }
  }

  get sessionCount(): number { return this.sessions.size; }
}
