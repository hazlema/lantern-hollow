import { audio } from '../audio';
import { h, ico } from './dom';
import { ICON } from './icons';
import { canFullscreen, isFullscreen, isIOS, isInstalled, isTouch, onFullscreenChange, toggleFullscreen } from './device';

export class TitleScreen {
  readonly el: HTMLDivElement;
  private continueBtn: HTMLButtonElement;

  constructor(root: HTMLElement, onPlay: () => void, onContinue: () => void, onTrophies: () => void) {
    const flies = Array.from({ length: 16 }, (_, i) =>
      h('div', { class: 'fly', style: `left:${10 + Math.random() * 85}%;top:${35 + Math.random() * 55}%;animation-delay:${(i * 0.6) % 9}s;animation-duration:${7 + Math.random() * 5}s` }));
    const play = h('button', { class: 'btn interactive', on: { click: onPlay, mouseenter: () => audio.play('ui_hover') } }, ico(ICON.moon), 'New Game');
    this.continueBtn = h('button', { class: 'btn plum interactive', on: { click: onContinue, mouseenter: () => audio.play('ui_hover') } }, 'Continue');
    this.el = h('div', { class: 'screen title interactive' },
      h('div', { class: 'art' }),
      h('div', { class: 'shade' }),
      ...flies,
      h('div', { class: 'logo' }, h('h1', { html: 'Lantern<span>Hollow</span>' }), h('p', { text: 'A cozy autumn zombie defense' })),
      h('div', { class: 'menu' }, this.continueBtn, play,
        h('button', { class: 'btn cream small interactive', on: { click: () => { audio.play('ui_click'); onTrophies(); }, mouseenter: () => audio.play('ui_hover') } }, ico(ICON.trophy), 'Trophy Room')),
      h('div', { class: 'foot', text: isTouch ? 'Drag to look around · Pinch to zoom' : 'Q/E rotate · Wheel zoom · Right-drag pan' }),
      this.screenButton(),
    );
    root.append(this.el);
  }

  /** Top-right corner: go fullscreen, or (iPhone, which can't) explain Add to Home Screen. */
  private screenButton(): HTMLElement | null {
    if (isInstalled()) return null;
    if (canFullscreen) {
      const btn = h('button', { class: 'round-btn corner interactive', html: ICON.expand, title: 'Fullscreen', on: { click: () => { audio.play('ui_click'); void toggleFullscreen(); } } });
      onFullscreenChange(() => { btn.innerHTML = isFullscreen() ? ICON.shrink : ICON.expand; });
      return btn;
    }
    if (!isIOS) return null;
    const how = h('div', { class: 'install panel hide' },
      h('h4', { text: 'Play fullscreen' }),
      h('p', { html: `Tap <span class="ico">${ICON.share}</span> <b>Share</b> in Safari, then <b>Add to Home Screen</b>. Open Lantern Hollow from your home screen and it fills the whole screen.` }));
    const btn = h('button', { class: 'btn cream small corner interactive', on: { click: () => { audio.play('ui_click'); how.classList.toggle('hide'); } } }, ico(ICON.expand), 'Fullscreen');
    return h('div', {}, btn, how);
  }

  show(on: boolean, hasSave = false) {
    this.el.classList.toggle('hide', !on);
    this.continueBtn.style.display = hasSave ? '' : 'none';
  }
}

export interface EndStats { nights: number; kills: number; towers: number; gold: number }

export class EndScreen {
  readonly el: HTMLDivElement;
  private modal: HTMLElement;

  constructor(root: HTMLElement) {
    this.modal = h('div', { class: 'modal panel' });
    this.el = h('div', { class: 'screen modal-wrap hide interactive' }, this.modal);
    root.append(this.el);
  }

