import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { vergleichePrivateEu } from "../src/berechnung/private-eu.js";
import { type RiskResponse } from "../src/berechnung/risiko.js";
import { leeresProfil, type Profil } from "../src/profil/profil.js";
import {
  wendeAenderungenAn,
  type Aenderung,
} from "../src/profil/aenderungen.js";
import { ChatService, type ModelAdapter } from "../src/chat.js";
import { Guardrails } from "../src/guardrails.js";
const f = <T>(wert: T) => ({
  wert,
  quelle: "aussage" as const,
  beleg: "Test",
  begruendung: null,
  nachricht: 0,
});
function profil(): Profil {
  const p = leeresProfil();
  p.personen.A = {
    geburtsjahr: f(1990),
    privateEu: {
      vorhanden: f(true),
      jahresrente: f(12000),
      deckung: f("krankheit"),
      wartefristMonate: f(6),
      leistungsendeAlter: f(65),
      zusaetzlichBestaetigt: f(true),
      mehrereVertraege: f(false),
    },
  };
  p.personen.B = { geburtsjahr: f(1984) };
  return p;
}
const response: RiskResponse = {
  response: {
    RiskScenarioSummaries: [
      { Scenario: 1, ErrorCode: 1, IncomeGap: 15000, CapitalGap: 400000 },
      { Scenario: 2, ErrorCode: 1, IncomeGap: 7000, CapitalGap: 100000 },
      { Scenario: 3, ErrorCode: 1, IncomeGap: 20000, CapitalGap: 500000 },
      { Scenario: 4, ErrorCode: 1, IncomeGap: 20000, CapitalGap: 500000 },
      { Scenario: 5, ErrorCode: 1, IncomeGap: 24000, CapitalGap: 600000 },
      { Scenario: 6, ErrorCode: 1, IncomeGap: 0, CapitalGap: 0 },
    ],
  },
};
const op = (
  feld: Aenderung["feld"],
  v: Partial<Aenderung> = {},
): Aenderung => ({
  aktion: "setzen",
  feld,
  person: "A",
  ziel: null,
  text: null,
  zahl: null,
  monat: null,
  ja_nein: null,
  einheit: null,
  einkommensbasis: null,
  monatsloehne: null,
  planart: null,
  quelle: "aussage",
  beleg: "Test",
  begruendung: null,
  ...v,
});
const apply = (p: Profil, changes: Aenderung[]) =>
  wendeAenderungenAn(p, changes, { text: "Test", index: 0, jahr: 2026 });
const first = (p: Profil) =>
  vergleichePrivateEu(p, response, 2026).vergleiche[0]!;

test("private EU pension matches person and cause, only after waiting; death and capital stay unchanged", () => {
  const original = structuredClone(response),
    v = vergleichePrivateEu(profil(), response, 2026);
  assert.equal(v.vergleiche.length, 4);
  assert.equal(v.vergleiche[0]!.status, "modelliert");
  assert.equal(v.vergleiche[0]!.lueckeNachLeistungsbeginn, 3000);
  assert.equal(v.vergleiche[0]!.wartefristMonate, 6);
  assert.equal(v.vergleiche[0]!.leistungsendeAlter, 65);
  assert.equal(v.vergleiche[1]!.status, "nicht_gedeckt");
  assert.equal(v.vergleiche[2]!.status, "offen");
  assert.deepEqual(response, original);
  const p = profil();
  p.personen.A.privateEu!.deckung = f("beides");
  p.personen.A.privateEu!.jahresrente = f(30000);
  assert.equal(first(p).lueckeNachLeistungsbeginn, 0);
  assert.equal(first(p).zurLueckendeckung, 15000);
  assert.equal(
    vergleichePrivateEu(p, response, 2026).vergleiche[1]!.zurLueckendeckung,
    7000,
  );
});

