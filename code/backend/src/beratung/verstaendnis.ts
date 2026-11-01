import { szenarien } from '../berechnung/risiko.js';
import { gleicheBudgetAb } from '../berechnung/budget.js';
import { istPaar, type Person, type PersonId, type Profil } from '../profil/profil.js';
import type { AblaufStand } from './ablauf.js';

/**
 * How well Pax understands the household: the three pillars of Swiss provision, the topics with their
 * calculations, what follows from the situation, and what matters next. Derived from the profile and the
 * results of the calculation engine; the advisor model's insights are taken over as they are. Nothing here calculates.
 */
export type SaeulenStatus = 'offen' | 'teilweise' | 'klar';
export interface Saeule { nummer: 1 | 2 | 3; titel: string; untertitel: string; status: SaeulenStatus; bekannt: string[]; offen: string[] }
export interface Thema { id: 'absicherung' | 'pensionierung'; titel: string; status: 'offen' | 'bereit' | 'berechnet' | 'fehlgeschlagen'; text: string; luecke: boolean; betrag: number }
// thema: the need a gap or a good result belongs to; the recommendations page groups by it.
// quelle 'ki': written by the advisor model; otherwise derived from the calculations.
export interface Erkenntnis { art: 'hinweis' | 'luecke' | 'gut'; text: string; thema?: 'absicherung' | 'pensionierung' | 'sparen'; quelle?: 'ki' }
export interface Lagebild {
  // verstehen: pillars or concern still open; rechnen: understood, calculations still need inputs; empfehlen: ready to advise.
  phase: 'verstehen' | 'rechnen' | 'empfehlen';
  fokus: 'absicherung' | 'pensionierung' | 'beides';
  saeulen: Saeule[];
  themen: Thema[];
  erkenntnisse: Erkenntnis[];
  naechstes: { label: string; warum: string }[];
  // Share of the facts the pillars need that are known, 0 to 1.
  verstanden: number;
  // Planned steps the calculations do not include yet. A fact for the models, not a text for the customer.
  nichtEingerechnet: string[];
}

const chf = (betrag: number) => `CHF ${Math.round(betrag).toLocaleString('de-CH')}`;
const PENSIONSWORTE = /pension|ruhestand|rente im alter|alter vorsorg|früh.*aufhören|sparen/i;
const ABSICHERUNGSWORTE = /absicher|invalid|erwerbsunf|tod|hinterblieb|krank|unfall|familie/i;

function personen(profil: Profil): { id: PersonId; person: Person; name: string }[] {
  return [
    { id: 'A' as const, person: profil.personen.A, name: '' },
    ...(istPaar(profil) ? [{ id: 'B' as const, person: profil.personen.B ?? {}, name: 'Partner/in: ' }] : []),
  ];
}

function status(bekannt: string[], offen: string[]): SaeulenStatus {
  return !offen.length ? 'klar' : bekannt.length ? 'teilweise' : 'offen';
}

