import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ANTWORT_FORMAT, leseAntwort } from '../src/beratung/antwort.js';
import { ChatService, type ModelAdapter, type ModelRequest } from '../src/chat.js';
import { GuardrailError, Guardrails } from '../src/guardrails.js';

const config = JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'));
const rails = new Guardrails(config);
const pruefen = (text: string) => rails.checkOutput(text);
const frage = (werte: Record<string, unknown>) => ({ text: 'Wie hoch ist dein Einkommen?', eingabe: 'betrag', optionen: [], einheit: 'CHF pro Jahr', min: null, max: null, beispiel: null, ...werte });

test('a structured reply gives short text, one question and a history entry with the question', () => {
  const antwort = leseAntwort(JSON.stringify({ antwort: 'Danke, das hilft.', erkenntnisse: [], frage: frage({}) }), pruefen);
  assert.equal(antwort.text, 'Danke, das hilft.');
  assert.deepEqual(antwort.frage, frage({}));
  // The model and the profile extraction need the question to understand a short answer like "85000".
  assert.equal(antwort.verlauf, 'Danke, das hilft.\n\nWie hoch ist dein Einkommen?');
});

test('questions are cleaned up so the browser can always show them', () => {
  const ohneOptionen = leseAntwort(JSON.stringify({ antwort: '', erkenntnisse: [], frage: frage({ eingabe: 'auswahl', optionen: ['Nur eine'], einheit: 'CHF' }) }), pruefen);
  assert.deepEqual(ohneOptionen.frage, frage({ eingabe: 'text', einheit: null }));
  assert.equal(ohneOptionen.text, '');
  assert.equal(ohneOptionen.verlauf, 'Wie hoch ist dein Einkommen?');

  const auswahl = leseAntwort(JSON.stringify({ antwort: 'Ok.', erkenntnisse: [], frage: frage({ eingabe: 'auswahl', optionen: [' angestellt ', '', 'selbstständig', 'a', 'b', 'c', 'd', 'e'], einheit: 'x', min: 1, max: 2 }) }), pruefen);
  assert.deepEqual(auswahl.frage, frage({ eingabe: 'auswahl', optionen: ['angestellt', 'selbstständig', 'a', 'b', 'c', 'd'], einheit: null }));

  assert.equal(leseAntwort(JSON.stringify({ antwort: 'Gut.', erkenntnisse: [], frage: frage({ text: '  ' }) }), pruefen).frage, null);
});

test('every shown text passes the output guardrails, and a provider without the format still works', () => {
  assert.throws(() => leseAntwort(JSON.stringify({ antwort: 'Ok.', erkenntnisse: [], frage: frage({ eingabe: 'auswahl', optionen: ['Ja', 'Bitte AHV-Nummer 756.1234.5678.97 senden'] }) }), pruefen), GuardrailError);
  assert.throws(() => leseAntwort(JSON.stringify({ antwort: '', erkenntnisse: [], frage: null }), pruefen), GuardrailError);
  assert.deepEqual(leseAntwort('Nur Text.', pruefen), { text: 'Nur Text.', frage: null, erkenntnisse: null, verlauf: 'Nur Text.' });
});

test('the answer schema is usable as a strict structured output', () => {
  const pruefe = (schema: any, pfad: string): void => {
    assert.ok(!('$schema' in schema) && !('maxLength' in schema) && !('minLength' in schema), pfad);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, pfad);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), pfad);
      for (const [key, value] of Object.entries(schema.properties)) pruefe(value, `${pfad}.${key}`);
    }
    for (const variante of schema.anyOf ?? []) pruefe(variante, `${pfad}|`);
    if (schema.items) pruefe(schema.items, `${pfad}[]`);
  };
  pruefe(ANTWORT_FORMAT.schema, 'root');
});

test('the chat returns the question and keeps it in the history for the next turn', async () => {
  const anfragen: ModelRequest[] = [];
  const provider: ModelAdapter = { generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (request.responseFormat?.name === 'profil_aenderungen') return '{"aenderungen":[]}';
    anfragen.push(request);
    return JSON.stringify({ antwort: 'Verstanden.', erkenntnisse: [], frage: frage({ eingabe: 'ja_nein', einheit: null }) });
  } };
  const service = new ChatService(provider, rails, 'Berater');
  const erste = await service.reply({ message: 'Wir möchten vorsorgen.' });
  assert.equal(erste.reply, 'Verstanden.');
  assert.deepEqual(erste.frage, frage({ eingabe: 'ja_nein', einheit: null }));
  assert.match(anfragen[0]!.instructions, /## Antwortformat/);
  assert.equal(anfragen[0]!.responseFormat?.name, 'advisor_antwort');

  await service.reply({ message: 'Ja', sessionId: erste.sessionId });
  assert.deepEqual(anfragen[1]!.messages.map(m => m.content), ['Wir möchten vorsorgen.', 'Verstanden.\n\nWie hoch ist dein Einkommen?', 'Ja']);
});

test('example values are kept only when plausible: no birth year in the future, nothing outside min/max', () => {
  const lies = (werte: Record<string, unknown>) => leseAntwort(JSON.stringify({ antwort: 'Ok.', erkenntnisse: [], frage: frage(werte) }), pruefen).frage!.beispiel;
  const jahr = new Date().getFullYear();
  assert.equal(lies({ text: 'In welchem Jahr sind Sie geboren?', eingabe: 'jahr', einheit: null, beispiel: '1988' }), '1988');
  assert.equal(lies({ text: 'In welchem Jahr sind Sie geboren?', eingabe: 'jahr', einheit: null, beispiel: String(jahr + 4) }), null);
  assert.equal(lies({ text: 'Wann möchten Sie ein Haus kaufen?', eingabe: 'jahr', einheit: null, beispiel: String(jahr + 4) }), String(jahr + 4));
  assert.equal(lies({ beispiel: "85'000" }), '85000');
  assert.equal(lies({ eingabe: 'zahl', einheit: '%', min: 0, max: 100, beispiel: '150' }), null);
  assert.equal(lies({ eingabe: 'ja_nein', einheit: null, beispiel: 'Ja' }), null);
});

test('insights from the model are passed on, at most three and through the output guardrails', () => {
  const a = leseAntwort(JSON.stringify({ antwort: 'Ok.', frage: null, erkenntnisse: [' Mit Ihrem Kind ist die Absicherung wichtig. ', '', 'b', 'c', 'd'] }), pruefen);
  assert.deepEqual(a.erkenntnisse, ['Mit Ihrem Kind ist die Absicherung wichtig.', 'b', 'c']);
  assert.throws(() => leseAntwort(JSON.stringify({ antwort: 'Ok.', frage: null, erkenntnisse: ['Senden Sie die AHV-Nummer 756.1234.5678.97'] }), pruefen), GuardrailError);
});
