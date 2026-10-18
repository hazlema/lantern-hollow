import { audio } from '../audio';
import { BRANCHES, TECHS, TECH_BY_ID, canResearch, isAvailable, type TechId } from '../data/tech';
import { add, h, ico } from './dom';
import { ICON, iconUrl } from './icons';

export const techIcon = (id: TechId) => iconUrl(TECH_BY_ID[id].icon);

export class Almanac {
  readonly el: HTMLDivElement;
  private nodes = new Map<TechId, HTMLElement>();
  private links: SVGSVGElement;
  private detail: HTMLElement;
  private emberEl: HTMLElement;
  private branchesEl: HTMLElement;
  private selected: TechId | null = null;
  private owned: ReadonlySet<TechId> = new Set();
  private embers = 0;
  isOpen = false;

  constructor(root: HTMLElement, private onResearch: (id: TechId) => void, private onClose: () => void) {
    this.emberEl = h('div', { class: 'embers' });
    this.detail = h('div', { class: 'detail' });
    const left = h('div', { class: 'left' },
      h('h2', { text: 'The Hollow Almanac' }),
      h('p', { class: 'lead', text: 'Every dawn you survive, the hearth leaves glowing embers. Spend them here on clever tricks and new contraptions. You can’t learn everything, so choose your path.' }),
      this.emberEl,
      this.detail,
    );
    this.links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.links.classList.add('links');
    this.branchesEl = h('div', { class: 'branches' });
    BRANCHES.forEach((name, b) => {
      const col = h('div', { class: 'branch' }, h('h5', { text: name }));
      TECHS.filter((t) => t.branch === b).sort((a, c) => a.tier - c.tier).forEach((t) => {
        const node = h('div', { class: 'node interactive', title: t.name },
          h('img', { attrs: { src: techIcon(t.id), alt: t.name, draggable: 'false' } }),
        );
        node.addEventListener('click', () => { audio.play('ui_click'); this.select(t.id); });
        node.addEventListener('mouseenter', () => audio.play('ui_hover', { volume: 0.4 }));
        node.addEventListener('dblclick', () => this.tryResearch(t.id));
        this.nodes.set(t.id, node);
        col.append(node);
      });
      this.branchesEl.append(col);
    });
    this.branchesEl.append(this.links);
    const right = h('div', { class: 'right' }, this.branchesEl);
    const close = h('button', { class: 'round-btn x interactive', html: ICON.close, title: 'Close (Esc)', on: { click: () => this.close() } });
    const book = h('div', { class: 'book interactive' }, h('div', { class: 'pages' }, left, right), close);
    this.el = h('div', { class: 'screen almanac-wrap hide interactive' }, book);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    root.append(this.el);
  }

  open(owned: ReadonlySet<TechId>, embers: number) {
    this.isOpen = true;
    this.el.classList.remove('hide');
    audio.play('ui_page');
    this.render(owned, embers);
    // re-trigger the opening animation
    const book = this.el.querySelector('.book') as HTMLElement;
    book.style.animation = 'none'; void book.offsetWidth; book.style.animation = '';
    requestAnimationFrame(() => this.drawLinks());
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hide');
    audio.play('ui_close');
    this.onClose();
  }

  render(owned: ReadonlySet<TechId>, embers: number) {
    this.owned = owned; this.embers = embers;
    this.emberEl.innerHTML = '';
    this.emberEl.append(ico(ICON.ember), h('div', {}, h('span', { text: String(embers) }), h('small', { text: embers === 1 ? 'ember to spend' : 'embers to spend' })));
    for (const t of TECHS) {
      const n = this.nodes.get(t.id)!;
      const own = owned.has(t.id);
      const avail = isAvailable(t.id, owned);
      n.classList.toggle('owned', own);
      n.classList.toggle('avail', avail);
      n.classList.toggle('afford', avail && canResearch(t.id, owned, embers));
      n.classList.toggle('sel', this.selected === t.id);
      n.querySelector('.tick')?.remove();
      n.querySelector('.cost')?.remove();
      if (own) n.append(h('span', { class: 'tick', html: ICON.check }));
      else n.append(h('span', { class: 'cost' }, ico(ICON.ember), h('span', { text: String(t.cost) })));
    }
    if (!this.selected) {
      // default selection: the first thing you could buy
      this.selected = TECHS.find((t) => canResearch(t.id, owned, embers))?.id ?? null;
      if (this.selected) this.nodes.get(this.selected)!.classList.add('sel');
    }
    this.renderDetail();
    if (this.isOpen) requestAnimationFrame(() => this.drawLinks());
  }

