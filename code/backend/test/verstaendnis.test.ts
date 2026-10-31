import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { lagebild, lagebildKontext } from '../src/beratung/verstaendnis.js';
import { wendeAenderungenAn, type Aenderung } from '../src/profil/aenderungen.js';

// Synthetic data only. The calculator is simulated; the understanding itself never calculates.
const JAHR = 2026;
const TEXT = 'Testangaben';
const op = (feld: Aenderung['feld'], v: Partial<Aenderung> = {}): Aenderung => ({
  aktion: 'setzen', feld, person: null, ziel: null, text: null, zahl: null, monat: null, ja_nein: null, einheit: null,
  einkommensbasis: null, monatsloehne: null, planart: null, quelle: 'aussage', beleg: TEXT, begruendung: null, ...v,
});
const rechner = {
  berechneRisiko: async () => { throw new Error('not needed'); },
  berechnePensionierung: async (r: { NeedRetirement: number }) => ({ response: {
    ErrorCode: 1, IncomeNeed: r.NeedRetirement, IncomeTotal: 62760, IncomePillar1: 32760, IncomePillar2: 30000, IncomeWithdrawal: 0,
    IncomeGap: Math.max(0, r.NeedRetirement - 62760), AvailableFortune: 50000, CapitalNeed: 100000, CapitalGap: 50000,
  } }),
  berechneSparen: async (r: { EndCapital: number; Duration: number }) => ({ response: { PeriodicInvestment: r.EndCapital / (r.Duration * 12), GrossCapital: r.EndCapital, Deposits: r.EndCapital, Interest: 0, InterestRate: 0 } }),
};

async function stand(aenderungen: Aenderung[]) {
  const ablauf = new Beratungsablauf(rechner as never);
  const start = ablauf.start(JAHR);
  const { profil } = wendeAenderungenAn(start.kontext.profil, aenderungen, { text: TEXT, index: 0, jahr: JAHR });
  return ablauf.aktualisiere(start, profil);
}

test('without information Pax is still understanding and asks for the concern first', async () => {
  const l = lagebild(await stand([]));
  assert.equal(l.phase, 'verstehen');
  assert.deepEqual(l.saeulen.map(s => s.status), ['offen', 'offen', 'offen']);
  assert.equal(l.naechstes[0]!.label, 'Dein wichtigstes Anliegen');
  assert.equal(l.naechstes.length, 3);
  assert.equal(l.verstanden, 0);
});

test('a planned self-employment is recognised as a change to the second pillar', async () => {
  const l = lagebild(await stand([
    op('anliegen', { text: 'Vorsorge für die Pensionierung' }),
    op('plan', { ziel: 'neu1', text: 'Selbstständigkeit aufnehmen', planart: 'stellenwechsel' }),
    op('plan_zeitpunkt', { ziel: 'neu1', zahl: 2028 }),
  ]));
  assert.equal(l.fokus, 'pensionierung');
  assert.match(l.erkenntnisse[0]!.text, /Selbstständigkeit ab 2028 entfällt in der Regel die obligatorische Pensionskasse/);
  assert.match(lagebildKontext(l), /Phase: verstehen\. Frage nach dem wichtigsten Punkt/);
});

test('with all three pillars, a concern and a calculation Pax is ready to advise', async () => {
  const l = lagebild(await stand([
    op('anliegen', { text: 'Ruhestand planen' }),
    op('beziehung', { text: 'ledig' }), op('geschlecht', { person: 'A', text: 'maennlich' }), op('geburtsjahr', { person: 'A', zahl: 1990 }),
    op('erwerb', { person: 'A', text: 'angestellt' }), op('einkommen', { person: 'A', zahl: 100000, einheit: 'chf_jahr', einkommensbasis: 'brutto' }),
    op('bvg_versichert', { person: 'A', ja_nein: true }), op('pk_altersrente', { person: 'A', zahl: 30000, einheit: 'chf_jahr' }), op('pk_guthaben', { person: 'A', zahl: 120000 }),
    op('private_eu_vorhanden', { person: 'A', ja_nein: false }), op('vermoegen_pensionierung', { zahl: 50000 }),
    op('pensionierungsalter', { person: 'A', zahl: 65 }), op('bedarf_pensionierung', { zahl: 70000, einheit: 'chf_jahr' }),
    op('pensionierung_basis_bestaetigt', { ja_nein: true }),
  ]));
  assert.deepEqual(l.saeulen.map(s => s.status), ['klar', 'klar', 'klar']);
  assert.equal(l.phase, 'empfehlen');
  assert.equal(l.verstanden, 1);
  const pension = l.themen.find(t => t.id === 'pensionierung')!;
  assert.equal(pension.status, 'berechnet');
  assert.equal(pension.luecke, true);
  assert.ok(l.erkenntnisse.some(e => e.art === 'luecke' && /Im Ruhestand fehlen dir rund CHF 7.240 pro Jahr/.test(e.text)));
});
