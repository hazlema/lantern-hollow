import * as THREE from 'three';
import { C, G, M } from '../models/kit';
import type { Zombie } from './zombie';
import type { Ctx } from '../core/world';

export interface Projectile {
  readonly object: THREE.Object3D;
  /** returns false when finished */
  update(dt: number, ctx: Ctx): boolean;
}

const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------

function acornMesh(golden: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(G.sphere(0.06, 10, 8), golden ? M(0xffcf40, { metal: 0.8, rough: 0.25, emissive: 0xffa000, emissiveIntensity: 0.6 }) : M(0x9a6232));
  body.scale.set(1, 1, 1.3);
  const cap = new THREE.Mesh(G.sphere(0.064, 10, 6), M(0x5e3b20));
  cap.scale.set(1, 1, 0.55);
  cap.position.z = -0.045;
  g.add(body, cap);
  return g;
}

export class AcornShot implements Projectile {
  readonly object: THREE.Group;
  private last = new THREE.Vector3();
  private spin = Math.random() * 6;

  constructor(from: THREE.Vector3, private target: Zombie, private damage: number, private speed: number, private crit: boolean) {
    this.object = acornMesh(crit);
    this.object.position.copy(from);
    target.aimPoint(this.last);
  }

  update(dt: number, ctx: Ctx): boolean {
    if (this.target.alive) this.target.aimPoint(this.last);
    const p = this.object.position;
    tmp.copy(this.last).sub(p);
    const d = tmp.length();
    const step = this.speed * dt;
    this.object.lookAt(this.last);
    this.spin += dt * 25;
    this.object.rotateZ(this.spin);
    if (d <= step + 0.05) {
      if (this.target.alive) {
        ctx.damage(this.target, this.damage, { crit: this.crit });
        ctx.fx.chunks.spawn({ x: this.last.x, y: this.last.y, z: this.last.z, count: 4, color: [0x9a6232, 0x5e3b20, 0xc89058], speed: 1.6, up: 1.8, size: 0.035, life: 0.6 });
        ctx.sfx(this.target.def.armor >= 3 ? 'armor_clank' : 'acorn_hit', this.last, 0.7);
        if (this.crit) ctx.fx.glows.spawn({ x: this.last.x, y: this.last.y, z: this.last.z, count: 10, color: [0xffd040, 0xfff0a0], size: 0.12, speed: 2, life: 0.4 });
      }
      return false;
    }
    p.addScaledVector(tmp, step / d);
    return true;
  }
}

// ---------------------------------------------------------------------------

export class PumpkinShot implements Projectile {
  readonly object: THREE.Group;
  private t = 0;
  private T: number;
  private h: number;
  private spinAxis = new THREE.Vector3(Math.random(), 1, Math.random()).normalize();

  constructor(private from: THREE.Vector3, private to: THREE.Vector3, private damage: number, private radius: number, speed: number) {
    this.object = new THREE.Group();
    const p = new THREE.Mesh(G.pumpkin(0.13), M(C.pumpkin, { rough: 0.6 }));
    const stem = new THREE.Mesh(G.cyl(0.015, 0.02, 0.05, 5), M(C.stem));
    stem.position.y = 0.11;
    p.castShadow = true;
    this.object.add(p, stem);
    this.object.position.copy(from);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    this.T = Math.max(0.45, dist / speed);
    this.h = 1.2 + dist * 0.28;
  }

  update(dt: number, ctx: Ctx): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.T);
    const p = this.object.position;
    p.lerpVectors(this.from, this.to, k);
    p.y = THREE.MathUtils.lerp(this.from.y, this.to.y, k) + Math.sin(k * Math.PI) * this.h;
    this.object.rotateOnAxis(this.spinAxis, dt * 7);
    if (k < 1) return true;

    // SPLAT
    const x = this.to.x, z = this.to.z;
    for (const zb of ctx.zombiesNear(x, z, this.radius)) {
      const falloff = 1 - 0.4 * (Math.hypot(zb.pos.x - x, zb.pos.z - z) / this.radius);
      ctx.damage(zb, this.damage * falloff, {});
    }
    ctx.fx.chunks.spawn({ x, y: 0.15, z, count: 16, color: [C.pumpkin, C.pumpkinDark, 0xffb04a, 0xf6e6b0], speed: 3, up: 3.2, size: 0.06, life: 1.1 });
    ctx.fx.puffs.spawn({ x, y: 0.2, z, count: 8, color: [0xf0d8b0, 0xd8b890], size: 0.5, grow: 2.2, speed: 1.4, up: 0.4, life: 0.7, alpha: 0.55, spread: 0.2 });
    ctx.fx.glows.spawn({ x, y: 0.2, z, count: 12, color: [0xffa040, 0xffd070], size: 0.18, speed: 2.5, up: 1, life: 0.35 });
    ctx.fx.decals.spawn('splat', x, z, { color: 0xe9802a, r0: this.radius * 0.5, r1: this.radius * 0.85, life: 4.5, alpha: 0.75 });
    ctx.fx.decals.spawn('ring', x, z, { color: 0xffd0a0, r0: 0.2, r1: this.radius * 1.15, life: 0.35, alpha: 0.9, additive: true, y: 0.03 });
    ctx.sfx('pumpkin_explode', this.to, 0.9);
    ctx.shake(0.12);
    if (ctx.mods.burn) ctx.addFire(x, z, this.radius * 0.8, this.damage * 0.35, 3);
    return false;
  }
}

// ---------------------------------------------------------------------------

