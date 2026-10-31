import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ChatService, type ModelAdapter } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
import type { Aenderung } from '../src/profil/aenderungen.js';
import type { RetirementRequest } from '../src/berechnung/pensionierung.js';

const op = (feld: Aenderung['feld'], v: Partial<Aenderung> = {}): Aenderung => ({ aktion: 'setzen', feld, person: null, ziel: null, text: null, zahl: null, monat: null, ja_nein: null, einheit: null, einkommensbasis: null, monatsloehne: null, planart: null, quelle: 'aussage', beleg: 'Test', begruendung: null, ...v });
const base = [op('beziehung', { text: 'ledig' }), op('geschlecht', { person: 'A', text: 'maennlich' }), op('geburtsjahr', { person: 'A', zahl: 1990 }), op('bvg_versichert', { person: 'A', ja_nein: true }), op('einkommen', { person: 'A', zahl: 100000, einheit: 'chf_jahr', einkommensbasis: 'brutto' }), op('pensionierungsalter', { person: 'A', zahl: 65 }), op('pk_altersrente', { person: 'A', zahl: 30000, einheit: 'chf_jahr' }), op('pk_guthaben', { person: 'A', zahl: 120000 }), op('bedarf_pensionierung', { zahl: 70000, einheit: 'chf_jahr' }), op('vermoegen_pensionierung', { zahl: 50000 }), op('pensionierung_basis_bestaetigt', { ja_nein: true }), op('budget_pensionierung_monat', { zahl: 250, einheit: 'chf_monat' })];
function fixture(changes = base) {
  let first = true, modelCalls = 0, fail = false, gate: Promise<void> | undefined;
  const requests: RetirementRequest[] = []; const contexts: string[] = [];
  const model: ModelAdapter = { generate: async r => {
    modelCalls++; contexts.push(JSON.stringify(r));
    if (r.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (r.responseFormat?.name === 'profil_aenderungen') { const aenderungen = first ? changes : []; first = false; return JSON.stringify({ aenderungen }); }
    return 'Danke.';
  } };
  const service = new ChatService(model, new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'))), 'Beratung', {
    heute: () => new Date('2026-10-31T12:00:00Z'), rechner: {
      berechneRisiko: async () => { throw new Error('Not requested'); },
      berechnePensionierung: async r => {
        requests.push(structuredClone(r)); if (gate) await gate; if (fail) throw new Error('secret must not escape');
        const capital = Math.max(0, (r.NeedRetirement - 62760) * 23);
        return { response: { ErrorCode: 1, IncomeNeed: r.NeedRetirement, IncomeTotal: 62760, IncomePillar1: 32760, IncomePillar2: 30000, IncomeWithdrawal: 0, IncomeGap: Math.max(0, r.NeedRetirement - 62760), AvailableFortune: 50000, CapitalNeed: capital, CapitalGap: Math.max(0, capital - 50000) } };
      },
      berechneSparen: async r => { const rate = Math.ceil(r.EndCapital / (r.Duration * 12)); const deposits = rate * r.Duration * 12; return { response: { PeriodicInvestment: rate, GrossCapital: deposits, Deposits: deposits, Interest: 0, InterestRate: 0 } }; },
    },
  });
  return { service, requests, contexts, calls: () => modelCalls, fail: () => { fail = true; }, gate: (p: Promise<void>) => { gate = p; } };
}

test('comparison changes only retirement need, preserves baseline and makes no model calls; adoption updates context and provenance', async () => {
  const f = fixture(); const initial = await f.service.reply({ message: 'Test' });
  const input = { sessionId: initial.sessionId, revision: initial.revision };
  const calls = f.calls();
  const v = await f.service.vergleicheSzenario({ ...input, jahresbedarf: 65000 });
  assert.equal(f.calls(), calls);
  assert.equal(v.ausgangslage.bedarfJahr, 70000); assert.equal(v.alternative.bedarfJahr, 65000);
  assert.equal(v.ausgangslage.sparbedarfMonat, 335); assert.equal(v.alternative.sparbedarfMonat, 5);
  assert.equal(v.ausgangslage.budget.fehlbetragMonat, 85); assert.equal(v.alternative.budget.restbudgetMonat, 245);
  assert.deepEqual(f.requests[1], { ...f.requests[0], NeedInPcRetirement: false, NeedRetirement: 65000 });
  assert.equal(initial.beratungsstand.profil.haushalt.bedarfPensionierung!.wert.hoehe, 70000);
  const adopted = f.service.uebernehmeSzenario({ ...input, szenarioId: v.id });
  assert.equal(adopted.revision, initial.revision + 1);
  assert.equal(adopted.beratungsstand.profil.haushalt.bedarfPensionierung!.wert.hoehe, 65000);
  assert.equal(adopted.beratungsstand.budget.restbudgetMonat, 245);
  assert.equal(adopted.beratungsstand.profil.haushalt.bedarfPensionierung!.beleg, adopted.userMessage);
  assert.equal(f.calls(), calls); assert.equal(f.requests.length, 2);
  await f.service.reply({ message: 'Test', sessionId: initial.sessionId });
  assert.ok(f.contexts.at(-1)!.includes('Ich übernehme das berechnete Pensionierungsziel mit CHF 65000'));
  assert.equal(f.requests.length, 2);
  assert.throws(() => f.service.uebernehmeSzenario({ ...input, szenarioId: v.id }), /geändert/);
});

