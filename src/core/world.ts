// The simulation: zombies walking the road, towers shooting, projectiles flying.
// Exposes a small `Ctx` surface that entities use to affect the world.
import * as THREE from 'three';
import { audio, type SfxName } from '../audio';
import type { GameMap } from '../data/map';
import { Path, smooth } from '../data/path';
import { spawnSchedule } from '../data/waves';
import { CHOP, DIFFICULTY, chopChance, goldScale, hpScale, type ZombieId } from '../data/zombies';
import type { Mods } from '../data/tech';
import { FirePatch, type Projectile } from '../entities/projectiles';
import { Tower } from '../entities/tower';
import { Zombie } from '../entities/zombie';
import type { FX } from '../fx/particles';
import { ZombieOverlays } from '../fx/overlays';
import type { Stage } from '../render/stage';

export interface DamageOpts { crit?: boolean; pierceArmor?: boolean; quiet?: boolean }

export interface Ctx {
  readonly zombies: readonly Zombie[];
  readonly path: Path;
  readonly fx: FX;
  readonly mods: Mods;
  damage(z: Zombie, amount: number, o: DamageOpts): void;
  zombiesNear(x: number, z: number, r: number): Zombie[];
  addProjectile(p: Projectile, from: Tower): void;
  addFire(x: number, z: number, r: number, dps: number, life: number): void;
  sfx(name: SfxName, at?: THREE.Vector3, volume?: number): void;
  shake(amount: number): void;
}

export interface WorldEvents {
  onKill(z: Zombie, gold: number, screen: { x: number; y: number }): void;
  onLeak(z: Zombie): void;
  onCrit(screen: { x: number; y: number }, amount: number): void;
  onBossSpawn(z: Zombie): void;
  /** a tower's fuse ran out: it exploded and is gone (the game frees its tile) */
  onTowerDestroyed(t: Tower): void;
}

interface QueuedSpawn { t: number; type: ZombieId }

export class World implements Ctx {
  readonly zombies: Zombie[] = [];
  readonly towers: Tower[] = [];
  readonly path: Path;
  readonly group = new THREE.Group();
  private overlays: ZombieOverlays;
  private projectiles: { p: Projectile; from: Tower }[] = [];
  private fires: FirePatch[] = [];
  private queue: QueuedSpawn[] = [];
  private nightT = 0;
  private nightN = 1;
  private scr = { x: 0, y: 0 };
  private tmp = new THREE.Vector3();
  private bossCount = 0;

  constructor(
    map: GameMap,
    private stage: Stage,
    readonly fx: FX,
    public mods: Mods,
    private events: WorldEvents,
  ) {
    const pts = map.waypoints.map((w) => map.toWorld(w.c, w.r));
    this.path = new Path(smooth(pts, 3));
    this.overlays = new ZombieOverlays(600, fx.decals.softTexture);
    stage.scene.add(this.group, this.overlays.group);
  }

  // --- Ctx -----------------------------------------------------------------
  zombiesNear(x: number, z: number, r: number): Zombie[] {
    const out: Zombie[] = [];
    for (const zb of this.zombies) {
      if (!zb.alive) continue;
      const pad = zb.boss ? 0.35 : 0;
      if (Math.hypot(zb.pos.x - x, zb.pos.z - z) <= r + pad) out.push(zb);
    }
    return out;
  }

  addProjectile(p: Projectile, from: Tower): void {
    this.projectiles.push({ p, from });
    this.group.add(p.object);
  }

  addFire(x: number, z: number, r: number, dps: number, life: number): void {
    this.fires.push(new FirePatch(x, z, r, dps, life));
    this.fx.decals.spawn('soft', x, z, { color: 0xff6a20, r0: r * 0.9, r1: r, life, alpha: 0.45, additive: true });
  }

  sfx(name: SfxName, at?: THREE.Vector3, volume = 1): void {
    let pan = 0;
    if (at) {
      this.stage.project(at, this.scr);
      pan = THREE.MathUtils.clamp((this.scr.x / window.innerWidth) * 2 - 1, -1, 1) * 0.6;
    }
    audio.play(name, { pan, volume });
  }

  shake(amount: number): void { this.stage.addShake(amount); }

