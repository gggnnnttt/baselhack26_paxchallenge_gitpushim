import assert from "node:assert/strict";
import { test } from "node:test";
import { ermittleProduktvorschlaege } from "../src/produkte/zuordnung.js";
import { paxErwerbsunfaehigkeit } from "../src/produkte/katalog.js";
import { Beratungsablauf } from "../src/beratung/ablauf.js";
import { ansicht, beratungsKontext } from "../src/beratung/darstellung.js";
import { leeresProfil, type Profil } from "../src/profil/profil.js";
import type { RiskResponse } from "../src/berechnung/risiko.js";
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
    hatKinder: f(false),
    budgetPensionierungMonat: f(400),
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
    bedarfInvaliditaet: f({ hoehe: 80, einheit: "prozent" }),
    bedarfTodesfall: f({ hoehe: 70, einheit: "prozent" }),
    privateEu: {
      vorhanden: f(true),
      jahresrente: f(12000),
      deckung: f("beides"),
      wartefristMonate: f(6),
      leistungsendeAlter: f(65),
      zusaetzlichBestaetigt: f(true),
      mehrereVertraege: f(false),
    },
  };
  return p;
}
const antwort: RiskResponse = {
  response: {
    RiskScenarioSummaries: [
      { Scenario: 1, ErrorCode: 0, IncomeGap: 14836, CapitalGap: 397417 },
      { Scenario: 2, ErrorCode: 0, IncomeGap: 0, CapitalGap: 0 },
      { Scenario: 3, ErrorCode: 0, IncomeGap: 8330, CapitalGap: 204196 },
      { Scenario: 4, ErrorCode: 0, IncomeGap: 0, CapitalGap: 0 },
    ],
  },
};
function fixture(response = antwort) {
  let calls = 0;
  const ablauf = new Beratungsablauf({
    berechneRisiko: async () => {
      calls++;
      return structuredClone(response);
    },
  });
  return { ablauf, calls: () => calls };
}

