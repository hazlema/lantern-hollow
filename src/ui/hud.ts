import { audio } from '../audio';
import { TOWERS, TOWER_ORDER, MAX_LEVEL, levelMult, type TargetMode, type TowerId } from '../data/towers';
import type { Mods } from '../data/tech';
import { TOWER_UNLOCK, TECH_BY_ID } from '../data/tech';
import type { SpawnGroup } from '../data/waves';
import { ZOMBIES, chopChance, type ZombieId } from '../data/zombies';
import { add, h, ico, replay } from './dom';
import { ICON, iconUrl } from './icons';

export interface HudActions {
  selectBuild(id: TowerId | null): void;
  startNight(): void;
  cycleSpeed(): void;
  togglePause(): void;
  openAlmanac(): void;
  toggleSettings(): void;
  upgradeSelected(): void;
  sellSelected(): void;
  setTargetMode(m: TargetMode): void;
  deselect(): void;
  repairSelected(): void;
  repairAll(): void;
}

export interface TowerView {
  id: TowerId;
  level: number;
  kills: number;
  targetMode: TargetMode;
  damage: number; rate: number; range: number;
  next?: { damage: number; rate: number; range: number };
  upgradeCost: number | null;
  sellValue: number;
  canAfford: boolean;
  /** 0..1, 1 = undamaged */
  condition: number;
  repairCost: number;
  canRepair: boolean;
  /** invasion in progress: repairs are at the doubled emergency rate */
  nightRate: boolean;
  /** upgrades are still locked (unlock on this night), or null when available */
  upgradeLockedUntil: number | null;
}

const fmt = (n: number, d = 0) => n.toFixed(d).replace(/\.0+$/, '');

export class Hud {
  readonly el: HTMLDivElement;
  private gold: HTMLElement; private embers: HTMLElement; private lives: HTMLElement;
  private goldPill: HTMLElement; private emberPill: HTMLElement; private lifePill: HTMLElement;
  private plaque: HTMLElement; private preview: HTMLElement; private progress: HTMLElement; private progBar: HTMLElement; private progTxt: HTMLElement;
  private cards = new Map<TowerId, HTMLElement>();
  private tip: HTMLElement;
  private nfBtn: HTMLButtonElement;
  private speedBtn: HTMLElement; private pauseBtn: HTMLElement; private almanacBadge: HTMLElement;
  private tpanel: HTMLElement;
  private toasts: HTMLElement;
  private bannerEl: HTMLElement;
  private floaters: HTMLElement;
  private vignette: HTMLElement;
  private coachEl: HTMLElement;
  private last = { gold: -1, embers: -1, lives: -1 };
  private repairAllBtn: HTMLButtonElement;
  private repairKey = '';
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private currentPanelKey = '';

