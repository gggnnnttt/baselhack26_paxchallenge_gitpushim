import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createApiCalcClient, type Rechner } from '../src/berechnung/apicalc.js';
import { berechneEigenheim, pruefeEigenheim } from '../src/berechnung/eigenheim.js';
import { pruefeFamilienSzenario } from '../src/berechnung/familie.js';
import { pruefePensionierung, type RetirementRequest, type RetirementResponse } from '../src/berechnung/pensionierung.js';
import { pruefeRisiko, type RiskRequest, type RiskResponse } from '../src/berechnung/risiko.js';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import type { BeratungsstandAnsicht } from '../src/beratung/darstellung.js';
import { bewerteStand, waehleFokus } from '../src/beratung/stand.js';
import { ChatService, type ChatAntwort, type ModelAdapter, type ModelRequest } from '../src/chat.js';
import { GuardrailError, Guardrails } from '../src/guardrails.js';
import { wendeAenderungenAn, type Aenderung, type Wunsch } from '../src/profil/aenderungen.js';
import { EXTRAKTION_FORMAT } from '../src/profil/extraktion.js';
import { leeresProfil, type Profil } from '../src/profil/profil.js';

// Synthetic data only, loosely based on the Müller persona. No real customer data, no external calls.
const config = JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'));
const JAHR = 2026;
const HEUTE = new Date('2026-10-31T12:00:00');

const op = (feld: Aenderung['feld'], werte: Partial<Aenderung> & { beleg: string }): Aenderung => ({
  aktion: 'setzen', feld, person: null, ziel: null, text: null, zahl: null, monat: null, ja_nein: null, einheit: null,
  einkommensbasis: null, monatsloehne: null, planart: null, anliegenthema: null, quelle: 'aussage', begruendung: null, ...werte,
});
const anwenden = (profil: Profil, text: string, aenderungen: Aenderung[], index = 0) => wendeAenderungenAn(profil, aenderungen, { text, index, jahr: JAHR });

const ANTWORT: RiskResponse = { response: { RiskScenarioSummaries: [
  { Scenario: 1, ErrorCode: 1, GrossIncome: 0, IncomeNeed: 0, IncomeGap: 0, IncomeTotal: 0, IncomePillar1: 0, IncomePillar2: 0, CapitalGap: 0 },
  { Scenario: 7, ErrorCode: 1, GrossIncome: 100000, IncomeNeed: 70000, IncomeGap: 12000, IncomeTotal: 58000, IncomePillar1: 30000, IncomePillar2: 28000, CapitalGap: 250000 },
] } };

// The Müller conversation step by step: each turn has the user message and the proposals a model would return.
const MUELLER: { nachricht: string; aenderungen: Aenderung[] }[] = [
  {
    nachricht: 'Wir sind verheiratet und haben ein fünf Monate altes Baby. Wir möchten unsere Familie absichern, falls einem von uns etwas passiert.',
    aenderungen: [
      op('anliegen', { text: 'Familie absichern, falls einem Elternteil etwas passiert', anliegenthema: 'absicherung', beleg: 'Wir möchten unsere Familie absichern' }),
      op('beziehung', { text: 'verheiratet', beleg: 'Wir sind verheiratet' }),
      op('kind', { ziel: 'neu1', text: 'Kind', beleg: 'ein fünf Monate altes Baby' }),
      op('kind_geburtsjahr', { ziel: 'neu1', zahl: 2026, beleg: 'fünf Monate altes Baby', quelle: 'ableitung', begruendung: '5 Monate alt im Oktober 2026 → geboren 2026' }),
      op('kind_elternteil', { ziel: 'neu1', text: 'beide', beleg: 'Wir sind verheiratet und haben ein fünf Monate altes Baby', quelle: 'ableitung', begruendung: 'Das Ehepaar spricht von „unserem“ Baby → gemeinsames Kind' }),
      // Invented by the model: the quote is not in the message, so it must be rejected.
      op('beziehung_seit_jahr', { zahl: 2020, beleg: 'seit 2020 verheiratet' }),
    ],
  },
  {
    nachricht: 'Ich bin 1986 geboren und arbeite momentan nicht, ich kümmere mich um die Kleine. Mein Mann ist Jahrgang 1984 und arbeitet 100 % als Angestellter.',
    aenderungen: [
      op('geburtsjahr', { person: 'A', zahl: 1986, beleg: 'Ich bin 1986 geboren' }),
      op('erwerb', { person: 'A', text: 'nicht_erwerbstaetig', beleg: 'arbeite momentan nicht' }),
      op('geschlecht', { person: 'B', text: 'maennlich', beleg: 'Mein Mann', quelle: 'ableitung', begruendung: '„Mein Mann“ → Person B männlich' }),
      op('geburtsjahr', { person: 'B', zahl: 1984, beleg: 'Jahrgang 1984' }),
      op('erwerb', { person: 'B', text: 'angestellt', beleg: 'als Angestellter' }),
      op('pensum', { person: 'B', zahl: 100, beleg: 'arbeitet 100 %' }),
      // A derivation without reason must be rejected.
      op('kind', { ziel: 'k1', text: 'Tochter', beleg: 'die Kleine', quelle: 'ableitung' }),
    ],
  },
  {
    nachricht: 'Er verdient 100’000 Franken brutto im Jahr und ist bei der Pensionskasse seines Arbeitgebers. Ich bin weiblich. Wir haben 2023 geheiratet.',
    aenderungen: [
      op('einkommen', { person: 'B', zahl: 100000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: "100'000 Franken brutto im Jahr" }),
      op('bvg_versichert', { person: 'B', ja_nein: true, beleg: 'bei der Pensionskasse seines Arbeitgebers' }),
      op('geschlecht', { person: 'A', text: 'weiblich', beleg: 'Ich bin weiblich' }),
      op('beziehung_seit_jahr', { zahl: 2023, beleg: '2023 geheiratet' }),
    ],
  },
  {
    nachricht: 'In etwa fünf Monaten möchte ich wieder einsteigen, wahrscheinlich 40 % mit rund 30’000 brutto im Jahr. Das ist aber noch unsicher.',
    aenderungen: [
      op('plan', { ziel: 'neu1', text: 'Wiedereinstieg in den Beruf', planart: 'wiedereinstieg', person: 'A', beleg: 'möchte ich wieder einsteigen' }),
      op('plan_zeitpunkt', { ziel: 'neu1', zahl: 2027, monat: 3, text: 'in etwa fünf Monaten', beleg: 'In etwa fünf Monaten', quelle: 'ableitung', begruendung: 'Oktober 2026 + 5 Monate → März 2027' }),
      op('plan_pensum', { ziel: 'neu1', zahl: 40, beleg: 'wahrscheinlich 40 %' }),
      op('plan_einkommen', { ziel: 'neu1', zahl: 30000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: "30'000 brutto im Jahr" }),
      op('plan_sicherheit', { ziel: 'neu1', text: 'unsicher', beleg: 'noch unsicher' }),
    ],
  },
  {
    nachricht: 'Wenn mein Mann ausfällt, bräuchten wir etwa 80 % seines Einkommens, und wenn er stirbt, etwa 70 %.',
    aenderungen: [
      op('bedarf_invaliditaet', { person: 'B', zahl: 80, einheit: 'prozent', beleg: 'bräuchten wir etwa 80 % seines Einkommens' }),
      op('bedarf_todesfall', { person: 'B', zahl: 70, einheit: 'prozent', beleg: 'wenn er stirbt, etwa 70 %' }),
    ],
  },
];