  private lastHitFrom: Tower | null = null;

  damage(z: Zombie, amount: number, o: DamageOpts): void {
    if (!z.alive) return;
    let dmg = amount;
    if (this.mods.molasses && z.slowTimer > 0) dmg *= 1.2;
    if (!o.pierceArmor) dmg = Math.max(1, dmg - z.def.armor);
    z.hp -= dmg;
    if (!o.quiet) z.hitFlash();
    if (o.crit) {
      z.aimPoint(this.tmp);
      this.stage.project(this.tmp, this.scr);
      this.events.onCrit({ ...this.scr }, Math.round(dmg));
    }
    if (z.hp <= 0) this.kill(z);
  }

  private kill(z: Zombie) {
    z.startDeath();
    if (this.lastHitFrom) this.lastHitFrom.kills++;
    const p = z.pos;
    const goo = [0x8fbf5a, 0x6fa040, 0xb5d47a];
    this.fx.chunks.spawn({ x: p.x, y: 0.3, z: p.z, count: z.boss ? 30 : 10, color: goo, speed: 2.2, up: 3, size: z.boss ? 0.09 : 0.05, life: 1 });
    this.fx.puffs.spawn({ x: p.x, y: 0.25, z: p.z, count: z.boss ? 16 : 7, color: [0xe8dcc0, 0xc8d8a8], size: z.boss ? 0.9 : 0.45, grow: 2, speed: 1.2, up: 0.5, life: 0.8, alpha: 0.6, spread: 0.15 });
    this.fx.decals.spawn('splat', p.x, p.z, { color: 0x7fae4a, r0: z.boss ? 0.8 : 0.28, r1: z.boss ? 1.1 : 0.36, life: 3, alpha: 0.55 });
    this.sfx('zombie_die', p, z.boss ? 1 : 0.8);
    if (z.boss) { this.shake(0.4); this.sfx('boss_roar', p, 0.8); }
    const gold = Math.max(1, Math.round(z.goldValue * this.mods.goldMult));
    this.tmp.set(p.x, z.rig.height + 0.2, p.z);
    this.stage.project(this.tmp, this.scr);
    // coins burst out
    this.fx.chunks.spawn({ x: p.x, y: 0.5, z: p.z, count: Math.min(6, 2 + Math.floor(gold / 4)), color: [0xffd34a, 0xf2b630], speed: 1.2, up: 3.5, size: 0.05, life: 0.8 });
    this.events.onKill(z, gold, { ...this.scr });
  }

  // --- nights --------------------------------------------------------------
  startNight(n: number): void {
    this.nightN = n;
    this.nightT = 0;
    this.queue = spawnSchedule(n);
  }

  get remaining(): number { return this.queue.length + this.zombies.filter((z) => z.alive).length; }
  get nightActive(): boolean { return this.queue.length > 0 || this.zombies.length > 0; }
  get hasBoss(): boolean { return this.bossCount > 0; }

  private spawn(type: ZombieId) {
    const z = new Zombie(type, hpScale(this.nightN) * DIFFICULTY.hp, goldScale(this.nightN));
    this.zombies.push(z);
    this.group.add(z.object);
    z.update(0, this.path, 0);
    const p = z.pos;
    this.fx.puffs.spawn({ x: p.x, y: 0.3, z: p.z, count: 6, color: [0x9dff9a, 0x6fd88a], size: 0.4, grow: 2, speed: 0.6, up: 0.4, life: 0.9, alpha: 0.45 });
    if (z.boss) { this.sfx('boss_roar', p, 1); this.shake(0.35); this.events.onBossSpawn(z); }
  }

  // --- towers --------------------------------------------------------------
  addTower(t: Tower) {
    this.towers.push(t);
    this.group.add(t.root);
    t.refreshModel(this);
  }

  removeTower(t: Tower) {
    this.towers.splice(this.towers.indexOf(t), 1);
    this.group.remove(t.root);
  }

  // --- lumberjacks ---------------------------------------------------------
  private chopping = new Map<Zombie, Tower>();

