// Tower models. Each returns a rig with the moving bits exposed so entities/tower.ts
// can aim, recoil, swing and flap them.
import * as THREE from 'three';
import type { TowerId } from '../data/towers';
import { C, G, M, group, part, pivot } from './kit';
import { Glow } from './props';
import { bake } from './bake';

export interface TowerRig {
  root: THREE.Group;
  /** yaws toward the target */
  head: THREE.Group;
  /** where shots leave from (child of head) */
  muzzle: THREE.Object3D;
  /** tower-specific moving parts */
  parts: Record<string, THREE.Object3D>;
  /** decorations toggled by level */
  levelBits: THREE.Object3D[][];
  /** materials the tower animates (glow pulses etc.) */
  mats?: Record<string, THREE.MeshStandardMaterial>;
  twin?: THREE.Group;
}

const stone = () => M(C.stone, { rough: 0.95 });
const wood = () => M(C.wood);
const woodDark = () => M(C.woodDark);
const brass = () => M(C.brass, { metal: 0.65, rough: 0.35 });

function stoneBase(root: THREE.Group, h = 0.26, r = 0.4): void {
  part(G.cyl(r * 0.92, r, h, 14), stone(), { p: [0, h / 2, 0] }, root);
  // chunky cobbles around the rim
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    part(G.rock(0.09, i % 5), M(i % 2 ? C.stoneDark : C.stone, { flat: true }), {
      p: [Math.cos(a) * r * 0.98, 0.06, Math.sin(a) * r * 0.98], r: [0, a, 0],
    }, root);
  }
  part(G.cyl(r * 0.94, r * 0.94, 0.05, 14), woodDark(), { p: [0, h + 0.02, 0] }, root);
}

function pennant(color: number, y: number): THREE.Group {
  const g = pivot(group(undefined, [-0.28, y, -0.28]));
  part(G.cyl(0.015, 0.015, 0.5, 5), woodDark(), { p: [0, 0.25, 0] }, g);
  const flag = part(G.cone(0.08, 0.22, 3), M(color), { p: [0.1, 0.42, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.25] }, g);
  flag.name = 'flag';
  return g;
}

function addLevelBits(rig: TowerRig, topY: number) {
  const l2 = pennant(C.red, topY - 0.2);
  rig.root.add(l2);
  const l3a = pennant(C.mapleGold, topY - 0.2);
  l3a.position.set(0.28, topY - 0.2, -0.28);
  rig.root.add(l3a);
  const ring = part(G.torus(0.4, 0.035, 6, 24), brass(), { p: [0, 0.28, 0], r: [Math.PI / 2, 0, 0] }, rig.root);
  ring.userData.noBake = true; // toggled per level
  rig.levelBits = [[], [l2], [l3a, ring]];
}

// ---------------------------------------------------------------------------

