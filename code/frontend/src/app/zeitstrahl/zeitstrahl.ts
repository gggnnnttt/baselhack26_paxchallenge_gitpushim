import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { PlanEditor } from './plan-editor';
import { PERSONEN, PLANARTEN, zuSpeichern, type Plan, type PlanArt, type PlanPerson, type PlanSpeichern, type ZeitstrahlAktion } from './zeitstrahl.model';

const PENSIONSALTER = 65;
const PAAR = new Set(['verheiratet', 'eingetragene_partnerschaft', 'konkubinat']);

// A plan as shown: with the change the customer just made (moved, edited, added, removed), until the backend confirmed it.
// Every change that waits for Pax blinks the same way. A new plan is shown as a draft until it exists in the profile.
// `entwurf`: not (or no longer) a plan in the profile, so it cannot be moved or edited.
interface Eintrag { plan: Plan; jahr: number | null; monat: number | null; wartet: boolean; entwurf: boolean }
type Vorschau = { jahr: number | null; monat: number | null; aenderung?: PlanSpeichern; entfernt?: boolean };
interface Ziehen { eintrag: Eintrag; startY: number; x: number; y: number; offsetX: number; offsetY: number; bewegt: boolean; ziel: { jahr: number | null } | null }

/**
 * The customer's plans as a path through the years, top to bottom: today first, retirement further down.
 * Plans are dragged to another year; who a plan is for is shown on it and changed in the editor.
 */
@Component({
  selector: 'app-zeitstrahl',
  imports: [NgTemplateOutlet, PlanEditor],
  templateUrl: './zeitstrahl.html',
  styleUrl: './zeitstrahl.scss',
})
export class Zeitstrahl {
  readonly stand = input<Beratungsstand | null>(null);
  // Actions sent or queued but not answered yet.
  readonly ausstehend = input(0);
  readonly aktion = output<ZeitstrahlAktion>();

  protected readonly PLANARTEN = PLANARTEN;
  protected readonly heute = new Date().getFullYear();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly editor = viewChild.required(PlanEditor);

  private readonly vorschau = signal(new Map<string, Vorschau>());
  private readonly entwuerfe = signal<Eintrag[]>([]);
  private entwurfNr = 0;
  // Descriptions of drafts not yet confirmed: their plan settles in without the pop-up meant for plans from the chat.
  private erwartet: string[] = [];
  protected readonly ziehen = signal<Ziehen | null>(null);
  protected readonly neu = signal(new Set<string>());
  private bekannt = new Set<string>();
  private klickIgnorieren = false;

  protected readonly eintraege = computed<Eintrag[]>(() => [
    ...(this.stand()?.profil.plaene ?? []).map(plan => {
      const v = this.vorschau().get(plan.id);
      if (!v) return { plan, jahr: plan.zeitpunkt?.wert.jahr ?? null, monat: plan.zeitpunkt?.wert.monat ?? null, wartet: false, entwurf: false };
      const a = v.aenderung;
      const gezeigt = a ? ({ ...plan, art: a.art, person: a.person, beschreibung: a.beschreibung, notiz: a.notiz || undefined } as Plan) : plan;
      // A plan being removed stays in place, blinking, and can no longer be moved or edited.
      return { plan: gezeigt, jahr: v.jahr, monat: v.monat, wartet: true, entwurf: !!v.entfernt };
    }),
    ...this.entwuerfe(),
  ]);

  private readonly geburtsjahre = computed(() => {
    const p = this.stand()?.profil.personen;
    return { A: p?.A.geburtsjahr?.wert, B: p?.B?.geburtsjahr?.wert };
  });

  protected readonly personen = computed<PlanPerson[]>(() => {
    const profil = this.stand()?.profil;
    const paar = PAAR.has(profil?.haushalt.beziehung?.wert ?? '') || !!profil?.personen.B || this.eintraege().some(e => e.plan.person === 'B');
    return paar ? ['A', 'B', 'haushalt'] : ['A', 'haushalt'];
  });