  private updateLumberjack(z: Zombie) {
    const target = this.chopping.get(z);
    if (target) {
      // the tower was sold, or there's nothing left to chop: move along
      if (!this.towers.includes(target) || target.broken) { z.stopChop(); this.chopping.delete(z); return; }
      if (z.chopHit) {
        this.chop(target);
        if (--z.swingsLeft <= 0 || target.broken) { z.stopChop(); this.chopping.delete(z); }
      }
      return;
    }
    // walking: every tower within reach gets exactly one roll of the dice
    for (const t of this.towers) {
      if (z.considered.has(t) || t.broken) continue;
      if (Math.hypot(t.pos.x - z.pos.x, t.pos.z - z.pos.z) > CHOP.reach) continue;
      z.considered.add(t);
      if (Math.random() < chopChance(this.nightN)) {
        z.startChop(t.pos.x, t.pos.z);
        this.chopping.set(z, t);
        this.sfx('zombie_groan', z.pos, 0.7);
        break;
      }
    }
  }

  /** KA-BOOM. Purely cosmetic (hurts nobody), but the tower is gone and must be rebuilt. */
  private explode(t: Tower) {
    const { x, z } = t.pos;
    this.removeTower(t);
    // fireball and flash
    this.fx.glows.spawn({ x, y: 0.5, z, count: 30, color: [0xfff0b0, 0xffb040, 0xff6a1a, 0xffffff], size: 0.45, grow: 0.3, speed: 3.2, up: 1.6, life: 0.5, spread: 0.3 });
    this.fx.glows.spawn({ x, y: 0.7, z, count: 6, color: [0xffd890, 0xffb060], size: 1.4, grow: 0.2, speed: 0.4, up: 0.4, life: 0.2, alpha: 0.8 });
    // the tower itself, in pieces: planks, cobbles, brass bits
    this.fx.chunks.spawn({ x, y: 0.6, z, count: 34, color: [0xa86e3e, 0x7a4a2a, 0xcf9a5e, 0xb3ada3, 0x8d877f, 0xd8a64a], speed: 3.6, up: 5.2, size: 0.085, life: 1.6, spread: 0.25 });
    this.fx.chunks.spawn({ x, y: 0.4, z, count: 12, color: [0x3a2a20, 0x5a4a40], speed: 2.4, up: 3, size: 0.05, life: 1.2 });
    // smoke column and dust
    this.fx.puffs.spawn({ x, y: 0.4, z, count: 18, color: [0x5a5048, 0x7a6e64, 0x9a8e84], size: 0.8, grow: 2.6, speed: 1.6, up: 1.1, drag: 1.2, life: 2.0, alpha: 0.65, spread: 0.3 });
    this.fx.puffs.spawn({ x, y: 0.1, z, count: 10, color: [0xd8c8a8, 0xc0b090], size: 0.6, grow: 2.2, speed: 2.4, up: 0.2, life: 1.0, alpha: 0.5, spread: 0.2 });
    // shockwave ring and a scorch mark that fades away
    this.fx.decals.spawn('ring', x, z, { color: 0xffc080, r0: 0.3, r1: 2.2, life: 0.5, alpha: 1, additive: true, y: 0.04 });
    this.fx.decals.spawn('splat', x, z, { color: 0x2a2018, r0: 0.55, r1: 0.7, life: 9, alpha: 0.65 });
    this.shake(0.4);
    this.events.onTowerDestroyed(t);
  }

  private chop(t: Tower) {
    const broke = t.wear(CHOP.damage);
    const p = t.pos;
    this.fx.chunks.spawn({ x: p.x, y: 0.45, z: p.z, count: 6, color: [0xa86e3e, 0xcf9a5e, 0xe8c890], speed: 1.8, up: 2.4, size: 0.04, life: 0.8 });
    this.fx.puffs.spawn({ x: p.x, y: 0.4, z: p.z, count: 2, color: [0xe0d0b0], size: 0.25, grow: 2, speed: 0.6, up: 0.3, life: 0.5, alpha: 0.45 });
    this.sfx('axe_chop', p, 0.8);
    // the final blow lights the fuse: creak... (the boom lands when the fuse runs out)
    if (broke) this.sfx('tower_break', p, 1);
  }

  refreshTowerModels() { for (const t of this.towers) t.refreshModel(this); }