function acorn(twin: boolean): TowerRig {
  const root = group();
  stoneBase(root);
  // timber stand
  for (const [x, z] of [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]]) {
    part(G.rbox(0.08, 0.36, 0.08, 0.02), wood(), { p: [x, 0.46, z] }, root);
  }
  part(G.rbox(0.62, 0.06, 0.06, 0.02), woodDark(), { p: [0, 0.42, 0.24], r: [0, 0, 0.35] }, root);
  part(G.rbox(0.62, 0.06, 0.06, 0.02), woodDark(), { p: [0, 0.42, -0.24], r: [0, 0, -0.35] }, root);
  part(G.rbox(0.68, 0.07, 0.68, 0.02), M(C.plank), { p: [0, 0.67, 0] }, root);

  const head = pivot(group(root, [0, 0.71, 0]));
  part(G.cyl(0.24, 0.27, 0.07, 16), woodDark(), { p: [0, 0.035, 0] }, head);
  // yoke
  for (const s of [-1, 1]) part(G.rbox(0.05, 0.22, 0.16, 0.02), woodDark(), { p: [s * 0.2, 0.17, 0] }, head);

  const barrels: THREE.Group[] = [];
  const makeBarrel = (x: number) => {
    const b = group(head, [x, 0.22, 0]);
    const recoil = pivot(group(b));
    part(G.cyl(0.16, 0.18, 0.56, 16), M(C.woodLight), { p: [0, 0, 0.05], r: [Math.PI / 2, 0, 0] }, recoil);
    for (let i = 0; i < 6; i++) part(G.box(0.012, 0.012, 0.5), M(C.wood), { p: [Math.cos(i * 1.05) * 0.168, Math.sin(i * 1.05) * 0.168, 0.05] }, recoil);
    for (const z of [-0.17, 0.07, 0.31]) part(G.torus(0.175, 0.026, 6, 20), brass(), { p: [0, 0, z] }, recoil);
    part(G.torus(0.13, 0.034, 6, 20), brass(), { p: [0, 0, 0.33] }, recoil);
    part(G.cyl(0.1, 0.1, 0.04, 12), M(0x2a1a10), { p: [0, 0, 0.33], r: [Math.PI / 2, 0, 0] }, recoil);
    // acorn peeking out
    part(G.sphere(0.055, 10, 8), M(0x9a6232), { p: [0, 0, 0.3], s: [1, 1, 1.2] }, recoil);
    barrels.push(recoil);
    return b;
  };
  let twinGroup: THREE.Group | undefined;
  if (twin) {
    makeBarrel(-0.1); makeBarrel(0.1);
    for (const b of barrels) b.scale.setScalar(0.78);
  } else {
    makeBarrel(0);
  }
  // acorn hopper basket on the back
  const hop = group(head, [0, 0.39, -0.14]);
  part(G.cyl(0.12, 0.08, 0.12, 12, true), M(0xc9a064), { p: [0, 0, 0] }, hop);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6;
    const ac = group(hop, [Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05]);
    part(G.sphere(0.04, 8, 6), M(0x9a6232), { s: [1, 1.2, 1] }, ac);
    part(G.sphere(0.042, 8, 6), M(0x5e3b20), { p: [0, 0.03, 0], s: [1, 0.5, 1] }, ac);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.22, 0.4);
  head.add(muzzle);

  const rig: TowerRig = { root, head, muzzle, parts: {}, levelBits: [] };
  barrels.forEach((b, i) => (rig.parts[`barrel${i}`] = b));
  if (twinGroup) rig.twin = twinGroup;
  addLevelBits(rig, 1.1);
  return rig;
}