const ERWARTETER_REQUEST: RiskRequest = {
  Relationship: 2,
  RelationshipSinceYear: 2023,
  Person1: { Sex: 2, BirthYear: 1986, GrossIncome: 0, WithBVG: false },
  Person2: { Sex: 1, BirthYear: 1984, GrossIncome: 100000, WithBVG: true, NeedInPcDisability: true, NeedDisability: 80, NeedInPcDeath: true, NeedDeath: 70 },
  NumberOfChildren: 1,
  WithChildren: true,
};

const KEIN: Wunsch = { art: 'angaben', thema: null };
const risiko = (a: BeratungsstandAnsicht) => a.stand.rechnungen.find(r => r.id === 'risiko')!;

function skriptModell(skript: Aenderung[][], antworten: (request: ModelRequest) => string = () => 'Danke, ich habe das notiert.', wuensche: Wunsch[] = []) {
  const anweisungen: string[] = [];
  let zug = 0;
  const provider: ModelAdapter = { generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (request.responseFormat?.name === 'profil_aenderungen') { const i = zug++; return JSON.stringify({ aenderungen: skript[i] ?? [], wunsch: wuensche[i] ?? KEIN, plan: null }); }
    anweisungen.push(request.instructions);
    return antworten(request);
  } };
  return { provider, anweisungen };
}

const PENSION: RetirementResponse = { response: { ErrorCode: 1, GrossIncome: 100000, IncomeNeed: 80000, IncomeGap: 4996, IncomeTotal: 75004, IncomePillar1: 48581, IncomePillar2: 26423, IncomeWithdrawal: 0, AvailableFortune: 0, CapitalNeed: 157592, CapitalGap: 157592 } };

function zaehlenderRechner(antwort: RiskResponse = ANTWORT) {
  const requests: RiskRequest[] = [];
  const pensionen: RetirementRequest[] = [];
  const rechner: Rechner = {
    berechneRisiko: async request => { requests.push(request); return antwort; },
    berechnePensionierung: async request => { pensionen.push(request); return PENSION; },
  };
  return { rechner, requests, pensionen };
}