  // --- main tick -----------------------------------------------------------
  update(dt: number, time: number): void {
    // spawns
    if (this.queue.length) {
      this.nightT += dt;
      while (this.queue.length && this.queue[0].t <= this.nightT) this.spawn(this.queue.shift()!.type);
    }

    for (const t of this.towers) { this.lastHitFrom = t; t.update(dt, this, time); }
    for (const t of this.towers.filter((x) => x.doomed && x.doomT <= 0)) this.explode(t);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const { p, from } = this.projectiles[i];
      this.lastHitFrom = from;
      if (!p.update(dt, this)) {
        this.group.remove(p.object);
        this.projectiles.splice(i, 1);
      }
    }
    // direct-damage towers (lanterns, sprinklers) attribute their kills inside update
    this.lastHitFrom = null;

    for (let i = this.fires.length - 1; i >= 0; i--) if (!this.fires[i].update(dt, this)) this.fires.splice(i, 1);

    this.bossCount = 0;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.alive && z.burnTimer > 0) {
        this.damage(z, z.burnDps * dt, { pierceArmor: true, quiet: true });
        if (Math.random() < dt * 14) this.fx.glows.spawn({ x: z.pos.x, y: z.rig.height * 0.6, z: z.pos.z, count: 1, color: [0xff7a20, 0xffc040], size: 0.16, speed: 0.2, up: 1, life: 0.4 });
      }
      if (z.alive && z.boss) this.bossCount++;
      if (z.alive) {
        z.groanT -= dt;
        if (z.groanT <= 0) { z.groanT = 5 + Math.random() * 10; this.sfx('zombie_groan', z.pos, 0.6); }
        if (z.stepped && (z.type === 'brute' || z.type === 'king')) {
          this.sfx('brute_stomp', z.pos, z.boss ? 0.7 : 0.4);
          if (z.boss) this.shake(0.06);
        }
      }
      const leaked = z.update(dt, this.path, time);
      if (z.alive && z.type === 'lumberjack') this.updateLumberjack(z);
      // licking the syrup off: a slurp of amber droplets means "can't slow me again for a bit"
      if (z.alive && z.licked) {
        this.fx.chunks.spawn({ x: z.pos.x, y: z.rig.height * 0.6, z: z.pos.z, count: 6, color: [0xd8861c, 0xf0a840], speed: 1.4, up: 2, size: 0.035, life: 0.6 });
        this.fx.puffs.spawn({ x: z.pos.x, y: z.rig.height * 0.8, z: z.pos.z, count: 2, color: [0xf6d8a0], size: 0.14, grow: 2, speed: 0.4, up: 0.6, life: 0.5, alpha: 0.6 });
      }
      // shaking off a stun: a huff of grumpy steam means "can't stun me again for a bit"
      if (z.alive && z.shrugged) {
        this.fx.puffs.spawn({ x: z.pos.x, y: z.rig.height + 0.05, z: z.pos.z, count: 5, color: [0xffffff, 0xe8e4f0], size: 0.16, grow: 2.2, speed: 0.6, up: 1.1, drag: 1.4, life: 0.7, alpha: 0.75, spread: 0.08 });
      }
      if (leaked && z.alive) {
        z.alive = false;
        this.events.onLeak(z);
        this.removeZombie(i);
        continue;
      }
      if (!z.alive && z.dying <= 0) this.removeZombie(i);
    }
  }

  private removeZombie(i: number) {
    const z = this.zombies[i];
    this.chopping.delete(z);
    this.group.remove(z.object);
    this.zombies.splice(i, 1);
  }

  /** Once per rendered frame, after the camera has moved. */
  syncOverlays(): void {
    this.overlays.update(this.zombies, this.stage.camera);
    this.overlays.updateTowers(this.towers, this.stage.camera);
  }

  /** Wipe everything (new game). */
  clear(): void {
    for (const z of this.zombies) this.group.remove(z.object);
    for (const t of this.towers) this.group.remove(t.root);
    for (const p of this.projectiles) this.group.remove(p.p.object);
    this.zombies.length = 0;
    this.towers.length = 0;
    this.projectiles.length = 0;
    this.fires.length = 0;
    this.queue.length = 0;
  }
}
