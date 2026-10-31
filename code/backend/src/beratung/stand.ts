import { bruttoJahr, chf } from '../berechnung/basis.js';
import { alleRechnungen, type Ergebnis, type Gespeichert, type Rechnung } from '../berechnung/rechnungen.js';
import type { Szenario } from '../berechnung/risiko.js';
import type { Wunsch } from '../profil/aenderungen.js';
import { erwachsene, personLabel, type AnliegenThema, type PersonId, type Profil } from '../profil/profil.js';

/**
 * The running advisory state of a household. Derived deterministically from the profile and stored results on
 * every turn, so it is reproducible and auditable. It describes where the advisory stands; it is not a question list.
 */

export type ThemaId = 'situation' | 'einkommen' | 'budget' | 'saeule1' | 'saeule2' | 'saeule3' | 'absicherung' | 'risiko' | 'familie' | 'eigenheim' | 'pensionierung';
export type ThemaStatus = 'offen' | 'teilweise' | 'geklaert';
export type RechnungsStatus = 'unvollstaendig' | 'bereit' | 'berechnet' | 'veraltet' | 'fehlgeschlagen';

export interface OffenerPunkt { thema: ThemaId; label: string; warum: string }

export interface Thema {
  id: ThemaId;
  titel: string;
  status: ThemaStatus;
  // Why the topic matters for this household right now (empty if only part of the overall picture).
  anlass: string | null;
  zusammenfassung: string;
  offen: OffenerPunkt[];
  rechnungen: string[];
}

export interface RechnungsStand extends Omit<Rechnung, 'pruefung'> {
  status: RechnungsStatus;
  pruefung: Rechnung['pruefung'];
  // Only a result computed from exactly the current inputs.
  ergebnis: Ergebnis | null;
  zeitpunkt: string | null;
  fehler: string | null;
}

export interface AnliegenStand { id: string; text: string; thema: AnliegenThema; status: 'offen' | 'in_klaerung' | 'ergebnis'; themen: ThemaId[]; rechnungen: string[] }

export interface Luecke { text: string; betrag: number; einheit: 'pro_jahr' | 'kapital'; quelle: string }

export interface Empfehlungsgrundlage {
  erlaubt: boolean;
  fehlt: string[];
  beduerfnisse: string[];
  vorhandeneLeistungen: string[];
  luecken: Luecke[];
}

export interface Beratungsstand {
  anliegen: AnliegenStand[];
  themen: Thema[];
  rechnungen: RechnungsStand[];
  empfehlung: Empfehlungsgrundlage;
  menschlicheBeratung: string[];
}

const TITEL: Record<ThemaId, string> = {
  situation: 'Lebenssituation',
  einkommen: 'Einkommen und Erwerb',
  budget: 'Budget und Ersparnisse',
  saeule1: '1. Säule (AHV/IV)',
  saeule2: '2. Säule (Pensionskasse)',
  saeule3: '3. Säule (private Vorsorge)',
  absicherung: 'Bestehende private Absicherung',
  risiko: 'Absicherung bei Erwerbsunfähigkeit und Tod',
  familie: 'Familienplanung',
  eigenheim: 'Eigenheim',
  pensionierung: 'Pensionierung',
};

// Which topics and calculations answer which kind of concern.
const ANLIEGEN_THEMEN: Record<AnliegenThema, ThemaId[]> = {
  absicherung: ['risiko', 'absicherung', 'saeule2'],
  familie: ['familie', 'risiko'],
  eigenheim: ['eigenheim', 'budget'],
  pensionierung: ['pensionierung', 'saeule3', 'budget'],
  sparen: ['saeule3', 'budget', 'pensionierung'],
  sonstiges: [],
};
export const WUNSCH_THEMA: Record<NonNullable<Wunsch['thema']>, ThemaId> = {
  absicherung: 'risiko', familie: 'familie', eigenheim: 'eigenheim', pensionierung: 'pensionierung', sparen: 'saeule3',
};

const punkt = (thema: ThemaId, label: string, warum: string): OffenerPunkt => ({ thema, label, warum });
const verdienend = (profil: Profil, id: PersonId) => profil.personen[id]?.erwerb?.wert !== 'nicht_erwerbstaetig';

