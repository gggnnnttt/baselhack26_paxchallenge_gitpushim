export class GuardrailError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); }
}

export interface GuardrailsConfig {
  version: 1;
  maxInputCharacters: number;
  maxOutputCharacters: number;
  maxHistoryMessages: number;
  maxSessions: number;
  sessionTtlMinutes: number;
  maxOutputTokens: number;
  blockedInputPatterns: string[];
  blockedOutputPatterns: string[];
}

const normalise = (value: string) => value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
const privateDataMessage = 'Diese Angaben bitte nicht im Chat teilen. Identifikations- und Zahlungsdaten werden in dieser Demo nicht erfasst und gehören nicht in den Chat.';

export class Guardrails {
  readonly config: GuardrailsConfig;
  private readonly inputPatterns: RegExp[];
  private readonly outputPatterns: RegExp[];

  constructor(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('Guardrails-Konfiguration fehlt.');
    const config = value as Record<string, unknown>;
    const numbers = ['maxInputCharacters', 'maxOutputCharacters', 'maxHistoryMessages', 'maxSessions', 'sessionTtlMinutes', 'maxOutputTokens'];
    const allowed = new Set(['version', ...numbers, 'blockedInputPatterns', 'blockedOutputPatterns']);
    if (config['version'] !== 1 || Object.keys(config).some(key => !allowed.has(key))) throw new Error('Ungültige Guardrails-Konfiguration.');
    for (const key of numbers) {
      if (!Number.isSafeInteger(config[key]) || (config[key] as number) <= 0) throw new Error(`Ungültige Grenze: ${key}`);
    }
    for (const key of ['blockedInputPatterns', 'blockedOutputPatterns']) {
      if (!Array.isArray(config[key]) || config[key].length === 0 || !config[key].every((p: unknown) => typeof p === 'string' && p.length > 0)) throw new Error(`Ungültige Regeln: ${key}`);
    }
    this.config = value as GuardrailsConfig;
    this.inputPatterns = this.config.blockedInputPatterns.map(pattern => new RegExp(pattern, 'iu'));
    this.outputPatterns = [...this.inputPatterns, ...this.config.blockedOutputPatterns.map(pattern => new RegExp(pattern, 'iu'))];
  }

  checkInput(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > this.config.maxInputCharacters) {
      throw new GuardrailError('Bitte eine Nachricht innerhalb der erlaubten Länge eingeben.', 400);
    }
    const text = normalise(value.trim());
    if (this.inputPatterns.some(pattern => pattern.test(text))) throw new GuardrailError(privateDataMessage);
    return text
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[E-MAIL ENTFERNT]')
      .replace(/\+\d[\d ().-]{7,20}\d/g, '[TELEFON ENTFERNT]');
  }

  checkOutput(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > this.config.maxOutputCharacters) {
      throw new GuardrailError('Die Antwort konnte nicht geprüft werden. Bitte versuchen Sie es erneut.', 503);
    }
    const text = normalise(value.trim());
    if (this.outputPatterns.some(pattern => pattern.test(text))) {
      throw new GuardrailError('Diese Antwort wurde durch die Sicherheitsprüfung zurückgehalten. Bitte formulieren Sie Ihr Beratungsanliegen erneut.');
    }
    return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[E-MAIL ENTFERNT]')
      .replace(/\+\d[\d ().-]{7,20}\d/g, '[TELEFON ENTFERNT]');
  }
}
