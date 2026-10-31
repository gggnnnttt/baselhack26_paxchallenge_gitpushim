import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gleicheBudgetAb } from '../src/berechnung/budget.js';
import { starteSparen } from '../src/berechnung/sparen.js';
import { leeresProfil } from '../src/profil/profil.js';
import { wendeAenderungenAn, type Aenderung } from '../src/profil/aenderungen.js';
import { ChatService, type ModelAdapter } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
const f = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'Test', begruendung: null, nachricht: 0 });
const sparen = () => ({ ...starteSparen(), phase: 'berechnet' as const, ergebnis: { zeitpunkt: '2026-10-31T12:00:00Z', monatlicherSparbetrag: 335, einzahlungen: 116580, endkapital: 116580 } });
const op = (feld: Aenderung['feld'], v: Partial<Aenderung> = {}): Aenderung => ({ aktion: 'setzen', feld, person: null, ziel: null, text: null, zahl: null, monat: null, ja_nein: null, einheit: null, einkommensbasis: null, monatsloehne: null, planart: null, quelle: 'aussage', beleg: 'Test', begruendung: null, ...v });

test('budget compares insufficient, equal and higher monthly amounts and distinguishes explicit zero', () => {
 for (const [budget, status, fehlbetrag, rest] of [[250, 'unterdeckung', 85, 0], [335, 'ausreichend', 0, 0], [400, 'ausreichend', 0, 65], [0, 'unterdeckung', 335, 0]] as const) {
  const p = leeresProfil(); p.haushalt.budgetPensionierungMonat = f(budget);
  const b = gleicheBudgetAb(p, sparen());
  assert.equal(b.status, status); assert.equal(b.fehlbetragMonat, fehlbetrag); assert.equal(b.restbudgetMonat, rest);
 }
});

test('unknown budget is not zero and stale or absent saving results never retain a comparison', () => {
 const p = leeresProfil(); assert.equal(gleicheBudgetAb(p, sparen()).status, 'offen');
 assert.equal(gleicheBudgetAb(p, sparen()).fehlbetragMonat, null);
 p.haushalt.budgetPensionierungMonat = f(400);
 for (const phase of ['wartet', 'bereit', 'fehlgeschlagen', 'nicht_moeglich'] as const) {
  const b = gleicheBudgetAb(p, { ...sparen(), phase });
  assert.equal(b.status, 'wartet'); assert.equal(b.sparbedarfMonat, null); assert.equal(b.restbudgetMonat, null);
 }
 const b = gleicheBudgetAb(p, { ...starteSparen(), phase: 'kein_bedarf' });
 assert.equal(b.status, 'kein_bedarf'); assert.equal(b.sparbedarfMonat, 0); assert.equal(b.restbudgetMonat, null);
});

test('cent comparison avoids floating-point differences and accepts a budget known before calculating', () => {
 const p = leeresProfil(); p.haushalt.budgetPensionierungMonat = f(0.3);
 assert.equal(gleicheBudgetAb(p, starteSparen()).verfuegbarMonat, 0.3);
 const b = gleicheBudgetAb(p, { ...sparen(), ergebnis: { ...sparen().ergebnis, monatlicherSparbetrag: 0.1 + 0.2 } });
 assert.equal(b.status, 'ausreichend'); assert.equal(b.fehlbetragMonat, 0);
});

test('budget changes validate evidence, unit and household scope and normalise annual amounts', () => {
 const p = leeresProfil();
 const apply = (changes: Aenderung[]) => wendeAenderungenAn(p, changes, { text: 'Test', index: 0, jahr: 2026 });
 const annual = apply([op('budget_pensionierung_monat', { zahl: 3000, einheit: 'chf_jahr' })]);
 assert.equal(annual.profil.haushalt.budgetPensionierungMonat!.wert, 250);
 assert.equal(annual.profil.haushalt.budgetPensionierungMonat!.beleg, 'Test');
 const zero = apply([op('budget_pensionierung_monat', { zahl: 0, einheit: 'chf_monat' })]);
 assert.equal(zero.profil.haushalt.budgetPensionierungMonat!.wert, 0);
 for (const v of [{ zahl: -1, einheit: 'chf_monat' as const }, { zahl: 20, einheit: 'prozent' as const }, { zahl: 400, einheit: 'chf_monat' as const, person: 'A' as const }, { zahl: 400, einheit: 'chf_monat' as const, beleg: 'nicht gesagt' }]) {
  const bad = apply([op('budget_pensionierung_monat', v)]);
  assert.equal(bad.abgelehnt.length, 1); assert.equal(bad.profil.haushalt.budgetPensionierungMonat, undefined);
 }
 const removed = wendeAenderungenAn(annual.profil, [op('budget_pensionierung_monat', { aktion: 'entfernen' })], { text: 'Test', index: 2, jahr: 2026 });
 assert.equal(removed.profil.haushalt.budgetPensionierungMonat, undefined);
});

