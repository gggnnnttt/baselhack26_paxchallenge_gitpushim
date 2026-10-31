import { randomUUID } from 'node:crypto';
import type { RisikoRechner } from './berechnung/apicalc.js';
import { Beratungsablauf, type AblaufStand } from './beratung/ablauf.js';
import { ansicht, beratungsKontext, type BeratungsstandAnsicht } from './beratung/darstellung.js';
import { neueTexte, wendeZeitstrahlAn, ZEITSTRAHL_NACHRICHT, ZeitstrahlAnfrage, zeitstrahlKontext } from './beratung/zeitstrahl.js';
import { GuardrailError, Guardrails } from './guardrails.js';
import { wendeAenderungenAn } from './profil/aenderungen.js';
import { extrahiereAenderungen } from './profil/extraktion.js';
import { checkScope } from './scope.js';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
// Model payloads are built only from accepted chat turns of the same session.
// Profile or application form values must use a separate data path and never be added here.
// Timeline changes are such form values: their turn is stored as the fixed ZEITSTRAHL_NACHRICHT.
// The advisory state (profile, calculation) is derived from these chat turns and goes the same way.
export interface ModelRequest { instructions: string; messages: ChatMessage[]; maxOutputTokens: number; responseFormat?: StrukturFormat }
// Provider-neutral request for a strict JSON answer; adapters map it to their structured-output feature.
export interface StrukturFormat { name: string; schema: Record<string, unknown> }
export interface ModelAdapter { generate(request: ModelRequest): Promise<string> }
export interface ChatOptionen { rechner?: RisikoRechner | null; heute?: () => Date }
export interface ChatAntwort { reply: string; sessionId: string; beratungsstand: BeratungsstandAnsicht }
interface Session { messages: ChatMessage[]; updated: number; busy: boolean; ablauf: AblaufStand }

// No model SDK or provider-specific checks in this pipeline.
export class ChatService {
  private readonly sessions = new Map<string, Session>();
  private readonly ablauf: Beratungsablauf;
  private readonly heute: () => Date;
  constructor(private readonly provider: ModelAdapter, private readonly rails: Guardrails, private readonly instructions: string, optionen: ChatOptionen = {}) {
    if (!instructions.trim()) throw new Error('Advisor-Instruktionen fehlen.');
    this.ablauf = new Beratungsablauf(optionen.rechner ?? null);
    this.heute = optionen.heute ?? (() => new Date());
  }