function saeulen(profil: Profil): Saeule[] {
  const h = profil.haushalt;
  const eins = { bekannt: [] as string[], offen: [] as string[] };
  const zwei = { bekannt: [] as string[], offen: [] as string[] };
  const drei = { bekannt: [] as string[], offen: [] as string[] };
  if (h.beziehung) eins.bekannt.push(`Zivilstand ${h.beziehung.wert.replace('_', ' ')}`); else eins.offen.push('Zivilstand');
  for (const { person: p, name } of personen(profil)) {
    if (p.geburtsjahr) eins.bekannt.push(`${name}Jahrgang ${p.geburtsjahr.wert}`); else eins.offen.push(`${name}Jahrgang`);
    const ohneErwerb = p.erwerb?.wert === 'nicht_erwerbstaetig';
    if (p.einkommen) eins.bekannt.push(`${name}Einkommen ${chf(p.einkommen.wert.betrag)} / ${p.einkommen.wert.einheit === 'chf_jahr' ? 'Jahr' : 'Monat'}`);
    else if (ohneErwerb) eins.bekannt.push(`${name}kein Erwerbseinkommen`);
    else eins.offen.push(`${name}Einkommen`);

    if (p.erwerb) zwei.bekannt.push(`${name}${p.erwerb.wert === 'selbststaendig' ? 'selbstständig' : p.erwerb.wert === 'angestellt' ? 'angestellt' : 'nicht erwerbstätig'}`);
    else zwei.offen.push(`${name}Erwerbssituation`);
    if (ohneErwerb) {
      // Without earned income there is no compulsory pension fund to ask about.
    } else if (p.bvgVersichert === undefined) {
      zwei.offen.push(`${name}Pensionskasse ja/nein`);
    } else if (!p.bvgVersichert.wert) {
      zwei.bekannt.push(`${name}keine Pensionskasse`);
    } else {
      zwei.bekannt.push(`${name}bei einer Pensionskasse versichert`);
      if (p.pkAltersrente) zwei.bekannt.push(`${name}PK-Altersrente ${chf(p.pkAltersrente.wert)} / Jahr`); else zwei.offen.push(`${name}PK-Altersrente`);
      if (p.pkGuthaben) zwei.bekannt.push(`${name}PK-Guthaben ${chf(p.pkGuthaben.wert)}`); else zwei.offen.push(`${name}PK-Guthaben`);
    }

    const eu = p.privateEu?.vorhanden;
    if (eu) drei.bekannt.push(`${name}${eu.wert ? 'private Erwerbsunfähigkeitsrente vorhanden' : 'keine private Erwerbsunfähigkeitsrente'}`);
    else drei.offen.push(`${name}private Erwerbsunfähigkeitsrente ja/nein`);
  }
  if (h.vermoegenPensionierung) drei.bekannt.push(`Vorsorgevermögen ${chf(h.vermoegenPensionierung.wert)}`);
  else drei.offen.push('Vermögen für die Pension (Säule 3a, Ersparnisse)');
  return [
    { nummer: 1, titel: '1. Säule', untertitel: 'AHV / IV', status: status(eins.bekannt, eins.offen), ...eins },
    { nummer: 2, titel: '2. Säule', untertitel: 'Pensionskasse', status: status(zwei.bekannt, zwei.offen), ...zwei },
    { nummer: 3, titel: '3. Säule', untertitel: 'Private Vorsorge', status: status(drei.bekannt, drei.offen), ...drei },
  ];
}

function themen(stand: AblaufStand): Thema[] {
  const { pruefung, berechnung } = stand.kontext;
  const risiko: Thema = { id: 'absicherung', titel: 'Absicherung bei Invalidität und Tod', status: 'offen', text: `Für die Berechnung fehlen noch ${pruefung.fehlend.length} Angaben.`, luecke: false, betrag: 0 };
  if (stand.phase === 'bereit') Object.assign(risiko, { status: 'bereit', text: 'Angaben vollständig, der Rechner ist nicht verbunden.' });
  if (stand.phase === 'fehlgeschlagen') Object.assign(risiko, { status: 'fehlgeschlagen', text: 'Die Berechnung ist fehlgeschlagen.' });
  if (stand.phase === 'berechnet' && berechnung) {
    const groesste = szenarien(berechnung.antwort).filter(s => !s.fehler && (s.luecke ?? 0) > 0).sort((a, b) => (b.luecke ?? 0) - (a.luecke ?? 0))[0];
    Object.assign(risiko, { status: 'berechnet', luecke: !!groesste, betrag: groesste?.luecke ?? 0, text: groesste ? `Grösste Lücke ${chf(groesste.luecke!)} pro Jahr (${groesste.szenario}).` : 'Die Berechnung zeigt keine Lücke.' });
  }
  const p = stand.pensionierung;
  const pension: Thema = { id: 'pensionierung', titel: 'Pensionierung', status: 'offen', text: `Für die Berechnung fehlen noch ${p.pruefung.fehlend.length} Angaben.`, luecke: false, betrag: 0 };
  if (p.phase === 'bereit') Object.assign(pension, { status: 'bereit', text: 'Angaben vollständig, der Rechner ist nicht verbunden.' });
  if (p.phase === 'fehlgeschlagen') Object.assign(pension, { status: 'fehlgeschlagen', text: 'Die Berechnung ist fehlgeschlagen.' });
  if (p.phase === 'berechnet' && p.berechnung) {
    const w = p.berechnung.antwort.response;
    Object.assign(pension, { status: 'berechnet', luecke: (w.IncomeGap ?? 0) > 0, betrag: Math.max(0, w.IncomeGap ?? 0), text: (w.IncomeGap ?? 0) > 0
      ? `Im Ruhestand fehlen ${chf(w.IncomeGap!)} pro Jahr, Kapitallücke ${chf(w.CapitalGap ?? 0)}.`
      : 'Die Basisrechnung zeigt im Ruhestand keine Lücke.' });
  }
  return [risiko, pension];
}

