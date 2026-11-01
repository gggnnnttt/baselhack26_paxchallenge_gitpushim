import assert from 'node:assert/strict';
import { test } from 'node:test';
import { erklaereGrafik, grafikZeilen } from '../src/beratung/grafik.js';
import { fixture } from './empfehlungen-fixture.js';

// Synthetic data only. The rows come from the calculations; the text from the model, with numbers from the rows only.
test('rows show need and pillars per calculated scenario, plus retirement', async () => {
  const zeilen = grafikZeilen(await fixture());
  const ruhestand = zeilen.find(z => z.id === 'ruhestand')!;
  assert.deepEqual(ruhestand, { id: 'ruhestand', titel: 'Ruhestand', wer: 'Haushalt', bedarf: 60000, ersteSaeule: 30000, zweiteSaeule: 22000, weiteres: 0, luecke: 8000 });
  assert.ok(zeilen.every(z => !/Person [AB]/.test(z.titel) && z.wer !== undefined));
});

test('the explanation is model text in Sie-form; an invented number drops it', async () => {
  const stand = await fixture();
  const gut = await erklaereGrafik(stand, { generate: async req => {
    assert.match(req.instructions, /Sie-Form/);
    return JSON.stringify({ text: "Im Ruhestand fehlen Ihnen CHF 8'000 pro Jahr, weil AHV und Pensionskasse den Bedarf nicht ganz decken." });
  } });
  assert.match(gut!, /8'000/);
  const erfunden = await erklaereGrafik(stand, { generate: async () => JSON.stringify({ text: "Es fehlen CHF 12'345 pro Jahr." }) });
  assert.equal(erfunden, null);
});