test('Müller conversation builds a correct calculateRisk request step by step', async () => {
  const { provider, anweisungen } = skriptModell(MUELLER.map(zug => zug.aenderungen));
  const { rechner, requests } = zaehlenderRechner();
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { rechner, heute: () => HEUTE });
  const staende: ChatAntwort[] = [];
  let sessionId: string | undefined;
  for (const zug of MUELLER) {
    const antwort = await service.reply({ message: zug.nachricht, ...(sessionId ? { sessionId } : {}) });
    sessionId = antwort.sessionId;
    staende.push(antwort);
  }
  const [erst, zweit, dritt, viert, fuenft] = staende.map(s => s.beratungsstand);

  // Turn 1: invented quote rejected, the child is a common child.
  assert.equal(erst!.phase, 'nachfragen');
  assert.deepEqual(erst!.letzteNachricht.abgelehnt.map(e => e.grund), ['Der Beleg „seit 2020 verheiratet“ steht nicht in der Nachricht.']);
  assert.equal(erst!.profil.haushalt.beziehungSeitJahr, undefined);
  assert.equal(erst!.profil.kinder[0]!.elternteil!.wert, 'beide');
  assert.ok(risiko(erst!).pruefung.fehlend.some(a => a.label === 'Jahr der Heirat'));
  assert.equal(erst!.schritt!.fokus!.label, 'Jahr der Heirat');
  assert.equal(erst!.stand.anliegen[0]!.status, 'in_klaerung');

  // Turn 2: derivation without reason rejected; Person A's sex is not guessed.
  assert.deepEqual(zweit!.letzteNachricht.abgelehnt.map(e => e.grund), ['Ableitung ohne Begründung.']);
  assert.equal(zweit!.profil.kinder[0]!.bezeichnung, 'Kind');
  assert.ok(risiko(zweit!).pruefung.fehlend.some(a => a.label === 'Geschlecht Person A (du)'));
  assert.equal(zweit!.profil.personen.B!.geschlecht!.quelle, 'ableitung');

  // Turn 3: typographic apostrophe in the message still matches the quote.
  assert.equal(dritt!.letzteNachricht.abgelehnt.length, 0);
  assert.equal(dritt!.profil.personen.B!.einkommen!.wert.betrag, 100000);
  assert.deepEqual(risiko(dritt!).pruefung.fehlend.map(a => a.label), [
    'Gewünschtes Einkommen bei Erwerbsunfähigkeit von Person B (Partner/in) (in % des heutigen Einkommens oder CHF pro Jahr)',
    'Gewünschtes Einkommen im Todesfall von Person B (Partner/in) (in % des heutigen Einkommens oder CHF pro Jahr)',
  ]);

  // Turn 4: the planned return to work stays a plan and does not change today's situation.
  const plan = viert!.profil.plaene[0]!;
  assert.deepEqual([plan.art, plan.person, plan.zeitpunkt!.wert.jahr, plan.zeitpunkt!.wert.monat, plan.pensumProzent!.wert, plan.sicherheit!.wert], ['wiedereinstieg', 'A', 2027, 3, 40, 'unsicher']);
  assert.equal(viert!.profil.personen.A.erwerb!.wert, 'nicht_erwerbstaetig');
  assert.equal(viert!.profil.personen.A.einkommen, undefined);
  assert.equal(risiko(viert!).status, 'unvollstaendig');
  // The return-to-work scenario needs what the household would need if Person A could no longer work afterwards.
  const szenario = viert!.stand.rechnungen.find(r => r.art === 'familie')!;
  assert.equal(szenario.status, 'unvollstaendig');
  assert.ok(szenario.pruefung.annahmen.some(a => a.includes('BVG-Eintrittsschwelle')));

  // Turn 5: complete → exactly one calculation with the expected request.
  assert.equal(fuenft!.phase, 'szenario_zeigen');
  assert.deepEqual(fuenft!.schritt!.rechnungen, ['risiko']);
  assert.equal(risiko(fuenft!).status, 'berechnet');
  assert.deepEqual(risiko(fuenft!).pruefung.request, ERWARTETER_REQUEST);
  assert.deepEqual(requests, [ERWARTETER_REQUEST]);
  const ergebnis = risiko(fuenft!).ergebnis!;
  assert.ok(ergebnis.art === 'risiko' && ergebnis.szenarien[1]!.luecke === 12000);
  assert.ok(risiko(fuenft!).pruefung.hinweise.some(h => h.includes('3. Säule')));
  assert.ok(risiko(fuenft!).pruefung.hinweise.some(h => h.includes('Pläne fliessen nicht ein')));
  assert.equal(fuenft!.stand.anliegen[0]!.status, 'ergebnis');
  // Not yet allowed: existing pillar 3a and private cover are unknown.
  assert.equal(fuenft!.stand.empfehlung.erlaubt, false);
  assert.ok(fuenft!.schritt!.nichtErlaubt.some(n => n.aktion === 'empfehlung_vorbereiten'));

  // Every accepted value points back to the user message it came from.
  assert.equal(fuenft!.profil.personen.B!.bedarfTodesfall!.nachricht, 8);
  assert.equal(fuenft!.profil.haushalt.beziehung!.nachricht, 0);

  // The reply model sees one focus instead of the full missing list, and results only once they exist.
  assert.match(anweisungen[0]!, /Fokus für die eine Rückfrage: Jahr der Heirat/);
  assert.doesNotMatch(anweisungen[0]!, /Geschlecht Person A/);
  assert.doesNotMatch(anweisungen[0]!, /Ergebnisse für diesen Schritt/);
  assert.match(anweisungen[4]!, /Ergebnisse für diesen Schritt[^]*Todesfall durch Krankheit – Person B: Bedarf CHF 70.000/);
});

test('corrections recalculate, incomplete changes mark the result as outdated', async () => {
  const korrektur = [op('einkommen', { person: 'B', zahl: 110000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: "110'000 brutto" })];
  const widerruf = [op('beziehung_seit_jahr', { aktion: 'entfernen', beleg: 'Heiratsjahr stimmt nicht' })];
  const { provider } = skriptModell([...MUELLER.map(zug => zug.aenderungen), korrektur, widerruf]);
  const { rechner, requests } = zaehlenderRechner();
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { rechner, heute: () => HEUTE });
  let sessionId: string | undefined;
  for (const zug of MUELLER) sessionId = (await service.reply({ message: zug.nachricht, ...(sessionId ? { sessionId } : {}) })).sessionId;
  const nachKorrektur = (await service.reply({ message: "Korrektur: Er verdient 110'000 brutto pro Jahr.", sessionId })).beratungsstand;
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.Person2!.GrossIncome, 110000);
  assert.equal(risiko(nachKorrektur).status, 'berechnet');
  const nachWiderruf = (await service.reply({ message: 'Das Heiratsjahr stimmt nicht, das muss ich nachschauen.', sessionId })).beratungsstand;
  assert.equal(risiko(nachWiderruf).status, 'veraltet');
  assert.equal(risiko(nachWiderruf).ergebnis, null);
  assert.equal(requests.length, 2);
});