  // At least 15 years, long enough for every plan and retirement, at most 45 years.
  protected readonly jahre = computed(() => {
    const { A, B } = this.geburtsjahre();
    const ende = Math.max(
      this.heute + 15,
      ...this.eintraege().map(e => (e.jahr ?? 0) + 2),
      ...[A, B].map(g => (g ? g + PENSIONSALTER + 1 : 0)),
    );
    return Array.from({ length: Math.min(ende, this.heute + 45) - this.heute + 1 }, (_, i) => {
      const jahr = this.heute + i;
      return {
        jahr,
        alter: A ? `mit ${jahr - A}` : '',
        pensionen: [A && A + PENSIONSALTER === jahr ? 'Sie' : null, B && B + PENSIONSALTER === jahr ? 'Partner/in' : null].filter(Boolean) as string[],
        eintraege: this.eintraege().filter(e => e.jahr === jahr).sort((x, y) => (x.monat ?? 6.5) - (y.monat ?? 6.5)),
      };
    });
  });

  protected readonly ohneDatum = computed(() => this.eintraege().filter(e => e.jahr === null));

  constructor() {
    // The backend answered everything: show its plans instead of the previews and drafts.
    effect(() => {
      if (this.ausstehend() !== 0) return;
      this.vorschau.set(new Map());
      this.entwuerfe.set([]);
    });
    // Plans that are new in the profile are scrolled into view. Those from the chat pop up;
    // those the customer just added already blinked as a draft and simply take its place.
    effect(() => {
      const plaene = this.stand()?.profil.plaene ?? [];
      const neue = plaene.filter(p => !this.bekannt.has(p.id));
      this.bekannt = new Set(plaene.map(p => p.id));
      const ploppen = neue.filter(p => {
        const i = this.erwartet.indexOf(p.beschreibung);
        if (i === -1) return true;
        this.erwartet.splice(i, 1);
        return false;
      }).map(p => p.id);
      // Nothing waits any more: drafts Pax did not take over must not hide a later plan from the chat.
      if (untracked(this.ausstehend) === 0) this.erwartet = [];
      if (!neue.length) return;
      setTimeout(() => this.zeigen(neue[0].id));
      if (!ploppen.length) return;
      this.neu.set(new Set(ploppen));
      setTimeout(() => this.neu.set(new Set()), 2500);
    });
  }

  protected wann(e: Eintrag): string {
    if (e.jahr === null) return 'ohne Datum';
    return e.monat ? `${String(e.monat).padStart(2, '0')}/${e.jahr}` : String(e.jahr);
  }

  // Who the plan is for, and the month if one is known.
  protected fuer(e: Eintrag): string {
    return `${PERSONEN[e.plan.person]}${e.monat ? `, ${this.wann(e)}` : ''}`;
  }

  protected titel(e: Eintrag): string {
    const art = PLANARTEN[e.plan.art as PlanArt]?.label ?? e.plan.art;
    return `${e.plan.beschreibung} (${art}, ${PERSONEN[e.plan.person]}, ${this.wann(e)})${e.plan.notiz ? `\nNotiz: ${e.plan.notiz}` : ''}`;
  }

  protected icon(e: Eintrag): string {
    return (PLANARTEN[e.plan.art as PlanArt] ?? PLANARTEN.sonstiges).icon;
  }

  protected zielText(jahr: number | null): string {
    if (jahr === null) return 'ohne Datum';
    const a = this.geburtsjahre().A;
    return a ? `${jahr}, Sie sind dann ${jahr - a}` : String(jahr);
  }

  protected neuerPlan(jahr: number | null = this.heute + 1) {
    const art: PlanArt = 'wohneigentum';
    this.editor().oeffnen({ typ: 'speichern', plan: null, art, person: 'haushalt', beschreibung: PLANARTEN[art].vorschlag, jahr, monat: null, notiz: '' });
  }

  // A click into the empty part of a year adds a plan in that year.
  protected jahrKlick(event: MouseEvent, jahr: number) {
    if ((event.target as HTMLElement).closest('.plan')) return;
    this.neuerPlan(jahr);
  }

