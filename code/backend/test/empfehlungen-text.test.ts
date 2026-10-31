import assert from 'node:assert/strict';
import { test } from 'node:test';
import { begruendeEmpfehlungen } from '../src/produkte/begruendung.js';
import { fixture } from './empfehlungen-fixture.js';
const antwort = (produktId = 'pax-terza-fondsstar') => JSON.stringify({ status: 'vorschlaege', statusText: 'Dein Vorschlag', empfehlungen: [{ produktId, thema: 'pensionierung', titel: 'Dein Ruhestand', begruendung: 'Deine Pensionierung braucht Planung. Dieses Produkt bietet fondsgebundenes Sparen.', grundlageIds: ['pensionierung'] }] });
test('model chooses products itself: identical data can produce different valid selections', async () => {
 const stand = await fixture();
 for (const id of ['pax-terza-fondsstar', 'pax-terza-lifestar']) {
 const r = await begruendeEmpfehlungen(stand, { generate: async req => {
 const data = JSON.parse(req.messages[0]!.content);
 assert.equal(data.katalog.length, 6);
 assert.equal(data.empfehlungen, undefined);
 assert.doesNotMatch(req.messages[0]!.content, /synthetisch|beleg|nachricht/);
 return antwort(id);
 } });
 assert.equal(r.empfehlungen[0]!.produkt.id, id);
 }
});
test('invalid products, sources, invented contact details and provider failure never become fixed-rule recommendations', async () => {
 const stand = await fixture();
 for (const raw of [antwort('fremd'), antwort().replace('pensionierung"]','fremde-quelle"]'), antwort().replace('Dieses Produkt', 'Dein Ansprechpartner ist eine synthetische Testperson. Dieses Produkt'), '{}']) {
 await assert.rejects(begruendeEmpfehlungen(stand, { generate: async () => raw }));
 }
 await assert.rejects(begruendeEmpfehlungen(stand, { generate: async () => { throw Error('secret'); } }), /Empfehlungen/);
});
test('model can decide no additional product, even with complete zero-gap calculations', async () => {
 let calls = 0;
 const r = await begruendeEmpfehlungen(await fixture({ gap: 0, pension: 0 }), { generate: async () => { calls++; return JSON.stringify({ status: 'kein_bedarf', statusText: 'Kein zusätzlicher Abschluss nötig', empfehlungen: [] }); } });
 assert.equal(calls, 1); assert.equal(r.status, 'kein_bedarf');
});
test('irrelevant partner scenarios cannot reach AI through any evidence source', async () => {
 const stand = await fixture({ gap: 0, pension: 0 });
 stand.kontext.berechnung!.antwort.response.RiskScenarioSummaries.push({ Scenario: 5, ErrorCode: 0, IncomeGap: 90000 });
 const before = JSON.stringify(stand);
 await begruendeEmpfehlungen(stand, { generate: async req => {
 const data = JSON.parse(req.messages[0]!.content);
 assert.doesNotMatch(JSON.stringify([data.grundlagen.lagebild, data.grundlagen.risiko, data.grundlagen.privateEu]), /90000|90.000|Person B/);
 return JSON.stringify({ status: 'kein_bedarf', statusText: 'Kein zusätzlicher Abschluss nötig', empfehlungen: [] });
 } });
 assert.equal(JSON.stringify(stand), before);
});
