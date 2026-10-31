import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ChatService } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
import { muellerProfil } from '../src/profil/demo.js';

test('Müller shortcut creates an isolated session and gives the model the family context, not preselected products', async () => {
  let calls = 0;
  const rails = new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8')));
  const service = new ChatService({ generate: async request => {
    calls++;
    assert.equal(request.responseFormat?.name, 'empfehlungen');
    const input = JSON.parse(request.messages[0]!.content);
    assert.equal(input.grundlagen.profil.personen.A.erwerb, 'nicht_erwerbstaetig');
    assert.equal(input.grundlagen.profil.personen.B.einkommen.betrag, 100000);
    assert.match(input.grundlagen.profil.anliegen[0].text, /fünf Monate/);
    assert.equal(input.katalog.length, 6);
    assert.equal(input.empfehlungen, undefined);
    return JSON.stringify({ status: 'vorschlaege', statusText: 'Familie schützen', empfehlungen: [{ produktId: 'pax-todesfall', thema: 'absicherung', titel: 'Familienschutz', begruendung: 'Euer Kind hängt vom Einkommen ab. Prüft die Absicherung.', grundlageIds: ['profil'] }] });
  } }, rails, 'Berate zur Vorsorge.', { heute: () => new Date('2026-10-31T12:00:00Z') });
  const first = await service.demo();
  const second = await service.demo();
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(calls, 0);
  assert.deepEqual(first.beratungsstand.produktzuordnung.faelle, []);
  const result = await service.empfehlungen({ sessionId: first.sessionId });
  assert.equal(calls, 1);
  assert.equal(result.textquelle, 'ki');
  assert.equal(result.empfehlungen[0]!.produkt.id, 'pax-todesfall');
  await service.empfehlungen({ sessionId: first.sessionId });
  assert.equal(calls, 1, 'same-revision model result is cached');
});

test('five-month-old child and future return to work cross year boundaries correctly', () => {
  const p = muellerProfil(new Date('2027-02-01T12:00:00Z'));
  assert.equal(p.kinder[0]!.geburtsjahr!.wert, 2026);
  assert.equal(p.plaene[0]!.zeitpunkt!.wert.monat, 7);
  assert.equal(p.personen.A.einkommen, undefined, 'future income must not become current income');
});