function rechnungsStaende(profil: Profil, jahr: number, gespeichert: Readonly<Record<string, Gespeichert>>): RechnungsStand[] {
  return alleRechnungen(profil, jahr).map(rechnung => {
    const g = gespeichert[rechnung.id];
    const aktuell = g && g.requestJson === rechnung.pruefung.requestJson;
    const status: RechnungsStatus = !rechnung.pruefung.bereit ? (g?.ergebnis ? 'veraltet' : 'unvollstaendig')
      : aktuell && g.ergebnis ? 'berechnet'
        : aktuell && g.fehler ? 'fehlgeschlagen'
          : g?.ergebnis ? 'veraltet'
            : 'bereit';
    return {
      ...rechnung,
      status,
      ergebnis: aktuell ? g.ergebnis : null,
      zeitpunkt: aktuell ? g.zeitpunkt : null,
      fehler: aktuell ? g.fehler : null,
    };
  });
}

function statusAus(offen: number, vorhanden: number): ThemaStatus {
  return offen === 0 ? 'geklaert' : vorhanden > 0 ? 'teilweise' : 'offen';
}

function rechnungsThema(id: ThemaId, rechnungen: RechnungsStand[], anlass: string | null, ohneRechnung: OffenerPunkt[] = []): Thema {
  const offen = [...ohneRechnung, ...rechnungen.flatMap(r => r.pruefung.fehlend.map(f => punkt(id, f.label, f.warum ?? '')))];
  const berechnet = rechnungen.filter(r => r.status === 'berechnet');
  const status: ThemaStatus = rechnungen.length > 0 && berechnet.length === rechnungen.length && ohneRechnung.length === 0 ? 'geklaert'
    : berechnet.length > 0 || rechnungen.some(r => r.pruefung.vorhanden.length > 0) ? 'teilweise' : 'offen';
  const zusammenfassung = rechnungen.length === 0 ? (ohneRechnung.length ? 'Noch kein konkreter Plan erfasst.' : 'Kein Thema für diesen Haushalt.')
    : rechnungen.map(r => `${r.titel}: ${STATUS_TEXT[r.status]}`).join('; ');
  return { id, titel: TITEL[id], status, anlass, zusammenfassung, offen, rechnungen: rechnungen.map(r => r.id) };
}

export const STATUS_TEXT: Record<RechnungsStatus, string> = {
  unvollstaendig: 'Angaben fehlen noch',
  bereit: 'Angaben vollständig, Berechnung in dieser Umgebung nicht möglich (kein APICalc-Zugang)',
  berechnet: 'berechnet',
  veraltet: 'Ergebnis veraltet (Angaben haben sich geändert)',
  fehlgeschlagen: 'Berechnung fehlgeschlagen',
};

