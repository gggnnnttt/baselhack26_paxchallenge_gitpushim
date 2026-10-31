import assert from "node:assert/strict";
import { test } from "node:test";
import { erstelleHandlungsplan } from "../src/beratung/handlungsplan.js";
import { Beratungsablauf } from "../src/beratung/ablauf.js";
import { ansicht, beratungsKontext } from "../src/beratung/darstellung.js";
import { leeresProfil, type Profil } from "../src/profil/profil.js";
const f = <T>(wert: T) => ({
  wert,
  quelle: "aussage" as const,
  beleg: "synthetisch",
  begruendung: null,
  nachricht: 0,
});
function profil(): Profil {
  const p = leeresProfil();
  p.haushalt = {
    beziehung: f("ledig"),
    bedarfPensionierung: f({ hoehe: 70000, einheit: "chf_jahr" }),
    vermoegenPensionierung: f(50000),
    pensionierungBasisBestaetigt: f(true),
  };
  p.personen.A = {
    geschlecht: f("maennlich"),
    geburtsjahr: f(1990),
    bvgVersichert: f(true),
    einkommen: f({
      betrag: 100000,
      einheit: "chf_jahr",
      basis: "brutto",
      monatsloehne: null,
    }),
    pensionierungsalter: f(65),
    pkAltersrente: f(30000),
    pkGuthaben: f(120000),
  };
  return p;
}
function fixture() {
  let pensionCalls = 0,
    sparCalls = 0;
  const ablauf = new Beratungsablauf({
    berechneRisiko: async () => ({
      response: {
        RiskScenarioSummaries: [
          { Scenario: 1, ErrorCode: 0, IncomeGap: 15000, CapitalGap: 400000 },
          { Scenario: 2, ErrorCode: 0, IncomeGap: 0, CapitalGap: 0 },
        ],
      },
    }),
    berechnePensionierung: async (r) => {
      pensionCalls++;
      return {
        response: {
          ErrorCode: 1,
          IncomeNeed: r.NeedRetirement,
          IncomeTotal: 64911,
          IncomePillar1: 32760,
          IncomePillar2: 30000,
          IncomeWithdrawal: 2151,
          IncomeGap: 5089,
          AvailableFortune: 50000,
          CapitalNeed: 166530,
          CapitalGap: r.NeedRetirement === 60000 ? 0 : 116530,
        },
      };
    },
    berechneSparen: async () => {
      sparCalls++;
      return {
        response: {
          PeriodicInvestment: 335,
          Deposits: 116580,
          GrossCapital: 116580,
          Interest: 0,
          InterestRate: 0,
        },
      };
    },
  });
  return { ablauf, counts: () => ({ pensionCalls, sparCalls }) };
}

test("empty profile gets a life-goal card, no invented product or financial result", () => {
  const stand = new Beratungsablauf(null).start(2026);
  const before = JSON.stringify(stand);
  const plan = erstelleHandlungsplan(stand);
  assert.deepEqual(
    plan.karten.map((k) => k.id),
    ["lebensziel"],
  );
  assert.equal(plan.karten[0]!.reihenfolge, 1);
  assert.deepEqual(erstelleHandlungsplan(stand), plan);
  assert.equal(JSON.stringify(stand), before);
});

test("missing PK values produce actionable evidence and prevent downstream pension planning cards", async () => {
  const p = profil();
  delete p.personen.A.pkAltersrente;
  delete p.personen.A.pkGuthaben;
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const plan = erstelleHandlungsplan(stand);
  const k = plan.karten.find((k) => k.id === "pension-pk")!;
  assert.equal(k.prioritaet, 1);
  assert.equal(k.offeneFragen.length, 2);
  assert.ok(k.datengrundlage[0]!.details.includes("PK-Altersrente"));
  assert.ok(!plan.karten.some((k) => k.id === "pension-budget-abstimmen"));
  for (const card of plan.karten) {
    assert.ok(card.begruendung);
    assert.ok(card.datengrundlage.length);
    assert.ok(card.offeneFragen.length);
    assert.ok(card.naechsterSchritt);
    assert.ok(card.aktion.nachricht);
  }
});

