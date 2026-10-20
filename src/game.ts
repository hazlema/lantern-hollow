import * as THREE from 'three';
import { audio } from './audio';
import { Stage, type Quality } from './render/stage';
import { GameMap } from './data/map';
import { TOWERS, MAX_LEVEL, SELL_REFUND, UPGRADE_UNLOCK_NIGHT, levelMult, repairCost, repairsAllowed, upgradeCost, upgradesUnlocked, type TargetMode, type TowerId, TOWER_ORDER } from './data/towers';
import { TECHS, TECH_BY_ID, TOWER_UNLOCK, canResearch, computeMods, type Mods, type TechId } from './data/tech';
import { TOTAL_NIGHTS, buildNight, dawnBonus, dawnEmbers, nightTotal } from './data/waves';
import { buildIsland, type Island } from './world/island';
import { Ambient } from './world/ambient';
import { BuildCursor } from './world/cursor';
import { Glow } from './models/props';
import { FX } from './fx/particles';
import { World } from './core/world';
import { Tower } from './entities/tower';
import { Hud, type TowerView } from './ui/hud';
import { Almanac } from './ui/almanac';
import { EndScreen, PauseVeil, Settings, TitleScreen } from './ui/screens';
import { ICON } from './ui/icons';
import { Tour, type TourStep } from './ui/tour';
import { Announcer } from './ui/announce';
import { TrophyCase, TrophyRoom } from './ui/trophies';
import { isTouch } from './ui/device';
import { MODES, modeOf, type ModeDef, type ModeId } from './data/modes';
import { dawnTrophies, goldTrophies, researchTrophies, type RunRecord } from './data/trophies';

type Phase = 'title' | 'build' | 'night' | 'over';

const START_GOLD = 200;
const START_LIVES = 20;
const START_EMBERS = 1;
const SAVE_KEY = 'lh_save_v1';
const TUT_KEY = 'lh_tutorial_done';

interface SaveData {
  v: 1;
  night: number; gold: number; lives: number; maxLives: number; embers: number;
  owned: TechId[];
  towers: { id: TowerId; c: number; r: number; level: number; mode: TargetMode; spent: number; kills: number; condition?: number }[];
  kills: number; built: number; endless: boolean;
  /** big announcements this run has already shown */
  announced?: string[];
  /** what this run has done that rules trophies out */
  run?: RunRecord;
  /** game mode (saves from before modes are Easy) */
  mode?: ModeId;
  /** Lantern Rush: seconds left on the day's clock */
  dayLeft?: number | null;
}

export class Game {
  readonly stage: Stage;
  readonly map = new GameMap();
  readonly island: Island;
  readonly fx = new FX();
  readonly ambient: Ambient;
  readonly world: World;
  readonly cursor: BuildCursor;
  readonly hud: Hud;
  readonly almanac: Almanac;
  readonly title: TitleScreen;
  readonly end: EndScreen;
  readonly settings: Settings;
  readonly pauseVeil: PauseVeil;
  readonly tour: Tour;
  readonly announcer: Announcer;
  private announced = new Set<string>();
  readonly trophies = new TrophyCase();
  readonly trophyRoom: TrophyRoom;
  private run: RunRecord = { hurt: false, upgraded: false };

  private timer = new THREE.Timer();
  private time = 0;
  phase: Phase = 'title';
  private paused = false;
  private speed = 1;

  // economy & progress
  gold = START_GOLD;
  lives = START_LIVES;
  maxLives = START_LIVES;
  embers = START_EMBERS;
  nightN = 1;
  owned = new Set<TechId>();
  mods: Mods = computeMods(this.owned);
  private nightCount = 0;
  private livesAtNightStart = START_LIVES;
  private stats = { kills: 0, built: 0 };
  private endless = false;
  private mode: ModeDef = MODES.easy;
  /** Lantern Rush: seconds until the next night starts by itself (null: wait for Nightfall) */
  private dayLeft: number | null = null;

