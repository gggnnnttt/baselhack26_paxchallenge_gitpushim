import { assign, createActor, fromPromise, setup, waitFor, type Snapshot } from 'xstate';
import type { Beratungsplan } from './plan.js';
import type { Rechner } from '../berechnung/apicalc.js';
import { fuehreAus, type Gespeichert } from '../berechnung/rechnungen.js';
import { KEIN_WUNSCH, type Wunsch } from '../profil/aenderungen.js';
import { leeresProfil, type Profil } from '../profil/profil.js';
import { bewerteStand, waehleFokus, WUNSCH_THEMA, type Beratungsstand, type OffenerPunkt, type RechnungsStand } from './stand.js';

export type Aktion = 'nachfragen' | 'erklaeren' | 'szenario_zeigen' | 'empfehlung_vorbereiten' | 'beratungsperson';
export const AKTIONEN: readonly Aktion[] = ['nachfragen', 'erklaeren', 'szenario_zeigen', 'empfehlung_vorbereiten', 'beratungsperson'];

/** The step the flow chose for this turn. The model phrases it; it cannot pick a step the guards did not allow. */
export interface Schritt {
  aktion: Aktion;
  quelle: 'planer' | 'fallback';
  frage: string | null;
  begruendung: string;
  fokus: OffenerPunkt | null;
  // Results to present in this turn.
  rechnungen: string[];
  erlaubt: Aktion[];
  nichtErlaubt: { aktion: Beratungsplan['aktion']; grund: string }[];
}

export interface AblaufKontext {
  jahr: number;
  plan: Beratungsplan | null;
  profil: Profil;
  wunsch: Wunsch;
  gespeichert: Record<string, Gespeichert>;
  stand: Beratungsstand;
  // Calculations completed in this turn.
  neu: string[];
  // Focus of the previous turn; not repeated immediately if the person did not answer it.
  zuletztGefragt: string | null;
  schritt: Schritt | null;
}
export type Phase = 'start' | Aktion;
export interface AblaufStand { phase: Phase; kontext: AblaufKontext; snapshot: Snapshot<unknown> }

type AblaufEvent = { type: 'NACHRICHT'; profil: Profil; wunsch: Wunsch; plan: Beratungsplan | null };

const faellig = (stand: Beratungsstand, gespeichert: Record<string, Gespeichert>, mitRechner: boolean): RechnungsStand[] =>
  stand.rechnungen.filter(r => r.pruefung.bereit && (!r.extern || mitRechner) && gespeichert[r.id]?.requestJson !== r.pruefung.requestJson);

/** Re-check references and prerequisites after applying validated profile changes. */
function planFehler(k: AblaufKontext, mitRechner: boolean): string | null {
  const p = k.plan;
  if (!p) return 'Kein Planungsvorschlag.';
  if (k.wunsch.art === 'beratungsperson' && p.aktion !== 'beratungsperson') return 'Der Wunsch nach einer Beratungsperson hat Vorrang.';
  if (p.fokusAnliegen && !k.stand.anliegen.some(a => a.id === p.fokusAnliegen)) return 'Das genannte Anliegen ist nicht bekannt.';
  if (p.aktion === 'nachfragen' && !p.frage?.trim()) return 'Es fehlt eine konkrete Rückfrage.';
  if (p.aktion === 'empfehlung_vorbereiten' && !k.stand.empfehlung.erlaubt) return k.stand.empfehlung.fehlt.join(' ');
  if (p.aktion === 'szenario_berechnen' || p.aktion === 'szenario_zeigen') {
    const r = k.stand.rechnungen.find(r => r.id === p.rechnung);
    if (!r) return 'Die genannte Rechnung ist nicht bekannt.';
    if (p.aktion === 'szenario_zeigen' && r.status !== 'berechnet') return 'Es liegt kein aktuelles Ergebnis dieser Rechnung vor.';
    if (p.aktion === 'szenario_berechnen' && (!r.pruefung.bereit || (r.extern && !mitRechner) || r.status === 'fehlgeschlagen')) return 'Die Berechnung ist unvollständig, nicht verfügbar oder fehlgeschlagen.';
  }
  return null;
}

