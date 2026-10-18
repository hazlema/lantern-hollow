// First-game guided tour: dims the screen, spotlights one control at a time and
// explains it in a little speech bubble with an arrow.
import { audio } from '../audio';
import { h } from './dom';

export interface TourStep {
  /** Screen rect to spotlight, or null for a centred message. Re-evaluated every frame. */
  target: () => DOMRect | null;
  title: string;
  text: string;
}

const PAD = 10;

export class Tour {
  readonly el: HTMLDivElement;
  private spot: HTMLDivElement;
  private bubble: HTMLDivElement;
  private arrow: HTMLDivElement;
  private titleEl: HTMLElement;
  private textEl: HTMLElement;
  private dots: HTMLElement;
  private nextBtn: HTMLButtonElement;
  private steps: TourStep[] = [];
  private i = 0;
  private raf = 0;
  private onDone: () => void = () => {};
  active = false;

  constructor(root: HTMLElement) {
    this.spot = h('div', { class: 'spot' });
    this.arrow = h('div', { class: 'arrow' });
    this.titleEl = h('h4');
    this.textEl = h('p');
    this.dots = h('div', { class: 'dots' });
    this.nextBtn = h('button', { class: 'btn green', text: 'Next', on: { click: () => this.next() } });
    const skip = h('button', { class: 'skip', text: 'Skip tour', on: { click: () => this.finish() } });
    this.bubble = h('div', { class: 'bubble panel' }, this.titleEl, this.textEl, h('div', { class: 'row' }, this.dots, skip, this.nextBtn));
    this.el = h('div', { class: 'tour hide interactive' }, this.spot, this.bubble, this.arrow);
    root.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); this.next(); }
      else if (e.key === 'Escape') { e.stopImmediatePropagation(); this.finish(); }
    }, true);
  }

  start(steps: TourStep[], onDone: () => void) {
    this.steps = steps;
    this.onDone = onDone;
    this.i = 0;
    this.active = true;
    this.el.classList.remove('hide');
    this.dots.innerHTML = '';
    steps.forEach(() => this.dots.append(h('i')));
    this.show();
    const loop = () => { if (!this.active) return; this.layout(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  private show() {
    const s = this.steps[this.i];
    this.titleEl.textContent = s.title;
    this.textEl.innerHTML = s.text;
    this.nextBtn.textContent = this.i === this.steps.length - 1 ? "Let's go!" : 'Next';
    [...this.dots.children].forEach((d, k) => d.classList.toggle('on', k === this.i));
    this.bubble.classList.remove('pop'); void this.bubble.offsetWidth; this.bubble.classList.add('pop');
    this.layout();
  }

  private next() {
    audio.play('ui_page', { volume: 0.6 });
    if (this.i >= this.steps.length - 1) { this.finish(); return; }
    this.i++;
    this.show();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.el.classList.add('hide');
    audio.play('ui_close');
    this.onDone();
  }

  private layout() {
    const r = this.steps[this.i].target();
    const W = window.innerWidth, H = window.innerHeight;
    const bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    if (!r) {
      Object.assign(this.spot.style, { left: `${W / 2}px`, top: `${H / 2}px`, width: '0px', height: '0px', opacity: '1' });
      Object.assign(this.bubble.style, { left: `${(W - bw) / 2}px`, top: `${(H - bh) / 2}px` });
      this.arrow.style.display = 'none';
      return;
    }
    Object.assign(this.spot.style, {
      left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px`, opacity: '1',
    });
    // put the bubble on whichever side has the most room
    const room = { below: H - r.bottom, above: r.top, left: r.left, right: W - r.right };
    const side = (Object.entries(room) as [keyof typeof room, number][]).sort((a, b) => b[1] - a[1])[0][0];
    const gap = PAD + 22;
    let x: number, y: number;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (side === 'below') { x = cx - bw / 2; y = r.bottom + gap; }
    else if (side === 'above') { x = cx - bw / 2; y = r.top - gap - bh; }
    else if (side === 'left') { x = r.left - gap - bw; y = cy - bh / 2; }
    else { x = r.right + gap; y = cy - bh / 2; }
    x = Math.max(12, Math.min(W - bw - 12, x));
    y = Math.max(12, Math.min(H - bh - 12, y));
    Object.assign(this.bubble.style, { left: `${x}px`, top: `${y}px` });
    // arrow sits on the bubble edge facing the target
    const a = this.arrow.style;
    a.display = '';
    this.arrow.className = `arrow ${side}`;
    if (side === 'below') { a.left = `${Math.max(x + 20, Math.min(x + bw - 44, cx - 12))}px`; a.top = `${y - 12}px`; }
    else if (side === 'above') { a.left = `${Math.max(x + 20, Math.min(x + bw - 44, cx - 12))}px`; a.top = `${y + bh - 12}px`; }
    else if (side === 'left') { a.left = `${x + bw - 12}px`; a.top = `${Math.max(y + 16, Math.min(y + bh - 40, cy - 12))}px`; }
    else { a.left = `${x - 12}px`; a.top = `${Math.max(y + 16, Math.min(y + bh - 40, cy - 12))}px`; }
  }
}