  // interaction
  private building: TowerId | null = null;
  /** touch: the tile a first tap previewed; a second tap on it builds */
  private pendingTile: string | null = null;
  private selected: Tower | null = null;
  private tileTowers = new Map<string, Tower>();
  private builtThisDay = new Set<Tower>();
  private shiftHeld = false;
  private keys = new Set<string>();
  private panelT = 0;
  private cottageShake = 0;
  private lastTod = -1;
  private tutorial = -1;
  // auto quality: watch the frame rate and step down if the GPU struggles
  autoQuality = true;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(stageEl: HTMLElement, readonly uiEl: HTMLElement) {
    this.stage = new Stage(stageEl);
    this.island = buildIsland(this.map);
    this.stage.scene.add(this.island.root, this.fx.root);
    this.ambient = new Ambient(this.stage.scene, this.island, this.fx);
    this.cursor = new BuildCursor(this.map);
    this.stage.scene.add(this.cursor.group);

    this.world = new World(this.map, this.stage, this.fx, this.mods, {
      onKill: (z, gold, scr) => {
        if (z.type === 'king') this.trophyRoom.award(['king']);
        this.gold += gold;
        this.stats.kills++;
        this.hud.floater(scr.x, scr.y, `+${gold}`);
        this.hud.coinFly(scr.x, scr.y);
        audio.play('coin', { volume: 0.5 });
        this.refreshUi();
      },
      onLeak: (z) => this.leak(z.def.lives),
      onCrit: (scr, amount) => this.hud.floater(scr.x, scr.y - 20, `${amount}!`, 'crit'),
      onBossSpawn: () => this.hud.banner('The Pumpkin King', 'has risen from the patch!', 'boss'),
      onTowerDestroyed: (t) => {
        // the tile is free again; the tower has to be rebuilt from scratch
        this.tileTowers.delete(`${t.c},${t.r}`);
        this.island.setTileClutter(t.c, t.r, true);
        this.builtThisDay.delete(t);
        if (this.selected === t) this.select(null);
        this.hud.toast(`A lumberjack blew up your <b>${t.def.name}</b>! You'll need to rebuild it.`, ICON.skull);
        this.trophyRoom.award(['destroyer']);
        this.refreshUi();
      },
    });

    this.hud = new Hud(uiEl, {
      selectBuild: (id) => this.setBuilding(id),
      startNight: () => this.startNight(),
      cycleSpeed: () => this.cycleSpeed(),
      togglePause: () => this.setPaused(!this.paused),
      openAlmanac: () => this.openAlmanac(),
      openTrophies: () => this.openTrophies(),
      toggleSettings: () => this.settings.toggle(),
      rotate: (dir) => this.stage.rotate(dir),
      upgradeSelected: () => this.upgradeSelected(),
      sellSelected: () => this.sellSelected(),
      setTargetMode: (m) => { if (this.selected) { this.selected.targetMode = m; this.updatePanel(true); } },
      deselect: () => this.select(null),
      repairSelected: () => this.repairSelected(),
      repairAll: () => this.repairAll(),
    });
    this.almanac = new Almanac(uiEl, (id) => this.research(id), () => this.refreshUi());
    this.settings = new Settings(uiEl, () => this.quitToTitle(), () => this.startTour(), (q) => {
      localStorage.setItem('lh_quality', q);
      this.autoQuality = q === 'auto';
      this.stage.setQuality(q === 'auto' ? 'high' : q as Quality);
    });
    this.pauseVeil = new PauseVeil(uiEl, () => this.setPaused(false));
    this.end = new EndScreen(uiEl);
    this.title = new TitleScreen(uiEl, (m) => this.newGame(m), () => this.continueGame(), () => this.openTrophies());
    this.tour = new Tour(uiEl);
    this.announcer = new Announcer(uiEl);
    this.trophyRoom = new TrophyRoom(uiEl, this.trophies, () => this.hud.setTrophyBadge(this.trophies.unseen));
    this.hud.setTrophyBadge(this.trophies.unseen);
    this.title.show(true, !!localStorage.getItem(SAVE_KEY));

    this.bindInput();
    this.stage.setNight(0.2, true);
    // browsers only allow sound after a gesture: the first click anywhere starts the music
    window.addEventListener('pointerdown', () => void this.boot(), { once: true });
    window.addEventListener('keydown', () => void this.boot(), { once: true });
    const q = localStorage.getItem('lh_quality');
    this.autoQuality = !q || q === 'auto';
    if (q && q !== 'auto') this.stage.setQuality(q as Quality);
  }

  // =========================================================================
  // flow

  private booted = false;
  private async boot() {
    await audio.unlock();
    if (this.booted) return;
    this.booted = true;
    audio.startMusic();
    audio.startAmbience();
    audio.setMusicIntensity(0);
  }

  /** Starts over in `mode` (by default the mode just played, for "Try again"). */
  newGame(mode: ModeId = this.mode.id) {
    audio.play('ui_click');
    void this.boot();
    localStorage.removeItem(SAVE_KEY);
    this.reset();
    this.setMode(MODES[mode]);
    const firstTime = !localStorage.getItem(TUT_KEY);
    this.tutorial = -1;
    this.enterBuild(true);
    // let the camera finish its swoop, then explain Rush and/or walk new players through the controls
    const tour = () => { if (firstTime && this.phase === 'build') this.startTour(); };
    setTimeout(() => (this.mode.dayTimer !== null ? this.announceRush(tour) : tour()), 1600);
  }

  private announceRush(then: () => void) {
    if (this.phase !== 'build' || this.announcer.active) return then();
    const secs = this.mode.dayTimer;
    this.announcer.show({
      image: '/art/rush_hero.webp',
      stamp: 'RUSH!',
      kicker: 'Lantern Rush',
      title: 'No rest for the cozy!',
      lead: ['Take your time on the first night.', `After that, each dawn gives you just ${secs} seconds.`],
      tips: [
        { icon: ICON.moon, html: 'Build at your own pace, then press <b>Nightfall</b> to start night one.' },
        { icon: ICON.clock, html: `After every dawn the Nightfall button counts down from <b>${secs}</b>. At zero, here they come.` },
        { icon: ICON.ff, html: (isTouch ? 'Tap' : 'Click') + ' the countdown' + (isTouch ? '' : ' (Space)') + ' to call the night early.' },
      ],
      button: 'Good luck!',
    }, then);
  }

  private announceLumberjacks() {
    if (this.phase !== 'build' || this.announced.has('lumberjack') || this.announcer.active) return;
    this.setBuilding(null);
    this.settings.toggle(false);
    if (this.almanac.isOpen) this.almanac.close();
    this.announcer.show({
      image: '/art/lumberjack_hero.webp',
      kicker: 'A new threat approaches',
      title: 'Lumberjacks!',
      lead: ['Lumberjack zombies have entered the game.', 'Lumberjack zombies destroy your defenses!'],
      tips: [
        { icon: ICON.sword, html: 'They stop beside the road to chop at a tower: <b>5% a swing</b>, up to 50%. Kill them first!' },
        { icon: ICON.target, html: 'Damaged towers hit softer. At <b>0%</b> a tower <b>explodes</b> and has to be rebuilt.' },
        { icon: ICON.wrench, html: (isTouch ? 'Tap a tower and press <b>Repair</b>' : 'Click a tower and press <b>Repair</b> (R)') + ', or use <b>Repair all</b>. Repairs wait for <b>dawn</b>, unless you learn the <b>Night Toolbox</b> (double price mid-invasion).' },
      ],
      button: 'Bring it on!',
    }, () => {
      this.announced.add('lumberjack');
      this.save();
    });
  }

  /** Spotlight box around a world point; w/h are CSS px at the default zoom and scale with it. */
  private worldRect(p: THREE.Vector3, w: number, h: number, lift = 0): DOMRect {
    const s = { x: 0, y: 0 };
    const z = this.stage.cameraZoom;
    w *= z; h *= z;
    this.stage.project(p.clone().add(new THREE.Vector3(0, lift, 0)), s);
    return new DOMRect(s.x - w / 2, s.y - h / 2, w, h);
  }