  constructor(root: HTMLElement, private act: HudActions) {
    const clickSfx = () => audio.play('ui_click');
    const hoverSfx = () => audio.play('ui_hover', { volume: 0.5 });

    // resources
    this.gold = h('span', { text: '0' });
    this.embers = h('span', { text: '0' });
    this.lives = h('span', { text: '0' });
    this.goldPill = h('div', { class: 'pill panel', title: 'Gold — build and upgrade towers' }, ico(ICON.coin), this.gold);
    this.emberPill = h('div', { class: 'pill panel', title: 'Embers — research in the Almanac' }, ico(ICON.ember), this.embers);
    this.lifePill = h('div', { class: 'pill panel', title: 'Cottage hearts' }, ico(ICON.heart), this.lives);
    const res = h('div', { class: 'res' }, this.goldPill, this.emberPill, this.lifePill);

    // night plaque + preview / progress
    this.plaque = h('div', { class: 'plaque' });
    this.preview = h('div', { class: 'preview panel' });
    this.progBar = h('i');
    this.progTxt = h('span');
    this.progress = h('div', { class: 'progress', style: 'display:none' }, this.progBar, this.progTxt);
    this.bossFill = h('i');
    this.boss = h('div', { class: 'bossbar', style: 'display:none' },
      h('img', { attrs: { src: iconUrl('z_king'), alt: '' } }),
      h('div', {}, h('b', { text: 'The Pumpkin King' }), h('div', { class: 'bar' }, this.bossFill)));
    const nightBox = h('div', { class: 'night-plaque' }, this.plaque, this.preview, this.progress, this.boss);

    // top-right controls
    const roundBtn = (svg: string, title: string, fn: () => void) => {
      const b = h('button', { class: 'round-btn interactive', html: svg, title, on: { click: () => { clickSfx(); fn(); }, mouseenter: hoverSfx } });
      return b;
    };
    this.speedBtn = roundBtn(ICON.play, 'Game speed (F)', () => act.cycleSpeed());
    this.speedBtn.append(h('span', { class: 'label', text: '1x' }));
    this.pauseBtn = roundBtn(ICON.pause, 'Pause (P)', () => act.togglePause());
    const almanac = roundBtn(ICON.book, 'The Almanac — research (T)', () => act.openAlmanac());
    this.almanacBadge = h('span', { class: 'badge', style: 'display:none' });
    almanac.append(this.almanacBadge);
    const settings = roundBtn(ICON.gear, 'Settings', () => act.toggleSettings());
    const ctrl = h('div', { class: 'ctrl' }, this.speedBtn, this.pauseBtn, almanac, settings);

    // build bar
    const bar = h('div', { class: 'buildbar panel interactive' });
    for (const id of TOWER_ORDER) {
      const def = TOWERS[id];
      const card = h('div', { class: 'card' },
        h('span', { class: 'key', text: def.hotkey }),
        h('img', { attrs: { src: iconUrl(`tower_${id}`), alt: def.name, draggable: 'false' } }),
        h('div', { class: 'nm', text: def.name }),
        h('div', { class: 'cost' }, ico(ICON.coin), h('span', { text: String(def.cost) })),
      );
      card.addEventListener('click', () => {
        if (card.classList.contains('locked')) { audio.play('ui_error'); act.openAlmanac(); return; }
        clickSfx();
        act.selectBuild(card.classList.contains('sel') ? null : id);
      });
      card.addEventListener('mouseenter', () => { hoverSfx(); this.showTip(id, card); });
      card.addEventListener('mouseleave', () => this.tip.classList.remove('show'));
      this.cards.set(id, card);
      bar.append(card);
    }
    this.tip = h('div', { class: 'tip panel' });

    // nightfall
    this.nfBtn = h('button', { class: 'btn plum ready interactive', on: { click: () => { act.startNight(); }, mouseenter: hoverSfx } }, ico(ICON.moon), 'Nightfall');
    this.repairAllBtn = h('button', { class: 'btn repair small interactive', style: 'display:none', title: 'Repair every damaged tower', on: { click: () => act.repairAll(), mouseenter: hoverSfx } });
    const nightfall = h('div', { class: 'nightfall' }, this.repairAllBtn, h('div', { class: 'hint-keys', text: 'Space' }), this.nfBtn);

    // tower panel
    this.tpanel = h('div', { class: 'tpanel panel interactive hide' });

    this.toasts = h('div', { class: 'toasts' });
    this.bannerEl = h('div', { class: 'banner' });
    this.floaters = h('div', { class: 'floaters' });
    this.vignette = h('div', { class: 'vignette-hurt' });
    this.coachEl = h('div', { class: 'coach panel hide' });

    this.el = h('div', { class: 'hud' }, this.vignette, this.floaters, res, nightBox, ctrl, bar, nightfall, this.tpanel, this.coachEl, this.toasts, this.bannerEl, this.tip);
    root.append(this.el);
  }

  show(on: boolean) { this.el.classList.toggle('show', on); }

  // --- resources -------------------------------------------------------------
  setResources(gold: number, embers: number, lives: number, maxLives: number) {
    if (gold !== this.last.gold) {
      if (gold > this.last.gold && this.last.gold >= 0) replay(this.goldPill, 'bump');
      this.gold.textContent = String(gold);
    }
    if (embers !== this.last.embers) {
      if (embers > this.last.embers && this.last.embers >= 0) replay(this.emberPill, 'bump');
      this.embers.textContent = String(embers);
    }
    if (lives !== this.last.lives) {
      if (lives < this.last.lives) replay(this.lifePill, 'hurt');
      this.lives.textContent = `${lives}`;
      this.lifePill.title = `Cottage hearts: ${lives} / ${maxLives}`;
    }
    this.last = { gold, embers, lives };
  }

  poor() { replay(this.goldPill, 'poor'); }

