import { erwachsene, personLabel, sparbetragJahr, type Plan, type Profil } from '../profil/profil.js';
import { abschliessen, bruttoJahr, chf, neuePruefung, type Pruefung } from './basis.js';

// Common rules of thumb of Swiss lenders. Named with every result; no financing commitment.
export const REGELN = {
  eigenmittel: 0.2,
  harteEigenmittel: 0.1,
  kalkZins: 0.05,
  nebenkosten: 0.01,
  belehnungNachAmortisation: 2 / 3,
  amortisationJahre: 15,
  tragbarkeit: 1 / 3,
} as const;

export interface EigenheimRequest {
  kaufpreis: number;
  kaufjahr: number;
  jahreBisKauf: number;
  vermoegen: number;
  sparbetragJahr: number;
  saeule3a: number;
  einkommenBrutto: number;
}

export interface Eigenheimergebnis {
  kaufpreis: number;
  kaufjahr: number;
  eigenmittelBeiKauf: number;
  eigenmittelNoetig: number;
  eigenmittelLuecke: number;
  sparbetragFuerZielJahr: number | null;
  hypothek: number;
  kostenJahr: number;
  tragbarkeitProzent: number;
  tragbar: boolean;
  maxKaufpreisNachEinkommen: number;
  saeule3aMoeglich: number;
}

/** Inputs for the home ownership scenario. Income at purchase uses today's income plus plans dated before the purchase. */
export function pruefeEigenheim(profil: Profil, plan: Plan, jahr: number): Pruefung<EigenheimRequest> {
  const p = neuePruefung<EigenheimRequest>();
  const kaufpreis = plan.kaufpreis?.wert;
  if (plan.kaufpreis) p.vorhanden.push({ label: 'Ungefährer Kaufpreis', wert: chf(plan.kaufpreis.wert), quelle: plan.kaufpreis.quelle });
  else p.fehlend.push({ label: 'Ungefährer Kaufpreis des Eigenheims', warum: 'Daraus ergeben sich nötige Eigenmittel und Tragbarkeit.' });

  const kaufjahr = plan.zeitpunkt?.wert.jahr ?? jahr;
  if (plan.zeitpunkt) p.vorhanden.push({ label: 'Geplantes Kaufjahr', wert: String(kaufjahr), quelle: plan.zeitpunkt.quelle });
  else p.optional.push({ label: 'Wann der Kauf ungefähr geplant ist', warum: 'Bis dahin kann noch gespart werden.' });
  const jahreBisKauf = Math.max(0, kaufjahr - jahr);

  const vermoegen = profil.haushalt.vermoegen;
  if (vermoegen) p.vorhanden.push({ label: 'Ersparnisse heute', wert: chf(vermoegen.wert), quelle: vermoegen.quelle });
  else p.fehlend.push({ label: 'Heutige Ersparnisse (ohne Pensionskasse)', warum: 'Eigenmittel sind die erste Hürde beim Hauskauf.' });

  const sparen = profil.haushalt.sparbetrag;
  if (sparen) p.vorhanden.push({ label: 'Regelmässiger Sparbetrag', wert: `${chf(sparbetragJahr(sparen.wert))} pro Jahr`, quelle: sparen.quelle });
  else if (jahreBisKauf > 0) p.fehlend.push({ label: 'Wie viel ihr bis zum Kauf regelmässig sparen könnt', warum: 'Zeigt, ob die Eigenmittel bis zum geplanten Kauf reichen.' });

  let einkommen = 0;
  let einkommenVollstaendig = true;
  for (const id of erwachsene(profil)) {
    const person = profil.personen[id] ?? {};
    // A dated plan before the purchase (e.g. return to work, lower workload) replaces today's income.
    const vorKauf = profil.plaene.filter(pl => (pl.person === id) && pl.zeitpunkt && pl.zeitpunkt.wert.jahr <= kaufjahr && (pl.einkommen || pl.pensumProzent?.wert === 0))
      .sort((a, b) => a.zeitpunkt!.wert.jahr - b.zeitpunkt!.wert.jahr).at(-1);
    if (vorKauf) {
      const brutto = vorKauf.pensumProzent?.wert === 0 && !vorKauf.einkommen ? 0 : bruttoJahr(vorKauf.einkommen!.wert);
      if (typeof brutto === 'number') {
        einkommen += brutto;
        p.annahmen.push(`${personLabel(id)}: Einkommen beim Kauf gemäss Plan „${vorKauf.beschreibung}“ (${chf(brutto)} brutto pro Jahr).`);
        continue;
      }
    }
    if (person.einkommen) {
      const brutto = bruttoJahr(person.einkommen.wert);
      if (typeof brutto === 'number') einkommen += brutto;
      else { einkommenVollstaendig = false; p.fehlend.push({ label: `${brutto} (${personLabel(id)})`, warum: 'Banken rechnen die Tragbarkeit mit dem Bruttoeinkommen.' }); }
    } else if (person.erwerb?.wert !== 'nicht_erwerbstaetig') {
      einkommenVollstaendig = false;
      p.fehlend.push({ label: `Bruttoeinkommen ${personLabel(id)}`, warum: 'Banken rechnen die Tragbarkeit mit dem Bruttoeinkommen.' });
    }
  }
  if (einkommenVollstaendig) p.vorhanden.push({ label: 'Bruttoeinkommen des Haushalts beim Kauf', wert: `${chf(einkommen)} pro Jahr`, quelle: 'backend' });

  const saeule3a = erwachsene(profil).reduce((summe, id) => summe + (profil.personen[id]?.saeule3aGuthaben?.wert ?? 0), 0);
  p.annahmen.push(
    `Faustregeln Schweizer Banken: ${REGELN.eigenmittel * 100} % Eigenmittel (davon mind. ${REGELN.harteEigenmittel * 100} % nicht aus der Pensionskasse), kalkulatorischer Zins ${REGELN.kalkZins * 100} %, Nebenkosten ${REGELN.nebenkosten * 100} % des Kaufpreises, Amortisation auf zwei Drittel innert ${REGELN.amortisationJahre} Jahren, Wohnkosten höchstens ein Drittel des Bruttoeinkommens.`,
    'Ersparnisse ohne Zins; Kaufnebenkosten (Notar, Grundbuch) nicht eingerechnet.',
  );
  p.hinweise.push('Vorbezüge aus Pensionskasse oder Säule 3a sind als Eigenmittel möglich, verkleinern aber die Altersvorsorge und die Leistungen bei Tod oder Erwerbsunfähigkeit. Sie sind hier nicht eingerechnet.');
  p.hinweise.push('Eine Hypothek erhöht den Bedarf der Familie, falls eine verdienende Person stirbt oder erwerbsunfähig wird.');
  if (!kaufpreis || !vermoegen || (!sparen && jahreBisKauf > 0) || !einkommenVollstaendig || p.fehlend.length) return p;
  return abschliessen(p, {
    kaufpreis, kaufjahr, jahreBisKauf, vermoegen: vermoegen.wert, sparbetragJahr: sparen ? sparbetragJahr(sparen.wert) : 0, saeule3a, einkommenBrutto: einkommen,
  });
}