function catapult(): TowerRig {
  const root = group();
  part(G.rbox(0.82, 0.16, 0.82, 0.05), stone(), { p: [0, 0.08, 0] }, root);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(G.rock(0.08, i), M(C.stoneDark, { flat: true }), { p: [Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42] }, root);
  }
  const head = pivot(group(root, [0, 0.16, 0]));
  part(G.cyl(0.36, 0.38, 0.06, 18), woodDark(), { p: [0, 0.03, 0] }, head);
  // plank chassis on four chunky wheels
  part(G.rbox(0.5, 0.08, 0.74, 0.03), M(C.plank), { p: [0, 0.14, 0] }, head);
  for (let i = 0; i < 4; i++) part(G.box(0.48, 0.012, 0.02), woodDark(), { p: [0, 0.181, -0.27 + i * 0.18] }, head);
  for (const s of [-1, 1]) {
    for (const z of [-0.24, 0.24]) {
      const wheel = group(head, [s * 0.29, 0.13, z]);
      part(G.cyl(0.13, 0.13, 0.06, 14), woodDark(), { r: [0, 0, Math.PI / 2] }, wheel);
      part(G.torus(0.12, 0.018, 6, 16), M(C.iron, { metal: 0.5, rough: 0.5 }), { r: [0, Math.PI / 2, 0] }, wheel);
      part(G.cyl(0.035, 0.035, 0.08, 8), brass(), { r: [0, 0, Math.PI / 2] }, wheel);
    }
    // solid A-frame side panels holding the axle
    part(G.tri(0.5, 0.42, 0.035), wood(), { p: [s * 0.2, 0.18, -0.02], r: [0, Math.PI / 2, 0] }, head);
    part(G.cyl(0.05, 0.05, 0.07, 10), brass(), { p: [s * 0.2, 0.56, -0.02], r: [0, 0, Math.PI / 2] }, head);
  }
  part(G.cyl(0.035, 0.035, 0.5, 8), woodDark(), { p: [0, 0.56, -0.02], r: [0, 0, Math.PI / 2] }, head);
  // cross bar the arm slams into
  part(G.rbox(0.46, 0.07, 0.07, 0.02), woodDark(), { p: [0, 0.68, 0.18] }, head);
  // throwing arm pivots on the axle
  const arm = pivot(group(head, [0, 0.56, -0.02]));
  part(G.rbox(0.1, 0.1, 0.86, 0.03), M(C.woodLight), { p: [0, 0, -0.18] }, arm);
  for (const z of [-0.05, -0.35]) part(G.torus(0.065, 0.014, 5, 12), M(0xc9a064), { p: [0, 0, z] }, arm);
  part(G.rbox(0.16, 0.16, 0.16, 0.03), M(C.stoneDark), { p: [0, -0.06, 0.24] }, arm);
  const bucket = group(arm, [0, 0.05, -0.58]);
  part(G.cyl(0.16, 0.11, 0.1, 12, true), wood(), { p: [0, 0, 0] }, bucket);
  part(G.cyl(0.09, 0.09, 0.01, 12), woodDark(), { p: [0, -0.04, 0] }, bucket);
  const ammo = pivot(group(bucket, [0, 0.09, 0]));
  part(G.pumpkin(0.15), M(C.pumpkin, { rough: 0.6 }), {}, ammo);
  part(G.cyl(0.018, 0.024, 0.06, 5), M(C.stem), { p: [0, 0.12, 0] }, ammo);
  arm.rotation.x = -0.85; // cocked: bucket low at the back
  const muzzle = new THREE.Object3D();
  bucket.add(muzzle);
  muzzle.position.set(0, 0.08, 0);
  const rig: TowerRig = { root, head, muzzle, parts: { arm, ammo }, levelBits: [] };
  addLevelBits(rig, 1.0);
  return rig;
}

function sprinkler(): TowerRig {
  const root = group();
  stoneBase(root, 0.18, 0.38);
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    part(G.rbox(0.06, 0.22, 0.06, 0.02), woodDark(), { p: [x, 0.31, z] }, root);
  }
  const barrel = pivot(group(root, [0, 0.62, 0]));
  part(G.cyl(0.25, 0.25, 0.5, 18), M(C.woodLight), { p: [0, 0, 0] }, barrel);
  part(G.sphere(0.25, 18, 8, ), M(C.woodLight), { p: [0, 0, 0], s: [1.08, 0.75, 1.08] }, barrel);
  for (const y of [-0.17, 0.0, 0.17]) part(G.torus(0.262, 0.018, 6, 22), brass(), { p: [0, y, 0], r: [Math.PI / 2, 0, 0] }, barrel);
  // painted maple leaf
  part(G.ico(0.07, 0), M(C.maple), { p: [0, 0.06, 0.25], s: [1, 1, 0.2] }, barrel);
  // tap
  part(G.cyl(0.025, 0.025, 0.1, 6), brass(), { p: [0, -0.12, 0.28], r: [Math.PI / 2, 0, 0] }, barrel);
  // syrup on top
  part(G.cyl(0.21, 0.21, 0.02, 18), M(C.syrup, { rough: 0.15 }), { p: [0, 0.26, 0] }, barrel);
  // pipe + spinning head
  part(G.cyl(0.03, 0.03, 0.3, 8), brass(), { p: [0, 0.98, 0] }, root);
  const head = pivot(group(root, [0, 1.12, 0]));
  part(G.sphere(0.06, 10, 8), brass(), {}, head);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const armG = group(head); armG.rotation.y = a;
    part(G.cyl(0.018, 0.018, 0.22, 6), brass(), { p: [0, 0, 0.11], r: [Math.PI / 2, 0, 0] }, armG);
    part(G.cyl(0.03, 0.02, 0.05, 6), brass(), { p: [0, 0.02, 0.22] }, armG);
  }
  const muzzle = new THREE.Object3D();
  head.add(muzzle);
  const rig: TowerRig = { root, head, muzzle, parts: { barrel }, levelBits: [] };
  addLevelBits(rig, 1.1);
  return rig;
}

