import { assign, createActor, fromPromise, setup, waitFor, type Snapshot } from 'xstate';
import type { RisikoRechner } from '../berechnung/apicalc.js';
import { pruefeRisiko, type RiskRequest, type RiskResponse, type RisikoPruefung } from '../berechnung/risiko.js';
import { leeresProfil, type Profil } from '../profil/profil.js';

export interface Berechnung { requestJson: string; antwort: RiskResponse; zeitpunkt: string }
export interface AblaufKontext { jahr: number; profil: Profil; pruefung: RisikoPruefung; berechnung: Berechnung | null; fehler: string | null }
export type Phase = 'erfassung' | 'bereit' | 'berechnung' | 'berechnet' | 'fehlgeschlagen';
export interface AblaufStand { phase: Phase; kontext: AblaufKontext; snapshot: Snapshot<unknown> }

type AblaufEvent = { type: 'PROFIL_AKTUALISIERT'; profil: Profil };

/**
 * Advisory flow. While inputs for the risk calculation are missing the flow stays in `erfassung`
 * (the questioning loop); every accepted profile change re-checks the inputs. Once complete it calculates,
 * and later changes either keep the current result, recalculate, or return to `erfassung` (result outdated).
 */
export function erstelleAblauf(rechner: RisikoRechner | null) {
  return setup({
    types: { context: {} as AblaufKontext, events: {} as AblaufEvent, input: {} as { jahr: number } },
    actors: {
      risikoBerechnen: fromPromise<RiskResponse, RiskRequest>(({ input }) => rechner ? rechner.berechneRisiko(input) : Promise.reject(new Error('APICalc ist nicht konfiguriert.'))),
    },
    guards: {
      unvollstaendig: ({ context }) => !context.pruefung.bereit,
      ergebnisAktuell: ({ context }) => context.berechnung !== null && context.berechnung.requestJson === context.pruefung.requestJson,
      ohneRechner: () => rechner === null,
    },
  }).createMachine({
    id: 'beratung',
    context: ({ input }) => {
      const profil = leeresProfil();
      return { jahr: input.jahr, profil, pruefung: pruefeRisiko(profil, input.jahr), berechnung: null, fehler: null };
    },
    initial: 'erfassung',
    on: {
      PROFIL_AKTUALISIERT: {
        target: '.pruefen',
        actions: assign(({ context, event }) => ({ profil: event.profil, pruefung: pruefeRisiko(event.profil, context.jahr) })),
      },
    },
    states: {
      erfassung: {},
      pruefen: {
        always: [
          { guard: 'unvollstaendig', target: 'erfassung' },
          { guard: 'ergebnisAktuell', target: 'berechnet' },
          { guard: 'ohneRechner', target: 'bereit' },
          { target: 'berechnung' },
        ],
      },
      bereit: {},
      berechnung: {
        entry: assign({ fehler: null }),
        invoke: {
          src: 'risikoBerechnen',
          input: ({ context }) => context.pruefung.request!,
          onDone: {
            target: 'berechnet',
            actions: assign(({ context, event }) => ({ berechnung: { requestJson: context.pruefung.requestJson!, antwort: event.output, zeitpunkt: new Date().toISOString() } })),
          },
          onError: {
            target: 'fehlgeschlagen',
            actions: assign(({ event }) => ({ fehler: event.error instanceof Error ? event.error.message : 'Die Risikoberechnung ist fehlgeschlagen.' })),
          },
        },
      },
      berechnet: {},
      fehlgeschlagen: {},
    },
  });
}

export class Beratungsablauf {
  private readonly maschine;
  constructor(rechner: RisikoRechner | null, private readonly timeoutMs = 20000) {
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
  async aktualisiere(vorher: AblaufStand, profil: Profil): Promise<AblaufStand> {
    const actor = createActor(this.maschine, { snapshot: vorher.snapshot, input: { jahr: vorher.kontext.jahr } });
    actor.start();
    actor.send({ type: 'PROFIL_AKTUALISIERT', profil });
    try {
      await waitFor(actor, snapshot => !snapshot.matches('berechnung'), { timeout: this.timeoutMs });
      return this.stand(actor);
    } finally {
      actor.stop();
    }
  }

  private stand(actor: ReturnType<typeof createActor<ReturnType<typeof erstelleAblauf>>>): AblaufStand {
    const snapshot = actor.getSnapshot();
    return { phase: snapshot.value as Phase, kontext: snapshot.context, snapshot: actor.getPersistedSnapshot() };
  }
}
