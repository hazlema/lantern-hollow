import * as THREE from 'three';
import { CHAIN_FALLOFF, TOWERS, conditionMult, levelMult, type TargetMode, type TowerDef, type TowerId } from '../data/towers';
import { buildTower, setTowerLevel, type TowerRig } from '../models/towers';
import { AcornShot, FeatherShot, PumpkinShot } from './projectiles';
import type { Zombie } from './zombie';
import type { Ctx } from '../core/world';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export interface TowerStats { damage: number; rate: number; range: number; splash: number }

export class Tower {
  readonly def: TowerDef;
  rig: TowerRig;
  level = 1;
  spent: number;
  kills = 0;
  targetMode: TargetMode;
  readonly pos: THREE.Vector3;
  readonly root = new THREE.Group();
  private cooldown = 0.3;
  // idle towers face the camera (default iso view looks from +x+z)
  private yaw = Math.PI / 4 + (Math.random() - 0.5) * 0.6;
  private target: Zombie | null = null;
  private recoil = 0;
  private armT = -1; // catapult swing timer (-1 = idle & loaded)
  private pendingPumpkin: { to: THREE.Vector3; dmg: number; splash: number } | null = null;
  private flap = 0;
  private pulse = 0;
  private buildT = 0;
  private twin = false;
  /** warm little pool of lantern light around the tower at night */
  readonly glowPool: THREE.Mesh;

  constructor(readonly id: TowerId, readonly c: number, readonly r: number, world: THREE.Vector3, cost: number, poolTex?: THREE.Texture) {
    this.glowPool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: poolTex ?? null, color: id === 'lantern' ? 0xc8ff70 : 0xffb050, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.glowPool.position.y = 0.025;
    this.glowPool.renderOrder = 4;
    this.def = TOWERS[id];
    this.spent = cost;
    this.targetMode = this.def.defaultTarget;
    this.pos = world.clone();
    this.root.position.copy(world);
    this.rig = buildTower(id);
    this.rig.head.rotation.y = this.yaw;
    this.root.add(this.rig.root);
    setTowerLevel(this.rig, 1);
    this.root.scale.setScalar(0.01);
    this.root.add(this.glowPool);
  }

  stats(ctx: Ctx): TowerStats {
    const lm = levelMult(this.level);
    return {
      damage: this.def.damage * lm.damage * ctx.mods.damage[this.id] * conditionMult(this.condition),
      rate: this.def.rate * lm.rate * ctx.mods.rate[this.id],
      range: this.def.range * lm.range * ctx.mods.rangeAll,
      splash: (this.def.splash ?? 0) * ctx.mods.splashMult,
    };
  }

  setLevel(l: number) {
    this.level = l;
    setTowerLevel(this.rig, l);
    this.buildT = 0.6; // replay the little bounce
  }

  /** Swap in the twin-barrel model when the tech is researched. */
  refreshModel(ctx: Ctx) {
    const wantTwin = this.id === 'acorn' && ctx.mods.acornShots > 1;
    if (wantTwin === this.twin) return;
    this.twin = wantTwin;
    this.root.remove(this.rig.root);
    this.rig = buildTower(this.id, { twin: wantTwin });
    setTowerLevel(this.rig, this.level);
    this.root.add(this.rig.root);
  }

  private pickTarget(ctx: Ctx, range: number): Zombie | null {
    let best: Zombie | null = null;
    let bestScore = -Infinity;
    for (const z of ctx.zombies) {
      if (!z.alive) continue;
      const d = Math.hypot(z.pos.x - this.pos.x, z.pos.z - this.pos.z);
      if (d > range || d < (this.def.minRange ?? 0)) continue;
      let s: number;
      switch (this.targetMode) {
        case 'first': s = z.dist; break;
        case 'last': s = -z.dist; break;
        case 'strong': s = z.hp + z.dist * 0.01; break;
        case 'close': s = -d; break;
      }
      if (s > bestScore) { bestScore = s; best = z; }
    }
    return best;
  }