function ausgewaehlteRechnungen(k: AblaufKontext, mitRechner: boolean): RechnungsStand[] {
  if (k.wunsch.art === 'beratungsperson') return [];
  const offen = faellig(k.stand, k.gespeichert, mitRechner);
  if (!k.plan) return offen; // Deterministic fallback for an abstaining planner.
  if (planFehler(k, mitRechner) || k.plan.aktion !== 'szenario_berechnen') return [];
  return offen.filter(r => r.id === k.plan!.rechnung);
}

function planerSchritt(k: AblaufKontext): Schritt {
  const p = k.plan!;
  const aktion = p.aktion === 'szenario_berechnen' ? 'szenario_zeigen' : p.aktion;
  const rechnungen = aktion === 'szenario_zeigen' ? [p.rechnung!] : aktion === 'empfehlung_vorbereiten'
    ? k.stand.rechnungen.filter(r => r.status === 'berechnet').map(r => r.id) : [];
  const rechte = erlaubteAktionen(k);
  return { aktion, quelle: 'planer', frage: p.frage, begruendung: p.begruendung, fokus: null, rechnungen,
    ...rechte, erlaubt: [...new Set([...rechte.erlaubt, aktion])] };
}

const ART_REIHENFOLGE = ['risiko', 'familie', 'eigenheim', 'pensionierung'];

/**
 * The one result to present in detail this turn: what the customer asked about, else the newest result that belongs
 * to the most recent concern, else today's risk before scenarios. Further new results are only mentioned.
 */
function zuZeigen(k: AblaufKontext): string[] {
  const berechnet = (id: string) => k.stand.rechnungen.find(r => r.id === id)?.status === 'berechnet';
  const gewuenscht = k.wunsch.thema ? (k.stand.themen.find(t => t.id === WUNSCH_THEMA[k.wunsch.thema!])?.rechnungen ?? []).filter(berechnet) : [];
  if (!k.neu.length) return k.wunsch.art === 'szenario' || k.wunsch.art === 'frage' ? gewuenscht.slice(0, 1) : [];
  const anliegen = [...k.stand.anliegen].reverse().flatMap(a => a.rechnungen);
  const rang = (id: string) => (gewuenscht.includes(id) ? 0 : anliegen.includes(id) ? 1 : 2) * 10 + ART_REIHENFOLGE.indexOf(id.split(':')[0]!);
  return [...k.neu].sort((a, b) => rang(a) - rang(b)).slice(0, 1);
}

function erlaubteAktionen(k: AblaufKontext): Pick<Schritt, 'erlaubt' | 'nichtErlaubt'> {
  const nichtErlaubt: Schritt['nichtErlaubt'] = [];
  const erlaubt: Aktion[] = ['erklaeren', 'beratungsperson'];
  if (waehleFokus(k.stand, k.wunsch, k.zuletztGefragt)) erlaubt.push('nachfragen');
  if (k.stand.rechnungen.some(r => r.status === 'berechnet')) erlaubt.push('szenario_zeigen');
  else nichtErlaubt.push({ aktion: 'szenario_zeigen', grund: 'Es liegt noch kein aktuelles Berechnungsergebnis vor.' });
  if (k.stand.empfehlung.erlaubt) erlaubt.push('empfehlung_vorbereiten');
  else nichtErlaubt.push({ aktion: 'empfehlung_vorbereiten', grund: k.stand.empfehlung.fehlt.join(' ') });
  return { erlaubt, nichtErlaubt };
}

