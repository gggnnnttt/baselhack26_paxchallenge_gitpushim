import { Component, computed, input, output } from '@angular/core';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { betrag, datum, sparbetrag } from '../format';

interface Balken {
  titel: string;
  fehler: string | null;
  bedarf?: number;
  einnahmen?: number;
  luecke: number;
  einnahmenAnteil: number;
  lueckeAnteil: number;
  tooltip: string;
}

/**
 * The calculations: protection against disability and death, an existing private disability pension,
 * retirement (with the "what if" comparison projected into it) and saving with the budget check.
 */
@Component({
  selector: 'app-plan-zahlen',
  templateUrl: './plan-zahlen.html',
  styleUrl: './plan-zahlen.scss',
})
export class PlanZahlen {
  readonly stand = input<Beratungsstand | null>(null);
  // Starts an answer in the chat, e.g. for the monthly budget.
  readonly frage = output<string>();

  protected readonly betrag = betrag;
  protected readonly datum = datum;
  protected readonly sparbetrag = sparbetrag;

  // The risk result grouped by person; all bars share one scale so they can be compared.
  protected readonly ergebnis = computed(() => {
    const szenarien = this.stand()?.risiko.ergebnis?.szenarien ?? [];
    const skala = Math.max(1, ...szenarien.map(z => Math.max(z.bedarf ?? 0, z.einnahmen ?? 0)));
    const gruppen = new Map<string, Balken[]>();
    for (const z of szenarien) {
      const [titel, person = ''] = z.szenario.split(' – ');
      const luecke = z.fehler ? 0 : z.luecke ?? 0;
      gruppen.set(person, [...(gruppen.get(person) ?? []), {
        titel,
        fehler: z.fehler,
        bedarf: z.bedarf,
        einnahmen: z.einnahmen,
        luecke,
        einnahmenAnteil: ((z.einnahmen ?? 0) / skala) * 100,
        lueckeAnteil: (luecke / skala) * 100,
        tooltip: z.fehler
          ? z.fehler
          : `Bedarf ${betrag(z.bedarf)}\nEinnahmen ${betrag(z.einnahmen)} (1. Säule ${betrag(z.ersteSaeule)}, 2. Säule ${betrag(z.zweiteSaeule)}, Partner/in ${betrag(z.partner)})\nLücke ${betrag(luecke)}, kapitalisiert ${betrag(z.kapitalisierteLuecke)}`,
      }]);
    }
    return [...gruppen].map(([person, zeilen]) => ({ person: person === 'Person A' ? 'Du' : person === 'Person B' ? 'Partner/in' : person, zeilen }));
  });

  // Retirement on the same kind of bar: what comes in (by source) against the need.
  protected readonly pension = computed(() => {
    const e = this.stand()?.pensionierung.ergebnis;
    if (!e) return null;
    const w = e.werte;
    const skala = Math.max(1, w.IncomeNeed ?? 0, w.IncomeTotal ?? 0);
    // Values the API did not return count as 0 here; the numbers below say what is known.
    const anteil = (wert: number | undefined) => (Math.max(0, wert ?? 0) / skala) * 100;
    return {
      veraltet: e.veraltet,
      zeitpunkt: e.zeitpunkt,
      werte: w,
      teile: [
        { klasse: 'saeule1', label: '1. Säule', anteil: anteil(w.IncomePillar1) },
        { klasse: 'saeule2', label: '2. Säule', anteil: anteil(w.IncomePillar2) },
        { klasse: 'verzehr', label: 'Vermögensverzehr', anteil: anteil(w.IncomeWithdrawal) },
      ],
      luecke: w.IncomeGap ?? 0,
      lueckeAnteil: anteil(w.IncomeGap),
    };
  });
}
