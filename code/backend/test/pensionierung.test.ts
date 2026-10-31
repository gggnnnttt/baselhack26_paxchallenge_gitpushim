import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createApiCalcClient } from '../src/berechnung/apicalc.js';
import { aktualisierePensionierung, pruefePensionierung, startePensionierung, type RetirementResponse } from '../src/berechnung/pensionierung.js';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { ansicht, beratungsKontext } from '../src/beratung/darstellung.js';
import { wendeAenderungenAn, type Aenderung } from '../src/profil/aenderungen.js';
import { leeresProfil, type Profil } from '../src/profil/profil.js';
import { ChatService, type ModelAdapter } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';

const fakt = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'synthetisch', begruendung: null, nachricht: 0 });
function profil(): Profil {
  const p = leeresProfil();
  p.haushalt = { beziehung: fakt('ledig'), bedarfPensionierung: fakt({ hoehe: 60000, einheit: 'chf_jahr' }),
    vermoegenPensionierung: fakt(50000), pensionierungBasisBestaetigt: fakt(true) };
  p.personen.A = { geschlecht: fakt('maennlich'), geburtsjahr: fakt(1990), bvgVersichert: fakt(true),
    einkommen: fakt({ betrag: 100000, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }),
    pensionierungsalter: fakt(65), pkAltersrente: fakt(30000), pkGuthaben: fakt(120000) };
  return p;
}
const antwort: RetirementResponse = { response: { ErrorCode: 1, IncomeNeed: 60000, IncomeTotal: 50000,
  IncomePillar1: 20000, IncomePillar2: 30000, IncomeWithdrawal: 2000, IncomeGap: 8000,
  AvailableFortune: 50000, CapitalNeed: 250000, CapitalGap: 200000 } };
const op = (feld: Aenderung['feld'], zahl: number | null, einheit: Aenderung['einheit'], person: Aenderung['person'] = null): Aenderung => ({
  aktion: 'setzen', feld, person, ziel: null, text: null, zahl, monat: null, ja_nein: null, einheit,
  einkommensbasis: null, monatsloehne: null, planart: null, quelle: 'aussage', beleg: 'Test', begruendung: null,
});

test('retirement maps a household without requiring risk needs; unknown and explicit zero stay distinct', () => {
  const p = profil();
  const r = pruefePensionierung(p, 2026);
  assert.equal(r.bereit, true);
  assert.equal(r.request!.Person1.RetirementPillar2.Pension, 30000);
  assert.equal(r.request!.CurrentFortune, 50000);
  assert.equal(r.request!.Saving, 0);
  delete p.haushalt.vermoegenPensionierung;
  assert.equal(pruefePensionierung(p, 2026).bereit, false);
  p.haushalt.vermoegenPensionierung = fakt(0);
  assert.equal(pruefePensionierung(p, 2026).request!.CurrentFortune, 0);
  delete p.haushalt.pensionierungBasisBestaetigt;
  assert.equal(pruefePensionierung(p, 2026).bereit, false);
  p.haushalt.pensionierungBasisBestaetigt = fakt(false);
  assert.equal(pruefePensionierung(p, 2026).bereit, false);
});

test('retirement does not silently guess PK figures and includes both partners', () => {
  const p = profil();
  p.haushalt.beziehung = fakt('verheiratet');
  p.haushalt.beziehungSeitJahr = fakt(2020);
  assert.equal(pruefePensionierung(p, 2026).bereit, false);
  p.personen.B = structuredClone(p.personen.A);
  p.personen.B.pensionierungsalter = fakt(63);
  assert.equal(pruefePensionierung(p, 2026).request!.Person2!.DesiredRetirementAge, 63);
  delete p.personen.B.pkAltersrente;
  assert.equal(pruefePensionierung(p, 2026).bereit, false);
  p.personen.B.bvgVersichert = fakt(false);
  assert.ok(pruefePensionierung(p, 2026).fehlend.some(f => f.label.includes('PK-Situation')));
});