function schritt(aktion: Aktion, k: AblaufKontext, mitRechner: boolean): Schritt {
  const fokus = waehleFokus(k.stand, k.wunsch, k.zuletztGefragt);
  const rechnungen = aktion === 'szenario_zeigen' ? zuZeigen(k) : aktion === 'empfehlung_vorbereiten' ? k.stand.rechnungen.filter(r => r.status === 'berechnet').map(r => r.id) : [];
  const titel = rechnungen.map(id => k.stand.rechnungen.find(r => r.id === id)?.titel).filter(Boolean).join(', ');
  const begruendung: Record<Aktion, string> = {
    beratungsperson: 'Die Person möchte mit einem Menschen sprechen.',
    empfehlung_vorbereiten: k.wunsch.art === 'empfehlung'
      ? 'Die Person möchte eine Empfehlung, und Bedürfnisse, bestehende Leistungen und Ergebnisse liegen vor.'
      : 'Alle Anliegen haben ein aktuelles Ergebnis und die bestehende Vorsorge ist bekannt. Eine Empfehlung kann vorbereitet und angeboten werden.',
    szenario_zeigen: k.neu.length
      ? `Neues Ergebnis berechnet: ${titel}.${k.neu.length > 1 ? ` Ebenfalls neu berechnet (nur kurz erwähnen und anbieten): ${k.neu.filter(id => !rechnungen.includes(id)).map(id => k.stand.rechnungen.find(r => r.id === id)?.titel).join(', ')}.` : ''}`
      : `Die Person fragt nach einem bereits berechneten Ergebnis: ${titel}.`,
    erklaeren: k.wunsch.art === 'frage' ? 'Die Person hat eine Frage gestellt; sie wird zuerst beantwortet.' : 'Für die aktuellen Anliegen ist nichts mehr offen.',
    nachfragen: k.wunsch.art === 'empfehlung' && !k.stand.empfehlung.erlaubt
      ? `Für eine Empfehlung fehlt noch Grundlage. ${fokus?.grund ?? ''}`
      : fokus?.grund ?? 'Es fehlt noch eine Angabe.',
  };
  const rechte = erlaubteAktionen(k);
  const ablehnung = k.plan ? planFehler(k, mitRechner) : null;
  return {
    aktion,
    quelle: 'fallback',
    frage: null,
    begruendung: begruendung[aktion],
    // Even when explaining or presenting, one follow-up point may be offered.
    fokus: aktion === 'beratungsperson' ? null : fokus?.punkt ?? null,
    rechnungen,
    ...rechte,
    nichtErlaubt: [...rechte.nichtErlaubt, ...(k.plan && ablehnung ? [{ aktion: k.plan.aktion, grund: ablehnung }] : [])],
  };
}

/**
 * Advisory flow per customer message:
 * bewerten → optional selected calculation → bewerten → validate planner or use deterministic fallback.
 * Guards decide which step is allowed; the model only phrases it.
 */
