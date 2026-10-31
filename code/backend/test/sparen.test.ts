import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiCalcClient } from '../src/berechnung/apicalc.js';
import { pruefePensionierung, type PensionierungsStand } from '../src/berechnung/pensionierung.js';
import { aktualisiereSparen, starteSparen, type SavingResponse, type SparRechner } from '../src/berechnung/sparen.js';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { ansicht, beratungsKontext } from '../src/beratung/darstellung.js';
import { leeresProfil, type Profil } from '../src/profil/profil.js';

const fakt = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'synthetisch', begruendung: null, nachricht: 0 });
function profil(): Profil {
  const p = leeresProfil();
  p.haushalt = { beziehung: fakt('ledig'), bedarfPensionierung: fakt({ hoehe: 70000, einheit: 'chf_jahr' }), vermoegenPensionierung: fakt(50000), pensionierungBasisBestaetigt: fakt(true) };
  p.personen.A = { geschlecht: fakt('maennlich'), geburtsjahr: fakt(1990), bvgVersichert: fakt(true),
    einkommen: fakt({ betrag: 100000, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }),
    pensionierungsalter: fakt(65), pkAltersrente: fakt(30000), pkGuthaben: fakt(120000) };
  return p;
}
function pension(gap = 116530, p = profil()): PensionierungsStand {
  const pruefung = pruefePensionierung(p, 2026);
  return { phase: 'berechnet', pruefung, fehler: null, berechnung: { requestJson: pruefung.requestJson!, zeitpunkt: '2026-10-31T12:00:00Z',
    antwort: { response: { ErrorCode: 1, IncomeNeed: 70000, IncomeTotal: 64911, IncomePillar1: 32760, IncomePillar2: 30000,
      IncomeWithdrawal: 2151, IncomeGap: 5089, AvailableFortune: 50000, CapitalNeed: 166530, CapitalGap: gap } } } };
}
function rechner(): SparRechner {
  return { berechneSparen: async r => ({ response: { PeriodicInvestment: r.EndCapital / (r.Duration * 12),
    Deposits: r.EndCapital, Interest: 0, GrossCapital: r.EndCapital, InterestRate: 0 } }) };
}

test('saving targets the remaining gap, uses no second allocation of existing capital and preserves cents', async () => {
  const s = await aktualisiereSparen(starteSparen(), pension(), 2026, rechner());
  assert.equal(s.phase, 'berechnet');
  assert.equal(s.request!.EndCapital, 116530); // Not 66530: the 50000 is already deducted.
  assert.equal(s.request!.InitialInvestment, 0);
  assert.equal(s.request!.SavingGoal, 2);
  assert.equal(s.request!.InvestmentMonthly, true);
  assert.equal(s.request!.Duration, 29);
  assert.equal(s.zieljahr, 2055);
  assert.ok(Math.abs(s.ergebnis!.monatlicherSparbetrag - 334.85632183908046) < 0.0001);
});

test('couples use the first retirement date, not the writing persons later retirement', async () => {
  const p = profil();
  p.haushalt.beziehung = fakt('verheiratet'); p.haushalt.beziehungSeitJahr = fakt(2020);
  p.personen.B = { ...structuredClone(p.personen.A), geburtsjahr: fakt(1984) };
  const s = await aktualisiereSparen(starteSparen(), pension(116530, p), 2026, rechner());
  assert.equal(s.zieljahr, 2049);
  assert.equal(s.request!.Duration, 23);
});

test('zero or surplus capital requires no API call; no saving time cannot produce a monthly plan', async () => {
  const never: SparRechner = { berechneSparen: async () => { throw new Error('must not call'); } };
  for (const gap of [0, -100]) {
    const s = await aktualisiereSparen(starteSparen(), pension(gap), 2026, never);
    assert.equal(s.phase, 'kein_bedarf'); assert.equal(s.ergebnis, null);
  }
  const s = await aktualisiereSparen(starteSparen(), pension(), 2055, never);
  assert.equal(s.phase, 'nicht_moeglich'); assert.equal(s.request, null);
});