test('chat asks only after a saving result; budget correction and withdrawal need no API recalculation', async () => {
 const base = [op('beziehung', { text: 'ledig' }), op('geschlecht', { person: 'A', text: 'maennlich' }), op('geburtsjahr', { person: 'A', zahl: 1990 }), op('bvg_versichert', { person: 'A', ja_nein: true }), op('einkommen', { person: 'A', zahl: 100000, einheit: 'chf_jahr', einkommensbasis: 'brutto' }), op('pensionierungsalter', { person: 'A', zahl: 65 }), op('pk_altersrente', { person: 'A', zahl: 30000, einheit: 'chf_jahr' }), op('pk_guthaben', { person: 'A', zahl: 120000 }), op('bedarf_pensionierung', { zahl: 70000, einheit: 'chf_jahr' }), op('vermoegen_pensionierung', { zahl: 50000 }), op('pensionierung_basis_bestaetigt', { ja_nein: true })];
 const turns = [[], base, [op('budget_pensionierung_monat', { zahl: 250, einheit: 'chf_monat' })], [op('budget_pensionierung_monat', { zahl: 400, einheit: 'chf_monat' })], [op('budget_pensionierung_monat', { aktion: 'entfernen' })], [op('budget_pensionierung_monat', { zahl: 0, einheit: 'chf_monat' })], [op('bedarf_pensionierung', { zahl: 60000, einheit: 'chf_jahr' })]];
 let index = 0, pensionCalls = 0, sparCalls = 0, context = '';
 const model: ModelAdapter = { generate: async r => {
  if (r.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
  if (r.responseFormat?.name === 'profil_aenderungen') return JSON.stringify({ aenderungen: turns[index++] ?? [] });
  context = r.instructions; return 'Danke.';
 } };
 const service = new ChatService(model, new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'))), 'Beratung', { heute: () => new Date('2026-10-31T12:00:00Z'), rechner: {
  berechneRisiko: async () => { throw new Error('not expected'); },
  berechnePensionierung: async r => {
   pensionCalls++; assert.ok(!JSON.stringify(r).includes('budgetPensionierung'));
   return { response: { ErrorCode: 1, IncomeNeed: r.NeedRetirement, IncomeTotal: 64911, IncomePillar1: 32760, IncomePillar2: 30000, IncomeWithdrawal: 2151, IncomeGap: 5089, AvailableFortune: 50000, CapitalNeed: 166530, CapitalGap: r.NeedRetirement === 60000 ? 0 : 116530 } };
  },
  berechneSparen: async r => { sparCalls++; return { response: { PeriodicInvestment: 335, Deposits: 116580, GrossCapital: 116580, Interest: 0, InterestRate: 0 } }; },
 } });
 let id: string | undefined;
 async function next() { const r = await service.reply({ message: 'Test', ...(id ? { sessionId: id } : {}) }); id = r.sessionId; return r.beratungsstand; }
 assert.equal((await next()).budget.status, 'wartet'); assert.ok(!context.includes('Frage jetzt gezielt'));
 assert.equal((await next()).budget.status, 'offen'); assert.match(context, /Frage jetzt gezielt/);
 assert.equal((await next()).budget.fehlbetragMonat, 85); assert.ok(!context.includes('Frage jetzt gezielt'));
 const enough = await next(); assert.equal(enough.budget.restbudgetMonat, 65);
 assert.equal(enough.profil.haushalt.bedarfPensionierung!.wert.hoehe, 70000);
 assert.equal(enough.profil.haushalt.vermoegenPensionierung!.wert, 50000);
 assert.equal((await next()).budget.status, 'offen'); assert.match(context, /Frage jetzt gezielt/);
 assert.equal((await next()).budget.fehlbetragMonat, 335);
 assert.equal(pensionCalls, 1); assert.equal(sparCalls, 1);
 assert.equal((await next()).budget.status, 'kein_bedarf'); assert.ok(!context.includes('Frage jetzt gezielt'));
});