  // --- night state -------------------------------------------------------------
  setNightInfo(n: number, total: number, phase: 'build' | 'night', upcoming: SpawnGroup[]) {
    const endless = n > total;
    this.plaque.innerHTML = '';
    this.plaque.append(ico(phase === 'night' ? ICON.moon : ICON.sun), h('span', { text: endless ? `Night ${n}` : `Night ${n}` }), h('small', { text: endless ? '∞' : `/ ${total}` }));
    this.preview.classList.toggle('hide', phase === 'night');
    this.progress.style.display = phase === 'night' ? '' : 'none';
    this.nfBtn.disabled = phase === 'night';
    this.nfBtn.classList.toggle('ready', phase === 'build');
    if (phase === 'build') {
      const counts = new Map<ZombieId, number>();
      for (const g of upcoming) counts.set(g.type, (counts.get(g.type) ?? 0) + g.count);
      this.preview.innerHTML = '';
      this.preview.append(h('span', { class: 'lbl', text: 'Tonight' }));
      for (const [type, count] of counts) {
        const extra = type === 'lumberjack' ? ` Chop chance tonight: ${Math.round(chopChance(n) * 100)}%.` : '';
        this.preview.append(h('div', { class: 'z', title: `${ZOMBIES[type].name}: ${ZOMBIES[type].blurb}${extra}` },
          h('img', { attrs: { src: iconUrl(`z_${type}`), alt: type } }), h('b', { text: `×${count}` })));
      }
    }
  }

  /** Show "Repair all" when anything is damaged. */
  setRepairAll(count: number, cost: number, affordable: boolean, night = false) {
    const key = `${count}:${cost}:${affordable}:${night}`;
    if (key === this.repairKey) return;
    this.repairKey = key;
    this.repairAllBtn.style.display = count > 0 ? '' : 'none';
    if (!count) return;
    this.repairAllBtn.innerHTML = '';
    add(this.repairAllBtn, ico(ICON.wrench), h('span', { text: `Repair all (${count})` }), ico(ICON.coin), h('span', { text: String(cost) }),
      night ? h('span', { class: 'rate', html: `${ICON.moon}×2` }) : null);
    this.repairAllBtn.classList.toggle('poor', !affordable);
    this.repairAllBtn.classList.toggle('night', night);
    this.repairAllBtn.title = night ? 'Emergency repairs cost double during the invasion. Normal price after dawn.' : 'Repair every damaged tower';
  }

  setBoss(frac: number | null) {
    this.boss.style.display = frac === null ? 'none' : '';
    if (frac !== null) this.bossFill.style.transform = `scaleX(${Math.max(0, frac)})`;
  }

  setProgress(remaining: number, total: number) {
    this.progBar.style.transform = `scaleX(${total ? remaining / total : 0})`;
    this.progTxt.textContent = `${remaining} zombie${remaining === 1 ? '' : 's'} left`;
  }

  // --- build bar ---------------------------------------------------------------
  refreshBuild(mods: Mods, gold: number, selected: TowerId | null) {
    for (const [id, card] of this.cards) {
      const locked = !mods.unlocked.has(id);
      const cost = Math.round(TOWERS[id].cost * mods.costMult);
      card.classList.toggle('locked', locked);
      card.classList.toggle('poor', !locked && gold < cost);
      card.classList.toggle('sel', selected === id);
      const costEl = card.querySelector('.cost') as HTMLElement;
      const lockEl = card.querySelector('.lock');
      if (locked) {
        costEl.innerHTML = 'Research it';
        if (!lockEl) card.append(h('span', { class: 'lock', html: ICON.lock }));
      } else {
        lockEl?.remove();
        costEl.innerHTML = '';
        costEl.append(ico(ICON.coin), h('span', { text: String(cost) }));
      }
    }
    this.costMult = mods.costMult;
    this.mods = mods;
  }
  private costMult = 1;
  private mods: Mods | null = null;

  private showTip(id: TowerId, card: HTMLElement) {
    const d = TOWERS[id];
    const lm = levelMult(1);
    const locked = this.mods && !this.mods.unlocked.has(id);
    const unlock = TOWER_UNLOCK[id];
    this.tip.innerHTML = '';
    add(this.tip,
      h('h4', { text: d.name }),
      h('p', { text: d.blurb }),
      locked && unlock ? h('p', { html: `<b>Locked.</b> Research <b>${TECH_BY_ID[unlock].name}</b> in the Almanac.` }) : null,
      h('dl', { class: 'stats' },
        h('dt', { text: id === 'sprinkler' ? 'Slow' : 'Damage' }), h('dd', { text: id === 'sprinkler' ? `${Math.round((this.mods?.slow ?? 0.35) * 100)}%` : fmt(d.damage * lm.damage * (this.mods?.damage[id] ?? 1)) + (d.splash ? ' splash' : '') }),
        h('dt', { text: 'Speed' }), h('dd', { text: `${fmt(d.rate * (this.mods?.rate[id] ?? 1), 2)}/s` }),
        h('dt', { text: 'Range' }), h('dd', { text: fmt(d.range * (this.mods?.rangeAll ?? 1), 1) }),
        h('dt', { text: 'Cost' }), h('dd', { text: String(Math.round(d.cost * this.costMult)) }),
      ),
    );
    const r = card.getBoundingClientRect();
    this.tip.style.left = `${Math.min(window.innerWidth - 270, Math.max(10, r.left + r.width / 2 - 125))}px`;
    this.tip.style.top = `${r.top - 210}px`;
    this.tip.classList.add('show');
    requestAnimationFrame(() => { this.tip.style.top = `${r.top - this.tip.offsetHeight - 18}px`; });
  }