test('nothing is committed when the reply is blocked, the extraction is invalid or the chat is deleted', async () => {
  // Blocked reply: profile change of that turn is discarded.
  let blockieren = false;
  const { provider } = skriptModell([[], [op('beziehung', { text: 'verheiratet', beleg: 'verheiratet' })], []],
    () => (blockieren ? 'Bitte sende deine AHV-Nummer.' : 'Danke.'));
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { heute: () => HEUTE });
  const erst = await service.reply({ message: 'Hallo, wir möchten vorsorgen.' });
  blockieren = true;
  await assert.rejects(service.reply({ message: 'Wir sind verheiratet.', sessionId: erst.sessionId }), GuardrailError);
  blockieren = false;
  const danach = await service.reply({ message: 'Was sollten wir wissen?', sessionId: erst.sessionId });
  assert.equal(danach.beratungsstand.profil.haushalt.beziehung, undefined);

  // Invalid extraction output fails closed before the reply call.
  let antwortAufrufe = 0;
  const kaputt = new ChatService({ generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (request.responseFormat) return '{"aenderungen":[{"feld":"name","text":"Erika"}],"wunsch":{"art":"angaben","thema":null}}';
    antwortAufrufe++;
    return 'Antwort';
  } }, new Guardrails(config), 'Berater');
  await assert.rejects(kaputt.reply({ message: 'Wir sind verheiratet.' }), (error: unknown) => error instanceof GuardrailError && error.status === 503);
  assert.equal(antwortAufrufe, 0);
  assert.equal(kaputt.sessionCount, 0);

  // Deleted while APICalc is running: no reply, no stored state.
  let freigeben!: () => void;
  const langsam: Rechner = { berechneRisiko: () => new Promise(resolve => { freigeben = () => resolve(ANTWORT); }), berechnePensionierung: async () => PENSION };
  const skript = skriptModell(MUELLER.map(zug => zug.aenderungen));
  const geloescht = new ChatService(skript.provider, new Guardrails(config), 'Berater', { rechner: langsam, heute: () => HEUTE });
  let sessionId: string | undefined;
  for (const zug of MUELLER.slice(0, -1)) sessionId = (await geloescht.reply({ message: zug.nachricht, ...(sessionId ? { sessionId } : {}) })).sessionId;
  const letzter = geloescht.reply({ message: MUELLER.at(-1)!.nachricht, sessionId });
  while (!freigeben) await new Promise(resolve => setImmediate(resolve));
  geloescht.deleteSession({ sessionId });
  freigeben();
  await assert.rejects(letzter, (error: unknown) => error instanceof GuardrailError && error.status === 410);
  assert.equal(geloescht.sessionCount, 0);
});

test('profile proposals are checked against the message and field rules', () => {
  const text = 'Mein Partner und ich leben zusammen. Ich bin 40 und verdiene 8000 netto im Monat.';
  const { profil, uebernommen, abgelehnt } = anwenden(leeresProfil(), text, [
    op('beziehung', { text: 'konkubinat', beleg: 'Mein Partner und ich leben zusammen' }),
    op('geburtsjahr', { person: 'A', zahl: 1986, beleg: 'Ich bin 40', quelle: 'ableitung', begruendung: 'Alter 40 im Jahr 2026 → 1986 (±1)' }),
    op('einkommen', { person: 'A', zahl: 8000, einheit: 'chf_monat', einkommensbasis: 'netto', beleg: '8000 netto im Monat' }),
    op('geburtsjahr', { person: 'B', zahl: 2090, beleg: 'Mein Partner' }),
    op('beziehung', { text: 'befreundet', beleg: 'leben zusammen' }),
    op('kind_geburtsjahr', { ziel: 'k7', zahl: 2020, beleg: 'Ich bin 40' }),
    op('einkommen', { person: 'A', zahl: 8000, einheit: 'prozent', beleg: '8000' }),
  ]);
  assert.equal(uebernommen.length, 3);
  assert.deepEqual(abgelehnt.map(e => e.grund), [
    'Geburtsjahr muss eine ganze Zahl zwischen 1900 und 2026 sein.',
    'Beziehung: erlaubt sind ledig, verheiratet, eingetragene_partnerschaft, konkubinat, geschieden, verwitwet.',
    'Kind k7 ist nicht bekannt.',
    'Einkommen braucht die Einheit chf_jahr oder chf_monat.',
  ]);
  assert.equal(profil.personen.B, undefined);
  const pruefung = pruefeRisiko(profil, JAHR);
  assert.ok(pruefung.fehlend.some(a => a.label === 'Seit welchem Jahr ihr zusammenlebt'));
  assert.ok(pruefung.fehlend.some(a => a.label === 'Bruttoeinkommen (genannt wurde ein Nettobetrag) (Person A (du))'));
});

test('quotes match regardless of how thousands are written', () => {
  const { uebernommen } = anwenden(leeresProfil(), 'Ich verdiene etwa 57’000 brutto.', [
    op('einkommen', { person: 'A', zahl: 57000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: '57000 brutto' }),
  ]);
  assert.equal(uebernommen.length, 1);
  const satz = anwenden(leeresProfil(), 'Ich bin 1991 geboren, er 1989.', [op('geburtsjahr', { person: 'A', zahl: 1991, beleg: 'Ich bin 1991 geboren.' })]);
  assert.equal(satz.uebernommen.length, 1);
});

