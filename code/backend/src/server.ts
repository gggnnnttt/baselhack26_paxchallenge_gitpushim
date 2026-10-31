import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import OpenAI from 'openai';
import { createApiCalcClient } from './berechnung/apicalc.js';
import { ChatService } from './chat.js';
import { GuardrailError, Guardrails } from './guardrails.js';
import { createOpenAIAdapter } from './providers/openai.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env['OPENAI_API_KEY'];
if (!apiKey) throw new Error('OPENAI_API_KEY fehlt in der Backend-Umgebung.');
const model = process.env['OPENAI_MODEL'] || 'gpt-6-luna';
const rails = new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8')));
const instructions = readFileSync(new URL('../advisor.instructions.md', import.meta.url), 'utf8');
// logLevel 'off' also ignores OPENAI_LOG=debug, which would print full request bodies including chat text.
const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 30000, logLevel: 'off' });
// Without APICALC_TOKEN the profile still works; the flow then stops at "bereit" and shows the prepared request.
const apiCalcToken = process.env['APICALC_TOKEN'];
const rechner = apiCalcToken ? createApiCalcClient({
  baseUrl: process.env['APICALC_BASE_URL'] || 'https://baselhackathon2026.azurewebsites.net/viper',
  token: apiCalcToken,
  tenant: process.env['APICALC_TENANT'] || undefined,
}) : null;
const chat = new ChatService(createOpenAIAdapter(client, model), rails, instructions, { rechner });
// Expire idle sessions even when no further requests arrive.
setInterval(() => chat.removeExpired(), 60000).unref();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

app.post('/api/chat', async (req, res) => {
  try {
    res.json(await chat.reply(req.body));
  } catch (error) {
    if (error instanceof GuardrailError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Die Anfrage konnte nicht sicher verarbeitet werden.' });
  }
});

app.post('/api/zeitstrahl', async (req, res) => {
  try {
    res.json(await chat.zeitstrahl(req.body));
  } catch (error) {
    if (error instanceof GuardrailError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Die Änderung im Zeitstrahl konnte nicht sicher verarbeitet werden.' });
  }
});

// Uses the same bearer-like session ownership and concurrency guard as the chat.
app.post('/api/szenario', async (req, res) => {
  try { res.json(await chat.vergleicheSzenario(req.body)); }
  catch (error) { res.status(error instanceof GuardrailError ? error.status : 500).json({ error: error instanceof GuardrailError ? error.message : 'Szenarioberechnung nicht verfügbar.' }); }
});
app.post('/api/szenario/uebernehmen', (req, res) => {
  try { res.json(chat.uebernehmeSzenario(req.body)); }
  catch (error) { res.status(error instanceof GuardrailError ? error.status : 500).json({ error: error instanceof GuardrailError ? error.message : 'Szenario konnte nicht übernommen werden.' }); }
});

app.post('/api/empfehlungen', async (req, res) => {
  try { res.json(await chat.empfehlungen(req.body)); }
  catch (error) { res.status(error instanceof GuardrailError ? error.status : 500).json({ error: error instanceof GuardrailError ? error.message : 'Empfehlungen sind momentan nicht verfügbar.' }); }
});

app.delete('/api/chat', (req, res) => {
  try {
    chat.deleteSession(req.body);
    res.status(204).end();
  } catch (error) {
    res.status(error instanceof GuardrailError ? error.status : 500).json({ error: error instanceof GuardrailError ? error.message : 'Ungültige Anfrage.' });
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
  res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Die Nachricht ist zu gross.' : 'Ungültige Anfrage.' });
});

app.listen(3000, '127.0.0.1', () => console.log(`Backend mit lokalen Guardrails läuft auf http://127.0.0.1:3000 (APICalc-Risikoberechnung: ${rechner ? 'aktiv' : 'nicht konfiguriert'})`));