export function erstelleAblauf(rechner: Rechner | null) {
  const mitRechner = rechner !== null;
  return setup({
    types: { context: {} as AblaufKontext, events: {} as AblaufEvent, input: {} as { jahr: number } },
    actors: {
      rechnen: fromPromise<Record<string, Gespeichert>, RechnungsStand[]>(async ({ input }) => {
        const ergebnisse = await Promise.all(input.map(async (r): Promise<[string, Gespeichert]> => {
          const basis = { requestJson: r.pruefung.requestJson!, zeitpunkt: new Date().toISOString() };
          try {
            return [r.id, { ...basis, ergebnis: await fuehreAus(r, rechner), fehler: null }];
          } catch (error) {
            return [r.id, { ...basis, ergebnis: null, fehler: error instanceof Error ? error.message : 'Die Berechnung ist fehlgeschlagen.' }];
          }
        }));
        return Object.fromEntries(ergebnisse);
      }),
    },
    guards: {
      rechnungFaellig: ({ context }) => ausgewaehlteRechnungen(context, mitRechner).length > 0,
      planErlaubt: ({ context }) => context.plan !== null && planFehler(context, mitRechner) === null,
      beratungspersonGewuenscht: ({ context }) => context.wunsch.art === 'beratungsperson',
      empfehlungGewuenschtUndErlaubt: ({ context }) => context.wunsch.art === 'empfehlung' && context.stand.empfehlung.erlaubt,
      ergebnisZuZeigen: ({ context }) => zuZeigen(context).length > 0,
      frageGestellt: ({ context }) => context.wunsch.art === 'frage',
      offenerPunkt: ({ context }) => waehleFokus(context.stand, context.wunsch, context.zuletztGefragt) !== null,
      empfehlungErlaubt: ({ context }) => context.stand.empfehlung.erlaubt,
    },
  }).createMachine({
    id: 'beratung',
    context: ({ input }) => {
      const profil = leeresProfil();
      return { jahr: input.jahr, plan: null, profil, wunsch: KEIN_WUNSCH, gespeichert: {}, stand: bewerteStand(profil, input.jahr, {}), neu: [], zuletztGefragt: null, schritt: null };
    },
    initial: 'start',
    on: {
      NACHRICHT: {
        target: '.bewerten',
        // Failed calculations may be requested again with the next message.
        actions: assign(({ context, event }) => ({
          profil: event.profil,
          plan: event.plan,
          wunsch: event.wunsch,
          neu: [],
          zuletztGefragt: context.schritt?.fokus?.label ?? null,
          gespeichert: Object.fromEntries(Object.entries(context.gespeichert).filter(([, g]) => g.fehler === null)),
        })),
      },
    },
    states: {
      start: {},
      bewerten: {
        entry: assign(({ context }) => ({ stand: bewerteStand(context.profil, context.jahr, context.gespeichert) })),
        always: [{ guard: 'rechnungFaellig', target: 'rechnen' }, { target: 'entscheiden' }],
      },
      rechnen: {
        invoke: {
          src: 'rechnen',
          input: ({ context }) => ausgewaehlteRechnungen(context, mitRechner),
          onDone: {
            target: 'bewerten',
            actions: assign(({ context, event }) => ({
              gespeichert: { ...context.gespeichert, ...event.output },
              neu: [...context.neu, ...Object.entries(event.output).filter(([, g]) => g.ergebnis !== null).map(([id]) => id)],
            })),
          },
        },
      },
      entscheiden: {
        always: [
          { guard: 'planErlaubt', target: 'geplant' },
          { guard: 'beratungspersonGewuenscht', target: 'beratungsperson' },
          { guard: 'empfehlungGewuenschtUndErlaubt', target: 'empfehlung_vorbereiten' },
          { guard: 'ergebnisZuZeigen', target: 'szenario_zeigen' },
          { guard: 'frageGestellt', target: 'erklaeren' },
          { guard: 'offenerPunkt', target: 'nachfragen' },
          { guard: 'empfehlungErlaubt', target: 'empfehlung_vorbereiten' },
          { target: 'erklaeren' },
        ],
      },
      geplant: { entry: assign(({ context }) => ({ schritt: planerSchritt(context) })) },
      nachfragen: { entry: assign(({ context }) => ({ schritt: schritt('nachfragen', context, mitRechner), plan: null })) },
      erklaeren: { entry: assign(({ context }) => ({ schritt: schritt('erklaeren', context, mitRechner), plan: null })) },
      szenario_zeigen: { entry: assign(({ context }) => ({ schritt: schritt('szenario_zeigen', context, mitRechner), plan: null })) },
      empfehlung_vorbereiten: { entry: assign(({ context }) => ({ schritt: schritt('empfehlung_vorbereiten', context, mitRechner), plan: null })) },
      beratungsperson: { entry: assign(({ context }) => ({ schritt: schritt('beratungsperson', context, mitRechner), plan: null })) },
    },
  });
}

export class Beratungsablauf {
  private readonly maschine;
  constructor(rechner: Rechner | null, private readonly timeoutMs = 25000) {
    this.maschine = erstelleAblauf(rechner);
  }

  start(jahr: number): AblaufStand {
    const actor = createActor(this.maschine, { input: { jahr } });
    actor.start();
    const stand = this.stand(actor);
    actor.stop();
    return stand;
  }

  /** Works on a restored copy; the caller decides whether the returned state is committed. */
  async aktualisiere(vorher: AblaufStand, profil: Profil, wunsch: Wunsch = KEIN_WUNSCH, plan: Beratungsplan | null = null): Promise<AblaufStand> {
    const actor = createActor(this.maschine, { snapshot: vorher.snapshot, input: { jahr: vorher.kontext.jahr } });
    actor.start();
    actor.send({ type: 'NACHRICHT', profil, wunsch, plan });
    try {
      await waitFor(actor, snapshot => snapshot.value === 'geplant' || AKTIONEN.includes(snapshot.value as Aktion), { timeout: this.timeoutMs });
      return this.stand(actor);
    } finally {
      actor.stop();
    }
  }

  private stand(actor: ReturnType<typeof createActor<ReturnType<typeof erstelleAblauf>>>): AblaufStand {
    const snapshot = actor.getSnapshot();
    return { phase: snapshot.context.schritt?.aktion ?? 'start', kontext: snapshot.context, snapshot: actor.getPersistedSnapshot() };
  }
}
