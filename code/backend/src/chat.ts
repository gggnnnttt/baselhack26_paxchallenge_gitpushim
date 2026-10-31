import { SzenarioAnfrage, SzenarioUebernahme, szenarioProfil, vergleichswerte, type SzenarioVergleich } from './beratung/szenario.js';
import { randomUUID } from 'node:crypto';
import type { RisikoRechner } from './berechnung/apicalc.js';
import { Beratungsablauf, type AblaufStand } from './beratung/ablauf.js';
import { ANTWORT_FORMAT, ANTWORT_REGELN, leseAntwort, type AdvisorAntwort, type Frage } from './beratung/antwort.js';
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
// `frage`: at most one question, shown with a fitting control in the browser.
// `revision`: counts accepted profile changes; a scenario comparison is only valid for the revision it was computed on.
export interface ChatAntwort { reply: string; frage: Frage | null; sessionId: string; beratungsstand: BeratungsstandAnsicht; revision: number }
// `entfernt`: older turns dropped from `messages`, so message numbers in the profile stay stable.
interface Session {
  messages: ChatMessage[]; entfernt: number; updated: number; busy: boolean; ablauf: AblaufStand; revision: number;
  szenario?: { vergleich: SzenarioVergleich; ablauf: AblaufStand; beleg: string };
}

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
    const session = existing ?? this.neueSitzung(now);
    const userMessage: ChatMessage = { role: 'user', content };
    session.busy = true;
    // Reserve capacity while awaiting the provider. Never persist raw/rejected content.
    this.sessions.set(sessionId, session);
    try {
      const context = [...session.messages.map(message => ({ ...message })), userMessage];
      await checkScope(this.provider, context);
      // Profile changes and calculations are worked out on copies and only committed with an accepted reply.
      const vorher = session.ablauf.kontext.profil;
      const aenderungen = await extrahiereAenderungen(this.provider, vorher, context, this.heute());
      const angewendet = wendeAenderungenAn(vorher, aenderungen, { text: content, index: session.entfernt + session.messages.length, jahr: session.ablauf.kontext.jahr });
      const ablauf = await this.ablauf.aktualisiere(session.ablauf, angewendet.profil);
      const antwort = await this.antworten(`${this.instructions}\n\n${beratungsKontext(ablauf, angewendet)}`, context);
      // Deleted while the provider call was running: keep nothing and return nothing.
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      this.anhaengen(session, userMessage, antwort.verlauf);
      session.ablauf = ablauf;
      session.revision++;
      delete session.szenario;
      session.updated = Date.now();
      return { reply: antwort.text, frage: antwort.frage, sessionId, revision: session.revision, beratungsstand: ansicht(ablauf, angewendet) };
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
      const angewendet = wendeZeitstrahlAn(vorher, aktionen, { index: session.entfernt + session.messages.length, jahr: session.ablauf.kontext.jahr });
      if (!angewendet.uebernommen.length) throw new GuardrailError(angewendet.abgelehnt[0]?.grund ?? 'Im Zeitstrahl hat sich nichts geändert.', 422);
      const ablauf = await this.ablauf.aktualisiere(session.ablauf, angewendet.profil);
      const userMessage: ChatMessage = { role: 'user', content: ZEITSTRAHL_NACHRICHT };
      const antwort = await this.antworten(
        `${this.instructions}\n\n${beratungsKontext(ablauf, angewendet)}\n\n${zeitstrahlKontext(angewendet)}`,
        [...session.messages.map(message => ({ ...message })), userMessage],
      );
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      this.anhaengen(session, userMessage, antwort.verlauf);
      session.ablauf = ablauf;
      // A timeline change is a profile change like a chat answer: an open scenario was computed on the old state.
      session.revision++;
      delete session.szenario;
      session.updated = Date.now();
      return { reply: antwort.text, frage: antwort.frage, sessionId, revision: session.revision, beratungsstand: ansicht(ablauf, angewendet) };
    } catch (error) {
      if (!existing && this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Der Modelldienst ist momentan nicht verfügbar. Bitte versuche es erneut.', 503);
    } finally {
      session.busy = false;
    }
  }

  // The advisor's reply: short text and at most one question, checked by the output guardrails.
  private async antworten(instructions: string, messages: ChatMessage[]): Promise<AdvisorAntwort> {
    const roh = await this.provider.generate({
      instructions: `${instructions}\n\n${ANTWORT_REGELN}`,
      messages,
      maxOutputTokens: this.rails.config.maxOutputTokens,
      responseFormat: ANTWORT_FORMAT,
    });
    return leseAntwort(roh, text => this.rails.checkOutput(text));
  }

  // Same session rules as in reply(); the timeline may also start a conversation.
  private oeffneSitzung(existingId: string | undefined): { sessionId: string; session: Session; existing: Session | undefined } {
    const now = Date.now();
    this.removeExpired(now);
    const existing = existingId ? this.sessions.get(existingId) : undefined;
    if (existingId !== undefined && !existing) throw new GuardrailError('Die Sitzung ist abgelaufen. Bitte starte einen neuen Chat.', 410);
    if (existing?.busy) throw new GuardrailError('Bitte warte auf die laufende Antwort.', 409);
    if (!existing && this.sessions.size >= this.rails.config.maxSessions) throw new GuardrailError('Der Chat ist gerade ausgelastet. Bitte später erneut versuchen.', 503);
    const session = existing ?? this.neueSitzung(now);
    return { sessionId: existingId ?? randomUUID(), session, existing };
  }

  private neueSitzung(now: number): Session {
    return { messages: [], entfernt: 0, updated: now, busy: false, revision: 0, ablauf: this.ablauf.start(this.heute().getFullYear()) };
  }

  /**
   * Stores an accepted turn. The conversation has no fixed end: only the newest turns are kept as model context,
   * older ones are dropped in pairs. What they said stays in the advisory state (profile, plans, calculation),
   * which every reply receives in its instructions.
   */
  private anhaengen(session: Session, userMessage: ChatMessage, antwort: string): void {
    session.messages.push(userMessage, { role: 'assistant', content: antwort });
    const grenze = Math.max(2, this.rails.config.maxHistoryMessages - (this.rails.config.maxHistoryMessages % 2));
    const zuViel = session.messages.length - grenze;
    if (zuViel > 0) {
      session.messages.splice(0, zuViel);
      session.entfernt += zuViel;
    }
  }

  private szenarioSession(sessionId: string, revision: number): Session {
    this.removeExpired();
    const session = this.sessions.get(sessionId);
    if (!session) throw new GuardrailError('Die Sitzung ist abgelaufen. Bitte starte einen neuen Chat.', 410);
    if (session.busy) throw new GuardrailError('Bitte warte auf die laufende Berechnung.', 409);
    if (session.revision !== revision) throw new GuardrailError('Die Ausgangslage hat sich geändert. Bitte den Vergleich neu berechnen.', 409);
    return session;
  }

  async vergleicheSzenario(body: unknown): Promise<SzenarioVergleich> {
    const parsed = SzenarioAnfrage.safeParse(body);
    if (!parsed.success) throw new GuardrailError('Bitte einen gültigen Jahresbedarf zwischen CHF 0 und CHF 1’000’000 angeben.', 400);
    const { sessionId, revision, jahresbedarf } = parsed.data;
    const session = this.szenarioSession(sessionId, revision);
    const ausgangslage = vergleichswerte(session.ablauf);
    if (Math.abs(ausgangslage.bedarfJahr - jahresbedarf) < 0.01) throw new GuardrailError('Bitte einen anderen Jahresbedarf als in der Ausgangslage wählen.', 400);
    session.busy = true;
    delete session.szenario;
    try {
      const kopie = szenarioProfil(session.ablauf, jahresbedarf, session.entfernt + session.messages.length);
      const ablauf = await this.ablauf.aktualisiere(session.ablauf, kopie.profil);
      const alternative = vergleichswerte(ablauf);
      if (this.sessions.get(sessionId) !== session) throw new GuardrailError('Dieser Chat wurde gelöscht.', 410);
      const vergleich: SzenarioVergleich = {
        id: randomUUID(), revision, ausgangslage, alternative,
        hinweise: [...session.ablauf.pensionierung.pruefung.hinweise,
          ...session.ablauf.sparen.hinweise,
          'Nur der gewünschte jährliche Haushaltsbedarf im Ruhestand wurde verändert. Einkommen, PK, Vermögen, Pensionierungsalter und Monatsbudget bleiben gleich.',
          'Die Alternative verändert deine aktuellen Angaben erst nach ausdrücklicher Übernahme. Kein Produktangebot und keine Garantie.'],
      };
      session.szenario = { vergleich, ablauf, beleg: kopie.beleg };
      session.updated = Date.now();
      return vergleich;
    } catch (error) {
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Die Alternative konnte nicht berechnet werden. Deine Ausgangslage bleibt erhalten.', 503);
    } finally { session.busy = false; }
  }

  uebernehmeSzenario(body: unknown): ChatAntwort & { userMessage: string } {
    const parsed = SzenarioUebernahme.safeParse(body);
    if (!parsed.success) throw new GuardrailError('Ungültige Szenarioübernahme.', 400);
    const { sessionId, revision, szenarioId } = parsed.data;
    const session = this.szenarioSession(sessionId, revision);
    const s = session.szenario;
    if (!s || s.vergleich.id !== szenarioId || s.vergleich.revision !== revision) throw new GuardrailError('Dieser Vergleich ist nicht mehr aktuell. Bitte neu berechnen.', 409);
    const reply = `Das berechnete Pensionierungsziel mit CHF ${s.vergleich.alternative.bedarfJahr.toLocaleString('de-CH')} Bedarf pro Jahr wurde übernommen. Alle anderen Angaben bleiben gleich. Berechnung, Budgetabgleich und Handlungsplan wurden aktualisiert. Es gelten weiterhin die bestätigten Basisannahmen.`;
    // Explicit form confirmation is retained as a transparent turn, so future extraction
    // and explanation know the accepted change rather than reviving the old chat value.
    this.anhaengen(session, { role: 'user', content: s.beleg }, reply);
    session.ablauf = s.ablauf;
    session.revision++;
    session.updated = Date.now();
    delete session.szenario;
    return { sessionId, revision: session.revision, reply, frage: null, userMessage: s.beleg,
      beratungsstand: ansicht(session.ablauf, { uebernommen: [{ feld: 'bedarf_pensionierung', text: s.beleg }], abgelehnt: [] }) };
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