export function bewerteStand(profil: Profil, jahr: number, gespeichert: Readonly<Record<string, Gespeichert>>): Beratungsstand {
  const rechnungen = rechnungsStaende(profil, jahr, gespeichert);
  const nachArt = (art: Rechnung['art']) => rechnungen.filter(r => r.art === art);
  const personen = erwachsene(profil);
  const h = profil.haushalt;
  const anliegenThemen = new Set(profil.anliegen.flatMap(a => ANLIEGEN_THEMEN[a.thema]));
  const anlass = (id: ThemaId, sonst: string | null = null) => {
    const a = profil.anliegen.filter(x => ANLIEGEN_THEMEN[x.thema].includes(id)).map(x => `Anliegen „${x.text}“`);
    return a.length ? a.join(', ') : sonst;
  };
  const hatAngehoerige = personen.length > 1 || profil.kinder.length > 0 || h.hatKinder?.wert === true;

  // Situation
  const situation: OffenerPunkt[] = [];
  if (!h.beziehung) situation.push(punkt('situation', 'Wie ihr zusammenlebt (ledig, verheiratet, Konkubinat …)', 'Leistungen für Hinterbliebene hängen davon ab.'));
  if (profil.kinder.length === 0 && h.hatKinder === undefined) situation.push(punkt('situation', 'Ob Kinder zum Haushalt gehören', 'Kinder verändern Bedarf und Leistungen.'));
  for (const id of personen) if (!profil.personen[id]?.geburtsjahr) situation.push(punkt('situation', `Jahrgang ${personLabel(id)}`, 'Leistungen und Zeithorizont hängen vom Alter ab.'));

  // Income
  const einkommen: OffenerPunkt[] = [];
  let einkommenBekannt = 0;
  for (const id of personen) {
    const p = profil.personen[id] ?? {};
    if (p.einkommen) {
      const brutto = bruttoJahr(p.einkommen.wert);
      if (typeof brutto === 'string') einkommen.push(punkt('einkommen', `${brutto} (${personLabel(id)})`, 'Leistungen der Sozialversicherungen werden vom Bruttoeinkommen berechnet.'));
      else einkommenBekannt++;
    } else if (p.erwerb?.wert === 'nicht_erwerbstaetig') einkommenBekannt++;
    else einkommen.push(punkt('einkommen', `Erwerbssituation und Bruttoeinkommen ${personLabel(id)}`, 'Grundlage für Leistungen, Bedarf und Tragbarkeit.'));
  }

  // Budget and savings
  const budget: OffenerPunkt[] = [];
  if (!h.sparbetrag) budget.push(punkt('budget', 'Wie viel ihr monatlich ungefähr sparen könnt', 'Zeigt, welcher Spielraum für Ziele und Vorsorge bleibt.'));
  if (!h.vermoegen) budget.push(punkt('budget', 'Ungefähre Ersparnisse heute (ohne Pensionskasse)', 'Vorhandenes Vermögen ist Teil des Gesamtbilds.'));

  // Pillars
  const saeule2: OffenerPunkt[] = [];
  for (const id of personen) {
    const p = profil.personen[id] ?? {};
    if (!p.bvgVersichert && verdienend(profil, id)) saeule2.push(punkt('saeule2', `Ob ${personLabel(id)} bei einer Pensionskasse versichert ist`, 'Die Pensionskasse leistet bei Alter, Invalidität und Tod.'));
  }
  const saeule3: OffenerPunkt[] = [];
  for (const id of personen) {
    if (!profil.personen[id]?.saeule3a) saeule3.push(punkt('saeule3', `Ob ${personLabel(id)} bereits eine Säule 3a hat`, 'Die private Vorsorge gehört zum Gesamtbild, fürs Alter und als Steuervorteil.'));
  }
  const absicherung: OffenerPunkt[] = [];
  if (hatAngehoerige) {
    for (const id of personen) {
      const p = profil.personen[id] ?? {};
      if (verdienend(profil, id) && (p.todesfallkapital === undefined || p.erwerbsunfaehigkeitsrente === undefined)) {
        absicherung.push(punkt('absicherung', `Ob für ${personLabel(id)} schon private Risikoversicherungen bestehen (Todesfallkapital, Erwerbsunfähigkeitsrente)`, 'Bestehende Leistungen verkleinern eine allfällige Lücke; nichts soll doppelt versichert werden.'));
      }
    }
  }

  const apiErgebnis = rechnungen.some(r => r.extern && r.status === 'berechnet');
  const themen: Thema[] = [
    { id: 'situation', titel: TITEL.situation, status: statusAus(situation.length, h.beziehung ? 1 : 0), anlass: null, zusammenfassung: [h.beziehung?.wert.replace('_', ' '), profil.kinder.length ? `${profil.kinder.length} Kind(er)` : h.hatKinder?.wert === false ? 'keine Kinder' : null].filter(Boolean).join(', ') || 'noch nicht bekannt', offen: situation, rechnungen: [] },
    { id: 'einkommen', titel: TITEL.einkommen, status: statusAus(einkommen.length, einkommenBekannt), anlass: null, zusammenfassung: `${einkommenBekannt} von ${personen.length} Einkommen bekannt`, offen: einkommen, rechnungen: [] },
    { id: 'budget', titel: TITEL.budget, status: statusAus(budget.length, 2 - budget.length), anlass: anlass('budget'), zusammenfassung: [h.vermoegen && `Ersparnisse ${chf(h.vermoegen.wert)}`, h.sparbetrag && `Sparbetrag ${chf(h.sparbetrag.wert.betrag)} pro ${h.sparbetrag.wert.einheit === 'chf_monat' ? 'Monat' : 'Jahr'}`].filter(Boolean).join(', ') || 'noch nicht bekannt', offen: budget, rechnungen: [] },
    { id: 'saeule1', titel: TITEL.saeule1, status: apiErgebnis ? 'geklaert' : 'offen', anlass: null, zusammenfassung: apiErgebnis ? 'In den APICalc-Berechnungen enthalten.' : 'Wird aus den Grunddaten berechnet; keine eigenen Fragen nötig.', offen: [], rechnungen: [] },
    { id: 'saeule2', titel: TITEL.saeule2, status: statusAus(saeule2.length, personen.length - saeule2.length), anlass: anlass('saeule2'), zusammenfassung: personen.map(id => `${personLabel(id)}: ${profil.personen[id]?.bvgVersichert ? (profil.personen[id]!.bvgVersichert!.wert ? 'versichert' : 'nicht versichert') : verdienend(profil, id) ? 'unbekannt' : 'keine (nicht erwerbstätig)'}`).join('; '), offen: saeule2, rechnungen: [] },
    { id: 'saeule3', titel: TITEL.saeule3, status: statusAus(saeule3.length, personen.length - saeule3.length), anlass: anlass('saeule3'), zusammenfassung: personen.map(id => { const p = profil.personen[id]; return `${personLabel(id)}: ${p?.saeule3a ? (p.saeule3a.wert ? `Säule 3a${p.saeule3aGuthaben ? ` (${chf(p.saeule3aGuthaben.wert)})` : ''}` : 'keine Säule 3a') : 'unbekannt'}`; }).join('; '), offen: saeule3, rechnungen: [] },
    { id: 'absicherung', titel: TITEL.absicherung, status: hatAngehoerige ? statusAus(absicherung.length, 1) : 'geklaert', anlass: anlass('absicherung'), zusammenfassung: hatAngehoerige ? personen.map(id => { const p = profil.personen[id]; return `${personLabel(id)}: Todesfallkapital ${p?.todesfallkapital ? chf(p.todesfallkapital.wert) : 'unbekannt'}, EU-Rente ${p?.erwerbsunfaehigkeitsrente ? `${chf(p.erwerbsunfaehigkeitsrente.wert)}/Jahr` : 'unbekannt'}`; }).join('; ') : 'Keine Angehörigen erfasst, die finanziell abhängig sind.', offen: absicherung, rechnungen: [] },
    rechnungsThema('risiko', nachArt('risiko'), anlass('risiko', hatAngehoerige ? 'Angehörige sind finanziell abhängig.' : null)),
    rechnungsThema('familie', nachArt('familie'), anlass('familie'), anliegenThemen.has('familie') && nachArt('familie').length === 0 ? [punkt('familie', 'Was ihr konkret plant (z. B. Elternzeit, Wiedereinstieg, weiteres Kind) und ungefähr wann', 'Damit lässt sich zeigen, wie sich Einkommen und Absicherung verändern.')] : []),
    rechnungsThema('eigenheim', nachArt('eigenheim'), anlass('eigenheim'), anliegenThemen.has('eigenheim') && nachArt('eigenheim').length === 0 ? [punkt('eigenheim', 'Ungefährer Kaufpreis und Zeitpunkt des Eigenheims', 'Daraus ergeben sich nötige Eigenmittel und Tragbarkeit.')] : []),
    rechnungsThema('pensionierung', nachArt('pensionierung'), anlass('pensionierung')),
  ];

  const anliegen: AnliegenStand[] = profil.anliegen.map(a => {
    const themenIds = ANLIEGEN_THEMEN[a.thema];
    const haupt = a.thema === 'familie' ? (nachArt('familie').length ? nachArt('familie') : nachArt('risiko'))
      : a.thema === 'absicherung' ? nachArt('risiko')
        : a.thema === 'eigenheim' ? nachArt('eigenheim')
          : a.thema === 'pensionierung' || a.thema === 'sparen' ? nachArt('pensionierung') : [];
    const zugehoerig = themen.filter(t => themenIds.includes(t.id));
    const status: AnliegenStand['status'] = haupt.length > 0 && haupt.every(r => r.status === 'berechnet') ? 'ergebnis'
      : zugehoerig.some(t => t.status !== 'offen') ? 'in_klaerung' : 'offen';
    return { id: a.id, text: a.text, thema: a.thema, status, themen: themenIds, rechnungen: haupt.map(r => r.id) };
  });

  return { anliegen, themen, rechnungen, empfehlung: empfehlungsgrundlage(profil, themen, anliegen, rechnungen), menschlicheBeratung: menschlicheBeratung(profil, jahr, rechnungen) };
}

