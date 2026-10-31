import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Beratungsstand } from '../beratungsstand/beratungsstand.model';
import { PlanEditor } from './plan-editor';
import { PERSONEN, PLANARTEN, zuSpeichern, type Plan, type PlanArt, type PlanPerson, type ZeitstrahlAktion } from './zeitstrahl.model';

const PX_PRO_JAHR = 72;
const CHIP_BREITE = 168;
// From the chip's left edge to the centre of its icon (border + padding + half icon), the point that marks the date.
const ICON_MITTE = 20;
const PENSIONSALTER = 65;
const PAAR = new Set(['verheiratet', 'eingetragene_partnerschaft', 'konkubinat']);

interface Spur { id: PlanPerson; label: string; geburtsjahr?: number }
// A plan as shown: with the position the customer just dragged it to, until the backend confirmed it.
interface Eintrag { plan: Plan; person: PlanPerson; jahr: number | null; monat: number | null; wartet: boolean }
interface Ziel { person: PlanPerson; jahr: number | null }
interface Ziehen { eintrag: Eintrag; startX: number; startY: number; x: number; y: number; offsetX: number; offsetY: number; bewegt: boolean; ziel: Ziel | null }

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
  protected readonly PX_PRO_JAHR = PX_PRO_JAHR;
  protected readonly CHIP_BREITE = CHIP_BREITE;
  protected readonly ICON_MITTE = ICON_MITTE;
  protected readonly heute = new Date().getFullYear();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly editor = viewChild.required(PlanEditor);
  private readonly achse = viewChild.required<ElementRef<HTMLElement>>('achse');
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  private readonly vorschau = signal(new Map<string, Ziel & { monat: number | null }>());
  protected readonly ziehen = signal<Ziehen | null>(null);
  protected readonly neu = signal(new Set<string>());
  private bekannt = new Set<string>();
  private klickIgnorieren = false;

  protected readonly eintraege = computed<Eintrag[]>(() => (this.stand()?.profil.plaene ?? []).map(plan => {
    const v = this.vorschau().get(plan.id);
    return v
      ? { plan, person: v.person, jahr: v.jahr, monat: v.monat, wartet: true }
      : { plan, person: plan.person, jahr: plan.zeitpunkt?.wert.jahr ?? null, monat: plan.zeitpunkt?.wert.monat ?? null, wartet: false };
  }));

  protected readonly spuren = computed<Spur[]>(() => {
    const profil = this.stand()?.profil;
    const paar = PAAR.has(profil?.haushalt.beziehung?.wert ?? '') || !!profil?.personen.B || this.eintraege().some(e => e.person === 'B');
    return [
      { id: 'A', label: PERSONEN.A, geburtsjahr: profil?.personen.A.geburtsjahr?.wert },
      ...(paar ? [{ id: 'B' as const, label: PERSONEN.B, geburtsjahr: profil?.personen.B?.geburtsjahr?.wert }] : []),
      { id: 'haushalt', label: PERSONEN.haushalt },
    ];
  });

  // At least 15 years, long enough for every plan and retirement, at most 45 years.
  protected readonly jahre = computed(() => {
    const ende = Math.max(
      this.heute + 15,
      ...this.eintraege().map(e => (e.jahr ?? 0) + 3),
      ...this.spuren().map(s => (s.geburtsjahr ? s.geburtsjahr + PENSIONSALTER + 2 : 0)),
    );
    return Array.from({ length: Math.min(ende, this.heute + 45) - this.heute + 1 }, (_, i) => this.heute + i);
  });

  // Plans of one lane in rows, so that chips close in time do not overlap.
  protected readonly zeilen = computed(() => this.spuren().map(spur => {
    const reihenEnde: number[] = [];
    const chips = this.eintraege()
      .filter(e => e.person === spur.id && e.jahr !== null)
      .map(e => ({ ...e, x: this.x(e.jahr!, e.monat) }))
      .sort((a, b) => a.x - b.x)
      .map(e => {
        let reihe = reihenEnde.findIndex(ende => e.x - ICON_MITTE >= ende + 6);
        if (reihe < 0) reihe = reihenEnde.push(0) - 1;
        reihenEnde[reihe] = e.x - ICON_MITTE + CHIP_BREITE;
        return { ...e, reihe };
      });
    const pension = spur.geburtsjahr ? spur.geburtsjahr + PENSIONSALTER : null;
    return {
      spur,
      chips,
      reihen: Math.max(1, reihenEnde.length),
      pension: pension !== null && pension >= this.heute && pension <= this.jahre().at(-1)! ? { jahr: pension, x: this.x(pension, null) } : null,
    };
  }));

  protected readonly ohneDatum = computed(() => this.eintraege().filter(e => e.jahr === null));
  protected readonly personen = computed(() => this.spuren().map(s => s.id));

  constructor() {
    // The backend answered everything: show its positions instead of the previews.
    effect(() => {
      if (this.ausstehend() === 0) this.vorschau.set(new Map());
    });
    // Plans that are new in the profile, e.g. from the chat, pop up and are scrolled into view.
    effect(() => {
      const ids = (this.stand()?.profil.plaene ?? []).map(p => p.id);
      const neue = ids.filter(id => !this.bekannt.has(id));
      this.bekannt = new Set(ids);
      if (!neue.length) return;
      this.neu.set(new Set(neue));
      // Scroll only the timeline sideways; moving the whole page would pull the chat away.
      setTimeout(() => {
        const chip = this.host.nativeElement.querySelector<HTMLElement>(`[data-plan="${neue[0]}"]`);
        const scroller = this.scroller().nativeElement;
        if (!chip || !scroller.contains(chip)) return;
        const versatz = chip.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
        scroller.scrollTo({ left: scroller.scrollLeft + versatz - scroller.clientWidth / 2, behavior: 'smooth' });
      });
      setTimeout(() => this.neu.set(new Set()), 2500);
    });
  }

  protected x(jahr: number, monat: number | null): number {
    return (jahr - this.heute + (monat ? (monat - 0.5) / 12 : 0.5)) * PX_PRO_JAHR;
  }

  protected alter(person: PlanPerson, jahr: number): string {
    const geburtsjahr = this.spuren().find(s => s.id === person)?.geburtsjahr;
    if (!geburtsjahr || person === 'haushalt') return '';
    return person === 'A' ? `du bist dann ${jahr - geburtsjahr}` : `Partner/in ist dann ${jahr - geburtsjahr}`;
  }

  protected chipTitel(e: Eintrag): string {
    const wann = e.jahr === null ? 'ohne Datum' : [e.monat ? `${String(e.monat).padStart(2, '0')}/${e.jahr}` : e.jahr, this.alter(e.person, e.jahr)].filter(Boolean).join(', ');
    return `${e.plan.beschreibung} (${PLANARTEN[e.plan.art as PlanArt]?.label ?? e.plan.art}, ${wann})${e.plan.notiz ? `\nNotiz: ${e.plan.notiz}` : ''}`;
  }

  protected icon(e: Eintrag): string {
    return (PLANARTEN[e.plan.art as PlanArt] ?? PLANARTEN.sonstiges).icon;
  }

  protected neuerPlan(person: PlanPerson = 'haushalt', jahr: number | null = this.heute + 1) {
    const art: PlanArt = person === 'haushalt' ? 'wohneigentum' : 'wiedereinstieg';
    this.editor().oeffnen({ typ: 'speichern', plan: null, art, person, beschreibung: PLANARTEN[art].vorschlag, jahr, monat: null, notiz: '' });
  }

  // A click into an empty spot of a lane adds a plan in that year.
  protected spurKlick(event: MouseEvent, person: PlanPerson) {
    if (event.target !== event.currentTarget) return;
    this.neuerPlan(person, this.jahrBei(event.clientX));
  }

  protected bearbeiten(e: Eintrag) {
    if (this.klickIgnorieren) return;
    this.editor().oeffnen(zuSpeichern(e.plan, { person: e.person, jahr: e.jahr, monat: e.monat }));
  }

  // Keyboard alternative to dragging: arrow keys move a dated plan by one year.
  protected taste(event: KeyboardEvent, e: Eintrag) {
    const schritt = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!schritt || e.jahr === null) return;
    event.preventDefault();
    const jahr = Math.min(this.heute + 70, Math.max(this.heute, e.jahr + schritt));
    this.verschieben(e, { person: e.person, jahr });
  }

  protected druecken(event: PointerEvent, e: Eintrag) {
    if (event.button !== 0) return;
    const chip = event.currentTarget as HTMLElement;
    chip.setPointerCapture(event.pointerId);
    const rect = chip.getBoundingClientRect();
    this.ziehen.set({
      eintrag: e, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, bewegt: false, ziel: null,
    });
  }

  protected bewegen(event: PointerEvent) {
    const z = this.ziehen();
    if (!z) return;
    const bewegt = z.bewegt || Math.hypot(event.clientX - z.startX, event.clientY - z.startY) > 5;
    if (bewegt) this.amRandScrollen(event.clientX);
    // The lane follows the pointer, the year follows the chip's icon, which marks the date like on the track.
    const iconX = event.clientX - z.offsetX + ICON_MITTE;
    this.ziehen.set({ ...z, x: event.clientX, y: event.clientY, bewegt, ziel: bewegt ? this.zielBei(event.clientX, event.clientY, iconX) : null });
  }

  protected loslassen() {
    const z = this.ziehen();
    this.ziehen.set(null);
    if (!z?.bewegt) return;
    // The click that follows the drag must not open the editor.
    this.klickIgnorieren = true;
    setTimeout(() => (this.klickIgnorieren = false));
    if (z.ziel) this.verschieben(z.eintrag, z.ziel);
  }

  protected abbrechen() {
    this.ziehen.set(null);
  }

  private verschieben(e: Eintrag, ziel: Ziel) {
    if (ziel.person === e.person && ziel.jahr === e.jahr) return;
    // Dropping on a year snaps to the year; the month is kept only within the same year.
    const monat = ziel.jahr === e.jahr ? e.monat : null;
    this.vorschau.update(m => new Map(m).set(e.plan.id, { ...ziel, monat }));
    this.aktion.emit(zuSpeichern(e.plan, { person: ziel.person, jahr: ziel.jahr, monat }));
  }

  private jahrBei(clientX: number): number {
    const links = this.achse().nativeElement.getBoundingClientRect().left;
    return Math.min(this.jahre().at(-1)!, Math.max(this.heute, this.heute + Math.floor((clientX - links) / PX_PRO_JAHR)));
  }

  private zielBei(clientX: number, clientY: number, iconX: number): Ziel | null {
    for (const el of this.host.nativeElement.querySelectorAll<HTMLElement>('[data-spur]')) {
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      const spur = el.dataset['spur']!;
      if (spur === 'ohne') return { person: this.ziehen()!.eintrag.person, jahr: null };
      return { person: spur as PlanPerson, jahr: this.jahrBei(iconX) };
    }
    return null;
  }

  private amRandScrollen(clientX: number) {
    const scroller = this.scroller().nativeElement;
    const r = scroller.getBoundingClientRect();
    const label = this.achse().nativeElement.getBoundingClientRect().left - r.left + scroller.scrollLeft;
    if (clientX < r.left + label + 40) scroller.scrollLeft -= 12;
    else if (clientX > r.right - 40) scroller.scrollLeft += 12;
  }
}