const kostenJahr = (kaufpreis: number, hypothek: number) =>
  hypothek * REGELN.kalkZins + kaufpreis * REGELN.nebenkosten + Math.max(0, hypothek - kaufpreis * REGELN.belehnungNachAmortisation) / REGELN.amortisationJahre;

/** Local, fully traceable calculation. */
export function berechneEigenheim(r: EigenheimRequest): Eigenheimergebnis {
  const eigenmittelBeiKauf = r.vermoegen + r.sparbetragJahr * r.jahreBisKauf;
  const eigenmittelNoetig = r.kaufpreis * REGELN.eigenmittel;
  const hypothek = Math.max(0, r.kaufpreis - Math.min(eigenmittelBeiKauf, r.kaufpreis));
  // With 20 % own funds: yearly cost per franc of price = 0.8*5 % + 1 % + (0.8 − 2/3)/15.
  const kostenProFranken = (1 - REGELN.eigenmittel) * REGELN.kalkZins + REGELN.nebenkosten + ((1 - REGELN.eigenmittel) - REGELN.belehnungNachAmortisation) / REGELN.amortisationJahre;
  const kostenEffektiv = kostenJahr(r.kaufpreis, hypothek);
  const tragbarkeit = r.einkommenBrutto > 0 ? kostenEffektiv / r.einkommenBrutto : Infinity;
  return {
    kaufpreis: r.kaufpreis,
    kaufjahr: r.kaufjahr,
    eigenmittelBeiKauf: Math.round(eigenmittelBeiKauf),
    eigenmittelNoetig: Math.round(eigenmittelNoetig),
    eigenmittelLuecke: Math.round(Math.max(0, eigenmittelNoetig - eigenmittelBeiKauf)),
    sparbetragFuerZielJahr: r.jahreBisKauf > 0 ? Math.round(Math.max(0, eigenmittelNoetig - r.vermoegen) / r.jahreBisKauf) : null,
    hypothek: Math.round(hypothek),
    kostenJahr: Math.round(kostenEffektiv),
    tragbarkeitProzent: Number.isFinite(tragbarkeit) ? Math.round(tragbarkeit * 1000) / 10 : 100,
    tragbar: tragbarkeit <= REGELN.tragbarkeit,
    maxKaufpreisNachEinkommen: Math.round((r.einkommenBrutto * REGELN.tragbarkeit) / kostenProFranken / 1000) * 1000,
    saeule3aMoeglich: r.saeule3a,
  };
}