function empfehlungsgrundlage(profil: Profil, themen: Thema[], anliegen: AnliegenStand[], rechnungen: RechnungsStand[]): Empfehlungsgrundlage {
  const thema = (id: ThemaId) => themen.find(t => t.id === id)!;
  const fehlt: string[] = [];
  if (anliegen.length === 0) fehlt.push('Noch kein Anliegen des Haushalts erfasst.');
  for (const a of anliegen) if (a.thema !== 'sonstiges' && a.status !== 'ergebnis') fehlt.push(`Für das Anliegen „${a.text}“ liegt noch kein aktuelles Berechnungsergebnis vor.`);
  for (const id of ['saeule2', 'saeule3', 'absicherung'] as const) if (thema(id).status !== 'geklaert') fehlt.push(`${TITEL[id]}: bestehende Leistungen sind noch nicht bekannt.`);
  if (!profil.haushalt.sparbetrag) fehlt.push('Budget: Der finanzielle Spielraum ist noch nicht bekannt.');

  const personen = erwachsene(profil);
  const vorhandeneLeistungen: string[] = [];
  for (const id of personen) {
    const p = profil.personen[id] ?? {};
    if (p.bvgVersichert?.wert) vorhandeneLeistungen.push(`${personLabel(id)}: Pensionskasse`);
    if (p.saeule3a?.wert) vorhandeneLeistungen.push(`${personLabel(id)}: Säule 3a${p.saeule3aGuthaben ? ` (${chf(p.saeule3aGuthaben.wert)})` : ''}`);
    if (p.todesfallkapital?.wert) vorhandeneLeistungen.push(`${personLabel(id)}: private Todesfallversicherung ${chf(p.todesfallkapital.wert)}`);
    if (p.erwerbsunfaehigkeitsrente?.wert) vorhandeneLeistungen.push(`${personLabel(id)}: private Erwerbsunfähigkeitsrente ${chf(p.erwerbsunfaehigkeitsrente.wert)} pro Jahr`);
  }
  if (profil.haushalt.vermoegen) vorhandeneLeistungen.push(`Ersparnisse ${chf(profil.haushalt.vermoegen.wert)}`);

  return { erlaubt: fehlt.length === 0, fehlt, beduerfnisse: profil.anliegen.map(a => a.text), vorhandeneLeistungen, luecken: luecken(profil, rechnungen) };
}