test('new profile fields validate monthly amounts, capital and unsupported ages; corrections/removals work', () => {
  const p = profil();
  const r = wendeAenderungenAn(p, [op('pk_altersrente', 2500, 'chf_monat', 'A'), op('bedarf_pensionierung', 5000, 'chf_monat'),
    op('vermoegen_pensionierung', 0, null), op('pensionierungsalter', 63, null, 'A'), op('pk_guthaben', 1000, 'prozent', 'A')], { text: 'Test', index: 2, jahr: 2026 });
  assert.equal(r.profil.personen.A.pkAltersrente!.wert, 30000);
  assert.equal(r.profil.haushalt.bedarfPensionierung!.wert.hoehe, 60000);
  assert.equal(r.profil.haushalt.vermoegenPensionierung!.wert, 0);
  assert.equal(r.profil.personen.A.pensionierungsalter!.wert, 63);
  assert.equal(r.abgelehnt.length, 1);
  const del = { ...op('pensionierungsalter', null, null, 'A'), aktion: 'entfernen' as const };
  assert.equal(wendeAenderungenAn(r.profil, [del], { text: 'Test', index: 4, jahr: 2026 }).profil.personen.A.pensionierungsalter, undefined);
  assert.equal(wendeAenderungenAn(p, [op('pensionierungsalter', 200, null, 'A')], { text: 'Test', index: 2, jahr: 2026 }).abgelehnt.length, 1);
});

test('retirement calculates independently, caches unchanged requests and invalidates withdrawn inputs', async () => {
  const p = profil(); let calls = 0;
  const ablauf = new Beratungsablauf({ berechneRisiko: async () => { throw new Error('Risk must not run'); },
    berechnePensionierung: async () => { calls++; return antwort; } });
  const first = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.equal(first.phase, 'erfassung');
  assert.equal(first.pensionierung.phase, 'berechnet');
  const same = await ablauf.aktualisiere(first, structuredClone(p));
  assert.equal(calls, 1);
  p.personen.A.pensionierungsalter = fakt(63);
  const changed = await ablauf.aktualisiere(same, p);
  assert.equal(calls, 2);
  delete p.haushalt.bedarfPensionierung;
  const stale = await ablauf.aktualisiere(changed, p);
  assert.equal(stale.pensionierung.phase, 'erfassung');
  assert.equal(ansicht(stale, { uebernommen: [], abgelehnt: [] }).pensionierung.ergebnis!.veraltet, true);
  assert.match(beratungsKontext(stale, { uebernommen: [], abgelehnt: [] }), /Kein aktuelles Pensionierungsergebnis/);
});

test('retirement handles missing configuration, business errors, transport failure and malformed success', async () => {
  const p = profil(), start = startePensionierung(p, 2026);
  assert.equal((await aktualisierePensionierung(start, p, 2026, null)).phase, 'bereit');
  const business = await aktualisierePensionierung(start, p, 2026, { berechnePensionierung: async () => ({ response: { ErrorCode: 8 } }) });
  assert.equal(business.phase, 'fehlgeschlagen');
  assert.match(business.fehler!, /Person A/);
  const fail = await aktualisierePensionierung(start, p, 2026, { berechnePensionierung: async () => { throw new Error('SECRET'); } });
  assert.ok(!fail.fehler!.includes('SECRET'));
  const invalid = await aktualisierePensionierung(start, p, 2026, { berechnePensionierung: async () => ({ response: { ErrorCode: 1 } }) });
  assert.equal(invalid.phase, 'fehlgeschlagen');
});

test('retirement client uses its own endpoint and validates the response', async () => {
  const request = pruefePensionierung(profil(), 2026).request!;
  const client = createApiCalcClient({ baseUrl: 'https://example.test/viper', token: 'synthetic', tenant: 'demo',
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://example.test/viper/operation/standard/APICalc_calculateRetirement?tenant=demo');
      assert.equal(JSON.parse(String(init!.body)).Person1.DesiredRetirementAge, 65);
      return Response.json(antwort);
    } });
  assert.deepEqual(await client.berechnePensionierung(request), antwort);
});