test("missing terms, uncertain coordination and multiple policies prevent offsetting", () => {
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
    assert.equal(first(p).status, "offen", key);
    assert.equal(first(p).lueckeNachLeistungsbeginn, null, key);
  }
  const p = profil();
  p.personen.A.privateEu!.zusaetzlichBestaetigt = f(false);
  assert.equal(first(p).status, "offen");
  p.personen.A.privateEu!.mehrereVertraege = f(true);
  assert.equal(first(p).status, "nicht_verwendbar");
});

test("zero, unknown and no policy differ; expired/near-end contracts and failed results are unusable", () => {
  const p = profil();
  p.personen.A.privateEu!.jahresrente = f(0);
  p.personen.A.privateEu!.wartefristMonate = f(0);
  assert.equal(first(p).status, "modelliert");
  assert.equal(first(p).lueckeNachLeistungsbeginn, 15000);
  p.personen.A.privateEu = { vorhanden: f(false) };
  assert.equal(first(p).status, "keine");
  for (const end of [36, 37]) {
    const q = profil();
    q.personen.A.privateEu!.leistungsendeAlter = f(end);
    assert.equal(first(q).status, "nicht_verwendbar");
  }
  const bad = structuredClone(response);
  bad.response.RiskScenarioSummaries[0]!.ErrorCode = 8;
  assert.equal(
    vergleichePrivateEu(profil(), bad, 2026).vergleiche[0]!.status,
    "nicht_verwendbar",
  );
  assert.deepEqual(vergleichePrivateEu(profil(), null, 2026).vergleiche, []);
});

test("rent input normalises monthly amounts and rejects invalid units, dates, sources and missing person", () => {
  const r = apply(leeresProfil(), [
    op("private_eu_rente", { zahl: 1000, einheit: "chf_monat" }),
    op("private_eu_wartefrist_monate", { zahl: 6 }),
    op("private_eu_endalter", { zahl: 65 }),
  ]);
  assert.equal(r.abgelehnt.length, 0);
  assert.equal(r.profil.personen.A.privateEu!.jahresrente!.wert, 12000);
  const bad = apply(leeresProfil(), [
    op("private_eu_rente", { zahl: 80, einheit: "prozent" }),
    op("private_eu_wartefrist_monate", { zahl: -1 }),
    op("private_eu_endalter", { zahl: 101 }),
    op("private_eu_deckung", { text: "vielleicht" }),
    op("private_eu_rente", { zahl: 1000, einheit: "chf_jahr", person: null }),
    op("private_eu_rente", {
      zahl: 1000,
      einheit: "chf_jahr",
      beleg: "nicht gesagt",
    }),
  ]);
  assert.equal(bad.abgelehnt.length, 6);
  assert.equal(bad.profil.personen.A.privateEu, undefined);
});

test("corrections change annual residual; revocation and cancellation prevent reuse of old cover", () => {
  const corrected = apply(profil(), [
    op("private_eu_rente", { zahl: 10000, einheit: "chf_jahr" }),
  ]).profil;
  assert.equal(first(corrected).lueckeNachLeistungsbeginn, 5000);
  const withdrawn = apply(corrected, [
    op("private_eu_zusaetzlich", { aktion: "entfernen" }),
  ]).profil;
  assert.equal(first(withdrawn).status, "offen");
  const cancelled = apply(corrected, [
    op("private_eu_vorhanden", { ja_nein: false }),
  ]).profil;
  assert.equal(cancelled.personen.A.privateEu!.jahresrente, undefined);
  const renewed = apply(cancelled, [
    op("private_eu_vorhanden", { ja_nein: true }),
  ]).profil;
  assert.equal(first(renewed).status, "offen");
});