  // --- selected tower panel ----------------------------------------------------
  showTower(v: TowerView | null) {
    if (!v) { this.tpanel.classList.add('hide'); this.currentPanelKey = ''; return; }
    const key = JSON.stringify(v);
    if (key === this.currentPanelKey) return;
    this.currentPanelKey = key;
    const d = TOWERS[v.id];
    const stars = h('div', { class: 'stars' });
    for (let i = 1; i <= MAX_LEVEL; i++) stars.append(h('span', { html: ICON.star.replace('<svg', `<svg class="${i <= v.level ? 'on' : ''}"`) }));
    const delta = (a: number, b: number | undefined, dp = 0) => b !== undefined && b > a + 0.001 ? `<em>→ ${fmt(b, dp)}</em>` : '';
    const isSlow = v.id === 'sprinkler';
    const stats = h('dl', { class: 'stats', html: `
      <dt>${isSlow ? 'Slow' : 'Damage'}</dt><dd>${isSlow ? `${Math.round((this.mods?.slow ?? .35) * 100)}%` : fmt(v.damage) + delta(v.damage, v.next?.damage)}</dd>
      <dt>Speed</dt><dd>${fmt(v.rate, 2)}/s${delta(v.rate, v.next?.rate, 2)}</dd>
      <dt>Range</dt><dd>${fmt(v.range, 1)}${delta(v.range, v.next?.range, 1)}</dd>` });
    const seg = h('div', { class: 'seg' });
    const modes: [TargetMode, string][] = [['first', 'First'], ['last', 'Last'], ['strong', 'Strong'], ['close', 'Close']];
    for (const [m, label] of modes) {
      seg.append(h('button', { class: v.targetMode === m ? 'on' : '', text: label, on: { click: () => { audio.play('ui_click'); this.act.setTargetMode(m); } } }));
    }
    const upBtn = h('button', { class: 'btn green', on: { click: () => this.act.upgradeSelected() } });
    if (v.upgradeCost === null) { upBtn.textContent = 'Max level'; upBtn.disabled = true; }
    else if (v.upgradeLockedUntil !== null) {
      upBtn.classList.add('locked');
      upBtn.title = `Tower upgrades unlock on Night ${v.upgradeLockedUntil}`;
      upBtn.append(ico(ICON.lock), h('span', { text: `Night ${v.upgradeLockedUntil}` }));
      upBtn.disabled = true;
    }
    else { upBtn.append(h('span', { text: 'Upgrade' }), ico(ICON.coin), h('span', { text: String(v.upgradeCost) })); upBtn.disabled = !v.canAfford; }
    const sellBtn = h('button', { class: 'btn red', on: { click: () => this.act.sellSelected() } }, h('span', { text: 'Sell' }), ico(ICON.coin), h('span', { text: String(v.sellValue) }));

    const damaged = v.condition < 0.999;
    const condRow = damaged ? h('div', { class: `cond ${v.condition <= 0 ? 'broken' : ''}` },
      h('span', { text: v.condition <= 0 ? 'Broken!' : 'Condition' }),
      h('div', { class: 'cbar' }, h('i', { style: `transform:scaleX(${Math.max(0.02, v.condition)})` })),
      h('b', { text: `${Math.round(v.condition * 100)}%` })) : null;
    const repairBtn = damaged ? h('button', {
      class: `btn repair ${v.nightRate ? 'night' : ''}`,
      title: v.nightRate ? 'Emergency repair (R): double price during the invasion. Normal price after dawn.' : 'Repair (R)',
      on: { click: () => this.act.repairSelected() },
    }, ico(ICON.wrench), h('span', { text: 'Repair' }), ico(ICON.coin), h('span', { text: String(v.repairCost) }),
      v.nightRate ? h('span', { class: 'rate', html: `${ICON.moon}×2` }) : null) : null;
    if (repairBtn) repairBtn.disabled = !v.canRepair;

    this.tpanel.innerHTML = '';
    add(this.tpanel,
      h('button', { class: 'close', html: ICON.close, title: 'Close (Esc)', on: { click: () => this.act.deselect() } }),
      h('header', {}, h('img', { attrs: { src: iconUrl(`tower_${v.id}`), alt: '' } }), h('div', {}, h('h3', { text: d.name }), stars, h('div', { class: 'kills', text: `${v.kills} zombie${v.kills === 1 ? '' : 's'} bonked` }))),
      condRow,
      stats,
      isSlow ? null : seg,
      repairBtn ? h('div', { class: 'acts' }, repairBtn) : null,
      h('div', { class: 'acts' }, upBtn, sellBtn),
    );
    if (isSlow) this.tpanel.querySelector('.acts')!.setAttribute('style', 'margin-top:12px');
    this.tpanel.querySelectorAll('.acts').forEach((a, i, all) => { if (i < all.length - 1) (a as HTMLElement).style.marginBottom = '8px'; });
    this.tpanel.classList.remove('hide');
  }