function fokus(profil: Profil): Lagebild['fokus'] {
  const text = [...profil.anliegen.map(a => a.text), ...profil.plaene.map(p => `${p.art} ${p.beschreibung}`)].join(' ');
  const pension = PENSIONSWORTE.test(text) || profil.plaene.some(p => p.art === 'pensionierung' || p.art === 'fruehpensionierung');
  const absicherung = ABSICHERUNGSWORTE.test(text) || profil.plaene.some(p => p.art === 'familienzuwachs');
  return pension && !absicherung ? 'pensionierung' : absicherung && !pension ? 'absicherung' : 'beides';
}

// What Pax recognised: the advisor model's own insights from its last reply, then the calculated results.
// The results stay deterministic, because their numbers come from the calculation engine, not from the model.
function erkenntnisse(stand: AblaufStand, themenListe: Thema[]): Erkenntnis[] {
  const profil = stand.kontext.profil;
  const liste: Erkenntnis[] = (stand.erkenntnisse ?? []).map(text => ({ art: 'hinweis', text, quelle: 'ki' }));

  // In the customer's words: the size of the gap, without scenario names or calculation terms.
  const [risiko, pension] = themenListe;
  if (risiko?.status === 'berechnet') {
    liste.push(risiko.luecke
      ? { art: 'luecke', thema: 'absicherung', text: `Bei Invalidität oder Tod fehlen Ihrem Haushalt bis zu ${chf(risiko.betrag)} pro Jahr.` }
      : { art: 'gut', thema: 'absicherung', text: 'Bei Invalidität und Tod zeigt die Berechnung heute keine Lücke.' });
  }
  if (pension?.status === 'berechnet') {
    liste.push(pension.luecke
      ? { art: 'luecke', thema: 'pensionierung', text: `Im Ruhestand fehlen Ihnen rund ${chf(pension.betrag)} pro Jahr.` }
      : { art: 'gut', thema: 'pensionierung', text: 'Für den Ruhestand zeigt die Berechnung heute keine Lücke.' });
  }
  const budget = gleicheBudgetAb(profil, stand.sparen);
  if (budget.status === 'unterdeckung' && budget.fehlbetragMonat !== null) {
    liste.push({ art: 'luecke', thema: 'sparen', text: `Um die Lücke bis zur Pension zu schliessen, fehlen in Ihrem Budget ${chf(budget.fehlbetragMonat)} pro Monat.` });
  }
  return liste;
}

function naechstes(stand: AblaufStand, saeulenListe: Saeule[], fokusWert: Lagebild['fokus']): Lagebild['naechstes'] {
  const profil = stand.kontext.profil;
  const liste: Lagebild['naechstes'] = [];
  if (!profil.anliegen.length) liste.push({ label: 'Ihr wichtigstes Anliegen', warum: 'Damit klar ist, worauf es Ihnen ankommt.' });
  for (const s of saeulenListe.slice(0, 2)) for (const o of s.offen) liste.push({ label: o, warum: `Gehört zur ${s.titel} (${s.untertitel}).` });
  const rechnung = (fokusWert === 'absicherung' ? [] : stand.pensionierung.pruefung.fehlend)
    .concat(fokusWert === 'pensionierung' ? [] : stand.kontext.pruefung.fehlend);
  for (const f of rechnung) liste.push({ label: f.label, warum: f.warum ?? 'Wird für die Berechnung gebraucht.' });
  for (const o of saeulenListe[2]!.offen) liste.push({ label: o, warum: 'Gehört zur 3. Säule (private Vorsorge).' });
  const gesehen = new Set<string>();
  return liste.filter(e => !gesehen.has(e.label) && gesehen.add(e.label)).slice(0, 3);
}

