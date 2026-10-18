// Build-mode helpers: ghost tower preview, range ring, tile highlight and the
// soft grid that only shows while you're placing something.
import * as THREE from 'three';
import type { GameMap } from '../data/map';
import type { TowerId } from '../data/towers';
import { buildTower } from '../models/towers';

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.05)');
  grd.addColorStop(0.86, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.95, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.985, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  // dashes around the rim
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.setLineDash([10, 9]);
  g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 3;
  g.beginPath(); g.roundRect(5, 5, 54, 54, 10); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BuildCursor {
  readonly group = new THREE.Group();
  private ghost: THREE.Group | null = null;
  private ghostId: TowerId | null = null;
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0x9cff9c, transparent: true, opacity: 0.55, emissive: 0x3a8a3a, emissiveIntensity: 0.6, depthWrite: false });
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private tile: THREE.Mesh;
  private tileMat: THREE.MeshBasicMaterial;
  private grid: THREE.InstancedMesh;
  private gridMat: THREE.MeshBasicMaterial;
  private gridOn = 0;
  private selRing: THREE.Mesh;
  private selRingMat: THREE.MeshBasicMaterial;

  constructor(map: GameMap) {
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const rtex = ringTexture();
    this.ringMat = new THREE.MeshBasicMaterial({ map: rtex, transparent: true, depthWrite: false, toneMapped: false, color: 0xffffff });
    this.ring = new THREE.Mesh(plane, this.ringMat);
    this.ring.renderOrder = 6;
    this.ring.position.y = 0.03;
    this.selRingMat = new THREE.MeshBasicMaterial({ map: rtex, transparent: true, depthWrite: false, toneMapped: false, color: 0xffd27a });
    this.selRing = new THREE.Mesh(plane, this.selRingMat);
    this.selRing.renderOrder = 6;
    this.selRing.position.y = 0.035;
    this.selRing.visible = false;

    this.tileMat = new THREE.MeshBasicMaterial({ map: tileTexture(), transparent: true, depthWrite: false, toneMapped: false });
    this.tile = new THREE.Mesh(plane, this.tileMat);
    this.tile.renderOrder = 7;
    this.tile.position.y = 0.025;

    this.gridMat = new THREE.MeshBasicMaterial({ map: tileTexture(), transparent: true, depthWrite: false, opacity: 0, toneMapped: false, color: 0xfff6dc });
    const cells: THREE.Vector3[] = [];
    map.forEach((c, r, k) => { if (k === 'grass') { const w = map.toWorld(c, r); cells.push(new THREE.Vector3(w.x, 0.02, w.z)); } });
    this.grid = new THREE.InstancedMesh(plane, this.gridMat, cells.length);
    cells.forEach((p, i) => this.grid.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.94, 1, 0.94))));
    this.grid.renderOrder = 4;

    this.group.add(this.grid, this.ring, this.tile, this.selRing);
    this.hide();
  }

  hide() {
    this.ring.visible = false;
    this.tile.visible = false;
    if (this.ghost) this.ghost.visible = false;
  }

  /** Show the ghost for `id` at a tile centre. */
  show(id: TowerId, pos: THREE.Vector3, range: number, ok: boolean, onGrid: boolean) {
    if (this.ghostId !== id) {
      if (this.ghost) this.group.remove(this.ghost);
      const rig = buildTower(id);
      rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; m.receiveShadow = false; }
      });
      rig.levelBits.flat().forEach((b) => (b.visible = false));
      this.ghost = rig.root;
      this.ghostId = id;
      this.group.add(this.ghost);
    }
    const g = this.ghost!;
    g.visible = onGrid;
    g.position.lerp(pos, g.position.distanceTo(pos) > 3 ? 1 : 0.45);
    this.ghostMat.color.set(ok ? 0x9cff9c : 0xff8a7a);
    this.ghostMat.emissive.set(ok ? 0x3a8a3a : 0x8a2a20);
    this.ring.visible = onGrid;
    this.ring.position.set(pos.x, 0.03, pos.z);
    this.ring.scale.set(range * 2, 1, range * 2);
    this.ringMat.color.set(ok ? 0xc8ffb0 : 0xff9a8a);
    this.tile.visible = onGrid;
    this.tile.position.set(pos.x, 0.025, pos.z);
    this.tileMat.color.set(ok ? 0xffffff : 0xff6a5a);
  }

  /** Hover highlight when not building (e.g. pointing at a tower). */
  hoverTile(pos: THREE.Vector3 | null) {
    this.tile.visible = !!pos;
    if (pos) { this.tile.position.set(pos.x, 0.025, pos.z); this.tileMat.color.set(0xfff0c0); }
  }

  select(pos: THREE.Vector3 | null, range = 0) {
    this.selRing.visible = !!pos;
    if (pos) { this.selRing.position.set(pos.x, 0.035, pos.z); this.selRing.scale.set(range * 2, 1, range * 2); }
  }

  setGrid(on: boolean) { this.gridOn = on ? 1 : 0; }

  update(dt: number, time: number) {
    this.gridMat.opacity += (this.gridOn * 0.32 - this.gridMat.opacity) * Math.min(1, dt * 8);
    this.grid.visible = this.gridMat.opacity > 0.01;
    this.ring.rotation.y = time * 0.3;
    this.selRing.rotation.y = -time * 0.25;
    if (this.ghost) this.ghost.position.y = 0.05 + Math.sin(time * 4) * 0.03;
  }
}