test('corrections overwrite, removals delete, and children are not duplicated', () => {
  let profil = anwenden(leeresProfil(), 'Wir haben zwei Töchter.', [
    op('kind', { ziel: 'neu1', text: 'Tochter', beleg: 'zwei Töchter' }),
    op('kind', { ziel: 'neu2', text: 'Tochter', beleg: 'zwei Töchter' }),
  ]).profil;
  profil = anwenden(profil, 'Die ältere ist 2019 geboren. Eigentlich haben wir nur eine Tochter, sorry.', [
    op('kind_geburtsjahr', { ziel: 'k1', zahl: 2019, beleg: '2019 geboren' }),
    op('kind', { aktion: 'entfernen', ziel: 'k2', beleg: 'nur eine Tochter' }),
  ], 2).profil;
  assert.deepEqual(profil.kinder.map(k => [k.id, k.geburtsjahr?.wert]), [['k1', 2019]]);
  profil = anwenden(profil, 'Wir haben noch einen Sohn bekommen.', [op('kind', { ziel: 'neu1', text: 'Sohn', beleg: 'einen Sohn' })], 4).profil;
  assert.deepEqual(profil.kinder.map(k => k.id), ['k1', 'k3']);
});

test('income, single parents and custody map to the documented API fields', () => {
  const profil = anwenden(leeresProfil(), 'Ich bin ledig, Mann, Jahrgang 1990, angestellt mit 7000 brutto pro Monat und 13 Monatslöhnen, mit Pensionskasse. Ich habe einen Sohn und das alleinige Sorgerecht. Bedarf 80 % bei Invalidität und 60 % im Todesfall.', [
    op('beziehung', { text: 'ledig', beleg: 'ledig' }),
    op('geschlecht', { person: 'A', text: 'maennlich', beleg: 'Mann' }),
    op('geburtsjahr', { person: 'A', zahl: 1990, beleg: 'Jahrgang 1990' }),
    op('erwerb', { person: 'A', text: 'angestellt', beleg: 'angestellt' }),
    op('einkommen', { person: 'A', zahl: 7000, einheit: 'chf_monat', einkommensbasis: 'brutto', monatsloehne: 13, beleg: '7000 brutto pro Monat und 13 Monatslöhnen' }),
    op('bvg_versichert', { person: 'A', ja_nein: true, beleg: 'mit Pensionskasse' }),
    op('kind', { ziel: 'neu1', text: 'Sohn', beleg: 'einen Sohn' }),
    op('kind_alleiniges_sorgerecht', { ziel: 'neu1', ja_nein: true, beleg: 'das alleinige Sorgerecht' }),
    op('bedarf_invaliditaet', { person: 'A', zahl: 80, einheit: 'prozent', beleg: '80 % bei Invalidität' }),
    op('bedarf_todesfall', { person: 'A', zahl: 60, einheit: 'prozent', beleg: '60 % im Todesfall' }),
  ]).profil;
  const pruefung = pruefeRisiko(profil, JAHR);
  assert.deepEqual(pruefung.fehlend, []);
  assert.deepEqual(pruefung.request, {
    Relationship: 1,
    RelationshipSinceYear: JAHR,
    Person1: { Sex: 1, BirthYear: 1990, GrossIncome: 91000, NumberOfChildren: 1, WithBVG: true, NeedInPcDisability: true, NeedDisability: 80, NeedInPcDeath: true, NeedDeath: 60 },
    NumberOfChildren: 0,
    WithChildren: true,
  });
  assert.ok(pruefung.hinweise.some(h => h.includes('Alleinstehende')));
});

test('flow waits without APICalc access, reports failures and does not recalculate unchanged inputs', async () => {
  const komplett = MUELLER.reduce((profil, zug, index) => anwenden(profil, zug.nachricht, zug.aenderungen, index * 2).profil, leeresProfil());
  const risikoStand = (s: Awaited<ReturnType<Beratungsablauf['aktualisiere']>>) => s.kontext.stand.rechnungen.find(r => r.id === 'risiko')!;
  const ohne = new Beratungsablauf(null);
  assert.equal(risikoStand(await ohne.aktualisiere(ohne.start(JAHR), komplett)).status, 'bereit');

  const kaputt = async () => { throw new Error('APICalc antwortete mit HTTP 401.'); };
  const fehler = new Beratungsablauf({ berechneRisiko: kaputt, berechnePensionierung: kaputt });
  const fehlgeschlagen = await fehler.aktualisiere(fehler.start(JAHR), komplett);
  assert.equal(risikoStand(fehlgeschlagen).status, 'fehlgeschlagen');
  assert.equal(risikoStand(fehlgeschlagen).fehler, 'APICalc antwortete mit HTTP 401.');

  const { rechner, requests } = zaehlenderRechner();
  const ablauf = new Beratungsablauf(rechner);
  const einmal = await ablauf.aktualisiere(ablauf.start(JAHR), komplett);
  const zweimal = await ablauf.aktualisiere(einmal, structuredClone(komplett));
  assert.equal(risikoStand(zweimal).status, 'berechnet');
  assert.equal(requests.length, 1);
});

test('APICalc client sends the documented request and never echoes response bodies', async () => {
  const aufrufe: { url: string; init: RequestInit }[] = [];
  const client = createApiCalcClient({
    baseUrl: 'https://apicalc.example/viper/', token: 'synthetic-token', tenant: 'pax',
    fetch: async (url, init) => { aufrufe.push({ url: String(url), init: init! }); return Response.json(ANTWORT); },
  });
  assert.deepEqual(await client.berechneRisiko(ERWARTETER_REQUEST), ANTWORT);
  assert.equal(aufrufe[0]!.url, 'https://apicalc.example/viper/operation/standard/APICalc_calculateRisk?tenant=pax');
  assert.equal((aufrufe[0]!.init.headers as Record<string, string>)['Authorization'], 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(String(aufrufe[0]!.init.body)), ERWARTETER_REQUEST);

  const abgelehnt = createApiCalcClient({ baseUrl: 'https://apicalc.example', token: 't', fetch: async () => new Response('SECRET_BODY', { status: 401 }) });
  await assert.rejects(abgelehnt.berechneRisiko(ERWARTETER_REQUEST), (error: Error) => error.message === 'APICalc antwortete mit HTTP 401.');
  const falsch = createApiCalcClient({ baseUrl: 'https://apicalc.example', token: 't', fetch: async () => Response.json({ unerwartet: true }) });
  await assert.rejects(falsch.berechneRisiko(ERWARTETER_REQUEST), /unerwartete Antwortstruktur/);
});