test("positive bounded EU need selects only the curated product and retains source, person, cause and period", async () => {
  const p = profil(),
    { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const before = JSON.stringify(stand);
  const candidates = ermittleProduktvorschlaege(stand).faelle.filter(
    (f) => f.status === "pruefkandidat",
  );
  assert.equal(candidates.length, 1);
  const c = candidates[0]!;
  assert.equal(c.produkt!.id, "pax-erwerbsunfaehigkeit");
  assert.equal(c.person, "A");
  assert.equal(c.ursache, "krankheit");
  assert.equal(c.restlueckeProJahr, 2836);
  assert.equal(c.bestehendeWartefristMonate, 6);
  assert.equal(c.bestehendeLeistungBisAlter, 65);
  assert.match(c.geltungsbereich, /Nur nach 6 Monaten/);
  assert.ok(c.offenePruefungen.some((q) => q.includes("Prämie")));
  assert.ok(c.offenePruefungen.some((q) => q.includes("PK-")));
  assert.equal(c.handlungId, "risikoluecke-A");
  assert.equal(c.regelId, "eu-pruefkandidat-v1");
  assert.ok(c.datengrundlage.some((d) => d.quelle.includes("Backend")));
  assert.ok(!("praemie" in c));
  assert.ok(!("versicherungssumme" in c));
  assert.equal(paxErwerbsunfaehigkeit.quellenstand, "2026-10-31");
  assert.ok(paxErwerbsunfaehigkeit.quelle.startsWith("https://www.pax.ch/"));
  assert.equal(JSON.stringify(stand), before);
});

test("unknown existing cover, missing policy terms and uncertain coordination all hide the product", async () => {
  for (const key of [
    "vorhanden",
    "jahresrente",
    "deckung",
    "wartefristMonate",
    "leistungsendeAlter",
    "zusaetzlichBestaetigt",
    "mehrereVertraege",
  ] as const) {
    const p = profil();
    delete p.personen.A.privateEu![key];
    const { ablauf } = fixture();
    const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
    const c = ermittleProduktvorschlaege(stand).faelle[0]!;
    assert.equal(c.status, "abklaerung", key);
    assert.equal(c.produkt, null, key);
    assert.equal(c.restlueckeProJahr, null, key);
  }
});

test("no annual gap produces no extra product; zero only during policy benefit requires temporal clarification", async () => {
  const p = profil();
  p.personen.A.privateEu!.jahresrente = f(30000);
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const cases = ermittleProduktvorschlaege(stand).faelle;
  assert.equal(cases[0]!.status, "abklaerung");
  assert.equal(cases[0]!.restlueckeProJahr, 0);
  assert.equal(cases[0]!.produkt, null);
  assert.ok(cases[0]!.offenePruefungen.some((q) => q.includes("Wartefrist")));
  assert.equal(cases[1]!.status, "kein_zusaetzlicher_bedarf");
  assert.equal(cases[1]!.produkt, null);
});

test("explicitly absent insurance permits a category candidate; excluded cause still needs complete policy terms", async () => {
  const p = profil();
  p.personen.A.privateEu = { vorhanden: f(false) };
  const { ablauf } = fixture();
  let stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.equal(
    ermittleProduktvorschlaege(stand).faelle[0]!.restlueckeProJahr,
    14836,
  );
  assert.equal(
    ermittleProduktvorschlaege(stand).faelle[0]!.status,
    "pruefkandidat",
  );
  const q = profil();
  q.personen.A.privateEu!.deckung = f("unfall");
  delete q.personen.A.privateEu!.zusaetzlichBestaetigt;
  stand = await ablauf.aktualisiere(stand, q);
  assert.equal(
    ermittleProduktvorschlaege(stand).faelle[0]!.status,
    "abklaerung",
  );
});

test("products never cross persons or death scenarios, including irrelevant API Person B output", async () => {
  const response = structuredClone(antwort);
  response.response.RiskScenarioSummaries.push({
    Scenario: 5,
    ErrorCode: 0,
    IncomeGap: 20000,
  });
  const p = profil();
  p.personen.B = { geburtsjahr: f(1984) };
  const { ablauf } = fixture(response);
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  const result = ermittleProduktvorschlaege(stand);
  assert.equal(result.faelle.length, 2);
  assert.ok(result.faelle.every((f) => f.person === "A"));
  assert.ok(result.faelle.every((f) => !f.szenario.includes("Todesfall")));
  assert.ok(result.hinweise.some((h) => h.includes("Pensionierungsbudget")));
});

test("withdrawal removes a prior product without API recalc; stale/failed results cannot retain products", async () => {
  const p = profil(),
    { ablauf, calls } = fixture();
  let stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.equal(
    ermittleProduktvorschlaege(stand).faelle[0]!.status,
    "pruefkandidat",
  );
  p.personen.A.privateEu!.zusaetzlichBestaetigt = f(false);
  stand = await ablauf.aktualisiere(stand, p);
  assert.equal(calls(), 1);
  assert.ok(
    ermittleProduktvorschlaege(stand).faelle.every((f) => f.produkt === null),
  );
  delete p.personen.A.geburtsjahr;
  const stale = await ablauf.aktualisiere(stand, p);
  assert.deepEqual(ermittleProduktvorschlaege(stale).faelle, []);
  assert.deepEqual(
    ermittleProduktvorschlaege({ ...stand, phase: "fehlgeschlagen" }).faelle,
    [],
  );
});

test("failed or unknown API scenario codes and missing personal need cannot produce candidates", async () => {
  for (const code of [8, 999]) {
    const r = structuredClone(antwort);
    r.response.RiskScenarioSummaries[0]!.ErrorCode = code;
    const { ablauf } = fixture(r);
    const stand = await ablauf.aktualisiere(ablauf.start(2026), profil());
    assert.equal(
      ermittleProduktvorschlaege(stand).faelle[0]!.status,
      "nicht_bereit",
    );
  }
  const p = profil();
  delete p.personen.A.einkommen;
  p.personen.A.erwerb = f("nicht_erwerbstaetig");
  p.personen.A.bvgVersichert = f(false);
  delete p.personen.A.bedarfInvaliditaet;
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), p);
  assert.equal(
    ermittleProduktvorschlaege(stand).faelle[0]!.status,
    "nicht_bereit",
  );
});

test("the frontend receives no legacy rule-selected products, the chat model never sees a product", async () => {
  const { ablauf } = fixture();
  const stand = await ablauf.aktualisiere(ablauf.start(2026), profil());
  assert.deepEqual(
    ansicht(stand, { uebernommen: [], abgelehnt: [] }).produktzuordnung.faelle,
    [],
  );
  const context = beratungsKontext(stand, { uebernommen: [], abgelehnt: [] });
  // An advisor, not a salesman: products only appear on the recommendations page.
  assert.doesNotMatch(context, /eu-pruefkandidat-v1|pruefkandidat|Pax Erwerbsunfähigkeitsversicherung/);
});