  // Changes from the editor show at once and blink until Pax has taken them in, like a dragged plan.
  protected ausEditor(a: ZeitstrahlAktion) {
    if (a.typ === 'entfernen') {
      const e = this.eintraege().find(x => x.plan.id === a.plan);
      if (e) this.vorschau.update(m => new Map(m).set(a.plan, { jahr: e.jahr, monat: e.monat, entfernt: true }));
    } else if (a.plan) {
      this.vorschau.update(m => new Map(m).set(a.plan!, { jahr: a.jahr, monat: a.monat, aenderung: a }));
    } else {
      const plan = { id: `entwurf-${++this.entwurfNr}`, art: a.art, person: a.person, beschreibung: a.beschreibung, notiz: a.notiz || undefined } as Plan;
      this.entwuerfe.update(l => [...l, { plan, jahr: a.jahr, monat: a.monat, wartet: true, entwurf: true }]);
      this.erwartet = [...this.erwartet.slice(-9), a.beschreibung];
      setTimeout(() => this.zeigen(plan.id));
    }
    this.aktion.emit(a);
  }

  protected bearbeiten(e: Eintrag) {
    // A draft or a change on its way cannot be edited until Pax has answered.
    if (this.klickIgnorieren || e.entwurf) return;
    this.editor().oeffnen(zuSpeichern(e.plan, { jahr: e.jahr, monat: e.monat }));
  }

  // Keyboard alternative to dragging: arrow keys move a dated plan by one year.
  protected taste(event: KeyboardEvent, e: Eintrag) {
    const schritt = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!schritt || e.jahr === null || e.entwurf) return;
    event.preventDefault();
    this.verschieben(e, Math.min(this.heute + 70, Math.max(this.heute, e.jahr + schritt)));
  }

  protected druecken(event: PointerEvent, e: Eintrag) {
    if (event.button !== 0 || e.entwurf) return;
    const karte = event.currentTarget as HTMLElement;
    karte.setPointerCapture(event.pointerId);
    const rect = karte.getBoundingClientRect();
    this.ziehen.set({ eintrag: e, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, bewegt: false, ziel: null });
  }

  protected bewegen(event: PointerEvent) {
    const z = this.ziehen();
    if (!z) return;
    const bewegt = z.bewegt || Math.abs(event.clientY - z.startY) > 5 || Math.abs(event.clientX - z.x) > 5;
    if (bewegt) this.amRandScrollen(event.clientY);
    this.ziehen.set({ ...z, x: event.clientX, y: event.clientY, bewegt, ziel: bewegt ? this.zielBei(event.clientY) : null });
  }

  protected loslassen() {
    const z = this.ziehen();
    this.ziehen.set(null);
    if (!z?.bewegt) return;
    // The click that follows the drag must not open the editor.
    this.klickIgnorieren = true;
    setTimeout(() => (this.klickIgnorieren = false));
    if (z.ziel) this.verschieben(z.eintrag, z.ziel.jahr);
  }

  protected abbrechen() {
    this.ziehen.set(null);
  }

  private verschieben(e: Eintrag, jahr: number | null) {
    if (jahr === e.jahr) return;
    const bisher = this.vorschau().get(e.plan.id);
    this.vorschau.update(m => new Map(m).set(e.plan.id, { ...bisher, jahr, monat: null }));
    this.aktion.emit(zuSpeichern(e.plan, { jahr, monat: null }));
  }

  // The year row (or the "no date" tray) at the height of the pointer.
  private zielBei(clientY: number): { jahr: number | null } | null {
    for (const el of this.host.nativeElement.querySelectorAll<HTMLElement>('[data-jahr], [data-ohne-datum]')) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return { jahr: el.dataset['jahr'] ? Number(el.dataset['jahr']) : null };
    }
    return null;
  }

  private scrollbereich(): HTMLElement | null {
    return this.host.nativeElement.closest<HTMLElement>('[data-scrollbereich]');
  }

  private amRandScrollen(clientY: number) {
    const bereich = this.scrollbereich();
    if (!bereich) return;
    const r = bereich.getBoundingClientRect();
    if (clientY < r.top + 48) bereich.scrollTop -= 14;
    else if (clientY > r.bottom - 48) bereich.scrollTop += 14;
  }

  // Scrolls only the sidebar, never the conversation.
  private zeigen(id: string) {
    const bereich = this.scrollbereich();
    const karte = this.host.nativeElement.querySelector<HTMLElement>(`[data-plan="${id}"]`);
    if (!bereich || !karte) return;
    const versatz = karte.getBoundingClientRect().top - bereich.getBoundingClientRect().top;
    bereich.scrollTo({ top: bereich.scrollTop + versatz - bereich.clientHeight / 3, behavior: 'smooth' });
  }
}