test('extraction schema is usable as a strict structured output', () => {
  const pruefen = (schema: any, pfad: string): void => {
    assert.ok(!('$schema' in schema) && !('maxLength' in schema) && !('minLength' in schema), pfad);
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, pfad);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), pfad);
      for (const [key, value] of Object.entries(schema.properties)) pruefen(value, `${pfad}.${key}`);
    }
    if (schema.items) pruefen(schema.items, `${pfad}[]`);
  };
  pruefen(EXTRAKTION_FORMAT.schema, 'root');
  // No field for names, addresses or health data exists.
  const felder: string[] = (EXTRAKTION_FORMAT.schema as any).properties.aenderungen.items.properties.feld.enum;
  assert.ok(!felder.some(feld => /name|adresse|gesundheit|diagnose|raucher/i.test(feld)));
});

const MUELLER_PROFIL = () => MUELLER.reduce((profil, zug, index) => anwenden(profil, zug.nachricht, zug.aenderungen, index * 2).profil, leeresProfil());

test('retirement request uses known savings and the desired age from a plan', () => {
  const text = 'Im Alter möchten wir 80 % unseres Einkommens. Wir haben 50000 gespart und legen 500 im Monat zur Seite. Mein Mann möchte mit 60 aufhören.';
  const profil = anwenden(MUELLER_PROFIL(), text, [
    op('bedarf_alter', { zahl: 80, einheit: 'prozent', beleg: '80 % unseres Einkommens' }),
    op('vermoegen', { zahl: 50000, beleg: '50000 gespart' }),
    op('sparbetrag', { zahl: 500, einheit: 'chf_monat', beleg: '500 im Monat' }),
    op('plan', { ziel: 'neu1', text: 'Frühpensionierung', planart: 'fruehpensionierung', person: 'B', beleg: 'möchte mit 60 aufhören' }),
    op('plan_alter', { ziel: 'neu1', zahl: 60, beleg: 'mit 60 aufhören' }),
  ], 10).profil;
  const basis = {
    Relationship: 2, RelationshipSinceYear: 2023,
    Person1: { Sex: 2, BirthYear: 1986, GrossIncome: 0, WithBVG: false },
    Person2: { Sex: 1, BirthYear: 1984, GrossIncome: 100000, WithBVG: true },
    CurrentFortune: 50000, Saving: 6000, NeedInPcRetirement: true, NeedRetirement: 80,
  };
  const regulaer = pruefePensionierung(profil, JAHR);
  assert.deepEqual(regulaer.request, basis);
  // Pillar 3a is unknown: named as not considered, not assumed to be zero silently.
  assert.ok(regulaer.optional.some(a => a.label.includes('Säule 3a')));
  const frueh = pruefePensionierung(profil, JAHR, profil.plaene[1]!);
  assert.deepEqual(frueh.request, { ...basis, Person2: { ...basis.Person2, DesiredRetirementAge: 60 } });
});

test('home ownership scenario is calculated locally with named rules of thumb', () => {
  const text = 'Ich bin ledig, verdiene 120000 brutto im Jahr, habe 60000 gespart und spare 1500 pro Monat. 2030 möchte ich eine Wohnung für 800000 kaufen.';
  const profil = anwenden(leeresProfil(), text, [
    op('beziehung', { text: 'ledig', beleg: 'ledig' }),
    op('erwerb', { person: 'A', text: 'angestellt', beleg: 'verdiene 120000', quelle: 'ableitung', begruendung: 'Lohn → angestellt' }),
    op('einkommen', { person: 'A', zahl: 120000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: '120000 brutto im Jahr' }),
    op('vermoegen', { zahl: 60000, beleg: '60000 gespart' }),
    op('sparbetrag', { zahl: 1500, einheit: 'chf_monat', beleg: '1500 pro Monat' }),
    op('plan', { ziel: 'neu1', text: 'Wohnung kaufen', planart: 'wohneigentum', beleg: 'eine Wohnung für 800000 kaufen' }),
    op('plan_zeitpunkt', { ziel: 'neu1', zahl: 2030, beleg: '2030' }),
    op('plan_kaufpreis', { ziel: 'neu1', zahl: 800000, beleg: 'für 800000' }),
  ]).profil;
  const pruefung = pruefeEigenheim(profil, profil.plaene[0]!, JAHR);
  assert.equal(pruefung.bereit, true);
  assert.ok(pruefung.annahmen.some(a => a.includes('kalkulatorischer Zins 5 %')));
  assert.deepEqual(berechneEigenheim(pruefung.request!), {
    kaufpreis: 800000, kaufjahr: 2030,
    eigenmittelBeiKauf: 132000, eigenmittelNoetig: 160000, eigenmittelLuecke: 28000, sparbetragFuerZielJahr: 25000,
    hypothek: 668000, kostenJahr: 50378, tragbarkeitProzent: 42, tragbar: false, maxKaufpreisNachEinkommen: 679000, saeule3aMoeglich: 0,
  });
});

