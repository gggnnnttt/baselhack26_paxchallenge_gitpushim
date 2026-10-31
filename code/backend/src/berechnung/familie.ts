import { istPaar, personLabel, type Herkunft, type Plan, type Profil } from '../profil/profil.js';
import { bruttoJahr, chf, type Pruefung } from './basis.js';
import { pruefeRisiko, type RiskRequest } from './risiko.js';

export const FAMILIEN_PLANARTEN: ReadonlySet<Plan['art']> = new Set(['wiedereinstieg', 'pensumaenderung', 'stellenwechsel', 'familienzuwachs']);
// BVG entry threshold 2025 (CHF 22'680). Used only as an explicitly named scenario assumption.
const BVG_EINTRITTSSCHWELLE = 22680;

/**
 * Family scenario: the risk calculation on a copy of the profile with one plan applied (return to work, other workload,
 * another child). Today's profile is never changed; every change to the copy is listed as an assumption.
 */
export function pruefeFamilienSzenario(profil: Profil, plan: Plan, jahr: number): Pruefung<RiskRequest> {
  const kopie = structuredClone(profil);
  const annahmen: string[] = [`Szenario „${plan.beschreibung}“${plan.zeitpunkt ? ` ab ${plan.zeitpunkt.wert.monat ? `${plan.zeitpunkt.wert.monat}/` : ''}${plan.zeitpunkt.wert.jahr}` : ''}, sonst gleiche Situation wie heute.`];
  const fehlend: Pruefung<RiskRequest>['fehlend'] = [];
  const herkunft: Herkunft = { quelle: 'ableitung', beleg: plan.herkunft.beleg, begruendung: 'Szenario-Annahme aus einem Plan', nachricht: plan.herkunft.nachricht };

  if (plan.art === 'familienzuwachs') {
    const geburtsjahr = plan.zeitpunkt?.wert.jahr ?? jahr + 1;
    kopie.kinder.push({ id: 'szenario', bezeichnung: 'Kind', herkunft, geburtsjahr: { wert: geburtsjahr, ...herkunft }, elternteil: { wert: istPaar(profil) ? 'beide' : 'A', ...herkunft } });
    kopie.haushalt.hatKinder = { wert: true, ...herkunft };
    annahmen.push(`Ein weiteres ${istPaar(profil) ? 'gemeinsames ' : ''}Kind, geboren ${geburtsjahr}.`);
  }
  // Workload or income changes belong to the scenario too, also when they were mentioned with the birth.
  const mitArbeit = plan.art !== 'familienzuwachs' || plan.pensumProzent !== undefined || plan.einkommen !== undefined;
  if (mitArbeit && plan.person !== 'haushalt') {
    const id = plan.person;
    const person = (kopie.personen[id] ??= {});
    if (plan.pensumProzent) {
      person.pensumProzent = { wert: plan.pensumProzent.wert, ...herkunft };
      annahmen.push(`${personLabel(id)}: Pensum ${plan.pensumProzent.wert} %.`);
    }
    if (plan.pensumProzent?.wert === 0) {
      person.erwerb = { wert: 'nicht_erwerbstaetig', ...herkunft };
      delete person.einkommen;
      delete person.bvgVersichert;
    } else if (plan.einkommen) {
      person.einkommen = { wert: plan.einkommen.wert, ...herkunft };
      if (person.erwerb?.wert !== 'selbststaendig') person.erwerb = { wert: 'angestellt', ...herkunft };
      const brutto = bruttoJahr(plan.einkommen.wert);
      annahmen.push(`${personLabel(id)}: Einkommen ${typeof brutto === 'number' ? `${chf(brutto)} brutto pro Jahr` : 'gemäss Plan'}.`);
      // A person who does not work today has no known pension fund status for the new job.
      const heute = profil.personen[id]?.bvgVersichert;
      if (!heute && typeof brutto === 'number') {
        const versichert = brutto >= BVG_EINTRITTSSCHWELLE;
        person.bvgVersichert = { wert: versichert, ...herkunft };
        annahmen.push(`${personLabel(id)}: Pensionskasse ${versichert ? 'angenommen' : 'nicht angenommen'}, weil das Einkommen ${versichert ? 'über' : 'unter'} der BVG-Eintrittsschwelle von ${chf(BVG_EINTRITTSSCHWELLE)} (Stand 2025) liegt.`);
      }
    } else {
      fehlend.push({ label: `Erwartetes Bruttoeinkommen nach „${plan.beschreibung}“ (${personLabel(id)})`, warum: 'Das Szenario braucht das künftige Einkommen, um Leistungen und Bedarf neu zu berechnen.' });
    }
  } else if (mitArbeit) {
    fehlend.push({ label: `Wer bei „${plan.beschreibung}“ das Pensum oder Einkommen ändert`, warum: 'Das Szenario rechnet die Änderung für die betreffende Person.' });
  }

  const p = pruefeRisiko(kopie, jahr);
  p.hinweise = p.hinweise.filter(h => !h.startsWith('Pläne fliessen nicht ein'));
  p.hinweise.push('Szenario, keine Prognose: Es zeigt die Absicherung, wenn der Plan so eintritt.');
  const alleFehlend = [...fehlend, ...p.fehlend];
  return { ...p, fehlend: alleFehlend, annahmen: [...annahmen, ...p.annahmen], ...(alleFehlend.length ? { bereit: false, request: null, requestJson: null } : {}) };
}