  private startTour() {
    if (this.phase !== 'build') return;
    this.settings.toggle(false);
    this.setBuilding(null);
    this.select(null);
    this.hud.coach(null);
    this.stage.resetView();
    const el = (sel: string) => () => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const union = (a: string, b: string) => () => {
      const ra = document.querySelector(a)?.getBoundingClientRect(), rb = document.querySelector(b)?.getBoundingClientRect();
      if (!ra || !rb) return null;
      const l = Math.min(ra.left, rb.left), t = Math.min(ra.top, rb.top);
      return new DOMRect(l, t, Math.max(ra.right, rb.right) - l, Math.max(ra.bottom, rb.bottom) - t);
    };
    const steps: TourStep[] = [
      { target: () => null, title: 'Welcome to Lantern Hollow!', text: 'Every night, sleepy zombies wander out of the old crypt and shuffle down the road toward your cozy cottage. Let\u2019s keep them out of the soup.' },
      { target: () => this.worldRect(this.island.cryptDoor, 170, 170, 0.3), title: 'The Crypt', text: 'Zombies rise from here once you call the night, then follow the <b>dirt road</b>.' },
      { target: () => this.worldRect(this.island.porch, 200, 180, 0.6), title: 'Your Cottage', text: 'Every zombie that reaches the door costs <b>hearts</b>. Big ones cost more!' },
      { target: el('.res'), title: 'Gold, Embers & Hearts', text: '<b>Gold</b> builds and upgrades towers. <b>Embers</b>, earned at each dawn, buy research. Run out of <b>hearts</b> and the hollow falls.' },
      { target: el('.buildbar'), title: 'Your Towers', text: isTouch
        ? 'Pick a tower, then tap the grass beside the road to see where it goes, and tap again to build. Tap a built tower to sell it or change who it targets. Upgrades unlock on <b>Night 10</b>.'
        : 'Pick a tower (or press <kbd>1</kbd>–<kbd>5</kbd>), then click the grass beside the road. Click a built tower to sell it or change who it targets. Upgrades unlock on <b>Night 10</b>.' },
      { target: el('.ctrl .round-btn:nth-child(3)'), title: 'The Almanac', text: 'Spend embers here to unlock new towers and better shots. The badge shows how many pages you can learn.' },
      { target: union('.ctrl .round-btn:nth-child(1)', '.ctrl .round-btn:nth-child(2)'), title: 'Speed & Pause', text: 'Speed nights up to <b>3×</b> or pause whenever you like. You can even build while paused.' },
      { target: el('.nightfall .btn.plum'), title: 'Nightfall', text: `Zombies only come when you call them. Get your defences ready, then press <b>Nightfall</b>${isTouch ? '' : ' (or <kbd>Space</kbd>)'}.` },
      { target: () => this.worldRect(new THREE.Vector3(0.5, 0, -0.5), 360, 240), title: 'Look Around', text: isTouch
        ? '<b>Drag</b> to look around, <b>pinch</b> to zoom, and the <b>arrow buttons</b> on the right turn the island.'
        : '<kbd>Q</kbd> / <kbd>E</kbd> rotate the island, the <b>mouse wheel</b> zooms, and <b>right-drag</b> or <kbd>WASD</kbd> pans.' },
    ];
    this.tour.start(steps, () => {
      localStorage.setItem(TUT_KEY, '1');
      if (this.world.towers.length === 0) this.tutorial = 0;
      this.updateCoach();
    });
  }

  continueGame() {
    audio.play('ui_click');
    void this.boot();
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return this.newGame();
    this.reset();
    try {
      const s = JSON.parse(raw) as SaveData;
      this.nightN = s.night; this.gold = s.gold; this.lives = s.lives; this.maxLives = s.maxLives; this.embers = s.embers;
      this.owned = new Set(s.owned); this.mods = computeMods(this.owned); this.world.mods = this.mods;
      this.stats = { kills: s.kills, built: s.built }; this.endless = s.endless;
      this.setMode(modeOf(s.mode));
      this.announced = new Set(s.announced ?? []);
      // saves from before trophies: give the benefit of the doubt where the save can't tell
      this.run = s.run ?? { hurt: s.lives < s.maxLives, upgraded: s.towers.some((t) => t.level > 1) };
      this.nightCount = s.night - 1;
      for (const t of s.towers) {
        const tw = this.placeTower(t.id, t.c, t.r, t.spent, false);
        tw.setLevel(t.level); tw.targetMode = t.mode; tw.kills = t.kills; tw.condition = t.condition ?? 1;
      }
    } catch {
      return this.newGame();
    }
    this.tutorial = -1;
    this.enterBuild(true);
    // pick the rush clock up where it was left
    const left = (JSON.parse(raw) as SaveData).dayLeft;
    if (this.dayLeft !== null && typeof left === 'number') this.dayLeft = Math.max(5, left);
    this.trophyRoom.award(researchTrophies(this.owned));
    // older saves past night 10 still deserve the lumberjack warning
    if (this.nightN >= 11) setTimeout(() => this.announceLumberjacks(), 1400);
  }

  private reset() {
    this.world.clear();
    for (const k of this.tileTowers.keys()) { const [c, r] = k.split(',').map(Number); this.island.setTileClutter(c, r, true); }
    this.tileTowers.clear();
    this.gold = START_GOLD; this.lives = this.maxLives = START_LIVES; this.embers = START_EMBERS;
    this.nightN = 1; this.nightCount = 0; this.endless = false;
    this.owned = new Set(); this.mods = computeMods(this.owned); this.world.mods = this.mods;
    this.stats = { kills: 0, built: 0 };
    this.announced = new Set();
    this.run = { hurt: false, upgraded: false };
    this.select(null); this.setBuilding(null);
    this.end.hide();
    this.speed = 1; this.hud.setSpeed(1);
    this.setPaused(false);
  }