test('family scenario recalculates on a copy with the plan applied and names its assumptions', () => {
  const text = 'Wenn ich nach dem Wiedereinstieg ausfalle, bräuchten wir 20000 im Jahr, und wenn ich sterbe 30000 im Jahr.';
  const profil = anwenden(MUELLER_PROFIL(), text, [
    op('bedarf_invaliditaet', { person: 'A', zahl: 20000, einheit: 'chf_jahr', beleg: 'bräuchten wir 20000 im Jahr' }),
    op('bedarf_todesfall', { person: 'A', zahl: 30000, einheit: 'chf_jahr', beleg: 'wenn ich sterbe 30000 im Jahr' }),
  ], 10).profil;
  const szenario = pruefeFamilienSzenario(profil, profil.plaene[0]!, JAHR);
  assert.equal(szenario.bereit, true);
  assert.deepEqual((szenario.request as RiskRequest).Person1, {
    Sex: 2, BirthYear: 1986, GrossIncome: 30000, WithBVG: true, NeedInPcDisability: false, NeedDisability: 20000, NeedInPcDeath: false, NeedDeath: 30000,
  });
  assert.ok(szenario.annahmen.some(a => a.includes('Pensionskasse angenommen')));
  // Today's profile is untouched.
  assert.equal(profil.personen.A.erwerb!.wert, 'nicht_erwerbstaetig');
  assert.deepEqual(pruefeRisiko(profil, JAHR).request!.Person1, { Sex: 2, BirthYear: 1986, GrossIncome: 0, WithBVG: false, NeedInPcDisability: false, NeedDisability: 20000, NeedInPcDeath: false, NeedDeath: 30000 });
});

test('a recommendation is only prepared once needs, existing provision and results are known', async () => {
  const vorsorge = 'Wir haben beide keine Säule 3a. Mein Mann hat eine Todesfallversicherung über 100000, aber keine Erwerbsunfähigkeitsrente. Wir können etwa 800 im Monat sparen. Was empfiehlst du uns?';
  const skript = [...MUELLER.map(zug => zug.aenderungen), [], [
    op('saeule3a', { person: 'A', ja_nein: false, beleg: 'beide keine Säule 3a' }),
    op('saeule3a', { person: 'B', ja_nein: false, beleg: 'beide keine Säule 3a' }),
    op('todesfallkapital', { person: 'B', zahl: 100000, beleg: 'Todesfallversicherung über 100000' }),
    op('erwerbsunfaehigkeitsrente', { person: 'B', zahl: 0, beleg: 'keine Erwerbsunfähigkeitsrente' }),
    op('sparbetrag', { zahl: 800, einheit: 'chf_monat', beleg: '800 im Monat' }),
  ]];
  const empfehlung: Wunsch = { art: 'empfehlung', thema: null };
  const wuensche = [...MUELLER.map(() => KEIN), empfehlung, empfehlung];
  const { provider, anweisungen } = skriptModell(skript, undefined, wuensche);
  const { rechner } = zaehlenderRechner();
  const service = new ChatService(provider, new Guardrails(config), 'Berater', { rechner, heute: () => HEUTE });
  let sessionId: string | undefined;
  for (const zug of MUELLER) sessionId = (await service.reply({ message: zug.nachricht, ...(sessionId ? { sessionId } : {}) })).sessionId;

  const zuFrueh = (await service.reply({ message: 'Was sollen wir abschliessen?', sessionId })).beratungsstand;
  assert.equal(zuFrueh.phase, 'nachfragen');
  assert.match(zuFrueh.schritt!.begruendung, /Empfehlung fehlt noch Grundlage/);
  assert.equal(zuFrueh.schritt!.fokus!.thema, 'saeule3');
  assert.match(anweisungen.at(-1)!, /Nicht erlaubt: empfehlung_vorbereiten/);

  const bereit = (await service.reply({ message: vorsorge, sessionId })).beratungsstand;
  assert.equal(bereit.phase, 'empfehlung_vorbereiten');
  assert.equal(bereit.stand.empfehlung.erlaubt, true);
  // Death of Person B: capitalised gap 250'000 minus existing private death cover 100'000.
  assert.deepEqual(bereit.stand.empfehlung.luecken.map(l => [l.betrag, l.einheit]), [[150000, 'kapital']]);
  assert.match(anweisungen.at(-1)!, /Empfehlungsgrundlage[^]*private Todesfallversicherung CHF 100.000/);
});

test('the next focus follows the most recent concern instead of a fixed order', () => {
  const text = 'Wir wollen die Familie absichern. Und wir träumen von einem eigenen Haus.';
  const profil = anwenden(leeresProfil(), text, [
    op('anliegen', { text: 'Familie absichern', anliegenthema: 'absicherung', beleg: 'Familie absichern' }),
    op('anliegen', { text: 'Eigenes Haus', anliegenthema: 'eigenheim', beleg: 'einem eigenen Haus' }),
    op('plan', { ziel: 'neu1', text: 'Haus kaufen', planart: 'wohneigentum', beleg: 'einem eigenen Haus' }),
  ]).profil;
  const stand = bewerteStand(profil, JAHR, {});
  assert.equal(waehleFokus(stand, KEIN)!.punkt.label, 'Ungefährer Kaufpreis des Eigenheims');
  assert.equal(waehleFokus(stand, { art: 'szenario', thema: 'absicherung' })!.punkt.thema, 'risiko');
  // Pillars are part of the picture even without a concern about them.
  assert.ok(['saeule1', 'saeule2', 'saeule3'].every(id => stand.themen.some(t => t.id === id)));
});

const VORSCHLAG = {
  fokusAnliegen: null, ungeklaert: ['Ziel der Familie'], aktion: 'nachfragen' as const,
  rechnung: null, frage: 'Was ist euch für eure Familie besonders wichtig?', begruendung: 'Zuerst das Anliegen verstehen.',
};

