import { Component, DestroyRef, ElementRef, afterRenderEffect, inject, input, viewChild } from '@angular/core';

/**
 * still: static face (older chat messages)
 * idle: breathes and blinks
 * thinking: raises the brow and looks around while a reply is loading
 * talking: opens and closes the mouth after a reply arrived
 */
export type PaxAvatarState = 'still' | 'idle' | 'thinking' | 'talking';

let nextId = 0;

// The P of the Pax logo (design/pax_logo_colour_pos_rgb.svg), lying on its side it forms brow and left eye.
const P =
  'M65.37,141.73V0h60.16c41.8,0,60.16,20.54,60.16,49.17s-18.37,49.17-60.16,49.17h-22.27v43.39h-37.89ZM122.35,69.42c18.22,0,24.58-7.52,24.58-20.25s-6.36-20.25-24.58-20.25h-19.09v40.49h19.09Z';

/**
 * The mouth is a closed shape: upper lip from the left to the right corner, lower lip back.
 * When both lips share one curve it is the smile line of the logo face; a lower lower lip opens it.
 * [left x, left y, right x, right y, upper lip control y, lower lip control y]
 */
type Mouth = [number, number, number, number, number, number];

interface Pose {
  faceY: number;
  faceTilt: number;
  browY: number;
  eyeX: number;
  eyeY: number;
  eyeOpen: number;
  mouth: Mouth;
}

const open = (corner: number, upper: number, lower: number): Mouth => {
  const y = 151 + (corner - 14) / 3;
  return [corner, y, 142 - corner, y, upper, lower];
};
const SMILE = open(14, 198, 198);
const HMM: Mouth = [34, 162, 108, 158, 170, 170];
const TALKING = [SMILE, open(18, 184, 218), open(22, 170, 234), open(18, 190, 210), open(20, 178, 226), open(16, 192, 206)];
const SYLLABLE = 0.2; // seconds per talking mouth shape

const NEUTRAL: Pose = { faceY: 0, faceTilt: 0, browY: 0, eyeX: 0, eyeY: 0, eyeOpen: 1, mouth: SMILE };
const BLEND = 0.45; // seconds to blend from one state into the next

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const wave = (t: number, period: number) => Math.sin((2 * Math.PI * t) / period);

// Eye closes briefly once per period.
function blink(t: number, period: number) {
  const phase = (t % period) / period;
  return 1 - 0.9 * Math.max(0, 1 - Math.abs(phase - 0.93) / 0.03);
}

// Pose of a state, t seconds after the state was entered.
function pose(state: PaxAvatarState, t: number): Pose {
  switch (state) {
    case 'still':
      return NEUTRAL;
    case 'idle':
      return { ...NEUTRAL, faceY: -1.5 + 1.5 * Math.cos((2 * Math.PI * t) / 4), eyeOpen: blink(t + 2, 5) };
    case 'thinking':
      return {
        ...NEUTRAL,
        faceTilt: -1.5 + 1.5 * Math.cos((2 * Math.PI * t) / 2.4),
        browY: -6,
        eyeX: 5 * wave(t, 2.4),
        eyeY: -5 + 2 * wave(t, 1.2),
        mouth: HMM,
      };
    case 'talking': {
      // Index and progress come from the same number, so they always agree at syllable borders.
      const syllables = t / SYLLABLE;
      const i = Math.floor(syllables);
      const from = TALKING[i % TALKING.length];
      const to = TALKING[(i + 1) % TALKING.length];
      const k = ease(syllables - i);
      const mouth = from.map((v, n) => mix(v, to[n], k)) as Mouth;
      // The head nods a little with the open mouth.
      return { ...NEUTRAL, faceY: (SMILE[5] - mouth[5]) / 12, eyeOpen: blink(t + 1, 2.5), mouth };
    }
  }
}

function blendPoses(a: Pose, b: Pose, k: number): Pose {
  return {
    faceY: mix(a.faceY, b.faceY, k),
    faceTilt: mix(a.faceTilt, b.faceTilt, k),
    browY: mix(a.browY, b.browY, k),
    eyeX: mix(a.eyeX, b.eyeX, k),
    eyeY: mix(a.eyeY, b.eyeY, k),
    eyeOpen: mix(a.eyeOpen, b.eyeOpen, k),
    mouth: a.mouth.map((v, n) => mix(v, b.mouth[n], k)) as Mouth,
  };
}

const mouthPath = ([lx, ly, rx, ry, upper, lower]: Mouth) =>
  `M${lx} ${ly} Q71 ${upper} ${rx} ${ry} Q71 ${lower} ${lx} ${ly} Z`;

@Component({
  selector: 'app-pax-avatar',
  templateUrl: './pax-avatar.html',
  styleUrl: './pax-avatar.scss',
})
export class PaxAvatar {
  readonly state = input<PaxAvatarState>('idle');

  protected readonly P = P;
  protected readonly SMILE_PATH = mouthPath(SMILE);
  // Every instance needs its own mask id, several avatars are on the page at once.
  protected readonly maskId = `pax-avatar-mask-${nextId++}`;

  private readonly face = viewChild.required<ElementRef<SVGGElement>>('face');
  private readonly brow = viewChild.required<ElementRef<SVGGElement>>('brow');
  private readonly eye = viewChild.required<ElementRef<SVGRectElement>>('eye');
  private readonly mouth = viewChild.required<ElementRef<SVGPathElement>>('mouth');

  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private current: Pose = NEUTRAL;
  private blendFrom: Pose = NEUTRAL;
  private stateStart = 0;
  private frame = 0;

  constructor() {
    // Runs after rendering, so the SVG elements exist when the first pose is written.
    afterRenderEffect(() => {
      const state = this.state();
      if (state === 'still' && this.current === NEUTRAL) return;
      this.blendFrom = this.current;
      this.stateStart = performance.now();
      if (this.reducedMotion) this.render(pose(state, 0));
      else if (!this.frame) this.frame = requestAnimationFrame(this.tick);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private readonly tick = (now: number) => {
    const t = Math.max(0, now - this.stateStart) / 1000;
    const k = Math.min(1, t / BLEND);
    this.render(blendPoses(this.blendFrom, pose(this.state(), t), ease(k)));
    // A still face needs no more frames once the blend is done.
    this.frame = this.state() === 'still' && k === 1 ? 0 : requestAnimationFrame(this.tick);
  };

  private render(p: Pose) {
    this.current = p;
    this.face().nativeElement.setAttribute('transform', `translate(0 ${p.faceY}) rotate(${p.faceTilt} 71 93)`);
    this.brow().nativeElement.setAttribute('transform', `translate(0 ${p.browY})`);
    this.eye().nativeElement.setAttribute(
      'transform',
      `translate(${p.eyeX + 120.5} ${p.eyeY + 80.5}) scale(1 ${p.eyeOpen}) translate(-120.5 -80.5)`,
    );
    this.mouth().nativeElement.setAttribute('d', mouthPath(p.mouth));
  }
}
