// Per-zombie decorations drawn with instancing: soft blob shadows under every
// zombie and camera-facing health bars. Three draw calls total, however big
// the horde gets.
import * as THREE from 'three';
import type { Zombie } from '../entities/zombie';
import type { Tower } from '../entities/tower';

function barTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(1, 1, 62, 14, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ZombieOverlays {
  readonly group = new THREE.Group();
  private blobs: THREE.InstancedMesh;
  private bg: THREE.InstancedMesh;
  private fill: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private right = new THREE.Vector3();
  private flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private col = new THREE.Color();

  private tbg: THREE.InstancedMesh;
  private tfill: THREE.InstancedMesh;

  constructor(private cap: number, shadowTex: THREE.Texture) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.blobs = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({
      map: shadowTex, color: 0x1a0e06, transparent: true, opacity: 0.4, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, toneMapped: false,
    }), cap);
    this.blobs.renderOrder = 3;
    const tex = barTexture();
    this.bg = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: tex, color: 0x2a1a14, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false }), cap);
    this.fill = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }), cap);
    this.bg.renderOrder = 30;
    this.fill.renderOrder = 31;
    for (const im of [this.blobs, this.bg, this.fill]) { im.frustumCulled = false; im.count = 0; }
    this.fill.setColorAt(0, this.col.set(0xffffff));
    // tower condition bars (only for damaged towers)
    this.tbg = new THREE.InstancedMesh(quad, this.bg.material, 128);
    this.tfill = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }), 128);
    this.tbg.renderOrder = 30; this.tfill.renderOrder = 31;
    for (const im of [this.tbg, this.tfill]) { im.frustumCulled = false; im.count = 0; }
    this.tfill.setColorAt(0, this.col.set(0xffffff));
    this.group.add(this.blobs, this.bg, this.fill, this.tbg, this.tfill);
  }

  update(zombies: readonly Zombie[], camera: THREE.Camera): void {
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    let nb = 0, nh = 0;
    for (const z of zombies) {
      if (nb >= this.cap) break;
      // blob shadow shrinks away with the zombie when it topples
      const r = 0.24 * z.rig.baseScale * z.shadowScale;
      if (r > 0.01) {
        this.m.compose(this.p.set(z.pos.x, 0.012, z.pos.z), this.flat, this.s.set(r * 2, r * 1.6, 1));
        this.blobs.setMatrixAt(nb++, this.m);
      }
      if (z.barShown < 0.02) continue;
      const w = z.boss ? 0.9 : 0.42;
      const h = (z.boss ? 0.13 : 0.09) * z.barShown;
      this.p.set(z.pos.x, z.barY, z.pos.z);
      this.m.compose(this.p, camera.quaternion, this.s.set(w + 0.05, h, 1));
      this.bg.setMatrixAt(nh, this.m);
      const frac = Math.max(0.001, z.hp / z.maxHp);
      this.p.addScaledVector(this.right, -w / 2 + (w * frac) / 2);
      this.m.compose(this.p, camera.quaternion, this.s.set(w * frac, h * 0.62, 1));
      this.fill.setMatrixAt(nh, this.m);
      if (z.boss) this.col.set(0xff8a3a);
      else this.col.setHSL(0.02 + 0.27 * frac, 0.75, 0.55);
      this.fill.setColorAt(nh, this.col);
      nh++;
    }
    this.blobs.count = nb;
    this.bg.count = this.fill.count = nh;
    this.blobs.instanceMatrix.needsUpdate = true;
    this.bg.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
  }

  updateTowers(towers: readonly Tower[], camera: THREE.Camera): void {
    let n = 0;
    const w = 0.62, h = 0.1;
    for (const t of towers) {
      if (t.condition >= 0.999 || n >= 128) continue;
      this.p.set(t.pos.x, 1.75, t.pos.z);
      this.m.compose(this.p, camera.quaternion, this.s.set(w + 0.05, h, 1));
      this.tbg.setMatrixAt(n, this.m);
      const frac = Math.max(0.02, t.condition);
      this.p.addScaledVector(this.right, -w / 2 + (w * frac) / 2);
      this.m.compose(this.p, camera.quaternion, this.s.set(w * frac, h * 0.6, 1));
      this.tfill.setMatrixAt(n, this.m);
      // amber when worn, red when nearly gone, grey when broken
      if (t.broken) this.col.setRGB(0.45, 0.42, 0.4);
      else this.col.setHSL(0.02 + 0.09 * frac, 0.85, 0.55);
      this.tfill.setColorAt(n, this.col);
      n++;
    }
    this.tbg.count = this.tfill.count = n;
    this.tbg.instanceMatrix.needsUpdate = true;
    this.tfill.instanceMatrix.needsUpdate = true;
    if (this.tfill.instanceColor) this.tfill.instanceColor.needsUpdate = true;
  }
}