test('a planner question replaces the fixed focus and the plan survives the turn', async () => {
  const ablauf = new Beratungsablauf(null);
  const stand = await ablauf.aktualisiere(ablauf.start(JAHR), leeresProfil(), KEIN, VORSCHLAG);
  assert.equal(stand.kontext.schritt!.quelle, 'planer');
  assert.equal(stand.kontext.schritt!.frage, VORSCHLAG.frage);
  assert.deepEqual(stand.kontext.plan, VORSCHLAG);
});

test('a planner cannot skip recommendation prerequisites or invent a result', async () => {
  const ablauf = new Beratungsablauf(null);
  for (const aktion of ['empfehlung_vorbereiten', 'szenario_zeigen'] as const) {
    const stand = await ablauf.aktualisiere(ablauf.start(JAHR), leeresProfil(), KEIN,
      { ...VORSCHLAG, aktion, frage: null, rechnung: aktion === 'szenario_zeigen' ? 'risiko' : null });
    assert.equal(stand.phase, 'nachfragen');
    assert.equal(stand.kontext.schritt!.quelle, 'fallback');
    assert.ok(stand.kontext.schritt!.nichtErlaubt.some(n => n.aktion === aktion));
    assert.equal(stand.kontext.plan, null);
  }
});

test('a planner calculation runs only the selected scenario and presents the result', async () => {
  const { rechner, requests, pensionen } = zaehlenderRechner();
  const ablauf = new Beratungsablauf(rechner);
  const stand = await ablauf.aktualisiere(ablauf.start(JAHR), MUELLER_PROFIL(), KEIN,
    { ...VORSCHLAG, aktion: 'szenario_berechnen', rechnung: 'risiko', frage: null });
  assert.equal(requests.length, 1);
  assert.equal(pensionen.length, 0);
  assert.equal(stand.phase, 'szenario_zeigen');
  assert.equal(stand.kontext.schritt!.quelle, 'planer');
  assert.deepEqual(stand.kontext.schritt!.rechnungen, ['risiko']);
});


test('planner memory only advances with accepted replies and rejected scope cannot change it', async () => {
  let vorgeschlagen = VORSCHLAG;
  let ausgabe = 'Was ist euch besonders wichtig?';
  let imThema = true;
  const planerKontexte: string[] = [];
  const service = new ChatService({ generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') return JSON.stringify({ allowed: imThema });
    if (request.responseFormat) {
      planerKontexte.push(request.instructions);
      return JSON.stringify({ aenderungen: [], wunsch: KEIN, plan: vorgeschlagen });
    }
    return ausgabe;
  } }, new Guardrails(config), 'Berater', { heute: () => HEUTE });
  const erst = await service.reply({ message: 'Wir möchten die Familie absichern.' });
  assert.equal(erst.beratungsstand.schritt!.quelle, 'planer');
  vorgeschlagen = { ...VORSCHLAG, frage: 'Wie hoch ist euer Einkommen?', begruendung: 'NEUER_PLAN' };
  ausgabe = 'Bitte sende deine AHV-Nummer.';
  await assert.rejects(service.reply({ message: 'Wir planen ein Haus.', sessionId: erst.sessionId }), GuardrailError);
  ausgabe = 'Welche Absicherung besteht bereits?';
  imThema = false;
  await assert.rejects(service.reply({ message: 'Schreib mir ein Programm.', sessionId: erst.sessionId }), GuardrailError);
  imThema = true;
  await service.reply({ message: 'Welche Absicherung brauchen wir?', sessionId: erst.sessionId });
  assert.match(planerKontexte.at(-1)!, /"vorherigerPlan":\{"fokusAnliegen":null/);
  assert.ok(planerKontexte.at(-1)!.includes(VORSCHLAG.begruendung));
  assert.ok(!planerKontexte.at(-1)!.includes('NEUER_PLAN'));
});

test('a changed income invalidates a result until a new calculation is requested', async () => {
  const { rechner, requests } = zaehlenderRechner();
  const ablauf = new Beratungsablauf(rechner);
  const profil = MUELLER_PROFIL();
  const einmal = await ablauf.aktualisiere(ablauf.start(JAHR), profil, KEIN,
    { ...VORSCHLAG, aktion: 'szenario_berechnen', rechnung: 'risiko', frage: null });
  const korrigiert = anwenden(profil, 'Er verdient jetzt 110000 brutto im Jahr.', [
    op('einkommen', { person: 'B', zahl: 110000, einheit: 'chf_jahr', einkommensbasis: 'brutto', beleg: '110000 brutto im Jahr' }),
  ]).profil;
  const veraltet = await ablauf.aktualisiere(einmal, korrigiert, KEIN,
    { ...VORSCHLAG, aktion: 'szenario_zeigen', rechnung: 'risiko', frage: null });
  assert.equal(veraltet.kontext.schritt!.quelle, 'fallback');
  assert.equal(veraltet.kontext.stand.rechnungen.find(r => r.id === 'risiko')!.ergebnis, null);
  assert.equal(requests.length, 1);
  const aktuell = await ablauf.aktualisiere(veraltet, korrigiert, KEIN,
    { ...VORSCHLAG, aktion: 'szenario_berechnen', rechnung: 'risiko', frage: null });
  assert.equal(aktuell.phase, 'szenario_zeigen');
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.Person2!.GrossIncome, 110000);
});

test('requesting a human does not start otherwise ready calculations', async () => {
  const { rechner, requests, pensionen } = zaehlenderRechner();
  const ablauf = new Beratungsablauf(rechner);
  const stand = await ablauf.aktualisiere(ablauf.start(JAHR), MUELLER_PROFIL(), { art: 'beratungsperson', thema: null });
  assert.equal(stand.phase, 'beratungsperson');
  assert.equal(requests.length + pensionen.length, 0);
});