  show(kind: 'defeat' | 'victory', s: EndStats, actions: { label: string; cls?: string; fn: () => void }[]) {
    this.modal.innerHTML = '';
    this.modal.append(
      h('h2', { text: kind === 'victory' ? 'Dawn Breaks!' : 'The Hollow Falls' }),
      h('p', { class: 'sub', text: kind === 'victory'
        ? 'Twenty nights, and the cottage still stands. The zombies wander off to bother someone else.'
        : 'The zombies barge into the cottage and help themselves to the soup. There’s always next autumn.' }),
      h('div', { class: 'art', style: `background-image:url(/art/${kind === 'victory' ? 'title' : 'backdrop'}.jpg);${kind === 'defeat' ? 'filter:saturate(.6) brightness(.8) hue-rotate(-10deg)' : ''}` }),
      h('div', { class: 'tally' },
        h('div', {}, h('b', { text: String(s.nights) }), 'nights survived'),
        h('div', {}, h('b', { text: String(s.kills) }), 'zombies bonked'),
        h('div', {}, h('b', { text: String(s.towers) }), 'towers built'),
      ),
      h('div', { class: 'row' }, ...actions.map((a) => h('button', { class: `btn ${a.cls ?? ''}`, text: a.label, on: { click: () => { audio.play('ui_click'); a.fn(); } } }))),
    );
    this.el.classList.remove('hide');
  }

  hide() { this.el.classList.add('hide'); }
}

export class Settings {
  readonly el: HTMLDivElement;
  open = false;

  constructor(root: HTMLElement, onQuit: () => void, onTour: () => void, onQuality: (q: string) => void) {
    const v = audio.getVolumes();
    const quality = h('select', { class: 'interactive', on: { change: (e) => { onQuality((e.target as HTMLSelectElement).value); audio.play('ui_click'); } } });
    for (const [val, label] of [['auto', 'Auto'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) {
      const o = h('option', { text: label, attrs: { value: val } });
      if ((localStorage.getItem('lh_quality') ?? 'auto') === val) o.selected = true;
      quality.append(o);
    }
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'ambience') => {
      const input = h('input', { attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: String(v[key]) } });
      input.addEventListener('input', () => audio.setVolumes({ [key]: parseFloat(input.value) }));
      input.addEventListener('change', () => audio.play('ui_click'));
      return h('label', {}, h('span', { text: label }), input);
    };
    this.el = h('div', { class: 'settings panel hide interactive' },
      h('h4', { text: 'Settings' }),
      slider('Master', 'master'), slider('Music', 'music'), slider('Effects', 'sfx'), slider('Ambience', 'ambience'),
      h('label', {}, h('span', { text: 'Graphics' }), quality),
      h('div', { class: 'keys', html: `
        <kbd>1</kbd>–<kbd>5</kbd> pick tower · <kbd>Space</kbd> nightfall<br>
        <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>WASD</kbd> pan · wheel zoom<br>
        <kbd>U</kbd> upgrade · <kbd>R</kbd> repair · <kbd>X</kbd> sell<br>
        <kbd>B</kbd> almanac · <kbd>T</kbd> trophies<br>
        <kbd>F</kbd> speed · <kbd>P</kbd> pause · <kbd>Esc</kbd> cancel` }),
      h('div', { style: 'margin-top:12px;display:flex;justify-content:space-between;gap:8px' },
        h('button', { class: 'btn cream', text: 'Show tutorial', style: 'font-size:15px;padding:6px 12px 8px', on: { click: () => { this.toggle(false); onTour(); } } }),
        h('button', { class: 'btn red', text: 'Quit to title', style: 'font-size:15px;padding:6px 12px 8px', on: { click: () => { this.toggle(false); onQuit(); } } })),
    );
    root.append(this.el);
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.classList.toggle('hide', !on);
  }
}

export class PauseVeil {
  readonly el: HTMLDivElement;
  constructor(root: HTMLElement, onResume: () => void) {
    this.el = h('div', { class: 'pause-veil hide interactive' },
      h('div', { style: 'text-align:center' }, h('h2', { text: 'Paused' }),
        h('button', { class: 'btn', text: 'Resume', on: { click: onResume } })));
    root.append(this.el);
  }
  show(on: boolean) { this.el.classList.toggle('hide', !on); }
}
