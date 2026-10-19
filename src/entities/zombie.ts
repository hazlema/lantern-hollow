import * as THREE from 'three';
import { CHOP, STUN, SYRUP, ZOMBIES, type ZombieDef, type ZombieId } from '../data/zombies';
import type { Path } from '../data/path';
import { buildZombie, type ZombieRig } from '../models/zombies';

const SLOW_TINT = new THREE.Color(0xe09a2a);
const BURN_TINT = new THREE.Color(0xff5a1a);

// ---------------------------------------------------------------------------

export class Zombie {
  readonly def: ZombieDef;
  readonly rig: ZombieRig;
  readonly pos = new THREE.Vector3();
  hp: number;
  readonly maxHp: number;
  readonly goldValue: number;
  dist = 0;
  alive = true;
  /** >0 while playing the fall-over animation */
  dying = 0;
  slowTimer = 0;
  slowAmt = 0;
  stunTimer = 0;
  burnTimer = 0;
  burnDps = 0;
  flashT = -1;
  private squashT = 0;
  groanT = 2 + Math.random() * 8;
  /** true for the frame a foot hits the ground */
  stepped = false;
  private lateral = (Math.random() - 0.5) * 0.42;
  private speedMul = 0.92 + Math.random() * 0.16;
  private phase = Math.random() * 10;
  private yaw = 0;
  private spawnT = 0;
  /** health bar visibility 0..1 and its height (drawn by fx/overlays.ts) */
  barShown = 0;
  barY = 0;
  /** blob shadow size factor (shrinks while the zombie topples away) */
  shadowScale = 1;
  private baseColors: THREE.Color[];
  private stars: THREE.Group;
  private s = { x: 0, z: 0, dx: 0, dz: 0 };