  // --- controls ----------------------------------------------------------------
  setSpeed(s: number) {
    this.speedBtn.innerHTML = s > 1 ? ICON.ff : ICON.play;
    this.speedBtn.append(h('span', { class: 'label', text: `${s}x` }));
  }
  setPaused(p: boolean) { this.pauseBtn.innerHTML = p ? ICON.play : ICON.pause; }
  setAlmanacBadge(n: number) {
    this.almanacBadge.style.display = n > 0 ? '' : 'none';
    this.almanacBadge.textContent = String(n);
  }

  // --- messages ------------------------------------------------------------------
  toast(msg: string, icon?: string) {
    const t = h('div', { class: 'toast panel' }, icon ? ico(icon) : null, h('span', { html: msg }));
    this.toasts.append(t);
    setTimeout(() => t.remove(), 3800);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  banner(title: string, sub = '', kind: 'night' | 'dawn' | 'boss' = 'night') {
    this.bannerEl.className = `banner ${kind}`;
    this.bannerEl.innerHTML = '';
    add(this.bannerEl, h('h1', { text: title }), sub ? h('h2', { text: sub }) : null);
  }

  floater(x: number, y: number, text: string, kind: 'gold' | 'crit' | 'hurt' = 'gold') {
    const f = h('div', { class: `floater ${kind === 'gold' ? '' : kind}`, style: `left:${x}px;top:${y}px` });
    if (kind === 'gold') f.append(ico(ICON.coin));
    f.append(h('span', { text }));
    this.floaters.append(f);
    setTimeout(() => f.remove(), 1100);
  }

  private flying = 0;
  /** A coin arcs from a kill up into the gold counter. */
  coinFly(x: number, y: number) {
    if (this.flying > 14) return;
    const target = this.goldPill.querySelector('.ico')!.getBoundingClientRect();
    const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
    const c = h('div', { class: 'coin-fly', html: ICON.coin, style: `left:${x}px;top:${y}px` });
    this.floaters.append(c);
    this.flying++;
    const mx = (x + tx) / 2 + (Math.random() - 0.5) * 160, my = Math.min(y, ty) - 60 - Math.random() * 80;
    const steps = 14;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const px = u * u * x + 2 * u * t * mx + t * t * tx;
      const py = u * u * y + 2 * u * t * my + t * t * ty;
      frames.push({ transform: `translate(${px - x}px, ${py - y}px) scale(${1 - t * 0.35}) rotate(${t * 540}deg)`, opacity: i === steps ? 0.6 : 1 });
    }
    const anim = c.animate(frames, { duration: 650 + Math.random() * 200, easing: 'cubic-bezier(.45,0,.75,1)', delay: 120 });
    anim.onfinish = () => { c.remove(); this.flying--; replay(this.goldPill, 'bump'); };
  }

  hurtFlash() {
    this.vignette.classList.add('on');
    setTimeout(() => this.vignette.classList.remove('on'), 120);
  }

  coach(html: string | null) {
    if (html === null) { this.coachEl.classList.add('hide'); return; }
    this.coachEl.innerHTML = html;
    this.coachEl.classList.remove('hide');
  }
}