function lantern(): TowerRig {
  const root = group();
  stoneBase(root, 0.2, 0.36);
  part(G.rbox(0.15, 1.15, 0.15, 0.03), wood(), { p: [0, 0.8, 0] }, root);
  for (const r of [0, Math.PI / 2]) {
    const brace = part(G.rbox(0.05, 0.45, 0.05, 0.01), woodDark(), { p: [0, 0.48, 0], r: [0, r, 0] }, root);
    brace.rotation.z = 0.5;
  }
  const head = pivot(group(root, [0, 1.38, 0]));
  // iron cage & glass jar
  const iron = M(C.iron, { metal: 0.55, rough: 0.5 });
  part(G.cyl(0.2, 0.22, 0.05, 6), iron, { p: [0, 0, 0] }, head);
  const glass = new THREE.MeshStandardMaterial({ color: 0xfff6d0, roughness: 0.05, transparent: true, opacity: 0.28, emissive: 0xc8ff6a, emissiveIntensity: 0.15 });
  part(G.cyl(0.17, 0.17, 0.36, 14), glass, { p: [0, 0.21, 0], shadow: false }, head);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(G.rbox(0.025, 0.38, 0.025, 0.005), iron, { p: [Math.cos(a) * 0.18, 0.21, Math.sin(a) * 0.18] }, head);
  }
  part(G.cyl(0.2, 0.2, 0.04, 6), iron, { p: [0, 0.41, 0] }, head);
  part(G.cone(0.27, 0.22, 6), M(0x8a3f2a, { rough: 0.8 }), { p: [0, 0.54, 0] }, head);
  part(G.torus(0.05, 0.012, 6, 12), iron, { p: [0, 0.68, 0] }, head);
  // the angry little swarm
  const core = part(G.sphere(0.07, 12, 10), Glow.lantern.mat, { p: [0, 0.2, 0], shadow: false }, head);
  core.visible = false;
  const flies = group(head, [0, 0.21, 0]);
  flies.userData.noBake = true; // every firefly orbits on its own
  const flyMat = new THREE.MeshStandardMaterial({ color: C.firefly, emissive: C.firefly, emissiveIntensity: 3.5 });
  for (let i = 0; i < 9; i++) {
    const f = part(G.sphere(0.022, 6, 5), flyMat, { shadow: false }, flies);
    f.userData.phase = i * 0.7;
    f.userData.rad = 0.05 + (i % 3) * 0.035;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.21, 0);
  head.add(muzzle);
  const rig: TowerRig = { root, head, muzzle, parts: { flies }, levelBits: [], mats: { flyMat, glass } };
  addLevelBits(rig, 1.0);
  return rig;
}