/** Gaps from current results only, with known private cover subtracted transparently. */
export function luecken(profil: Profil, rechnungen: RechnungsStand[]): Luecke[] {
  const liste: Luecke[] = [];
  for (const r of rechnungen) {
    if (r.status !== 'berechnet' || !r.ergebnis) continue;
    const e = r.ergebnis;
    if (e.art === 'risiko' || e.art === 'familie') {
      // Per person and case the worse of illness and accident counts; listing both adds noise, not information.
      const schlimmste = new Map<string, Szenario>();
      for (const s of e.szenarien) {
        if (s.fehler || !s.person || !s.fall) continue;
        const key = `${s.person}:${s.fall}`;
        const wert = (x: Szenario) => (s.fall === 'tod' ? x.kapitalisierteLuecke ?? 0 : x.luecke ?? 0);
        const bisher = schlimmste.get(key);
        if (!bisher || wert(s) > wert(bisher)) schlimmste.set(key, s);
      }
      for (const s of schlimmste.values()) {
        if (!s.person || !s.fall) continue;
        const p = profil.personen[s.person] ?? {};
        if (s.fall === 'erwerbsunfaehigkeit' && (s.luecke ?? 0) > 0) {
          const privat = p.erwerbsunfaehigkeitsrente?.wert ?? 0;
          const rest = Math.max(0, s.luecke! - privat);
          if (rest > 0) liste.push({ text: `${r.titel} – ${s.szenario.replace(/ durch \S+/, '')}${privat ? ` (nach privater EU-Rente ${chf(privat)})` : ''}`, betrag: rest, einheit: 'pro_jahr', quelle: r.id });
        }
        if (s.fall === 'tod' && (s.kapitalisierteLuecke ?? 0) > 0) {
          const privat = p.todesfallkapital?.wert ?? 0;
          const rest = Math.max(0, s.kapitalisierteLuecke! - privat);
          if (rest > 0) liste.push({ text: `${r.titel} – ${s.szenario.replace(/ durch \S+/, '')}${privat ? ` (nach privatem Todesfallkapital ${chf(privat)})` : ''}`, betrag: rest, einheit: 'kapital', quelle: r.id });
        }
      }
    } else if (e.art === 'pensionierung' && !e.pension.fehler && (e.pension.luecke ?? 0) > 0) {
      liste.push({ text: `${r.titel}: Einkommenslücke im Alter`, betrag: e.pension.luecke!, einheit: 'pro_jahr', quelle: r.id });
    } else if (e.art === 'eigenheim') {
      if (e.eigenheim.eigenmittelLuecke > 0) liste.push({ text: `${r.titel}: fehlende Eigenmittel bis ${e.eigenheim.kaufjahr}`, betrag: e.eigenheim.eigenmittelLuecke, einheit: 'kapital', quelle: r.id });
    }
  }
  return liste;
}