test('chat commits retirement only after an accepted reply and includes its result in model context', async () => {
  const changes: Aenderung[] = [
    { ...op('beziehung', null, null), text: 'ledig' },
    { ...op('geschlecht', null, null, 'A'), text: 'maennlich' },
    op('geburtsjahr', 1990, null, 'A'),
    { ...op('bvg_versichert', null, null, 'A'), ja_nein: true },
    { ...op('einkommen', 100000, 'chf_jahr', 'A'), einkommensbasis: 'brutto' },
    op('pensionierungsalter', 65, null, 'A'), op('pk_altersrente', 30000, 'chf_jahr', 'A'),
    op('pk_guthaben', 120000, null, 'A'), op('bedarf_pensionierung', 60000, 'chf_jahr'),
    op('vermoegen_pensionierung', 50000, null), { ...op('pensionierung_basis_bestaetigt', null, null), ja_nein: true },
  ];
  let context = '';
  const model: ModelAdapter = { generate: async r => {
    if (r.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (r.responseFormat?.name === 'profil_aenderungen') return JSON.stringify({ aenderungen: changes });
    context = r.instructions; return 'Die Basisrechnung liegt vor.';
  } };
  const service = new ChatService(model, new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'))), 'Beratung', {
    rechner: { berechneRisiko: async () => { throw new Error('not expected'); }, berechnePensionierung: async () => antwort },
  });
  const result = await service.reply({ message: 'Test' });
  assert.equal(result.beratungsstand.pensionierung.phase, 'berechnet');
  assert.match(context, /Aktuelles Pensionierungsergebnis/);
  assert.equal(result.beratungsstand.phase, 'erfassung');
});

test('explicit complete baseline confirmation is retained even if the model omits its boolean', async () => {
  const p = profil();
  delete p.haushalt.pensionierungBasisBestaetigt;
  const text = 'Im Ruhestand benötige ich CHF 60’000 pro Jahr. Für diese Basisrechnung akzeptiere ich ausdrücklich keine weiteren Sparbeiträge, 0 % Verzinsung und Planung bis Alter 88.';
  const applied = wendeAenderungenAn(p, [], { text, index: 0, jahr: 2026 });
  assert.equal(applied.profil.haushalt.pensionierungBasisBestaetigt!.wert, true);
  assert.ok(text.includes(applied.profil.haushalt.pensionierungBasisBestaetigt!.beleg));
  const state = await aktualisierePensionierung(startePensionierung(p, 2026), applied.profil, 2026, { berechnePensionierung: async () => antwort });
  assert.equal(state.phase, 'berechnet');
});

test('baseline fallback does not accept a mention, a question, incomplete assumptions or a later refusal', () => {
  const p = profil(); delete p.haushalt.pensionierungBasisBestaetigt;
  const statement = 'Für diese Basisrechnung akzeptiere ich ausdrücklich keine weiteren Sparbeiträge, 0 % Verzinsung und Planung bis Alter 88';
  for (const text of [
    'Die Annahmen sind keine weiteren Sparbeiträge, 0 % Verzinsung und Planung bis Alter 88.',
    'Ich akzeptiere 0 % Verzinsung.', 'Ja.', `${statement}?`,
    `Soll ich sagen: „${statement}“?`, `${statement}. Ich möchte aber weitere Sparbeiträge berücksichtigen.`,
    'Für diese Basisrechnung akzeptiere ich ausdrücklich nicht keine weiteren Sparbeiträge, 0 % Verzinsung und Planung bis Alter 88.',
  ]) assert.equal(wendeAenderungenAn(p, [], { text, index: 0, jahr: 2026 }).profil.haushalt.pensionierungBasisBestaetigt, undefined, text);
});