  private setMode(m: ModeDef) {
    this.mode = m;
    this.world.hpMult = m.hp;
    this.hud.setMode(m.name, m.dayTimer !== null);
  }

  private enterBuild(fromTitle = false) {
    this.phase = 'build';
    // Lantern Rush: every day after the first runs on the clock
    this.dayLeft = this.mode.dayTimer !== null && this.nightN > 1 ? this.mode.dayTimer : null;
    this.hud.setCountdown(this.dayLeft);
    this.title.show(false);
    this.hud.show(true);
    this.stage.setNight(this.dayTone());
    audio.setMusicIntensity(0);
    audio.setBossMode(false);
    if (fromTitle) this.stage.intro();
    this.hud.setNightInfo(this.nightN, TOTAL_NIGHTS, 'build', buildNight(this.nightN));
    this.builtThisDay.clear();
    this.refreshUi();
    this.updateCoach();
  }

  private dayTone() { return Math.min(0.28, (this.nightN - 1) * 0.014); }

  startNight() {
    if (this.phase !== 'build') return;
    this.phase = 'night';
    this.dayLeft = null;
    this.hud.setCountdown(null);
    audio.play('wave_start');
    audio.setMusicIntensity(1);
    this.world.startNight(this.nightN);
    this.nightCount = nightTotal(this.nightN);
    this.livesAtNightStart = this.lives;
    this.stage.setNight(1);
    this.builtThisDay.clear();
    const boss = buildNight(this.nightN).some((g) => g.type === 'king');
    if (boss) {
      this.hud.banner(`Night ${this.nightN}`, 'Something big stirs in the pumpkin patch…', 'boss');
    } else {
      const lines = ['The dead are restless…', 'Something shuffles in the dark…', 'Lanterns lit. Here they come!', 'Brrraaains… and pie?', 'Hold the hollow!'];
      this.hud.banner(`Night ${this.nightN}`, lines[(this.nightN - 1) % lines.length], 'night');
    }
    this.hud.setNightInfo(this.nightN, TOTAL_NIGHTS, 'night', []);
    if (this.tutorial === 2) { this.tutorial = 3; }
    this.updateCoach();
    this.refreshUi();
  }

  private dawn() {
    const n = this.nightN;
    const flawless = this.lives >= this.livesAtNightStart;
    const bonus = dawnBonus(n);
    const em = dawnEmbers(n, flawless);
    let interest = 0;
    if (this.mods.interest) interest = Math.min(50, Math.floor(this.gold * 0.05));
    this.gold += bonus + interest;
    this.embers += em;
    audio.play('wave_clear');
    this.hud.banner('Dawn', `+${bonus + interest} gold · +${em} ember${em > 1 ? 's' : ''}${flawless ? ' · flawless!' : ''}`, 'dawn');
    if (interest) this.hud.toast(`Piggy bank interest: <b>+${interest}</b> gold`, ICON.coin);
    this.nightN++;
    const won = n === TOTAL_NIGHTS && !this.endless;
    this.trophyRoom.award([...dawnTrophies(n, this.run, this.mode.id), ...(won ? goldTrophies(this.gold) : [])]);

    if (won) {
      this.phase = 'over';
      localStorage.removeItem(SAVE_KEY);
      audio.play('victory');
      setTimeout(() => this.end.show('victory', { nights: n, kills: this.stats.kills, towers: this.stats.built, gold: this.gold }, [
        { label: 'Keep defending (endless)', cls: 'plum', fn: () => { this.endless = true; this.end.hide(); this.enterBuild(); this.save(); } },
        { label: 'New game', fn: () => this.newGame() },
      ]), 1800);
      this.stage.setNight(this.dayTone());
      return;
    }
    this.enterBuild();
    const affordable = TECHS.filter((t) => canResearch(t.id, this.owned, this.embers)).length;
    if (affordable) setTimeout(() => this.hud.toast(`The Almanac has <b>${affordable}</b> page${affordable > 1 ? 's' : ''} you can learn`, ICON.book), 1400);
    // let the dawn banner finish, then the fanfare
    if (this.nightN === 11) setTimeout(() => this.announceLumberjacks(), 2600);
    if (this.nightN === UPGRADE_UNLOCK_NIGHT) {
      setTimeout(() => { audio.play('upgrade'); this.hud.toast('<b>Tower upgrades unlocked!</b> Click a tower to upgrade it up to three stars.', ICON.star); }, 2200);
    }
    if (buildNight(this.nightN).some((g) => g.type === 'king')) {
      setTimeout(() => this.hud.toast('Tonight the <b>Pumpkin King</b> rises! Owls and catapults hurt him most. Try <b>Strong</b> targeting.', ICON.skull), 2600);
    }
    if (this.tutorial === 3) this.tutorial = 4;
    this.updateCoach();
    this.save();
  }

  private leak(livesLost: number) {
    this.run.hurt = true;
    this.lives = Math.max(0, this.lives - livesLost);
    audio.play('life_lost');
    this.hud.hurtFlash();
    this.stage.addShake(0.25);
    this.cottageShake = 1;
    const scr = { x: 0, y: 0 };
    this.stage.project(this.island.porch.clone().add(new THREE.Vector3(0, 1, 0)), scr);
    this.hud.floater(scr.x, scr.y, `-${livesLost} ♥`, 'hurt');
    this.fx.puffs.spawn({ x: this.island.porch.x, y: 0.6, z: this.island.porch.z, count: 10, color: [0xe8dcc0, 0xc8d8a8], size: 0.5, grow: 2, speed: 1.2, up: 0.5, life: 0.8, alpha: 0.6 });
    this.refreshUi();
    if (this.lives <= 0 && this.phase === 'night') this.defeat();
  }