function menschlicheBeratung(profil: Profil, jahr: number, rechnungen: RechnungsStand[]): string[] {
  const gruende: string[] = [];
  for (const id of erwachsene(profil)) {
    const p = profil.personen[id] ?? {};
    if (p.erwerb?.wert === 'selbststaendig') gruende.push(`${personLabel(id)} ist selbstständig: Vorsorge ohne Pensionskasse und Absicherung brauchen eine individuelle Prüfung.`);
    if (p.geburtsjahr && jahr - p.geburtsjahr.wert >= 58) gruende.push(`${personLabel(id)} ist nahe an der Pensionierung: Bezugsform und Steuern brauchen eine persönliche Beratung.`);
  }
  if (profil.kinder.some(k => k.elternteil && k.elternteil.wert !== 'beide') && profil.personen.B) gruende.push('Patchwork-Familie: Ansprüche von Kindern aus früheren Beziehungen brauchen eine persönliche Prüfung.');
  if (profil.haushalt.beziehung?.wert === 'geschieden' && profil.kinder.length > 0) gruende.push('Nach einer Scheidung mit Kindern hängen Leistungen von Vereinbarungen ab, die der Advisor nicht kennt.');
  const grosseLuecke = luecken(profil, rechnungen).some(l => l.einheit === 'kapital' && l.betrag > 1_000_000);
  if (grosseLuecke) gruende.push('Sehr grosse Lücke (über CHF 1 Mio. Kapital): Lösung und Tragbarkeit gehören in eine persönliche Beratung.');
  return gruende;
}

/**
 * Chooses the one open point that matters most next. Order: what the customer just asked for, the most recent
 * concern, basics, the three pillars and existing cover, budget, retirement. Never more than one point.
 */
// Formal inputs (needed by the calculation, not by the conversation) are asked last.
const FORMAL = /^Geschlecht /;

export function waehleFokus(stand: Beratungsstand, wunsch: Wunsch, zuletztGefragt: string | null = null): { punkt: OffenerPunkt; grund: string } | null {
  const thema = (id: ThemaId) => stand.themen.find(t => t.id === id)!;
  const kandidaten: { ids: ThemaId[]; grund: string }[] = [];
  if (wunsch.thema) kandidaten.push({ ids: [WUNSCH_THEMA[wunsch.thema]], grund: `Die Person fragt nach ${TITEL[WUNSCH_THEMA[wunsch.thema]]}; dafür fehlt noch diese Angabe.` });
  if (wunsch.art === 'empfehlung' && !stand.empfehlung.erlaubt) {
    // Only what actually blocks a recommendation: concerns without result, existing provision and budget.
    const ids = [...stand.anliegen.filter(a => a.status !== 'ergebnis').flatMap(a => a.themen), 'saeule2', 'saeule3', 'absicherung', 'budget'] as ThemaId[];
    kandidaten.push({ ids, grund: 'Die Person möchte eine Empfehlung; dafür fehlt noch diese Grundlage.' });
  }
  for (const a of [...stand.anliegen].reverse()) kandidaten.push({ ids: a.themen, grund: `Gehört zum Anliegen „${a.text}“.` });
  kandidaten.push({ ids: ['situation', 'einkommen'], grund: 'Grundlage, um die Situation zu verstehen.' });
  kandidaten.push({ ids: ['saeule2', 'saeule3', 'absicherung'], grund: 'Bestehende Vorsorge und Absicherung gehören zum Gesamtbild, bevor Ergänzungen besprochen werden.' });
  kandidaten.push({ ids: ['risiko', 'budget', 'pensionierung'], grund: 'Rundet das Gesamtbild über alle drei Säulen ab.' });
  // First pass: substantive points that were not just asked. A question the person did not answer is not repeated
  // immediately; it can come back later. Then formal points, and only as a last resort the same question again.
  const durchgaenge: ((p: OffenerPunkt) => boolean)[] = [
    p => !FORMAL.test(p.label) && p.label !== zuletztGefragt,
    p => p.label !== zuletztGefragt,
    () => true,
  ];
  for (const passt of durchgaenge) {
    for (const k of kandidaten) {
      for (const id of k.ids) {
        const offen = thema(id).offen.find(passt);
        if (offen) return { punkt: offen, grund: k.grund };
      }
    }
  }
  return null;
}
