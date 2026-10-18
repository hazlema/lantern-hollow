// Big "new threat" announcement: two columns (art on the left, words on the
// right), a fanfare, light rays and a stamped NEW! badge. Shown once per run.
import { audio } from '../audio';
import { add, h, ico } from './dom';

export interface Announcement {
  image: string;
  kicker: string;
  title: string;
  /** main message, shown big */
  lead: string[];
  tips: { icon: string; html: string }[];
  button: string;
}

export class Announcer {
  readonly el: HTMLDivElement;
  private panel: HTMLDivElement;
  private onClose: () => void = () => {};
  active = false;

  constructor(root: HTMLElement) {
    this.panel = h('div', { class: 'announce panel' });
    this.el = h('div', { class: 'screen announce-wrap hide interactive' }, this.panel);
    root.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    }, true);
  }

  show(a: Announcement, onClose: () => void) {
    this.onClose = onClose;
    this.active = true;
    this.panel.innerHTML = '';
    const art = h('div', { class: 'art' },
      h('div', { class: 'rays' }),
      h('img', { attrs: { src: a.image, alt: '', draggable: 'false' } }),
      h('div', { class: 'stamp', text: 'NEW!' }),
      ...Array.from({ length: 7 }, (_, i) => h('i', { class: 'chip', style: `--d:${i * 0.45}s;--x:${(i * 37) % 100}%` })),
    );
    const words = h('div', { class: 'words' });
    add(words,
      h('div', { class: 'kicker', text: a.kicker }),
      h('h2', { text: a.title }),
      ...a.lead.map((t) => h('p', { class: 'lead', text: t })),
      h('ul', { class: 'tips' }, ...a.tips.map((t) => h('li', {}, ico(t.icon), h('span', { html: t.html })))),
      h('button', { class: 'btn', text: a.button, on: { click: () => this.close() } }),
    );
    add(this.panel, art, words);
    this.el.classList.remove('hide');
    // replay the entrance animation every time
    this.panel.classList.remove('enter'); void this.panel.offsetWidth; this.panel.classList.add('enter');
    audio.play('announce');
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.el.classList.add('hide');
    audio.play('ui_click');
    this.onClose();
  }
}