test('changed or withdrawn pension inputs never retain an old saving result', async () => {
  let calls = 0;
  const calc: SparRechner = { berechneSparen: async r => { calls++; return rechner().berechneSparen(r); } };
  const first = await aktualisiereSparen(starteSparen(), pension(), 2026, calc);
  await aktualisiereSparen(first, pension(), 2026, calc);
  assert.equal(calls, 1);
  const changed = await aktualisiereSparen(first, pension(200000), 2026, calc);
  assert.equal(calls, 2); assert.equal(changed.zielkapital, 200000);
  const p = pension(); p.phase = 'erfassung';
  const waiting = await aktualisiereSparen(changed, p, 2026, calc);
  assert.equal(waiting.phase, 'wartet'); assert.equal(waiting.ergebnis, null);
  const outdated = pension(); outdated.berechnung!.requestJson = 'outdated';
  assert.equal((await aktualisiereSparen(first, outdated, 2026, calc)).ergebnis, null);
  const zero = await aktualisiereSparen(first, pension(0), 2026, calc);
  assert.equal(zero.phase, 'kein_bedarf'); assert.equal(zero.ergebnis, null);
});

test('saving configuration, malformed answers, implausible rates and provider failures are handled safely', async () => {
  assert.equal((await aktualisiereSparen(starteSparen(), pension(), 2026, null)).phase, 'bereit');
  const broken: SparRechner[] = [
    { berechneSparen: async () => { throw new Error('SECRET'); } },
    { berechneSparen: async () => ({ response: {} }) as SavingResponse },
    { berechneSparen: async () => ({ response: { PeriodicInvestment: 1, Deposits: 116530, Interest: 0, GrossCapital: 116530, InterestRate: 0 } }) },
  ];
  for (const calc of broken) {
    const s = await aktualisiereSparen(starteSparen(), pension(), 2026, calc);
    assert.equal(s.phase, 'fehlgeschlagen'); assert.equal(s.ergebnis, null);
    assert.ok(!s.fehler!.includes('SECRET'));
  }
});

test('saving client calls calculateSaving with authentication and validates its response', async () => {
  const request = (await aktualisiereSparen(starteSparen(), pension(), 2026, null)).request!;
  const client = createApiCalcClient({ baseUrl: 'https://example.test/viper/', token: 'synthetic', tenant: 'pax', fetch: async (url, init) => {
    assert.equal(String(url), 'https://example.test/viper/operation/standard/APICalc_calculateSaving?tenant=pax');
    assert.equal((init!.headers as Record<string, string>)['Authorization'], 'Bearer synthetic');
    assert.deepEqual(JSON.parse(String(init!.body)), request);
    return Response.json(await rechner().berechneSparen(request));
  } });
  assert.ok((await client.berechneSparen(request)).response.PeriodicInvestment > 0);
});

test('advisory flow chains retirement and saving, exposes the verified plan to chat and clears it after withdrawal', async () => {
  const p = profil();
  const ablauf = new Beratungsablauf({ berechneRisiko: async () => { throw new Error('not expected'); },
    berechnePensionierung: async () => pension().berechnung!.antwort, berechneSparen: rechner().berechneSparen });
  const first = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.equal(first.phase, 'erfassung'); assert.equal(first.pensionierung.phase, 'berechnet'); assert.equal(first.sparen.phase, 'berechnet');
  const view = ansicht(first, { uebernommen: [], abgelehnt: [] });
  assert.ok(!('grundlageJson' in view.sparen));
  const context = beratungsKontext(first, { uebernommen: [], abgelehnt: [] });
  assert.match(context, /334.86/); assert.match(context, /Gesamte verfügbare Einnahmen inklusive Vermögensverzehr/);
  delete p.haushalt.bedarfPensionierung;
  const next = await ablauf.aktualisiere(first, p);
  assert.equal(next.sparen.ergebnis, null);
});

test('live API whole-CHF rounding is accepted and the actual end capital stays visible', async () => {
  const rounded: SparRechner = { berechneSparen: async () => ({ response: {
    PeriodicInvestment: 335, Deposits: 116580, Interest: 0, GrossCapital: 116580, InterestRate: 0,
  } }) };
  const s = await aktualisiereSparen(starteSparen(), pension(), 2026, rounded);
  assert.equal(s.phase, 'berechnet');
  assert.equal(s.ergebnis!.monatlicherSparbetrag, 335);
  assert.equal(s.ergebnis!.endkapital, 116580);
  assert.equal(s.zielkapital, 116530);
});
