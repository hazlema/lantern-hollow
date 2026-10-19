// The trophy room: a wooden cabinet of everything you've earned across every game,
// plus the gold "Trophy unlocked!" card that slides in when you earn one.
import { audio } from '../audio';
import { SHELVES, TROPHIES, TROPHY_BY_ID, type TrophyId } from '../data/trophies';
import { h, ico } from './dom';
import { ICON, iconUrl } from './icons';

const STORE_KEY = 'lh_trophies';

interface Earned { at: number; seen?: boolean }

/** Earned trophies, kept apart from the save so they survive new games. */
export class TrophyCase {
  private earned: Partial<Record<TrophyId, Earned>> = {};

  constructor() {
    try { this.earned = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}'); } catch { this.earned = {}; }
  }

  has(id: TrophyId) { return !!this.earned[id]; }
  when(id: TrophyId) { return this.earned[id]?.at ?? null; }
  isNew(id: TrophyId) { return !!this.earned[id] && !this.earned[id]!.seen; }
  get count() { return Object.keys(this.earned).filter((id) => id in TROPHY_BY_ID).length; }
  get unseen() { return TROPHIES.filter((t) => this.isNew(t.id)).length; }

  /** Records the trophies; returns only the ones that are new. */
  award(ids: TrophyId[]): TrophyId[] {
    const fresh = [...new Set(ids)].filter((id) => !this.earned[id]);
    if (!fresh.length) return fresh;
    for (const id of fresh) this.earned[id] = { at: Date.now() };
    this.persist();
    return fresh;
  }

  markSeen() {
    for (const e of Object.values(this.earned)) if (e) e.seen = true;
    this.persist();
  }

  private persist() { localStorage.setItem(STORE_KEY, JSON.stringify(this.earned)); }
}

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export class TrophyRoom {
  readonly el: HTMLDivElement;
  private body: HTMLElement;
  private countEl: HTMLElement;
  private fill: HTMLElement;
  private toastStack: HTMLElement;
  private queue: TrophyId[] = [];
  private toasting = false;
  isOpen = false;

  constructor(root: HTMLElement, readonly store: TrophyCase, private onChange: () => void) {
    this.countEl = h('b');
    this.fill = h('i');
    this.body = h('div', { class: 'shelves' });
    const close = h('button', { class: 'round-btn x interactive', html: ICON.close, title: 'Close (Esc)', on: { click: () => this.close() } });
    const cabinet = h('div', { class: 'cabinet panel interactive' },
      h('header', {},
        h('img', { attrs: { src: iconUrl('trophy_cup'), alt: '' } }),
        h('div', {}, h('h2', { text: 'Trophy Room' }), h('p', { text: 'Every trophy you earn stays on the shelf, game after game.' })),
        h('div', { class: 'tally' }, this.countEl, h('div', { class: 'meter' }, this.fill))),
      this.body,
      close,
    );
    this.el = h('div', { class: 'screen trophy-wrap hide interactive' }, cabinet);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.toastStack = h('div', { class: 'trophy-toasts' });
    root.append(this.el, this.toastStack);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    this.isOpen = true;
    this.render();
    this.el.classList.remove('hide');
    audio.play('ui_page');
    const cab = this.el.querySelector('.cabinet') as HTMLElement;
    cab.style.animation = 'none'; void cab.offsetWidth; cab.style.animation = '';
    // "New!" ribbons show this once, then they're old news
    this.store.markSeen();
    this.onChange();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hide');
    audio.play('ui_close');
  }

  private render() {
    const total = TROPHIES.length, have = this.store.count;
    this.countEl.textContent = `${have} / ${total}`;
    this.fill.style.transform = `scaleX(${have / total})`;
    this.body.innerHTML = '';
    SHELVES.forEach((name, s) => {
      const row = h('div', { class: 'shelf-row' });
      for (const t of TROPHIES.filter((x) => x.shelf === s)) {
        const at = this.store.when(t.id);
        row.append(h('div', { class: `tcard tier${t.tier} ${at ? 'earned' : 'locked'}` },
          this.store.isNew(t.id) ? h('span', { class: 'new', text: 'New!' }) : null,
          h('div', { class: 'medal' }, h('img', { attrs: { src: iconUrl(t.icon), alt: '', draggable: 'false' } }), at ? null : h('span', { class: 'lock', html: ICON.lock })),
          h('h4', { text: t.name }),
          h('p', { text: t.desc }),
          h('small', { text: at ? `Earned ${fmtDate(at)}` : 'Not yet earned' }),
        ));
      }
      this.body.append(h('section', {}, h('h3', { text: name }), row, h('div', { class: 'plank' })));
    });
  }

  /** Award trophies and celebrate the new ones, one card at a time. */
  award(ids: TrophyId[]) {
    const fresh = this.store.award(ids);
    if (!fresh.length) return;
    this.queue.push(...fresh);
    this.onChange();
    if (this.isOpen) this.render();
    if (!this.toasting) this.nextToast();
  }

  private nextToast() {
    const id = this.queue.shift();
    if (!id) { this.toasting = false; return; }
    this.toasting = true;
    const t = TROPHY_BY_ID[id];
    audio.play('trophy');
    const card = h('div', { class: `trophy-toast panel tier${t.tier}` },
      h('div', { class: 'medal' }, h('img', { attrs: { src: iconUrl(t.icon), alt: '' } })),
      h('div', {}, h('div', { class: 'kicker' }, ico(ICON.trophy), h('span', { text: 'Trophy unlocked!' })), h('b', { text: t.name }), h('p', { text: t.desc })),
      h('i', { class: 'shine' }),
    );
    this.toastStack.append(card);
    setTimeout(() => card.classList.add('out'), 4600);
    setTimeout(() => card.remove(), 5200);
    // stagger so a big dawn (or the win screen) reads as a little parade
    setTimeout(() => this.nextToast(), 1500);
  }
}