/** A painted owl feather: cream vane, chocolate bands, ragged notches, a quill. */
function featherTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  // vane silhouette: wide in the middle, pointed tip at the top
  const vane = new Path2D();
  vane.moveTo(32, 6);
  vane.bezierCurveTo(58, 46, 60, 150, 40, 214);
  vane.lineTo(32, 222);
  vane.lineTo(24, 214);
  vane.bezierCurveTo(4, 150, 6, 46, 32, 6);
  g.save();
  g.clip(vane);
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#d9c29a'); grd.addColorStop(0.5, '#fbf0d8'); grd.addColorStop(1, '#d9c29a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  // barred bands, slanting back from the quill like real barbs
  g.fillStyle = '#7f5636';
  for (let i = 0; i < 5; i++) {
    const y = 40 + i * 36;
    g.beginPath();
    g.moveTo(0, y + 10); g.lineTo(32, y); g.lineTo(64, y + 10); g.lineTo(64, y + 24); g.lineTo(32, y + 14); g.lineTo(0, y + 24);
    g.fill();
  }
  g.restore();
  // a couple of notches in the vane edge
  g.globalCompositeOperation = 'destination-out';
  for (const [x, y] of [[8, 120], [57, 88], [55, 168]]) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x < 32 ? 9 : -9), y + 10); g.lineTo(x, y + 6); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // quill
  g.strokeStyle = '#5e3b20';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(32, 14); g.lineTo(32, 252); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let featherParts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } | null = null;

function featherMesh(): THREE.Group {
  if (!featherParts) {
    const map = featherTexture();
    // lies along +z (the flight direction) with the tip forward
    const geo = new THREE.PlaneGeometry(0.19, 0.76).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8,
      emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.22,
    });
    featherParts = { geo, mat };
  }
  const g = new THREE.Group();
  const flat = new THREE.Mesh(featherParts.geo, featherParts.mat);
  const upright = new THREE.Mesh(featherParts.geo, featherParts.mat);
  upright.rotation.z = Math.PI / 2;
  flat.castShadow = upright.castShadow = true;
  g.add(flat, upright);
  return g;
}

export class FeatherShot implements Projectile {
  readonly object = featherMesh();
  private dir: THREE.Vector3;
  private left: number;
  private hit = new Set<Zombie>();
  private trailT = 0;

  constructor(from: THREE.Vector3, at: THREE.Vector3, private damage: number, private speed: number, range: number, private pierce: number) {
    this.object.position.copy(from);
    this.dir = at.clone().sub(from).normalize();
    this.left = range + 1.5;
    this.object.lookAt(at);
  }

  private roll = Math.random() * Math.PI;

  update(dt: number, ctx: Ctx): boolean {
    const step = this.speed * dt;
    const p = this.object.position;
    p.addScaledVector(this.dir, step);
    this.left -= step;
    // spiral along the flight line like a thrown dart
    this.roll += dt * 9;
    this.object.lookAt(p.x + this.dir.x, p.y + this.dir.y, p.z + this.dir.z);
    this.object.rotateZ(this.roll);
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.035;
      ctx.fx.puffs.spawn({ x: p.x, y: p.y, z: p.z, count: 1, color: [0xf6ead2, 0xe0c8a0], size: 0.1, grow: 1.8, speed: 0.15, up: 0.05, life: 0.4, alpha: 0.4 });
    }
    for (const z of ctx.zombiesNear(p.x, p.z, 0.38)) {
      if (this.hit.has(z)) continue;
      if (Math.abs(p.y - (z.pos.y + z.rig.height * 0.5)) > z.rig.height) continue;
      this.hit.add(z);
      // after the first hit, level out so the feather can skewer the zombies behind
      if (this.hit.size === 1) { this.dir.y = 0; this.dir.normalize(); }
      ctx.damage(z, this.damage, { pierceArmor: true });
      ctx.sfx('owl_hit', p, 0.8);
      ctx.fx.chunks.spawn({ x: p.x, y: p.y, z: p.z, count: 7, color: [0xf2e6cc, 0x7f5636, 0xf2e6cc], speed: 1.6, up: 1.6, size: 0.045, life: 0.8 });
      ctx.fx.puffs.spawn({ x: p.x, y: p.y, z: p.z, count: 4, color: [0xf6ead2], size: 0.18, grow: 2, speed: 0.6, up: 0.4, life: 0.5, alpha: 0.5 });
      if (this.hit.size >= this.pierce) return false;
    }
    // feathers dip toward the ground as they fly, then stop if they reach it
    if (p.y < 0.05) return false;
    return this.left > 0;
  }
}

// ---------------------------------------------------------------------------

export class FirePatch {
  private tick = 0;
  private emitT = 0;
  constructor(readonly x: number, readonly z: number, readonly r: number, readonly dps: number, public life: number) {}

  update(dt: number, ctx: Ctx): boolean {
    this.life -= dt;
    this.tick -= dt;
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.05;
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * this.r;
      ctx.fx.glows.spawn({ x: this.x + Math.cos(a) * d, y: 0.05, z: this.z + Math.sin(a) * d, count: 1, color: [0xff7a20, 0xffb040, 0xff5010], size: 0.22, grow: 0.2, speed: 0.1, up: 1.2, life: 0.55 });
    }
    if (this.tick <= 0) {
      this.tick = 0.25;
      for (const z of ctx.zombiesNear(this.x, this.z, this.r)) {
        z.burnTimer = Math.max(z.burnTimer, 1.2);
        z.burnDps = Math.max(z.burnDps, this.dps);
      }
    }
    return this.life > 0;
  }
}