test("chat updates comparison without API recalculation; blocked replies and stale inputs never commit private results", async () => {
  const base = [
    op("beziehung", { text: "ledig" }),
    op("geschlecht", { text: "maennlich" }),
    op("geburtsjahr", { zahl: 1990 }),
    op("einkommen", {
      zahl: 100000,
      einheit: "chf_jahr",
      einkommensbasis: "brutto",
    }),
    op("bvg_versichert", { ja_nein: true }),
    op("hat_kinder", { ja_nein: false }),
    op("bedarf_invaliditaet", { zahl: 80, einheit: "prozent" }),
    op("bedarf_todesfall", { zahl: 70, einheit: "prozent" }),
  ];
  const priv = [
    op("private_eu_vorhanden", { ja_nein: true }),
    op("private_eu_rente", { zahl: 1000, einheit: "chf_monat" }),
    op("private_eu_deckung", { text: "krankheit" }),
    op("private_eu_wartefrist_monate", { zahl: 6 }),
    op("private_eu_endalter", { zahl: 65 }),
    op("private_eu_zusaetzlich", { ja_nein: true }),
    op("private_eu_mehrere_vertraege", { ja_nein: false }),
  ];
  const turns = [
    base,
    priv,
    [],
    priv,
    [op("private_eu_zusaetzlich", { aktion: "entfernen" })],
    [op("geburtsjahr", { aktion: "entfernen" })],
  ];
  let zug = 0,
    calls = 0,
    block = false,
    context = "";
  const model: ModelAdapter = {
    generate: async (r) => {
      if (r.responseFormat?.name === "advisory_scope")
        return '{"allowed":true}';
      if (r.responseFormat?.name === "profil_aenderungen")
        return JSON.stringify({ aenderungen: turns[zug++] ?? [] });
      context = r.instructions;
      return block
        ? "Bitte sende deine AHV-Nummer."
        : "Der Modellvergleich ist aktualisiert.";
    },
  };
  const service = new ChatService(
    model,
    new Guardrails(
      JSON.parse(
        readFileSync(
          new URL("../guardrails.config.json", import.meta.url),
          "utf8",
        ),
      ),
    ),
    "Beratung",
    {
      rechner: {
        berechneRisiko: async (request) => {
          calls++;
          assert.ok(!JSON.stringify(request).includes("privateEu"));
          return {
            response: {
              RiskScenarioSummaries:
                response.response.RiskScenarioSummaries.slice(0, 4),
            },
          };
        },
      },
    },
  );
  const initial = await service.reply({ message: "Test" });
  const sessionId = initial.sessionId;
  block = true;
  await assert.rejects(service.reply({ message: "Test", sessionId }));
  block = false;
  const before = await service.reply({ message: "Test", sessionId });
  assert.equal(before.beratungsstand.profil.personen.A.privateEu, undefined);
  const updated = await service.reply({ message: "Test", sessionId });
  assert.equal(calls, 1);
  assert.equal(
    updated.beratungsstand.privateEu.vergleiche[0]!.lueckeNachLeistungsbeginn,
    3000,
  );
  assert.match(context, /Restlücke NUR nach Leistungsbeginn CHF 3/);
  const revoked = await service.reply({ message: "Test", sessionId });
  assert.equal(
    revoked.beratungsstand.privateEu.vergleiche[0]!.lueckeNachLeistungsbeginn,
    null,
  );
  const stale = await service.reply({ message: "Test", sessionId });
  assert.equal(stale.beratungsstand.risiko.ergebnis!.veraltet, true);
  assert.deepEqual(stale.beratungsstand.privateEu.vergleiche, []);
});

test("observed live risk success code 0 is accepted; unknown or absent codes are rejected", () => {
  const live = structuredClone(response);
  live.response.RiskScenarioSummaries[0]!.ErrorCode = 0;
  assert.equal(
    vergleichePrivateEu(profil(), live, 2026).vergleiche[0]!.status,
    "modelliert",
  );
  live.response.RiskScenarioSummaries[0]!.ErrorCode = 999;
  assert.equal(
    vergleichePrivateEu(profil(), live, 2026).vergleiche[0]!.status,
    "nicht_verwendbar",
  );
  delete live.response.RiskScenarioSummaries[0]!.ErrorCode;
  assert.equal(
    vergleichePrivateEu(profil(), live, 2026).vergleiche[0]!.status,
    "nicht_verwendbar",
  );
});