  private defeat() {
    this.phase = 'over';
    localStorage.removeItem(SAVE_KEY);
    audio.play('game_over');
    audio.stopMusic(2);
    this.trophyRoom.award(['lost']);
    this.setBuilding(null);
    this.select(null);
    setTimeout(() => this.end.show('defeat', { nights: this.nightN - 1, kills: this.stats.kills, towers: this.stats.built, gold: this.gold }, [
      { label: 'Try again', fn: () => { audio.startMusic(); this.newGame(); } },
      { label: 'Title screen', cls: 'cream', fn: () => this.quitToTitle() },
    ]), 1500);
  }

  private quitToTitle() {
    this.tour.finish();
    if (this.phase === 'build') this.save();
    this.phase = 'title';
    this.world.clear();
    this.end.hide();
    this.select(null); this.setBuilding(null);
    this.hud.show(false);
    this.setPaused(false);
    this.title.show(true, !!localStorage.getItem(SAVE_KEY));
    audio.setMusicIntensity(0);
    this.stage.setNight(0.2);
  }

  private save() {
    if (this.phase !== 'build') return;
    const data: SaveData = {
      v: 1, night: this.nightN, gold: this.gold, lives: this.lives, maxLives: this.maxLives, embers: this.embers,
      owned: [...this.owned], kills: this.stats.kills, built: this.stats.built, endless: this.endless, announced: [...this.announced], run: this.run,
      mode: this.mode.id, dayLeft: this.dayLeft,
      towers: this.world.towers.map((t) => ({ id: t.id, c: t.c, r: t.r, level: t.level, mode: t.targetMode, spent: t.spent, kills: t.kills, condition: t.condition })),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  // =========================================================================
  // building & selection

  private towerCost(id: TowerId) { return Math.round(TOWERS[id].cost * this.mods.costMult); }

  setBuilding(id: TowerId | null) {
    if (id && !this.mods.unlocked.has(id)) { audio.play('ui_error'); return; }
    this.building = id;
    this.pendingTile = null;
    if (id) this.select(null);
    this.cursor.setGrid(!!id);
    if (!id) this.cursor.hide();
    this.stage.canvas.style.cursor = id ? 'crosshair' : '';
    if (id && this.tutorial === 0) this.tutorial = 1;
    this.updateCoach();
    this.refreshUi();
  }

  private canPlace(c: number, r: number) {
    return this.map.isBuildable(c, r) && !this.tileTowers.has(`${c},${r}`);
  }

  private placeTower(id: TowerId, c: number, r: number, spent: number, fx = true): Tower {
    const w = this.map.toWorld(c, r);
    const t = new Tower(id, c, r, new THREE.Vector3(w.x, 0, w.z), spent, this.fx.decals.softTexture);
    this.world.addTower(t);
    this.tileTowers.set(`${c},${r}`, t);
    this.island.setTileClutter(c, r, false);
    if (fx) {
      this.fx.puffs.spawn({ x: w.x, y: 0.15, z: w.z, count: 10, color: [0xf0e0c0, 0xd8c8a0], size: 0.45, grow: 2.2, speed: 1.6, up: 0.3, life: 0.7, alpha: 0.6, spread: 0.3 });
      this.fx.chunks.spawn({ x: w.x, y: 0.3, z: w.z, count: 8, color: [0xa86e3e, 0xcf9a5e, 0x93bf55], speed: 2, up: 3, size: 0.045, life: 0.8 });
      this.fx.glows.spawn({ x: w.x, y: 0.4, z: w.z, count: 12, color: [0xfff0b0, 0xffd070], size: 0.12, speed: 1.8, up: 1.2, life: 0.6 });
    }
    return t;
  }

  private tryPlace(c: number, r: number) {
    const id = this.building!;
    if (!this.canPlace(c, r)) { audio.play('place_invalid'); return; }
    const cost = this.towerCost(id);
    if (this.gold < cost) { audio.play('ui_error'); this.hud.poor(); this.hud.toast('Not enough gold', ICON.coin); return; }
    this.gold -= cost;
    const t = this.placeTower(id, c, r, cost);
    this.builtThisDay.add(t);
    this.stats.built++;
    audio.play('build');
    if (this.tutorial === 1) { this.tutorial = 2; this.updateCoach(); }
    if (!this.shiftHeld || this.gold < cost) this.setBuilding(null);
    this.refreshUi();
    this.save();
  }

  private select(t: Tower | null) {
    this.selected = t;
    if (t) {
      const st = t.stats(this.world);
      this.cursor.select(t.pos, st.range);
      audio.play('ui_open', { volume: 0.6 });
    } else {
      this.cursor.select(null);
    }
    this.updatePanel(true);
  }

  private towerView(t: Tower): TowerView {
    const st = t.stats(this.world);
    const maxed = t.level >= MAX_LEVEL;
    const cost = maxed ? null : Math.round(upgradeCost(t.def, t.level) * this.mods.costMult);
    let next: TowerView['next'];
    if (!maxed) {
      const a = levelMult(t.level), b = levelMult(t.level + 1);
      next = { damage: st.damage * b.damage / a.damage, rate: st.rate * b.rate / a.rate, range: st.range * b.range / a.range };
    }
    return {
      id: t.id, level: t.level, kills: t.kills, targetMode: t.targetMode,
      damage: st.damage, rate: st.rate, range: st.range, next,
      upgradeCost: cost, sellValue: this.sellValue(t), canAfford: cost !== null && this.gold >= cost,
      condition: t.condition, repairCost: this.repairPrice(t), canRepair: this.gold >= this.repairPrice(t), nightRate: this.phase === 'night',
      repairLocked: !this.canRepairNow(),
      upgradeLockedUntil: upgradesUnlocked(this.nightN) ? null : UPGRADE_UNLOCK_NIGHT,
    };
  }

  private sellValue(t: Tower) {
    // full refund for towers placed this morning: no harm in changing your mind
    return this.builtThisDay.has(t) && this.phase === 'build' ? t.spent : Math.round(t.spent * SELL_REFUND);
  }

  private updatePanel(force = false) {
    if (!force && !this.selected) return;
    this.hud.showTower(this.selected ? this.towerView(this.selected) : null);
    if (this.selected) this.cursor.select(this.selected.pos, this.selected.stats(this.world).range);
  }

  private upgradeSelected() {
    const t = this.selected;
    if (!t || t.level >= MAX_LEVEL) return;
    if (!upgradesUnlocked(this.nightN)) {
      audio.play('ui_error');
      this.hud.toast(`Tower upgrades unlock on <b>Night ${UPGRADE_UNLOCK_NIGHT}</b>. Build more towers for now!`, ICON.lock);
      return;
    }
    const cost = Math.round(upgradeCost(t.def, t.level) * this.mods.costMult);
    if (this.gold < cost) { audio.play('ui_error'); this.hud.poor(); return; }
    this.gold -= cost;
    t.spent += cost;
    t.setLevel(t.level + 1);
    this.run.upgraded = true;
    audio.play('upgrade');
    this.fx.glows.spawn({ x: t.pos.x, y: 0.6, z: t.pos.z, count: 24, color: [0xffe27a, 0xfff6c0, 0xffb040], size: 0.14, speed: 1.6, up: 2, life: 0.9, spread: 0.3 });
    this.fx.decals.spawn('ring', t.pos.x, t.pos.z, { color: 0xffd060, r0: 0.3, r1: 1.2, life: 0.5, additive: true, y: 0.04 });
    this.refreshUi();
    this.updatePanel(true);
    this.save();
  }

  private sellSelected() {
    const t = this.selected;
    if (!t) return;
    const refund = this.sellValue(t);
    this.gold += refund;
    this.world.removeTower(t);
    this.tileTowers.delete(`${t.c},${t.r}`);
    this.island.setTileClutter(t.c, t.r, true);
    this.builtThisDay.delete(t);
    audio.play('sell');
    this.fx.puffs.spawn({ x: t.pos.x, y: 0.3, z: t.pos.z, count: 12, color: [0xf0e0c0, 0xd8c8a0], size: 0.5, grow: 2.2, speed: 1.5, up: 0.5, life: 0.8, alpha: 0.6 });
    this.fx.chunks.spawn({ x: t.pos.x, y: 0.4, z: t.pos.z, count: 5, color: [0xffd34a, 0xf2b630], speed: 1.4, up: 3.5, size: 0.05, life: 0.8 });
    const scr = { x: 0, y: 0 };
    this.stage.project(t.pos.clone().setY(1), scr);
    this.hud.floater(scr.x, scr.y, `+${refund}`);
    this.select(null);
    this.refreshUi();
    this.save();
  }

  private repairPrice(t: Tower) { return Math.round(repairCost(t.spent, t.condition, this.phase === 'night') * this.mods.costMult); }

  private repairTower(t: Tower): boolean {
    const cost = this.repairPrice(t);
    if (cost <= 0 || this.gold < cost) return false;
    this.gold -= cost;
    t.repair();
    this.fx.glows.spawn({ x: t.pos.x, y: 0.6, z: t.pos.z, count: 16, color: [0xfff0b0, 0xffd070, 0xffffff], size: 0.12, speed: 1.4, up: 1.6, life: 0.7, spread: 0.3 });
    this.fx.chunks.spawn({ x: t.pos.x, y: 0.5, z: t.pos.z, count: 5, color: [0xcfd6de, 0xa86e3e], speed: 1.2, up: 2, size: 0.035, life: 0.6 });
    return true;
  }

  private canRepairNow() { return repairsAllowed(this.phase === 'night', this.mods.nightRepairs); }

  private repairsLockedNotice() {
    audio.play('ui_error');
    this.hud.toast('Repairs wait for <b>dawn</b>. Learn the <b>Night Toolbox</b> in the Almanac to repair during the invasion.', ICON.lock);
  }

  private repairSelected() {
    const t = this.selected;
    if (!t || t.condition >= 0.999) return;
    if (!this.canRepairNow()) { this.repairsLockedNotice(); return; }
    if (!this.repairTower(t)) { audio.play('ui_error'); this.hud.poor(); return; }
    audio.play('repair');
    this.refreshUi();
    this.updatePanel(true);
    this.save();
  }

  /** Fix the worst first until the gold runs out. */
  private repairAll() {
    if (!this.canRepairNow()) { this.repairsLockedNotice(); return; }
    const hurt = this.world.towers.filter((t) => t.condition < 0.999).sort((a, b) => a.condition - b.condition);
    let fixed = 0;
    for (const t of hurt) if (this.repairTower(t)) fixed++;
    if (!fixed) { audio.play('ui_error'); this.hud.poor(); return; }
    audio.play('repair');
    if (fixed < hurt.length) this.hud.toast(`Repaired ${fixed} of ${hurt.length} towers. Not enough gold for the rest.`, ICON.wrench);
    this.refreshUi();
    this.updatePanel(true);
    this.save();
  }

  // =========================================================================
  // research

  private openAlmanac() {
    this.setBuilding(null);
    this.almanac.open(this.owned, this.embers);
    if (this.tutorial === 4) { this.tutorial = -1; this.updateCoach(); }
  }

  private openTrophies() {
    if (this.tour.active || this.announcer.active) return;
    this.setBuilding(null);
    this.settings.toggle(false);
    this.trophyRoom.open();
  }

  private research(id: TechId) {
    if (!canResearch(id, this.owned, this.embers)) return;
    const t = TECH_BY_ID[id];
    this.embers -= t.cost;
    this.owned.add(id);
    this.mods = computeMods(this.owned);
    this.world.mods = this.mods;
    if (id === 'home_door') { this.maxLives += 5; this.lives += 5; }
    this.world.refreshTowerModels();
    audio.play('research');
    this.almanac.render(this.owned, this.embers);
    const unlocked = TOWER_ORDER.find((tid) => TOWER_UNLOCK[tid] === id);
    this.hud.toast(unlocked ? `New tower: <b>${t.name}</b>! Press <b>${TOWERS[unlocked].hotkey}</b>` : `Learned <b>${t.name}</b>`, ICON.book);
    this.trophyRoom.award(researchTrophies(this.owned));
    this.refreshUi();
    this.save();
  }

  // =========================================================================
  // ui sync

  private refreshUi() {
    this.hud.setResources(Math.floor(this.gold), this.embers, this.lives, this.maxLives);
    this.hud.refreshBuild(this.mods, this.gold, this.building);
    this.hud.setAlmanacBadge(TECHS.filter((t) => canResearch(t.id, this.owned, this.embers)).length);
    if (this.phase === 'night') this.hud.setProgress(this.world.remaining, this.nightCount);
  }

  private updateCoach() {
    const steps: (string | null)[] = [
      `Pick the <b>Acorn Turret</b> from the bar below${isTouch ? '' : ' (or press <b>1</b>)'}`,
      isTouch
        ? 'Tap the grass beside the <b>dirt road</b> to preview, then tap again to build. Zombies walk the road to your cottage!'
        : 'Place it on the grass beside the <b>dirt road</b>. Zombies walk the road to your cottage!',
      'Nice! Build another if you like, then press <b>Nightfall</b> when you’re ready.',
      null,
      'You survived! Spend <b>embers</b> in the <b>Almanac</b> (book icon, top-right) to unlock new towers.',
    ];
    this.hud.coach(this.tutorial >= 0 && this.phase === 'build' ? steps[this.tutorial] ?? null : null);
  }

  private cycleSpeed() {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.hud.setSpeed(this.speed);
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.hud.setPaused(p);
    this.pauseVeil.show(p);
  }

  // =========================================================================
  // input

  private bindInput() {
    const c = this.stage.canvas;
    // every finger (or the mouse) currently down, and where it was last seen
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; btn: number; moved: boolean; touch: boolean } | null = null;
    let pinch: { dist: number; x: number; y: number } | null = null;
    /** a two-finger gesture happened: swallow the tap when the fingers lift */
    let gesture = false;
    const measure = () => {
      const [a, b] = [...pts.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    c.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      if (pts.size === 1) {
        down = { x: e.clientX, y: e.clientY, btn: e.button, moved: false, touch: e.pointerType === 'touch' };
        gesture = false;
      } else if (pts.size === 2) {
        pinch = measure();
        gesture = true;
        down = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const last = pts.get(e.pointerId);
      if (last) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last.x = e.clientX; last.y = e.clientY;
        // two fingers: pinch to zoom, drag together to pan
        if (pinch && pts.size >= 2) {
          const m = measure();
          this.stage.zoomBy(m.dist / pinch.dist);
          this.stage.panBy(m.x - pinch.x, m.y - pinch.y);
          pinch = m;
          return;
        }
        if (down) {
          if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > (down.touch ? 10 : 6)) down.moved = true;
          if (down.moved) { this.stage.panBy(dx, dy); return; }
        }
      }
      if (e.pointerType !== 'touch') this.updateHover(e.clientX, e.clientY);
    });
    const lift = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (gesture) { if (!pts.size) gesture = false; return; }
      const d = down; down = null;
      return d;
    };
    c.addEventListener('pointercancel', (e) => { lift(e); down = null; });
    c.addEventListener('pointerup', (e) => {
      const d = lift(e);
      if (!d || d.moved || this.phase === 'title' || this.phase === 'over') return;
      if (d.btn === 2) { if (this.building) this.setBuilding(null); else this.select(null); return; }
      if (d.btn !== 0) return;
      if (d.touch && this.building && this.previewTap(e.clientX, e.clientY)) return;
      this.click(e.clientX, e.clientY);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.stage.zoomBy(e.deltaY > 0 ? 0.9 : 1.11); }, { passive: false });

