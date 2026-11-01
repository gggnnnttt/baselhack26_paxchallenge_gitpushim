import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { bereinigeUrteil, kannBeurteilen, pruefeUebergabe, uebergabeKontext } from '../src/beratung/uebergabe.js';
import { ChatService } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
import { muellerProfil } from '../src/profil/demo.js';

// Synthetic data only. The criteria are a fixed catalogue; whether one is met is the model's judgement.
const heute = new Date('2026-10-31T12:00:00Z');

test('only catalogue criteria count, and Pax judges only once it understands the household', async () => {
  const ablauf = new Beratungsablauf(null);
  const leer = ablauf.start(2026);
  assert.equal(kannBeurteilen(leer), false);
  assert.match(uebergabeKontext(leer), /noch unvollständig/);
  const demo = await ablauf.aktualisiere(leer, muellerProfil(heute));
  assert.equal(kannBeurteilen(demo), true);
  assert.match(uebergabeKontext(demo), /`selbststaendigkeit`/);
  assert.deepEqual(pruefeUebergabe(demo), { noetig: false, kriterien: [] });
  demo.uebergabe = { kriterien: ['familie'], text: 'Eine Fachperson klärt die Begünstigung.' };
  assert.deepEqual(pruefeUebergabe(demo).kriterien.map(k => k.id), ['familie']);
  assert.deepEqual(bereinigeUrteil({ kriterien: ['erfunden', 'familie', 'familie'], text: ' Text ' }), { kriterien: ['familie'], text: 'Text' });
  assert.equal(bereinigeUrteil({ kriterien: ['erfunden'], text: 'Text' }), null);
  assert.equal(bereinigeUrteil({ kriterien: ['familie'], text: '  ' }), null);
});

test('the model decides from the situation, not from a first statement of intent', async () => {
  const rails = new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8')));
  const selbst = { kriterien: ['selbststaendigkeit'], text: 'Mit Familie und Hypothek klärt eine Fachperson, wie Sie Ihren Risikoschutz ersetzen.' };
  let uebergabe: unknown = selbst;
  const service = new ChatService({ generate: async req => {
    if (req.responseFormat?.name === 'advisor_antwort') {
      assert.match(req.instructions, /Übergabe an eine Pax-Fachperson/);
      return JSON.stringify({ antwort: 'Danke.', frage: null, erkenntnisse: [], uebergabe });
    }
    if (req.responseFormat?.name === 'advisory_scope') return JSON.stringify({ allowed: true });
    return JSON.stringify({ aenderungen: [] });
  } }, rails, 'Berate zur Vorsorge.', { heute: () => heute });

  // A first message on an empty profile: even if the model wanted a handoff, Pax does not judge yet.
  const erste = await service.reply({ message: 'Ich will mich selbstständig machen.' });
  assert.equal(erste.beratungsstand.uebergabe.noetig, false);

  // A known household: the model's judgement is shown with its explanation.
  const demo = await service.demo();
  const mit = await service.reply({ sessionId: demo.sessionId, message: 'Ich mache mich nächstes Jahr selbstständig.' });
  assert.deepEqual(mit.beratungsstand.uebergabe.kriterien.map(k => k.id), ['selbststaendigkeit']);
  assert.match(mit.beratungsstand.uebergabe.text!, /klärt eine Fachperson/);

  uebergabe = { kriterien: ['selbststaendigkeit'], text: "Mit CHF 999'999 Lücke sollte eine Fachperson übernehmen." };
  const erfunden = await service.reply({ sessionId: demo.sessionId, message: 'Und jetzt?' });
  assert.match(erfunden.beratungsstand.uebergabe.text!, /klärt eine Fachperson/, 'an explanation with an invented number is rejected, the previous judgement stays');

  uebergabe = null;
  const ohne = await service.reply({ sessionId: demo.sessionId, message: 'Ich bleibe doch angestellt.' });
  assert.deepEqual(ohne.beratungsstand.uebergabe, { noetig: false, kriterien: [], text: null });
});
