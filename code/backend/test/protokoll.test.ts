import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schreibeProtokoll } from '../src/beratung/protokoll.js';
import type { EmpfehlungenAntwort } from '../src/produkte/begruendung.js';
import { produktkatalog } from '../src/produkte/katalog.js';
import { fixture } from './empfehlungen-fixture.js';

// Synthetic data only. The record's texts come from the model; a text with an invented number or a name is dropped.
const empfehlungen: EmpfehlungenAntwort = {
  status: 'vorschlaege', statusText: 'Vorschläge', erkenntnisse: [], regelHinweis: 'Hinweis', textquelle: 'ki',
  empfehlungen: [
    { id: 'ki-1', thema: 'pensionierung', titel: 'Lücke im Ruhestand schliessen', begruendung: 'Im Ruhestand fehlt Ihnen Einkommen.', einordnung: null, grundlage: 'Person A: Jahrgang 1995.', produkt: produktkatalog[0]!, hinweis: null },
    { id: 'ki-2', thema: 'absicherung', titel: 'Erwerbsunfähigkeit absichern', begruendung: 'Bei Krankheit fehlt Einkommen.', einordnung: null, grundlage: 'Risiko', produkt: produktkatalog[1]!, hinweis: null },
  ],
};

test('the record gets prose from the model for the chosen packages only, checked against the data', async () => {
  const stand = await fixture();
  const texte = await schreibeProtokoll(stand, empfehlungen, ['ki-1'], { generate: async req => {
    assert.match(req.instructions, /Sie-Form/);
    const daten = JSON.parse(req.messages[0]!.content);
    assert.deepEqual(daten.empfehlungen.map((e: { id: string }) => e.id), ['ki-1']);
    return JSON.stringify({
      ausgangslage: "Sie sind angestellt und möchten im Ruhestand gut leben. Im Ruhestand fehlen Ihnen CHF 8'000 pro Jahr.",
      pakete: [{ id: 'ki-1', grundlage: "Die Empfehlung beruht auf Ihrem Jahrgang 1995 und einer Lücke von CHF 12'345 pro Jahr." }],
      fazit: 'Kontaktieren Sie Frau Muster unter www.pax.ch.',
    });
  } });
  assert.match(texte.ausgangslage!, /8'000/);
  assert.deepEqual(texte.pakete, [{ id: 'ki-1', grundlage: null }]);
  assert.equal(texte.fazit, null);
});

test('without a chosen package from the recommendations there is no record text', async () => {
  const stand = await fixture();
  await assert.rejects(schreibeProtokoll(stand, empfehlungen, ['ki-9'], { generate: async () => '{}' }), /nicht mehr aktuell/);
});
