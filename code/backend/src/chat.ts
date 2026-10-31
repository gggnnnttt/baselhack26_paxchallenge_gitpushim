import { SzenarioAnfrage, SzenarioUebernahme, szenarioProfil, vergleichswerte, type SzenarioVergleich } from './beratung/szenario.js';
import { randomUUID } from 'node:crypto';
import type { RisikoRechner } from './berechnung/apicalc.js';
import { Beratungsablauf, type AblaufStand } from './beratung/ablauf.js';
import { ansicht, beratungsKontext, type BeratungsstandAnsicht } from './beratung/darstellung.js';
import { GuardrailError, Guardrails } from './guardrails.js';
import { wendeAenderungenAn } from './profil/aenderungen.js';
import { extrahiereAenderungen } from './profil/extraktion.js';
import { checkScope } from './scope.js';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
// Model payloads are built only from accepted chat turns of the same session.
// Profile or application form values must use a separate data path and never be added here.
// The advisory state (profile, calculation) is derived from these chat turns and goes the same way.
export interface ModelRequest { instructions: string; messages: ChatMessage[]; maxOutputTokens: number; responseFormat?: StrukturFormat }
// Provider-neutral request for a strict JSON answer; adapters map it to their structured-output feature.
export interface StrukturFormat { name: string; schema: Record<string, unknown> }
export interface ModelAdapter { generate(request: ModelRequest): Promise<string> }
export interface ChatOptionen { rechner?: RisikoRechner | null; heute?: () => Date }
export interface ChatAntwort { reply: string; sessionId: string; beratungsstand: BeratungsstandAnsicht; revision: number }
interface Session { messages: ChatMessage[]; updated: number; busy: boolean; ablauf: AblaufStand; revision: number; szenario?: { vergleich: SzenarioVergleich; ablauf: AblaufStand; beleg: string } }

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
    const session = existing ?? { messages: [], updated: now, busy: false, revision: 0, ablauf: this.ablauf.start(this.heute().getFullYear()) };
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
      session.revision++;
      delete session.szenario;
      session.updated = Date.now();
      return { reply, sessionId, revision: session.revision, beratungsstand: ansicht(ablauf, angewendet) };
    } catch (error) {
      if (!existing && this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
      if (error instanceof GuardrailError) throw error;
      throw new GuardrailError('Der Modelldienst ist momentan nicht verfügbar. Bitte versuche es erneut.', 503);
    } finally {
      session.busy = false;
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
      const kopie = szenarioProfil(session.ablauf, jahresbedarf, session.messages.length);
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
    if (session.messages.length + 2 > this.rails.config.maxHistoryMessages) throw new GuardrailError('Die maximale Gesprächslänge ist erreicht. Bitte starte einen neuen Chat.', 409);
    const reply = `Das berechnete Pensionierungsziel mit CHF ${s.vergleich.alternative.bedarfJahr.toLocaleString('de-CH')} Bedarf pro Jahr wurde übernommen. Alle anderen Angaben bleiben gleich. Berechnung, Budgetabgleich und Handlungsplan wurden aktualisiert. Es gelten weiterhin die bestätigten Basisannahmen.`;
    // Explicit form confirmation is retained as a transparent turn, so future extraction
    // and explanation know the accepted change rather than reviving the old chat value.
    session.messages.push({ role: 'user', content: s.beleg }, { role: 'assistant', content: reply });
    session.ablauf = s.ablauf;
    session.revision++;
    session.updated = Date.now();
    delete session.szenario;
    return { sessionId, revision: session.revision, reply, userMessage: s.beleg,
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
