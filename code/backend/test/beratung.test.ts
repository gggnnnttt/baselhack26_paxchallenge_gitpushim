import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createApiCalcClient, type RisikoRechner } from '../src/berechnung/apicalc.js';
import { pruefeRisiko, type RiskRequest, type RiskResponse } from '../src/berechnung/risiko.js';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { ChatService, type ChatAntwort, type ModelAdapter, type ModelRequest } from '../src/chat.js';
import { GuardrailError, Guardrails } from '../src/guardrails.js';
import { wendeAenderungenAn, type Aenderung } from '../src/profil/aenderungen.js';
import { EXTRAKTION_FORMAT } from '../src/profil/extraktion.js';
import { leeresProfil, type Profil } from '../src/profil/profil.js';

// Synthetic data only, loosely based on the Müller persona. No real customer data, no external calls.
const config = JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8'));
const JAHR = 2026;
const HEUTE = new Date('2026-10-31T12:00:00');

const op = (feld: Aenderung['feld'], werte: Partial<Aenderung> & { beleg: string }): Aenderung => ({
  aktion: 'setzen', feld, person: null, ziel: null, text: null, zahl: null, monat: null, ja_nein: null, einheit: null,
  einkommensbasis: null, monatsloehne: null, planart: null, quelle: 'aussage', begruendung: null, ...werte,
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
      op('anliegen', { text: 'Familie absichern, falls einem Elternteil etwas passiert', beleg: 'Wir möchten unsere Familie absichern' }),
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

function skriptModell(skript: Aenderung[][], antworten: (request: ModelRequest) => string = () => 'Danke, ich habe das notiert.') {
  const anweisungen: string[] = [];
  let zug = 0;
  const provider: ModelAdapter = { generate: async request => {
    if (request.responseFormat?.name === 'advisory_scope') return '{"allowed":true}';
    if (request.responseFormat?.name === 'profil_aenderungen') return JSON.stringify({ aenderungen: skript[zug++] ?? [] });
    anweisungen.push(request.instructions);
    return antworten(request);
  } };
  return { provider, anweisungen };
}

function zaehlenderRechner(antwort: RiskResponse = ANTWORT) {
  const requests: RiskRequest[] = [];
  const rechner: RisikoRechner = { berechneRisiko: async request => { requests.push(request); return antwort; } };
  return { rechner, requests };
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
  assert.equal(erst!.phase, 'erfassung');
  assert.deepEqual(erst!.letzteNachricht.abgelehnt.map(e => e.grund), ['Der Beleg steht nicht in der Nachricht.']);
  assert.equal(erst!.profil.haushalt.beziehungSeitJahr, undefined);
  assert.equal(erst!.profil.kinder[0]!.elternteil!.wert, 'beide');
  assert.ok(erst!.risiko.fehlend.some(a => a.label === 'Jahr der Heirat'));

  // Turn 2: derivation without reason rejected; Person A's sex is not guessed.
  assert.deepEqual(zweit!.letzteNachricht.abgelehnt.map(e => e.grund), ['Ableitung ohne Begründung.']);
  assert.equal(zweit!.profil.kinder[0]!.bezeichnung, 'Kind');
  assert.ok(zweit!.risiko.fehlend.some(a => a.label === 'Geschlecht Person A (du)'));
  assert.equal(zweit!.profil.personen.B!.geschlecht!.quelle, 'ableitung');

  // Turn 3: typographic apostrophe in the message still matches the quote.
  assert.equal(dritt!.letzteNachricht.abgelehnt.length, 0);
  assert.equal(dritt!.profil.personen.B!.einkommen!.wert.betrag, 100000);
  assert.deepEqual(dritt!.risiko.fehlend.map(a => a.label), [
    'Gewünschtes Einkommen bei Erwerbsunfähigkeit von Person B (Partner/in) (in % des heutigen Einkommens oder CHF pro Jahr)',
    'Gewünschtes Einkommen im Todesfall von Person B (Partner/in) (in % des heutigen Einkommens oder CHF pro Jahr)',
  ]);

  // Turn 4: the planned return to work stays a plan and does not change today's situation.
  const plan = viert!.profil.plaene[0]!;
  assert.deepEqual([plan.art, plan.person, plan.zeitpunkt!.wert.jahr, plan.zeitpunkt!.wert.monat, plan.pensumProzent!.wert, plan.sicherheit!.wert], ['wiedereinstieg', 'A', 2027, 3, 40, 'unsicher']);
  assert.equal(viert!.profil.personen.A.erwerb!.wert, 'nicht_erwerbstaetig');
  assert.equal(viert!.profil.personen.A.einkommen, undefined);
  assert.equal(viert!.phase, 'erfassung');

  // Turn 5: complete → exactly one calculation with the expected request.
  assert.equal(fuenft!.phase, 'berechnet');
  assert.deepEqual(fuenft!.risiko.request, ERWARTETER_REQUEST);
  assert.deepEqual(requests, [ERWARTETER_REQUEST]);
  assert.equal(fuenft!.risiko.ergebnis!.szenarien[1]!.luecke, 12000);
  assert.ok(fuenft!.risiko.hinweise.some(h => h.includes('3. Säule')));
  assert.ok(fuenft!.risiko.hinweise.some(h => h.includes('Pläne fliessen nicht ein')));

  // Every accepted value points back to the user message it came from.
  assert.equal(fuenft!.profil.personen.B!.bedarfTodesfall!.nachricht, 8);
  assert.equal(fuenft!.profil.haushalt.beziehung!.nachricht, 0);

  // The reply model sees missing inputs first and the result only once it exists.
  assert.match(anweisungen[0]!, /Noch fehlend[^]*Jahr der Heirat/);
  assert.match(anweisungen[0]!, /Noch kein Berechnungsergebnis/);
  assert.match(anweisungen[4]!, /Todesfall durch Krankheit – Person B: Bedarf CHF 70.000/);
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
  assert.equal(nachKorrektur.phase, 'berechnet');
  const nachWiderruf = (await service.reply({ message: 'Das Heiratsjahr stimmt nicht, das muss ich nachschauen.', sessionId })).beratungsstand;
  assert.equal(nachWiderruf.phase, 'erfassung');
  assert.equal(nachWiderruf.risiko.ergebnis!.veraltet, true);
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
    if (request.responseFormat) return '{"aenderungen":[{"feld":"name","text":"Erika"}]}';
    antwortAufrufe++;
    return 'Antwort';
  } }, new Guardrails(config), 'Berater');
  await assert.rejects(kaputt.reply({ message: 'Wir sind verheiratet.' }), (error: unknown) => error instanceof GuardrailError && error.status === 503);
  assert.equal(antwortAufrufe, 0);
  assert.equal(kaputt.sessionCount, 0);

  // Deleted while APICalc is running: no reply, no stored state.
  let freigeben!: () => void;
  const langsam: RisikoRechner = { berechneRisiko: () => new Promise(resolve => { freigeben = () => resolve(ANTWORT); }) };
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
  const ohne = new Beratungsablauf(null);
  assert.equal((await ohne.aktualisiere(ohne.start(JAHR), komplett)).phase, 'bereit');

  const fehler = new Beratungsablauf({ berechneRisiko: async () => { throw new Error('APICalc antwortete mit HTTP 401.'); } });
  const fehlgeschlagen = await fehler.aktualisiere(fehler.start(JAHR), komplett);
  assert.equal(fehlgeschlagen.phase, 'fehlgeschlagen');
  assert.equal(fehlgeschlagen.kontext.fehler, 'APICalc antwortete mit HTTP 401.');

  const { rechner, requests } = zaehlenderRechner();
  const ablauf = new Beratungsablauf(rechner);
  const einmal = await ablauf.aktualisiere(ablauf.start(JAHR), komplett);
  const zweimal = await ablauf.aktualisiere(einmal, structuredClone(komplett));
  assert.equal(zweimal.phase, 'berechnet');
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