export function lagebild(stand: AblaufStand): Lagebild {
  const profil = stand.kontext.profil;
  const saeulenListe = saeulen(profil);
  const themenListe = themen(stand);
  const fokusWert = fokus(profil);
  const bekannt = saeulenListe.reduce((n, s) => n + s.bekannt.length, 0) + (profil.anliegen.length ? 1 : 0);
  const gesamt = bekannt + saeulenListe.reduce((n, s) => n + s.offen.length, 0) + (profil.anliegen.length ? 0 : 1);
  const alleKlar = saeulenListe.every(s => s.status === 'klar') && profil.anliegen.length > 0;
  const phase = !alleKlar ? 'verstehen' : themenListe.some(t => t.status === 'berechnet') ? 'empfehlen' : 'rechnen';
  return {
    phase,
    fokus: fokusWert,
    saeulen: saeulenListe,
    themen: themenListe,
    erkenntnisse: erkenntnisse(stand, themenListe),
    naechstes: naechstes(stand, saeulenListe, fokusWert),
    verstanden: gesamt ? bekannt / gesamt : 0,
    nichtEingerechnet: themenListe.some(t => t.status === 'berechnet') ? profil.plaene.map(p => p.beschreibung) : [],
  };
}

const PHASEN_TEXT: Record<Lagebild['phase'], string> = {
  verstehen: 'Frage nach dem wichtigsten Punkt unter „Als Nächstes“, eine Frage pro Antwort. Verknüpfe neue Angaben in einem Satz mit dem Lagebild, statt Regeln zu erklären.',
  rechnen: 'Die drei Säulen sind verstanden. Erfrage, was die Berechnungen zum Anliegen noch brauchen, und ordne vorliegende Ergebnisse kurz ein.',
  empfehlen: 'Du kennst alle drei Säulen und das Anliegen und kannst Empfehlungen machen. Sage das einmal klar und selbstbewusst, fasse das Lagebild in wenigen Stichpunkten zusammen und lade ein, die Seite mit den Empfehlungen über den Knopf zu öffnen. Nenne im Gespräch keine Produkte, Pakete oder Prämien: Die Paket-Empfehlungen zeigt die Seite.',
};

/** The understanding for the model: compact, with one instruction for how to lead the conversation now. */
export function lagebildKontext(l: Lagebild): string {
  return [
    '## Lagebild (vom Backend abgeleitet)',
    `Phase: ${l.phase}. ${PHASEN_TEXT[l.phase]}`,
    `Fokus des Kunden: ${l.fokus === 'beides' ? 'Absicherung und Pensionierung' : l.fokus}`,
    ...l.saeulen.map(s => `- ${s.titel} (${s.untertitel}): ${s.status}${s.bekannt.length ? `; bekannt: ${s.bekannt.join(', ')}` : ''}${s.offen.length ? `; offen: ${s.offen.join(', ')}` : ''}`),
    ...l.themen.map(t => `- ${t.titel}: ${t.text}`),
    'Erkenntnisse aus den Berechnungen:',
    ...(l.erkenntnisse.some(e => e.quelle !== 'ki') ? l.erkenntnisse.filter(e => e.quelle !== 'ki').map(e => `- ${e.text}`) : ['- noch keine']),
    ...(l.nichtEingerechnet.length ? [`Nicht in den Berechnungen enthalten (geplante Schritte): ${l.nichtEingerechnet.join(', ')}. Erwähne das nur, wenn es für die Einordnung wichtig ist.`] : []),
    'Deine eigenen Erkenntnisse aus der letzten Antwort (nicht vom Backend geprüft, bei Bedarf ersetzen):',
    ...(l.erkenntnisse.some(e => e.quelle === 'ki') ? l.erkenntnisse.filter(e => e.quelle === 'ki').map(e => `- ${e.text}`) : ['- noch keine']),
    'Als Nächstes:',
    ...(l.naechstes.length ? l.naechstes.map(n => `- ${n.label} – ${n.warum}`) : ['- nichts offen']),
  ].join('\n');
}