test("budget corrections replace cards deterministically, keep underlying calculations and handle withdrawal", async () => {
  const p = profil();
  const { ablauf, counts } = fixture();
  let stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.ok(
    erstelleHandlungsplan(stand).karten.some((k) => k.id === "budget-erfassen"),
  );
  p.haushalt.budgetPensionierungMonat = f(250);
  stand = await ablauf.aktualisiere(stand, p);
  let plan = erstelleHandlungsplan(stand);
  const under = plan.karten.find((k) => k.id === "pension-budget-abstimmen")!;
  assert.match(under.begruendung, /85/);
  assert.equal(under.datengrundlage.length, 2);
  assert.ok(!plan.karten.some((k) => k.id === "budget-erfassen"));
  p.haushalt.budgetPensionierungMonat = f(400);
  stand = await ablauf.aktualisiere(stand, p);
  plan = erstelleHandlungsplan(stand);
  assert.ok(!plan.karten.some((k) => k.id === under.id));
  assert.ok(plan.karten.some((k) => k.id === "sparweg-pruefen"));
  assert.deepEqual(counts(), { pensionCalls: 1, sparCalls: 1 });
  delete p.haushalt.budgetPensionierungMonat;
  stand = await ablauf.aktualisiere(stand, p);
  assert.ok(
    erstelleHandlungsplan(stand).karten.some((k) => k.id === "budget-erfassen"),
  );
  p.haushalt.bedarfPensionierung = f({ hoehe: 60000, einheit: "chf_jahr" });
  stand = await ablauf.aktualisiere(stand, p);
  assert.deepEqual(
    erstelleHandlungsplan(stand).karten.map((k) => k.id),
    ["pension-annahmen-pruefen"],
  );
});

test("contract clarification precedes independent budget planning, but cannot invent a reduced risk gap", async () => {
  const p = profil();
  p.haushalt.budgetPensionierungMonat = f(250);
  p.personen.A.privateEu = {
    vorhanden: f(true),
    zusaetzlichBestaetigt: f(false),
    mehrereVertraege: f(false),
  };
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const plan = erstelleHandlungsplan(stand);
  const contract = plan.karten.findIndex(
    (k) => k.id === "private-eu-klaeren-A",
  );
  const budget = plan.karten.findIndex(
    (k) => k.id === "pension-budget-abstimmen",
  );
  assert.ok(contract >= 0 && budget > contract);
  assert.ok(
    plan.karten[contract]!.offeneFragen.some((f) => f.includes("Verrechnung")),
  );
  assert.ok(!plan.karten.some((k) => k.id === "risikoluecke-A"));
  assert.ok(
    plan.karten[contract]!.aktion.nachricht.includes("Sende nichts an Dritte"),
  );
});

test("verified annual risk comparison produces a bounded action and stale inputs remove it", async () => {
  const p = profil();
  p.haushalt.hatKinder = f(false);
  p.personen.A.bedarfInvaliditaet = f({ hoehe: 80, einheit: "prozent" });
  p.personen.A.bedarfTodesfall = f({ hoehe: 70, einheit: "prozent" });
  p.personen.A.privateEu = {
    vorhanden: f(true),
    jahresrente: f(12000),
    deckung: f("beides"),
    wartefristMonate: f(6),
    leistungsendeAlter: f(65),
    zusaetzlichBestaetigt: f(true),
    mehrereVertraege: f(false),
  };
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const k = erstelleHandlungsplan(stand).karten.find(
    (k) => k.id === "risikoluecke-A",
  )!;
  assert.ok(k);
  assert.match(k.datengrundlage[0]!.details, /3.000|3'000|3’000/);
  assert.match(k.datengrundlage[0]!.details, /nach 6 Monaten bis Alter 65/);
  delete p.personen.A.geburtsjahr;
  const stale = await ablauf.aktualisiere(stand, p);
  assert.ok(
    !erstelleHandlungsplan(stale).karten.some((k) => k.id === "risikoluecke-A"),
  );
  assert.ok(
    !erstelleHandlungsplan(stale).karten.some(
      (k) => k.id === "pension-budget-abstimmen",
    ),
  );
});

test("API failure produces a clarification card and never a new solution from old values", async () => {
  const p = profil();
  const ablauf = new Beratungsablauf({
    berechneRisiko: async () => {
      throw new Error("not expected");
    },
    berechnePensionierung: async () => {
      throw new Error("offline");
    },
  });
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.deepEqual(
    erstelleHandlungsplan(stand).karten.map((k) => k.id),
    ["berechnung-verfuegbarkeit"],
  );
});

test("frontend and model receive the same backend priorities with stable IDs and no source mutation", async () => {
  const p = profil();
  p.haushalt.budgetPensionierungMonat = f(250);
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const before = JSON.stringify(stand);
  const plan = erstelleHandlungsplan(stand);
  assert.deepEqual(
    ansicht(stand, { uebernommen: [], abgelehnt: [] }).handlungsplan,
    plan,
  );
  const context = beratungsKontext(stand, { uebernommen: [], abgelehnt: [] });
  for (const k of plan.karten)
    assert.ok(context.includes(`[${k.id}, Priorität ${k.prioritaet}]`));
  assert.deepEqual(
    plan.karten.map((k) => k.reihenfolge),
    plan.karten.map((_, i) => i + 1),
  );
  assert.equal(new Set(plan.karten.map((k) => k.id)).size, plan.karten.length);
  assert.equal(JSON.stringify(stand), before);
});