function owl(): TowerRig {
  const root = group();
  // tree stump with roots
  part(G.cyl(0.3, 0.38, 0.75, 12), M(0x7a5236), { p: [0, 0.37, 0] }, root);
  part(G.cyl(0.3, 0.3, 0.02, 12), M(0xd6aa72), { p: [0, 0.755, 0] }, root);
  part(G.torus(0.18, 0.01, 4, 16), M(0xa07448), { p: [0, 0.77, 0], r: [Math.PI / 2, 0, 0] }, root);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    part(G.rbox(0.1, 0.12, 0.3, 0.04), M(0x6b4630), { p: [Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36], r: [0, -a + Math.PI / 2, 0.3] }, root);
  }
  part(G.sphere(0.12, 8, 6), M(C.moss), { p: [0.2, 0.55, 0.22], s: [1, 0.5, 0.6] }, root);
  // perch branch
  part(G.cyl(0.03, 0.03, 0.45, 6), M(C.trunk), { p: [0, 0.83, 0.02], r: [0, 0, Math.PI / 2] }, root);

  const head = pivot(group(root, [0, 0.82, 0]));
  const owlBody = pivot(group(head));
  const feather = M(0x9a6a44), dark = M(0x6b4630), cream = M(0xf1dfb8), belly = M(0xe9d3a8);
  // plump body with a speckled belly
  part(G.sphere(0.21, 18, 14), feather, { p: [0, 0.2, 0], s: [1, 1.08, 0.95] }, owlBody);
  part(G.sphere(0.16, 16, 12), belly, { p: [0, 0.16, 0.08], s: [1, 1.1, 0.7] }, owlBody);
  for (let i = 0; i < 5; i++) {
    const x = (i % 3 - 1) * 0.06 + (i > 2 ? 0.03 : 0), y = 0.1 + Math.floor(i / 3) * 0.08;
    part(G.cone(0.018, 0.03, 3), dark, { p: [x, y + 0.04, 0.19], r: [Math.PI / 2 + 0.4, 0, Math.PI] }, owlBody);
  }
  const wingL = pivot(group(owlBody, [-0.19, 0.27, -0.01]));
  const wingR = pivot(group(owlBody, [0.19, 0.27, -0.01]));
  for (const [w, s] of [[wingL, -1], [wingR, 1]] as const) {
    part(G.sphere(0.13, 12, 10), dark, { p: [s * 0.02, -0.08, 0], s: [0.42, 1.1, 0.95] }, w);
  }
  // big round head with a heart-ish facial disc and enormous eyes
  const face = pivot(group(owlBody, [0, 0.45, 0.01]));
  part(G.sphere(0.18, 18, 14), feather, { s: [1.08, 0.95, 0.95] }, face);
  for (const s of [-1, 1]) {
    part(G.sphere(0.085, 16, 12), cream, { p: [s * 0.075, 0.0, 0.12], s: [1, 1, 0.45] }, face);
    part(G.sphere(0.058, 14, 12), M(0xf3a21f, { rough: 0.25, emissive: 0x6a3a00, emissiveIntensity: 0.3 }), { p: [s * 0.075, 0.005, 0.148] }, face);
    part(G.sphere(0.034, 12, 10), M(0x141414, { rough: 0.15 }), { p: [s * 0.075, 0.005, 0.192] }, face);
    part(G.sphere(0.012, 8, 6), M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 }), { p: [s * 0.065 + 0.012, 0.022, 0.215] }, face);
    // ear tufts
    part(G.cone(0.045, 0.13, 6), dark, { p: [s * 0.12, 0.15, 0.0], r: [-0.2, 0, -s * 0.45] }, face);
    // brows give it a determined little scowl
    part(G.rbox(0.07, 0.018, 0.02, 0.008), dark, { p: [s * 0.075, 0.075, 0.16], r: [0, 0, s * 0.3] }, face);
  }
  part(G.cone(0.028, 0.07, 6), M(0xf0a030), { p: [0, -0.05, 0.17], r: [Math.PI / 2 + 0.5, 0, 0] }, face);
  // feet gripping the perch
  for (const s of [-1, 1]) part(G.sphere(0.035, 8, 6), M(0xf0a030), { p: [s * 0.07, 0.0, 0.1], s: [1.4, 0.6, 1.2] }, owlBody);
  owlBody.scale.setScalar(1.15);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.3, 0.2);
  head.add(muzzle);
  const rig: TowerRig = { root, head, muzzle, parts: { wingL, wingR, face, owlBody }, levelBits: [] };
  addLevelBits(rig, 1.2);
  return rig;
}

export function buildTower(id: TowerId, opts: { twin?: boolean } = {}): TowerRig {
  let rig: TowerRig;
  switch (id) {
    case 'acorn': rig = acorn(!!opts.twin); break;
    case 'catapult': rig = catapult(); break;
    case 'sprinkler': rig = sprinkler(); break;
    case 'lantern': rig = lantern(); break;
    case 'owl': rig = owl(); break;
  }
  rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  bake(rig.root, { flatten: true });
  return rig;
}

export function setTowerLevel(rig: TowerRig, level: number): void {
  rig.levelBits.forEach((bits, i) => bits.forEach((b) => (b.visible = level >= i + 1)));
  rig.root.scale.setScalar(1.15 + (level - 1) * 0.07);
}