  async reply(body: unknown): Promise<ChatAntwort> {
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
    const session = existing ?? { messages: [], updated: now, busy: false, ablauf: this.ablauf.start(this.heute().getFullYear()) };
    const userMessage: ChatMessage = { role: 'user', content };
    if (session.messages.length + 2 > this.rails.config.maxHistoryMessages) throw new GuardrailError('Die maximale Gesprächslänge ist erreicht. Bitte starte einen neuen Chat.', 409);
    session.busy = true;
    // Reserve capacity while awaiting the provider. Never persist raw/rejected content.
    this.sessions.set(sessionId, session);
    try {
      const context = [...session.messages.map(message => ({ ...message })), userMessage];
      await checkScope(this.provider, context);
      // Profile changes and calculations are worked out on copies and only committed with an accepted reply.
      const vorher = session.ablauf.kontext.profil;
      const aenderungen = await extrahiereAenderungen(this.provider, vorher, context, this.heute());
      const angewendet = wendeAenderungenAn(vorher, aenderungen, { text: content, index: session.messages.length, jahr: session.ablauf.kontext.jahr });
      const ablauf = await this.ablauf.aktualisiere(session.ablauf, angewendet.profil);
      const candidate = await this.provider.generate({
        instructions: `${this.instructions}\n\n${beratungsKontext(ablauf, angewendet)}`,
        messages: context,
        maxOutputTokens: this.rails.config.maxOutputTokens,
      });
      const reply = this.rails.checkOutput(candidate);
      // Deleted while the provider call was running: keep nothing and return nothing.
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      session.messages.push(userMessage, { role: 'assistant', content: reply });
      session.ablauf = ablauf;
      session.updated = Date.now();
      return { reply, sessionId, beratungsstand: ansicht(ablauf, angewendet) };
    } catch (error) {
      if (!existing && this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Der Modelldienst ist momentan nicht verfügbar. Bitte versuche es erneut.', 503);
    } finally {
      session.busy = false;
    }
  }

  /**
   * Applies plan changes from the timeline to the profile and lets the advisor react to them in a reply.
   * The values reach the model only through the advisory state in the instructions, see ZEITSTRAHL_NACHRICHT.
   */
  async zeitstrahl(body: unknown): Promise<ChatAntwort> {
    const anfrage = ZeitstrahlAnfrage.safeParse(body);
    if (!anfrage.success) throw new GuardrailError('Ungültige Änderung im Zeitstrahl.', 400);
    // Free text from the timeline passes the same input guardrails as a chat message.
    const aktionen = anfrage.data.aktionen.map(a => (a.typ === 'speichern'
      ? { ...a, beschreibung: this.rails.checkInput(a.beschreibung), notiz: a.notiz.trim() ? this.rails.checkInput(a.notiz) : '' }
      : a));
    const { sessionId, session, existing } = this.oeffneSitzung(anfrage.data.sessionId);
    session.busy = true;
    this.sessions.set(sessionId, session);
    try {
      const vorher = session.ablauf.kontext.profil;
      const texte = neueTexte(vorher, aktionen);
      if (texte.length) await checkScope(this.provider, [...session.messages, { role: 'user', content: texte.join('\n') }]);
      const angewendet = wendeZeitstrahlAn(vorher, aktionen, { index: session.messages.length, jahr: session.ablauf.kontext.jahr });
      if (!angewendet.uebernommen.length) throw new GuardrailError(angewendet.abgelehnt[0]?.grund ?? 'Im Zeitstrahl hat sich nichts geändert.', 422);
      const ablauf = await this.ablauf.aktualisiere(session.ablauf, angewendet.profil);
      const userMessage: ChatMessage = { role: 'user', content: ZEITSTRAHL_NACHRICHT };
      const candidate = await this.provider.generate({
        instructions: `${this.instructions}\n\n${beratungsKontext(ablauf, angewendet)}\n\n${zeitstrahlKontext(angewendet)}`,
        messages: [...session.messages.map(message => ({ ...message })), userMessage],
        maxOutputTokens: this.rails.config.maxOutputTokens,
      });
      const reply = this.rails.checkOutput(candidate);
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      session.messages.push(userMessage, { role: 'assistant', content: reply });
      session.ablauf = ablauf;
      session.updated = Date.now();
      return { reply, sessionId, beratungsstand: ansicht(ablauf, angewendet) };
    } catch (error) {
      if (!existing && this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Der Modelldienst ist momentan nicht verfügbar. Bitte versuche es erneut.', 503);
    } finally {
      session.busy = false;
    }
  }

  // Same session rules as in reply(); the timeline may also start a conversation.
  private oeffneSitzung(existingId: string | undefined): { sessionId: string; session: Session; existing: Session | undefined } {
    const now = Date.now();
    this.removeExpired(now);
    const existing = existingId ? this.sessions.get(existingId) : undefined;
    if (existingId !== undefined && !existing) throw new GuardrailError('Die Sitzung ist abgelaufen. Bitte starte einen neuen Chat.', 410);
    if (existing?.busy) throw new GuardrailError('Bitte warte auf die laufende Antwort.', 409);
    if (!existing && this.sessions.size >= this.rails.config.maxSessions) throw new GuardrailError('Der Chat ist gerade ausgelastet. Bitte später erneut versuchen.', 503);
    const session = existing ?? { messages: [], updated: now, busy: false, ablauf: this.ablauf.start(this.heute().getFullYear()) };
    if (session.messages.length + 2 > this.rails.config.maxHistoryMessages) throw new GuardrailError('Die maximale Gesprächslänge ist erreicht. Bitte starte einen neuen Chat.', 409);
    return { sessionId: existingId ?? randomUUID(), session, existing };
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