  private aim(dt: number, at: THREE.Vector3, speed = 10): number {
    const want = Math.atan2(at.x - this.pos.x, at.z - this.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    this.rig.head.rotation.y = this.yaw;
    return Math.abs(d);
  }

  // --- wear and tear (lumberjacks) -----------------------------------------
  /** 1 = good as new; at 0 the tower is doomed and blows up (see World) */
  condition = 1;
  private hitT = 0;
  private smokeT = 0;
  /** seconds left before a doomed tower explodes (-1 = not doomed) */
  doomT = -1;
  /** fuse length between the final axe blow and the boom */
  static readonly FUSE = 0.45;
  get broken() { return this.condition <= 0.0001; }
  get doomed() { return this.doomT >= 0; }

  /** Knock some condition off. Returns true if this blow finished the tower off. */
  wear(amount: number): boolean {
    if (this.broken) return false;
    this.condition = Math.max(0, Math.round((this.condition - amount) * 1000) / 1000);
    this.hitT = 1;
    if (this.broken) this.doomT = Tower.FUSE;
    return this.broken;
  }

  repair() {
    this.condition = 1;
    this.buildT = 0.4; // happy little bounce
  }

  private wearVisuals(dt: number, ctx: Ctx, time: number) {
    this.hitT = Math.max(0, this.hitT - dt * 5);
    if (this.doomed) {
      // the last moments: shudder harder and harder, swell, spit sparks
      this.doomT = Math.max(0, this.doomT - dt);
      const k = 1 - this.doomT / Tower.FUSE;
      const j = 0.04 + k * 0.14;
      this.rig.root.rotation.z = Math.sin(time * 70) * j + 0.15;
      this.rig.root.rotation.x = Math.cos(time * 53) * j * 0.7;
      this.rig.root.position.set(Math.sin(time * 91) * j * 0.3, k * 0.06, Math.cos(time * 77) * j * 0.3);
      this.rig.root.scale.setScalar((1.15 + (this.level - 1) * 0.07) * (1 + k * 0.2));
      if (Math.random() < dt * 40) {
        ctx.fx.glows.spawn({ x: this.pos.x, y: 0.4 + Math.random() * 0.8, z: this.pos.z, count: 2, color: [0xffd070, 0xff8a30, 0xffffff], size: 0.12, speed: 2.2, up: 1.6, life: 0.35, spread: 0.25 });
      }
      return;
    }
    // lean a little more with every chop
    const lean = (1 - this.condition) * 0.12;
    const shake = Math.sin(time * 60) * 0.06 * this.hitT;
    this.rig.root.rotation.z = lean + shake;
    this.rig.root.rotation.x = shake * 0.5;
    this.rig.root.position.set(0, 0, 0);
    if (this.condition < 0.5) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.5 - (0.5 - this.condition) * 0.6;
        ctx.fx.puffs.spawn({ x: this.pos.x + (Math.random() - 0.5) * 0.3, y: 0.7, z: this.pos.z + (Math.random() - 0.5) * 0.3, count: 1,
          color: [0x9a8e84, 0x7a6e64], size: 0.28, grow: 2.6, speed: 0.12, up: 0.5, drag: 0.6, life: 1.8, alpha: 0.4 });
      }
    }
  }

  setNightGlow(n: number) {
    (this.glowPool.material as THREE.MeshBasicMaterial).opacity = n * 0.4;
  }

  update(dt: number, ctx: Ctx, time: number): void {
    // build-in bounce
    this.buildT = Math.min(1, this.buildT + dt * 2.2);
    const b = this.buildT;
    const bounce = b < 1 ? 1 + Math.sin(b * Math.PI * 2.5) * (1 - b) * 0.35 : 1;
    this.root.scale.set(Math.min(1, b * 3) * (2 - bounce), Math.min(1, b * 3) * bounce, Math.min(1, b * 3) * (2 - bounce));

    this.wearVisuals(dt, ctx, time);
    if (this.broken) return; // a doomed tower stops firing while the fuse burns

    const st = this.stats(ctx);
    this.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 4);

    const td = this.target ? Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z) : 0;
    if (!this.target || !this.target.alive || td > st.range || td < (this.def.minRange ?? 0)) {
      this.target = this.pickTarget(ctx, st.range);
    } else if (this.targetMode !== 'close') {
      // keep re-evaluating so "first" really tracks the leader
      this.target = this.pickTarget(ctx, st.range) ?? this.target;
    }

    switch (this.id) {
      case 'acorn': this.updateAcorn(dt, ctx, st, time); break;
      case 'catapult': this.updateCatapult(dt, ctx, st); break;
      case 'sprinkler': this.updateSprinkler(dt, ctx, st, time); break;
      case 'lantern': this.updateLantern(dt, ctx, st, time); break;
      case 'owl': this.updateOwl(dt, ctx, st, time); break;
    }
  }

  private muzzleWorld(out: THREE.Vector3, obj: THREE.Object3D = this.rig.muzzle): THREE.Vector3 {
    obj.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(obj.matrixWorld);
  }

  private updateAcorn(dt: number, ctx: Ctx, st: TowerStats, time: number) {
    const barrels = Object.keys(this.rig.parts).filter((k) => k.startsWith('barrel')).map((k) => this.rig.parts[k]);
    barrels.forEach((br, i) => (br.position.z = -this.recoil * 0.12 * (i === 0 ? 1 : 0.7)));
    if (!this.target) {
      this.rig.head.rotation.y = this.yaw += Math.sin(time * 0.6 + this.c) * dt * 0.3;
      return;
    }
    this.target.aimPoint(tmp);
    const off = this.aim(dt, tmp, 12);
    if (this.cooldown > 0 || off > 0.35) return;
    this.cooldown = 1 / st.rate;
    this.recoil = 1;
    const shots = ctx.mods.acornShots;
    for (let i = 0; i < shots; i++) {
      this.muzzleWorld(tmp2);
      if (shots > 1) {
        const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        tmp2.addScaledVector(side, (i === 0 ? -1 : 1) * 0.08);
      }
      const crit = Math.random() < ctx.mods.acornCrit;
      ctx.addProjectile(new AcornShot(tmp2.clone(), this.target, st.damage * (crit ? 3 : 1), this.def.projectileSpeed, crit), this);
    }
    this.muzzleWorld(tmp2);
    ctx.fx.puffs.spawn({ x: tmp2.x, y: tmp2.y, z: tmp2.z, count: 3, color: 0xf3e6cc, size: 0.16, grow: 2.2, speed: 0.5, up: 0.3, life: 0.45, alpha: 0.5 });
    ctx.sfx('acorn_fire', this.pos, 0.55);
  }

  private updateCatapult(dt: number, ctx: Ctx, st: TowerStats) {
    const arm = this.rig.parts.arm, ammo = this.rig.parts.ammo;
    if (this.armT >= 0) {
      this.armT += dt;
      const t = this.armT;
      // whip over the top, then winch slowly back down
      if (t < 0.14) arm.rotation.x = THREE.MathUtils.lerp(-0.85, 1.9, (t / 0.14) ** 2);
      else arm.rotation.x = THREE.MathUtils.lerp(1.9, -0.85, THREE.MathUtils.smoothstep(t - 0.14, 0, 1.0));
      if (t >= 0.12 && this.pendingPumpkin) {
        ammo.visible = false;
        this.muzzleWorld(tmp2);
        const p = this.pendingPumpkin;
        ctx.addProjectile(new PumpkinShot(tmp2.clone(), p.to, p.dmg, p.splash, this.def.projectileSpeed), this);
        this.pendingPumpkin = null;
      }
      if (t > 1.0) ammo.visible = true;
      if (t >= 1.14) this.armT = -1;
    }
    if (!this.target) return;
    // lead the target: where will it be when the pumpkin lands?
    const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
    const flight = Math.max(0.45, dist / this.def.projectileSpeed) + 0.12;
    this.target.predict(ctx.path, flight, tmp);
    const off = this.aim(dt, tmp, 5);
    if (this.cooldown > 0 || off > 0.25 || this.armT >= 0) return;
    this.cooldown = 1 / st.rate;
    this.armT = 0;
    this.pendingPumpkin = { to: tmp.clone().setY(0.1), dmg: st.damage, splash: st.splash };
    ctx.sfx('catapult_fire', this.pos, 0.8);
  }

  private updateSprinkler(dt: number, ctx: Ctx, st: TowerStats, time: number) {
    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.rig.head.rotation.y += dt * (1.5 + this.pulse * 14);
    const barrel = this.rig.parts.barrel;
    barrel.scale.set(1 + this.pulse * 0.06, 1 - this.pulse * 0.08, 1 + this.pulse * 0.06);
    if (this.cooldown > 0) return;
    const inRange = ctx.zombiesNear(this.pos.x, this.pos.z, st.range);
    if (!inRange.length) return;
    this.cooldown = 1 / st.rate;
    this.pulse = 1;
    for (const z of inRange) {
      z.slow(ctx.mods.slow * (0.5 + 0.5 * this.condition), 1.6);
      ctx.damage(z, st.damage, { quiet: true });
    }
    ctx.fx.decals.spawn('ring', this.pos.x, this.pos.z, { color: 0xffb040, r0: 0.3, r1: st.range, life: 0.7, alpha: 0.55, y: 0.03 });
    ctx.fx.decals.spawn('soft', this.pos.x, this.pos.z, { color: 0xd8861c, r0: st.range * 0.6, r1: st.range * 0.95, life: 1.2, alpha: 0.3, y: 0.02 });
    for (let i = 0; i < 3; i++) {
      const a = time * 3 + i * 2.1;
      ctx.fx.chunks.spawn({ x: this.pos.x + Math.cos(a) * 0.2, y: 1.15, z: this.pos.z + Math.sin(a) * 0.2, count: 3, color: [0xd8861c, 0xf0a840], speed: st.range * 1.2, up: 2.2, size: 0.035, life: 0.8 });
    }
    ctx.sfx('syrup_pulse', this.pos, 0.7);
  }

  private updateLantern(dt: number, ctx: Ctx, st: TowerStats, time: number) {
    const flies = this.rig.parts.flies;
    const agitation = Math.max(0, 1 - this.cooldown * st.rate) + this.pulse;
    this.pulse = Math.max(0, this.pulse - dt * 3);
    flies.children.forEach((f, i) => {
      const ph = f.userData.phase as number, rad = f.userData.rad as number;
      const sp = 2 + agitation * 4;
      f.position.set(Math.cos(time * sp + ph) * rad, Math.sin(time * sp * 1.3 + ph * 2) * 0.12, Math.sin(time * sp + ph) * rad);
      f.scale.setScalar(1 + this.pulse * 0.8 + (i % 2) * 0.2);
    });
    if (!this.target || this.cooldown > 0) return;
    this.cooldown = 1 / st.rate;
    this.pulse = 1;
    const hit: Zombie[] = [this.target];
    let prev = this.target;
    while (hit.length < ctx.mods.chainTargets) {
      let next: Zombie | null = null, nd = 1.9;
      for (const z of ctx.zombies) {
        if (!z.alive || hit.includes(z)) continue;
        const d = Math.hypot(z.pos.x - prev.pos.x, z.pos.z - prev.pos.z);
        if (d < nd) { nd = d; next = z; }
      }
      if (!next) break;
      hit.push(next);
      prev = next;
    }
    let from = this.muzzleWorld(new THREE.Vector3());
    hit.forEach((z, i) => {
      const to = z.aimPoint(new THREE.Vector3());
      ctx.fx.bolts.zap(from, to);
      ctx.fx.glows.spawn({ x: to.x, y: to.y, z: to.z, count: 8, color: [0xdcff73, 0xffffff, 0xa8ff50], size: 0.14, speed: 1.6, up: 0.6, life: 0.3 });
      // each jump hits softer; Overcharge doubles the first hit instead of stunning
      const first = i === 0 && ctx.mods.overcharge ? 2 : 1;
      ctx.damage(z, st.damage * Math.pow(CHAIN_FALLOFF, i) * first, {});
      from = to;
    });
    ctx.sfx('zap', this.pos, 0.75);
  }

  private updateOwl(dt: number, ctx: Ctx, st: TowerStats, time: number) {
    this.flap = Math.max(0, this.flap - dt * 3);
    const { wingL, wingR, face } = this.rig.parts;
    wingL.rotation.z = -this.flap * 1.2;
    wingR.rotation.z = this.flap * 1.2;
    this.rig.head.position.y = 0.82 + this.flap * 0.08;
    if (!this.target) {
      // idle owl head swivel
      face.rotation.y = Math.sin(time * 0.7 + this.c) * 0.9;
      return;
    }
    face.rotation.y *= 0.85;
    this.target.aimPoint(tmp);
    const off = this.aim(dt, tmp, 6);
    if (this.cooldown > 0 || off > 0.2) return;
    this.cooldown = 1 / st.rate;
    this.flap = 1;
    this.muzzleWorld(tmp2);
    ctx.addProjectile(new FeatherShot(tmp2.clone(), tmp.clone(), st.damage, this.def.projectileSpeed, st.range, ctx.mods.owlPierce), this);
    // a little burst of loose fluff as the owl flings it
    ctx.fx.chunks.spawn({ x: tmp2.x, y: tmp2.y, z: tmp2.z, count: 4, color: [0xf2e6cc, 0x9a6a44], speed: 0.8, up: 1.2, size: 0.03, life: 0.7, gravity: 3 });
    ctx.sfx('owl_fire', this.pos, 0.8);
  }
}
