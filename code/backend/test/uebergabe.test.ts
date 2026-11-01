import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { pruefeUebergabe, uebergabeKontext } from '../src/beratung/uebergabe.js';
import { ChatService } from '../src/chat.js';
import { Guardrails } from '../src/guardrails.js';
import { muellerProfil } from '../src/profil/demo.js';
import type { Profil } from '../src/profil/profil.js';

// Synthetic data only. The criteria are fixed rules; only the explanation comes from the model.
const heute = new Date('2026-10-31T12:00:00Z');
const f = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'Testangabe', begruendung: null, nachricht: 0 });

async function standMit(aendern: (p: Profil) => void) {
  const ablauf = new Beratungsablauf(null);
  const profil = muellerProfil(heute);
  aendern(profil);
  return ablauf.aktualisiere(ablauf.start(2026), profil);
}

test('the demo household meets no criterion; predefined situations always do', async () => {
  assert.deepEqual(pruefeUebergabe(await standMit(() => {})).kriterien, []);
  const selbst = pruefeUebergabe(await standMit(p => { p.personen.B!.erwerb = f('selbststaendig'); p.personen.B!.bvgVersichert = f(false); }));
  assert.deepEqual(selbst.kriterien.map(k => k.id), ['selbststaendig_ohne_pk']);
  const police = pruefeUebergabe(await standMit(p => { p.personen.B!.privateEu = { vorhanden: f(true) }; }));
  assert.deepEqual(police.kriterien.map(k => k.id), ['bestehende_versicherung']);
  const patchwork = pruefeUebergabe(await standMit(p => { p.kinder[0]!.elternteil = f('B'); }));
  assert.deepEqual(patchwork.kriterien.map(k => k.id), ['patchwork']);
  assert.match(uebergabeKontext(selbst), /Selbstständig ohne Pensionskasse/);
  assert.match(uebergabeKontext({ noetig: false, kriterien: [] }), /`uebergabe` ist null/);
});

test('the explanation comes from the model, is kept only while a criterion applies, and never invents numbers', async () => {
  const rails = new Guardrails(JSON.parse(readFileSync(new URL('../guardrails.config.json', import.meta.url), 'utf8')));
  let uebergabe: string | null = 'Weil Sie selbstständig sind, fehlt Ihnen die Pensionskasse. Eine Fachperson prüft Ihren Risikoschutz.';
  const service = new ChatService({ generate: async req => {
    if (req.responseFormat?.name === 'advisor_antwort') {
      assert.match(req.instructions, /Übergabe an eine Pax-Fachperson/);
      return JSON.stringify({ antwort: 'Danke.', frage: null, erkenntnisse: [], uebergabe });
    }
    if (req.responseFormat?.name === 'advisory_scope') return JSON.stringify({ allowed: true });
    return JSON.stringify({ aenderungen: [] });
  } }, rails, 'Berate zur Vorsorge.', { heute: () => heute });
  const demo = await service.demo();
  assert.equal(demo.beratungsstand.uebergabe.noetig, false);
  const ohne = await service.reply({ sessionId: demo.sessionId, message: 'Was bedeutet das für uns?' });
  assert.equal(ohne.beratungsstand.uebergabe.text, null, 'no criterion, no explanation, even if the model wrote one');
  // A planned self-employment is a predefined criterion: now the model's explanation is shown.
  const plan = { typ: 'speichern', plan: null, art: 'stellenwechsel', person: 'B', beschreibung: 'Selbstständig machen', jahr: 2028, monat: null, notiz: '' };
  const mit = await service.zeitstrahl({ sessionId: demo.sessionId, aktionen: [plan] });
  assert.deepEqual(mit.beratungsstand.uebergabe.kriterien.map(k => k.id), ['selbststaendigkeit_geplant']);
  assert.match(mit.beratungsstand.uebergabe.text!, /Fachperson prüft/);
  uebergabe = "Mit CHF 999'999 Lücke sollte eine Fachperson übernehmen.";
  const erfunden = await service.reply({ sessionId: demo.sessionId, message: 'Und jetzt?' });
  assert.match(erfunden.beratungsstand.uebergabe.text!, /Fachperson prüft/, 'an explanation with an invented number is rejected, the previous one stays');
});
