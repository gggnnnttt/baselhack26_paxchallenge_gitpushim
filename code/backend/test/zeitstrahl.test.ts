import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { wendeZeitstrahlAn, ZEITSTRAHL_NACHRICHT, type ZeitstrahlAktion } from '../src/beratung/zeitstrahl.js';
import { ChatService, type ModelAdapter, type ModelRequest } from '../src/chat.js';
import { GuardrailError, Guardrails } from '../src/guardrails.js';
import { leeresProfil } from '../src/profil/profil.js';

// Synthetic data only. The model is simulated; the timeline itself never needs one to change the profile.
const config = JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'));
const JAHR = 2026;
const HEUTE = new Date('2026-10-31T12:00:00');

const speichern = (werte: Partial<Extract<ZeitstrahlAktion, { typ: 'speichern' }>> = {}): ZeitstrahlAktion => ({
  typ: 'speichern', plan: null, art: 'wohneigentum', person: 'haushalt', beschreibung: 'Haus kaufen', jahr: 2031, monat: null, notiz: '', ...werte,
});
const anwenden = (profil = leeresProfil(), aktionen: ZeitstrahlAktion[], index = 0) => wendeZeitstrahlAn(profil, aktionen, { index, jahr: JAHR });

test('timeline adds, moves, edits and removes plans with timeline provenance', () => {
  const neu = anwenden(undefined, [speichern({ notiz: 'Wir wollen dafür nach Baselland ziehen.' })]);
  const haus = neu.profil.plaene[0]!;
  assert.equal(haus.id, 'p1');
  assert.equal(haus.herkunft.quelle, 'zeitstrahl');
  assert.deepEqual(haus.zeitpunkt?.wert, { jahr: 2031, monat: null, text: null });
  assert.equal(haus.notiz, 'Wir wollen dafür nach Baselland ziehen.');
  assert.match(neu.uebernommen[0]!.text, /Neu im Zeitstrahl: „Haus kaufen“ \(wohneigentum, Haushalt, 2031\), Notiz/);

  // A plan from the chat keeps its wording until the customer moves it in the timeline.
  const ausChat = structuredClone(neu.profil);
  ausChat.plaene[0]!.zeitpunkt = { wert: { jahr: 2031, monat: null, text: 'in 5 Jahren' }, quelle: 'ableitung', beleg: 'in 5 Jahren', begruendung: '2026 + 5', nachricht: 0 };
  const verschoben = anwenden(ausChat, [speichern({ plan: 'p1', jahr: 2032, monat: 6, person: 'A', notiz: 'Wir wollen dafür nach Baselland ziehen.' })], 4);
  const plan = verschoben.profil.plaene[0]!;
  assert.deepEqual(plan.zeitpunkt?.wert, { jahr: 2032, monat: 6, text: null });
  assert.equal(plan.zeitpunkt?.quelle, 'zeitstrahl');
  assert.equal(plan.zeitpunkt?.nachricht, 4);
  assert.equal(plan.person, 'A');
  assert.equal(verschoben.uebernommen[0]!.text, '„Haus kaufen“: jetzt Person A, Zeitpunkt 2031 → 06/2032');

  const ohneDatum = anwenden(verschoben.profil, [speichern({ plan: 'p1', jahr: null, person: 'A' })]);
  assert.equal(ohneDatum.profil.plaene[0]!.zeitpunkt, undefined);
  assert.equal(ohneDatum.profil.plaene[0]!.notiz, undefined);

  const entfernt = anwenden(ohneDatum.profil, [{ typ: 'entfernen', plan: 'p1' }]);
  assert.equal(entfernt.profil.plaene.length, 0);
  assert.equal(entfernt.uebernommen[0]!.text, '„Haus kaufen“ aus dem Zeitstrahl entfernt');
});

test('timeline rejects invalid plans and reports unchanged plans as nothing', () => {
  const basis = anwenden(undefined, [speichern()]).profil;
  const ergebnis = anwenden(basis, [
    speichern({ jahr: JAHR - 1 }),
    speichern({ jahr: JAHR + 71 }),
    speichern({ jahr: null, monat: 3 }),
    speichern({ plan: 'p9' }),
    { typ: 'entfernen', plan: 'p9' },
    speichern({ plan: 'p1' }),
  ]);
  assert.equal(ergebnis.uebernommen.length, 0);
  assert.deepEqual(ergebnis.abgelehnt.map(e => e.grund), [
    'Das Jahr muss zwischen 2026 und 2096 liegen.',
    'Das Jahr muss zwischen 2026 und 2096 liegen.',
    'Ein Monat braucht ein Jahr.',
    'Plan p9 ist nicht bekannt.',
    'Plan p9 ist nicht bekannt.',
  ]);
  assert.deepEqual(ergebnis.profil, basis);
});