  constructor(readonly type: ZombieId, hpScale: number, goldScale: number) {
    this.def = ZOMBIES[type];
    this.rig = buildZombie(type);
    this.maxHp = this.hp = Math.round(this.def.hp * hpScale);
    this.goldValue = this.def.gold * goldScale;
    this.baseColors = this.rig.tintables.map((m) => m.color.clone());
    if (this.def.boss) this.lateral *= 0.3;

    // dizzy stars for stuns
    this.stars = new THREE.Group();
    const starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.8, 0.6), toneMapped: false });
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), starMat);
      st.position.set(Math.cos(i * 2.1) * 0.16, 0, Math.sin(i * 2.1) * 0.16);
      this.stars.add(st);
    }
    this.stars.position.y = this.rig.height / this.rig.root.scale.y - 0.05;
    this.stars.visible = false;
    this.rig.root.add(this.stars);
    this.rig.root.scale.multiplyScalar(0.01);
  }

  get object() { return this.rig.root; }
  get boss() { return !!this.def.boss; }
  /** centre-of-mass point for projectiles to aim at */
  aimPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.rig.height * 0.5, this.pos.z);
  }

  /** Where will I be in `t` seconds? (for lobbed pumpkins) */
  predict(path: Path, t: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.dist + this.currentSpeed() * t;
    path.sample(d, this.s);
    return out.set(this.s.x - this.s.dz * this.lateral, 0, this.s.z + this.s.dx * this.lateral);
  }

  // --- lumberjack chopping --------------------------------------------------
  /** world point of the tower being chopped, or null while walking */
  chopAt: { x: number; z: number } | null = null;
  /** towers this lumberjack has already rolled the dice on */
  readonly considered = new Set<object>();
  swingsLeft = 0;
  /** true for the frame the axe bites */
  chopHit = false;
  private chopT = 0;

  startChop(x: number, z: number) {
    this.chopAt = { x, z };
    this.swingsLeft = CHOP.maxSwings;
    this.chopT = 0;
  }

  stopChop() { this.chopAt = null; }

  currentSpeed(): number {
    if (this.stunTimer > 0 || this.dying > 0 || this.chopAt) return 0;
    return this.def.speed * this.speedMul * (this.slowTimer > 0 ? 1 - this.slowAmt : 1);
  }

  /** seconds spent slowed in a row, and the syrup-immune window after licking it off */
  private syrupT = 0;
  syrupImmuneT = 0;
  /** true for the frame the zombie licks the syrup off */
  licked = false;

  slow(amount: number, duration: number) {
    if (this.syrupImmuneT > 0) return;
    // bosses shrug off half the syrup
    const a = this.boss ? amount * 0.5 : amount;
    this.slowAmt = Math.max(this.slowTimer > 0 ? this.slowAmt : 0, a);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  /** seconds left of stun immunity (stun fatigue) */
  stunImmuneT = 0;
  /** true for the frame a stun wears off and the zombie gets grumpy (immune) */
  shrugged = false;

  stun(duration: number) {
    // the Pumpkin King is far too proud to be stunned; everyone else shrugs off stuns for a bit after one
    // a stun already running isn't refreshed either, or overlapping lanterns would lock zombies forever
    if (this.boss || this.stunImmuneT > 0 || this.stunTimer > 0) return;
    this.stunTimer = duration;
  }

  /** Returns true when the zombie reached the cottage door. */
  update(dt: number, path: Path, time: number): boolean {
    const rig = this.rig;
    const baseScale = rig.baseScale;

    if (this.dying > 0) {
      // comedic topple: tip backwards, bounce, sink
      this.dying -= dt;
      const t = 1 - Math.max(0, this.dying) / 0.55;
      rig.root.rotation.x = -Math.min(1, t * 1.8) * 1.45;
      rig.root.position.y = this.pos.y + Math.sin(Math.min(1, t * 1.8) * Math.PI) * 0.12 - Math.max(0, t - 0.6) * 0.6;
      rig.root.scale.setScalar(baseScale * (1 - Math.max(0, t - 0.75) * 3));
      this.barShown = Math.max(0, this.barShown - dt * 6);
      this.shadowScale = Math.max(0, 1 - Math.max(0, t - 0.5) * 2.2);
      return false;
    }

    this.spawnT += dt;
    const pop = Math.min(1, this.spawnT / 0.35);
    const overshoot = 1 + Math.sin(pop * Math.PI) * 0.15;
    rig.root.scale.setScalar(baseScale * pop * overshoot);

    if (this.slowTimer > 0) this.slowTimer -= dt;
    this.shrugged = false;
    this.licked = false;
    if (this.syrupImmuneT > 0) this.syrupImmuneT -= dt;
    if (this.slowTimer > 0) {
      this.syrupT += dt;
      if (this.syrupT >= SYRUP.maxSlow) {
        // slurp: syrup gone, and they won't get stuck again for a bit
        this.slowTimer = 0;
        this.syrupT = 0;
        this.syrupImmuneT = SYRUP.immunity;
        this.licked = true;
      }
    } else {
      this.syrupT = Math.max(0, this.syrupT - dt);
    }
    if (this.stunImmuneT > 0) this.stunImmuneT -= dt;
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) { this.stunImmuneT = STUN.immunity; this.shrugged = true; }
    }
    if (this.burnTimer > 0) this.burnTimer -= dt;
    const speed = this.currentSpeed();
    this.dist += speed * dt;

    path.sample(this.dist, this.s);
    this.pos.set(this.s.x - this.s.dz * this.lateral, 0, this.s.z + this.s.dx * this.lateral);
    rig.root.position.copy(this.pos);
    const targetYaw = Math.atan2(this.s.dx, this.s.dz);
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 6);
    rig.root.rotation.y = this.yaw;

    // --- walk cycle -------------------------------------------------------
    const sprint = this.type === 'sprinter';
    const heavy = this.type === 'brute' || this.type === 'king';
    const cadence = sprint ? 13 : heavy ? 4.5 : 6.5;
    const prevStep = Math.floor(this.phase / Math.PI);
    if (speed > 0) this.phase += dt * cadence * (0.4 + speed / this.def.speed * 0.6);
    const ph = this.phase;
    this.stepped = Math.floor(ph / Math.PI) !== prevStep;
    const swing = sprint ? 0.85 : heavy ? 0.35 : 0.5;
    rig.legL.rotation.x = Math.sin(ph) * swing;
    rig.legR.rotation.x = -Math.sin(ph) * swing;
    rig.body.position.y = rig.legL.position.y + Math.abs(Math.cos(ph)) * (sprint ? 0.05 : 0.03);
    rig.body.rotation.z = Math.sin(ph) * (heavy ? 0.1 : 0.07);
    if (sprint) {
      rig.armL.rotation.x = 0.6 - Math.sin(ph) * 1.1;
      rig.armR.rotation.x = 0.6 + Math.sin(ph) * 1.1;
      if (rig.scarf) rig.scarf.rotation.x = 0.4 + Math.sin(ph * 2) * 0.25;
    } else {
      rig.armL.rotation.x = -1.25 + Math.sin(ph * 0.5 + 0.5) * 0.18;
      rig.armR.rotation.x = -1.25 + Math.sin(ph * 0.5 + 2.1) * 0.18;
      rig.armL.rotation.z = Math.sin(ph * 0.5) * 0.08;
    }
    rig.head.rotation.z = Math.sin(ph * 0.5 + 1) * 0.15;
    rig.head.rotation.x = Math.sin(ph * 0.25) * 0.08 + 0.05;

    // chopping: plant the feet, face the tower, wind up and swing
    this.chopHit = false;
    if (this.chopAt && this.stunTimer <= 0) {
      const want = Math.atan2(this.chopAt.x - this.pos.x, this.chopAt.z - this.pos.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 10);
      rig.root.rotation.y = this.yaw;
      const prev = this.chopT / CHOP.swingTime;
      this.chopT += dt;
      if (this.chopT >= CHOP.swingTime) this.chopT -= CHOP.swingTime;
      const p = this.chopT / CHOP.swingTime;
      const STRIKE = 0.68;
      if (prev < STRIKE && p >= STRIKE) this.chopHit = true;
      const ease = (x: number) => x * x * (3 - 2 * x);
      let arm: number;
      if (p < 0.5) arm = -1.0 - 2.0 * ease(p / 0.5);              // raise the axe high
      else if (p < STRIKE) arm = -3.0 + 2.7 * ((p - 0.5) / (STRIKE - 0.5)) ** 2; // CHOP
      else arm = -0.3 - 0.7 * ease((p - STRIKE) / (1 - STRIKE)); // haul it back up
      rig.armR.rotation.x = arm;
      rig.armL.rotation.x = -0.9 + (arm + 1.6) * 0.35;
      rig.body.rotation.x = p > 0.5 && p < 0.8 ? 0.22 : 0.05;
      rig.legL.rotation.x = 0.15;
      rig.legR.rotation.x = -0.12;
    } else if (this.type === 'lumberjack') {
      rig.body.rotation.x = 0;
    }

    // stunned: wobble in place with stars
    this.stars.visible = this.stunTimer > 0;
    if (this.stunTimer > 0) {
      this.stars.rotation.y = time * 7;
      rig.body.rotation.z = Math.sin(time * 12) * 0.12;
    }

    // boing: a quick squash when bonked
    if (this.squashT > 0) this.squashT = Math.max(0, this.squashT - dt);
    const sq = Math.sin((this.squashT / 0.14) * Math.PI) * 0.16;
    rig.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);

    // --- status tints -----------------------------------------------------
    if (this.flashT > -0.06) this.flashT -= dt;
    const flash = Math.max(0, this.flashT / 0.09) * 0.55;
    const burn = this.burnTimer > 0 ? 0.35 + Math.sin(time * 18) * 0.15 : 0;
    for (const m of rig.flash) {
      m.emissive.setRGB(flash + burn, flash + burn * 0.35, flash);
    }
    rig.tintables.forEach((m, i) => {
      m.color.copy(this.baseColors[i]);
      if (this.slowTimer > 0) m.color.lerp(SLOW_TINT, 0.45);
      if (this.burnTimer > 0) m.color.lerp(BURN_TINT, 0.15);
    });

    const wantBar = this.hp < this.maxHp || this.boss ? 1 : 0;
    this.barShown += (wantBar - this.barShown) * Math.min(1, dt * 10);
    this.barY = this.rig.height * pop + 0.15;
    this.shadowScale = pop;
    return this.dist >= path.length;
  }

  hitFlash() {
    // under heavy fire, don't strobe: let each flash finish before the next
    if (this.flashT <= -0.06) this.flashT = 0.09;
    if (this.squashT <= 0) this.squashT = 0.14;
  }

  startDeath() {
    this.alive = false;
    this.dying = 0.55;
    this.stars.visible = false;
  }
}
