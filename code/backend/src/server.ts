import { existsSync } from 'node:fs';
import express from 'express';
import OpenAI from 'openai';

if (existsSync('.env')) process.loadEnvFile('.env');

const model = process.env['OPENAI_MODEL'] || 'gpt-6-luna';
const client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] || 'missing' });

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'messages fehlt' });
    return;
  }
  try {
    const response = await client.responses.create({ model, input: messages });
    res.json({ reply: response.output_text });
  } catch (err) {
    const message = err instanceof OpenAI.APIError ? `OpenAI-Fehler ${err.status}: ${err.message}` : 'Unbekannter Fehler';
    res.status(500).json({ error: message });
  }
});

app.listen(3000, '127.0.0.1', () => console.log('Backend läuft auf http://127.0.0.1:3000'));