// Scope check passes; every other call is the advisor reply.
function modell(antwort = 'Ein Hauskauf 2031 in Baselland: Habt ihr schon Eigenkapital angespart?') {
  const anfragen: ModelRequest[] = [];
  const scopeTexte: string[] = [];
  const provider: ModelAdapter = { generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') {
      scopeTexte.push(request.messages.at(-1)!.content);
      return '{"allowed":true}';
    }
    if (request.responseFormat?.name === 'profil_aenderungen') return '{"aenderungen":[]}';
    anfragen.push(request);
    return antwort;
  } };
  return { provider, anfragen, scopeTexte };
}

test('a timeline change is stored in the profile and the advisor reacts to it', async () => {
  const { provider, anfragen, scopeTexte } = modell();
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { heute: () => HEUTE });
  const antwort = await service.zeitstrahl({ aktionen: [speichern({ notiz: 'Wir wollen dafür nach Baselland ziehen.' })] });

  assert.equal(antwort.reply, 'Ein Hauskauf 2031 in Baselland: Habt ihr schon Eigenkapital angespart?');
  assert.equal(antwort.beratungsstand.profil.plaene[0]!.notiz, 'Wir wollen dafür nach Baselland ziehen.');
  assert.deepEqual(scopeTexte, ['Plan: Haus kaufen\nNotiz zum Plan: Wir wollen dafür nach Baselland ziehen.']);
  // The note reaches the model as quoted data in the instructions, the history only holds the fixed turn.
  const anfrage = anfragen[0]!;
  assert.match(anfrage.instructions, /Notiz des Kunden "Wir wollen dafür nach Baselland ziehen\."/);
  assert.match(anfrage.instructions, /## Änderung im Zeitstrahl\n.*\n- Neu im Zeitstrahl: „Haus kaufen“/);
  assert.deepEqual(anfrage.messages, [{ role: 'user', content: ZEITSTRAHL_NACHRICHT }]);

  // Moving the plan needs no scope check, and the next chat turn still knows the plan.
  await service.zeitstrahl({ sessionId: antwort.sessionId, aktionen: [speichern({ plan: 'p1', jahr: 2033, notiz: 'Wir wollen dafür nach Baselland ziehen.' })] });
  assert.equal(scopeTexte.length, 1);
  assert.match(anfragen[1]!.instructions, /„Haus kaufen“: Zeitpunkt 2031 → 2033/);
  await service.reply({ message: 'Was bedeutet das für unsere Pensionskasse?', sessionId: antwort.sessionId });
  assert.match(anfragen[2]!.instructions, /Zeitpunkt 2033 \(im Zeitstrahl gesetzt\)/);
  assert.equal(anfragen[2]!.messages.length, 5);
});

test('timeline text passes the input guardrails and failures commit nothing', async () => {
  const { provider, anfragen } = modell();
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { heute: () => HEUTE });
  await assert.rejects(service.zeitstrahl({ aktionen: [speichern({ notiz: 'AHV: 756.1234.5678.97' })] }), GuardrailError);
  await assert.rejects(service.zeitstrahl({ aktionen: [speichern(), { typ: 'unbekannt' }] }), (error: GuardrailError) => error.status === 400);
  await assert.rejects(service.zeitstrahl({ aktionen: [speichern({ jahr: 1999 })] }), (error: GuardrailError) => error.status === 422);
  assert.equal(anfragen.length, 0);
  assert.equal(service.sessionCount, 0);

  const blockiert = modell('Bitte sende deine AHV-Nummer als Foto.');
  const zweiter = new ChatService(blockiert.provider, new Guardrails(config), 'Berater', { heute: () => HEUTE });
  await assert.rejects(zweiter.zeitstrahl({ aktionen: [speichern()] }), GuardrailError);
  assert.equal(zweiter.sessionCount, 0);
});