    window.addEventListener('keydown', (e) => {
      this.shiftHeld = e.shiftKey;
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (this.trophyRoom.isOpen) { if (k === 'escape' || k === 't') this.trophyRoom.close(); return; }
      if (this.phase === 'title' && k === 't') { this.openTrophies(); return; }
      if (this.phase === 'title' || this.phase === 'over' || this.tour.active || this.announcer.active) return;
      if (this.almanac.isOpen) { if (k === 'escape' || k === 'b') this.almanac.close(); return; }
      const tower = TOWER_ORDER.find((id) => TOWERS[id].hotkey === k);
      if (tower) { this.setBuilding(this.building === tower ? null : tower); return; }
      switch (k) {
        case 'escape':
          if (this.settings.open) this.settings.toggle(false);
          else if (this.building) this.setBuilding(null);
          else if (this.selected) this.select(null);
          else this.setPaused(!this.paused);
          break;
        case ' ': e.preventDefault(); this.startNight(); break;
        case 'q': this.stage.rotate(-1); break;
        case 'e': this.stage.rotate(1); break;
        case 'f': this.cycleSpeed(); break;
        case 'p': this.setPaused(!this.paused); break;
        case 'b': this.openAlmanac(); break;
        case 't': this.openTrophies(); break;
        case 'u': this.upgradeSelected(); break;
        case 'r': this.repairSelected(); break;
        case 'x': case 'delete': this.sellSelected(); break;
        case 'home': this.stage.resetView(); break;
      }
    });
    window.addEventListener('keyup', (e) => { this.shiftHeld = e.shiftKey; this.keys.delete(e.key.toLowerCase()); });
    window.addEventListener('blur', () => this.keys.clear());
  }

  private tileAt(x: number, y: number): { c: number; r: number; pos: THREE.Vector3 } | null {
    const hit = this.stage.pick(x, y, 0);
    if (!hit) return null;
    const g = this.map.toGrid(hit.x, hit.z);
    if (!this.map.inBounds(g.c, g.r) || this.map.kind(g.c, g.r) === 'void') return null;
    const w = this.map.toWorld(g.c, g.r);
    return { ...g, pos: new THREE.Vector3(w.x, 0, w.z) };
  }

  private lastMouse = { x: 0, y: 0 };
  private updateHover(x: number, y: number) {
    this.lastMouse = { x, y };
    if (this.phase === 'title' || this.phase === 'over') return;
    const t = this.tileAt(x, y);
    if (this.building) {
      if (!t) { this.cursor.hide(); return; }
      const ok = this.canPlace(t.c, t.r) && this.gold >= this.towerCost(this.building);
      const range = TOWERS[this.building].range * this.mods.rangeAll;
      this.cursor.show(this.building, t.pos, range, ok, true);
    } else {
      const tower = t ? this.tileTowers.get(`${t.c},${t.r}`) : undefined;
      this.cursor.hoverTile(tower ? tower.pos : null);
      this.stage.canvas.style.cursor = tower ? 'pointer' : '';
    }
  }

  /** Touch has no hover: the first tap on a tile shows the build preview, the second builds. */
  private previewTap(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    const key = t ? `${t.c},${t.r}` : null;
    if (key && key === this.pendingTile) return false;
    this.pendingTile = key;
    this.lastMouse = { x, y };
    this.updateHover(x, y);
    if (key) audio.play('ui_hover');
    return true;
  }

  private click(x: number, y: number) {
    const t = this.tileAt(x, y);
    if (this.building) {
      if (t) this.tryPlace(t.c, t.r);
      return;
    }
    const tower = t ? this.tileTowers.get(`${t.c},${t.r}`) : undefined;
    if (tower && tower !== this.selected) this.select(tower);
    else if (!tower) this.select(null);
  }

  // =========================================================================
  // loop

  start() {
    this.timer.connect(document);
    const loop = (ts: number) => {
      requestAnimationFrame(loop);
      this.timer.update(ts);
      const dt = Math.min(this.timer.getDelta(), 0.05);
      this.time += dt;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  /**
   * Lantern Rush's day clock. Runs in real seconds (game speed doesn't shorten it) and keeps going
   * while the Almanac or trophy room is open; only pausing, the tour or an announcement stop it.
   */
  private tickDay(dt: number) {
    if (this.dayLeft === null || this.phase !== 'build' || this.paused || this.tour.active || this.announcer.active) return;
    const before = Math.ceil(this.dayLeft);
    this.dayLeft -= dt;
    const now = Math.ceil(this.dayLeft);
    if (now !== before && now >= 1 && now <= 5) audio.play(now === 1 ? 'rush_last' : 'rush_tick');
    if (this.dayLeft <= 0) {
      if (this.almanac.isOpen) this.almanac.close();
      if (this.trophyRoom.isOpen) this.trophyRoom.close();
      this.startNight();
      return;
    }
    this.hud.setCountdown(this.dayLeft);
  }

  private frame(dt: number) {
    const time = this.time;
    if (this.autoQuality && this.phase !== 'title') {
      this.fpsAcc += dt; this.fpsFrames++;
      if (this.fpsAcc > 4) {
        const fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0; this.fpsFrames = 0;
        const q = this.stage.quality;
        if (fps < 40 && q !== 'low') {
          this.stage.setQuality(q === 'high' ? 'medium' : 'low');
          console.info(`[quality] ${fps.toFixed(0)} fps → ${this.stage.quality}`);
        }
      }
    }
    // keyboard panning
    const pan = 520 * dt;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.stage.panBy(0, pan);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.stage.panBy(0, -pan);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.stage.panBy(pan, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.stage.panBy(-pan, 0);

    const simulating = (this.phase === 'build' || this.phase === 'night' || this.phase === 'over') && !this.paused && !this.almanac.isOpen && !this.trophyRoom.isOpen;
    if (simulating) {
      const total = dt * this.speed;
      const steps = Math.ceil(total / (1 / 45));
      for (let i = 0; i < steps; i++) this.world.update(total / steps, time);
      if (this.phase === 'night' && !this.world.nightActive) this.dawn();
      if (this.phase === 'night') audio.setBossMode(this.world.hasBoss);
    }

    this.tickDay(dt);

    // re-evaluate hover while the camera glides
    if (this.building && (!isTouch || this.pendingTile)) this.updateHover(this.lastMouse.x, this.lastMouse.y);

    this.panelT -= dt;
    if (this.panelT <= 0) {
      this.panelT = 0.25;
      this.updatePanel();
      if (this.phase === 'night') this.hud.setProgress(this.world.remaining, this.nightCount);
      const boss = this.world.zombies.find((z) => z.boss && z.alive);
      this.hud.setBoss(boss ? boss.hp / boss.maxHp : null);
      // keep "can afford" states fresh as gold trickles in
      this.hud.refreshBuild(this.mods, this.gold, this.building);
      const hurt = this.world.towers.filter((t) => t.condition < 0.999);
      const total = hurt.reduce((sum, t) => sum + this.repairPrice(t), 0);
      this.hud.setRepairAll(this.phase === 'title' ? 0 : hurt.length, total, this.gold >= Math.min(...hurt.map((t) => this.repairPrice(t)), Infinity), this.phase === 'night', !this.canRepairNow());
    }

    // cottage wobble when hit
    if (this.cottageShake > 0) {
      this.cottageShake = Math.max(0, this.cottageShake - dt * 2.5);
      this.island.cottage.rotation.z = Math.sin(time * 40) * 0.03 * this.cottageShake;
      this.island.cottage.scale.y = 1 - Math.sin(this.cottageShake * Math.PI) * 0.05;
    }

    this.island.windUniforms.uTime.value = time;
    Glow.update(this.stage.night, time);
    this.ambient.update(dt, time, this.stage.night);
    this.cursor.update(dt, time);
    for (const t of this.world.towers) t.setNightGlow(this.stage.night);
    this.stage.update(dt, time);
    if (Math.abs(this.stage.night - this.lastTod) > 0.02) {
      this.lastTod = this.stage.night;
      audio.setTimeOfDay(this.stage.night);
    }
    this.world.syncOverlays();
    const pxPerUnit = this.stage.renderer.domElement.height / (this.stage.camera.top - this.stage.camera.bottom);
    this.fx.update(simulating ? dt * this.speed : dt * 0.3, pxPerUnit);
    this.stage.render();
  }
}