test('zero gap uses zero savings; unknown budget stays unknown; replacing scenario invalidates old id', async () => {
  const f = fixture(base.filter(o => o.feld !== 'budget_pensionierung_monat'));
  const initial = await f.service.reply({ message: 'Test' }); const input = { sessionId: initial.sessionId, revision: initial.revision };
  const first = await f.service.vergleicheSzenario({ ...input, jahresbedarf: 65000 });
  assert.equal(first.alternative.budget.fehlbetragMonat, null);
  const second = await f.service.vergleicheSzenario({ ...input, jahresbedarf: 60000 });
  assert.equal(second.alternative.sparbedarfMonat, 0); assert.equal(second.alternative.kapitalluecke, 0);
  assert.equal(second.alternative.budget.verfuegbarMonat, null);
  assert.throws(() => f.service.uebernehmeSzenario({ ...input, szenarioId: first.id }), /nicht mehr aktuell/);
});

test('chat updates invalidate comparison; failures preserve original profile and remove previous candidate', async () => {
  const f = fixture(); const initial = await f.service.reply({ message: 'Test' });
  const input = { sessionId: initial.sessionId, revision: initial.revision };
  const v = await f.service.vergleicheSzenario({ ...input, jahresbedarf: 65000 });
  const next = await f.service.reply({ sessionId: initial.sessionId, message: 'Test' });
  assert.equal(next.beratungsstand.profil.haushalt.bedarfPensionierung!.wert.hoehe, 70000);
  assert.throws(() => f.service.uebernehmeSzenario({ ...input, szenarioId: v.id }), /geändert/);
  const latest = { sessionId: initial.sessionId, revision: next.revision };
  const old = await f.service.vergleicheSzenario({ ...latest, jahresbedarf: 65000 });
  f.fail();
  await assert.rejects(f.service.vergleicheSzenario({ ...latest, jahresbedarf: 66000 }), /aktuelle Pensionierungs/);
  assert.throws(() => f.service.uebernehmeSzenario({ ...latest, szenarioId: old.id }), /nicht mehr aktuell/);
});

test('strict input, missing baseline, expired or wrong sessions and cross-session adoption rejected', async () => {
  const f = fixture(); const a = await f.service.reply({ message: 'Test' });
  const input = { sessionId: a.sessionId, revision: a.revision };
  for (const jahresbedarf of [-1, NaN, Infinity, 1000001, '65000', null]) await assert.rejects(f.service.vergleicheSzenario({ ...input, jahresbedarf }));
  await assert.rejects(f.service.vergleicheSzenario({ ...input, jahresbedarf: 70000 }), /anderen Jahresbedarf/);
  await assert.rejects(f.service.vergleicheSzenario({ ...input, jahresbedarf: 65000, profil: {} }));
  await assert.rejects(f.service.vergleicheSzenario({ ...input, sessionId: 'missing', jahresbedarf: 65000 }), /abgelaufen/);
  const v = await f.service.vergleicheSzenario({ ...input, jahresbedarf: 65000 });
  const b = await f.service.reply({ message: 'Test' });
  assert.throws(() => f.service.uebernehmeSzenario({ sessionId: b.sessionId, revision: b.revision, szenarioId: v.id }));
  f.service.deleteSession({ sessionId: a.sessionId });
  assert.throws(() => f.service.uebernehmeSzenario({ ...input, szenarioId: v.id }), /abgelaufen/);
  const empty = fixture([]); const e = await empty.service.reply({ message: 'Test' });
  await assert.rejects(empty.service.vergleicheSzenario({ sessionId: e.sessionId, revision: e.revision, jahresbedarf: 65000 }), /aktuelle Pensionierungs/);
});

test('concurrent chat and scenario writes blocked; deletion during calculation cannot resurrect session', async () => {
  const f = fixture(); const a = await f.service.reply({ message: 'Test' });
  let release!: () => void; f.gate(new Promise<void>(resolve => { release = resolve; }));
  const input = { sessionId: a.sessionId, revision: a.revision, jahresbedarf: 65000 };
  const pending = f.service.vergleicheSzenario(input);
  await assert.rejects(f.service.vergleicheSzenario(input), /warte/);
  await assert.rejects(f.service.reply({ sessionId: a.sessionId, message: 'Test' }), /warte/);
  f.service.deleteSession({ sessionId: a.sessionId }); release();
  await assert.rejects(pending, /gelöscht/); assert.equal(f.service.sessionCount, 0);
});