  private select(id: TechId) {
    this.selected = id;
    for (const [k, n] of this.nodes) n.classList.toggle('sel', k === id);
    this.renderDetail();
  }

  private tryResearch(id: TechId) {
    if (!canResearch(id, this.owned, this.embers)) { audio.play('ui_error'); return; }
    this.onResearch(id);
    const n = this.nodes.get(id)!;
    n.classList.remove('unlocked-anim'); void n.offsetWidth; n.classList.add('unlocked-anim');
    this.burst(n);
  }

  private burst(n: HTMLElement) {
    const r = n.getBoundingClientRect();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const s = h('div', { class: 'sparkle', style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * 70}px;--dy:${Math.sin(a) * 70}px;position:fixed` });
      document.body.append(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  private renderDetail() {
    this.detail.innerHTML = '';
    const id = this.selected;
    if (!id) { this.detail.append(h('div', { class: 'empty', text: 'Pick a page in the almanac to read about it.' })); return; }
    const t = TECH_BY_ID[id];
    const own = this.owned.has(id);
    const avail = isAvailable(id, this.owned);
    const can = canResearch(id, this.owned, this.embers);
    const missing = t.requires.filter((r) => !this.owned.has(r)).map((r) => TECH_BY_ID[r].name);
    const btn = h('button', { class: `btn ${own ? 'cream' : 'green'}`, on: { click: () => this.tryResearch(id) } });
    if (own) { btn.textContent = 'Learned'; btn.disabled = true; }
    else { btn.append(h('span', { text: 'Research' }), ico(ICON.ember), h('span', { text: String(t.cost) })); btn.disabled = !can; }
    add(this.detail,
      h('div', { class: 'head' }, h('img', { attrs: { src: techIcon(id), alt: '' } }), h('h3', { text: t.name })),
      h('p', { text: t.desc }),
      !own && !avail ? h('div', { class: 'req', text: `Requires: ${missing.join(', ')}` }) : null,
      !own && avail && !can ? h('div', { class: 'req', text: `Needs ${t.cost - this.embers} more ember${t.cost - this.embers === 1 ? '' : 's'}. Survive more nights!` }) : null,
      btn,
    );
  }

  /** Node centre/edges in the branches container's own layout space (immune to the book's open animation). */
  private layoutOf(n: HTMLElement) {
    const col = n.parentElement as HTMLElement;
    const x = col.offsetLeft + n.offsetLeft + n.offsetWidth / 2;
    const top = col.offsetTop + n.offsetTop;
    return { x, top, bottom: top + n.offsetHeight };
  }

  private drawLinks() {
    let paths = '';
    for (const t of TECHS) {
      const to = this.layoutOf(this.nodes.get(t.id)!);
      for (const req of t.requires) {
        const from = this.layoutOf(this.nodes.get(req)!);
        const owned = this.owned.has(req) && this.owned.has(t.id);
        const lit = this.owned.has(req);
        // short sturdy stitch between a page and the one it unlocks
        paths += `<line x1="${from.x}" y1="${from.bottom - 4}" x2="${to.x}" y2="${to.top + 4}" stroke="${owned ? '#e0a030' : lit ? '#a8784a' : '#c8b08a'}" stroke-width="${owned ? 7 : 5}" stroke-linecap="round" ${lit ? '' : 'stroke-dasharray="1 9"'} />`;
      }
    }
    this.links.innerHTML = paths;
  }
}
