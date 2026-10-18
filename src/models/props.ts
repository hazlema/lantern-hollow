// Scenery: trees, rocks, pumpkins, lamps, the crypt and the cottage.
import * as THREE from 'three';
import { C, G, M, group, part, pick } from './kit';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Materials that glow brighter as night falls. */
class GlowMat {
  readonly mat: THREE.MeshStandardMaterial;
  constructor(color: number, emissive: number, private day: number, private nightI: number) {
    this.mat = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: day, roughness: 0.4 });
  }
  set(n: number, flicker = 1) { this.mat.emissiveIntensity = lerp(this.day, this.nightI, n) * flicker; }
}

export const Glow = {
  window: new GlowMat(0xffe0a0, 0xffa94a, 0.25, 3.2),
  lantern: new GlowMat(0xfff0c0, 0xffb84d, 0.4, 5.0),
  jack: new GlowMat(0xffb040, 0xff7a1a, 0.0, 4.2),
  crypt: new GlowMat(0x9dff9a, 0x5dff7a, 0.6, 3.5),
  /** zombie eyes: plain white by day, a soft spooky glow at night */
  eyes: new GlowMat(0xf8ffd0, 0xe8ff9a, 0.0, 1.4),
  update(night: number, time: number) {
    const f = 0.92 + Math.sin(time * 9.1) * 0.04 + Math.sin(time * 23.7) * 0.04;
    this.window.set(night, f);
    this.lantern.set(night, f);
    this.jack.set(night, 0.9 + Math.sin(time * 6.3) * 0.1);
    this.crypt.set(night, 0.85 + Math.sin(time * 1.7) * 0.15);
    this.eyes.set(night);
  },
};

// ---------------------------------------------------------------------------

export function mapleTree(r: () => number): THREE.Group {
  const g = group();
  const tone = pick(r, [C.maple, C.mapleOrange, C.mapleGold, C.mapleOrange]);
  const tilt = (r() - 0.5) * 0.15;
  const trunk = group(g); trunk.rotation.z = tilt;
  part(G.cyl(0.07, 0.12, 0.8, 8), M(C.trunk), { p: [0, 0.4, 0] }, trunk);
  part(G.cyl(0.03, 0.05, 0.35, 6), M(C.trunk), { p: [0.12, 0.65, 0], r: [0, 0, -0.9] }, trunk);
  const crown = group(trunk, [0, 1.0, 0]);
  crown.userData.foliage = true;
  const blobs = 4 + Math.floor(r() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + r();
    const rad = i === 0 ? 0.42 : 0.26 + r() * 0.12;
    const off = i === 0 ? 0 : 0.28;
    const c = new THREE.Color(tone).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08).getHex();
    part(G.ico(rad, 2), M(c, { rough: 0.9 }), {
      p: [Math.cos(a) * off, (i === 0 ? 0.12 : r() * 0.25 - 0.05), Math.sin(a) * off],
    }, crown);
  }
  g.scale.setScalar(0.85 + r() * 0.4);
  g.rotation.y = r() * Math.PI * 2;
  return g;
}

export function pineTree(r: () => number): THREE.Group {
  const g = group();
  g.userData.foliage = true; // only the boughs above the trunk actually sway
  part(G.cyl(0.06, 0.09, 0.4, 7), M(C.trunk), { p: [0, 0.2, 0] }, g);
  const layers = [[0.46, 0.6, 0.5], [0.37, 0.55, 0.85], [0.26, 0.5, 1.17]];
  for (const [rad, h, y] of layers) {
    part(G.cone(rad, h, 9), M(r() > 0.5 ? C.pine : C.pineDark, { rough: 0.9 }), { p: [0, y, 0], r: [0, r() * 3, 0] }, g);
  }
  g.scale.setScalar(0.85 + r() * 0.45);
  g.rotation.y = r() * Math.PI * 2;
  return g;
}

export function deadTree(r: () => number): THREE.Group {
  const g = group();
  const wood = M(0x5b4a44);
  part(G.cyl(0.05, 0.1, 0.95, 6), wood, { p: [0, 0.47, 0], r: [0, 0, 0.08] }, g);
  for (let i = 0; i < 4; i++) {
    const y = 0.5 + i * 0.14;
    const a = r() * Math.PI * 2;
    const b = part(G.cyl(0.015, 0.035, 0.42, 5), wood, { p: [Math.cos(a) * 0.12, y + 0.12, Math.sin(a) * 0.12] }, g);
    b.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
  }
  g.rotation.y = r() * 6;
  return g;
}

export function rocks(r: () => number): THREE.Group {
  const g = group();
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const rad = i === 0 ? 0.28 : 0.13 + r() * 0.08;
    const a = r() * 6.28;
    const off = i === 0 ? 0 : 0.28;
    const rock = part(G.rock(rad, Math.floor(r() * 7)), M(i ? C.stoneDark : C.stone, { flat: true, rough: 0.95 }),
      { p: [Math.cos(a) * off, rad * 0.45, Math.sin(a) * off], r: [0, r() * 6, 0] }, g);
    if (i === 0) part(G.sphere(rad * 0.75, 10, 6), M(C.moss, { rough: 1 }), { p: [0, rad * 0.5, 0], s: [1, 0.3, 1] }, rock);
  }
  return g;
}

export function pumpkin(r: () => number, size: number, carved: boolean): THREE.Group {
  const g = group();
  const body = part(G.pumpkin(size), M(r() > 0.3 ? C.pumpkin : C.pumpkinDark, { rough: 0.6 }), { p: [0, size * 0.72, 0] }, g);
  part(G.cyl(size * 0.09, size * 0.13, size * 0.35, 6), M(C.stem), { p: [0, size * 0.78, 0], r: [0.2, 0, 0.15] }, body);
  if (carved) {
    const gm = Glow.jack.mat;
    const face = group(body, [0, 0, size * 0.93]);
    part(G.cone(size * 0.17, size * 0.18, 3), gm, { p: [-size * 0.3, size * 0.15, 0], r: [Math.PI / 2, 0, Math.PI], s: [1, 0.3, 1], shadow: false }, face);
    part(G.cone(size * 0.17, size * 0.18, 3), gm, { p: [size * 0.3, size * 0.15, 0], r: [Math.PI / 2, 0, Math.PI], s: [1, 0.3, 1], shadow: false }, face);
    part(G.rbox(size * 0.75, size * 0.16, size * 0.08, 0.02), gm, { p: [0, -size * 0.22, -0.01], shadow: false }, face);
  }
  return g;
}

export function pumpkinPatch(r: () => number): THREE.Group {
  const g = group();
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r();
    const p = pumpkin(r, 0.14 + r() * 0.1, r() > 0.6);
    p.position.set(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
    p.rotation.y = r() * 6.28 + (p.children.length ? 0 : 0);
    g.add(p);
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * 6.28;
    part(G.sphere(0.12, 8, 6), M(C.vine, { rough: 0.9 }), { p: [Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32], s: [1.2, 0.25, 0.8], r: [0, a, 0] }, g);
  }
  part(G.torus(0.22, 0.015, 5, 24, 4.5), M(C.vine), { p: [0, 0.03, 0], r: [Math.PI / 2, 0, r() * 6] }, g);
  return g;
}

export function lampPost(): THREE.Group {
  const g = group();
  part(G.rbox(0.22, 0.12, 0.22, 0.03), M(C.stone), { p: [0, 0.06, 0] }, g);
  part(G.rbox(0.09, 1.15, 0.09, 0.02), M(C.woodDark), { p: [0, 0.65, 0] }, g);
  part(G.rbox(0.36, 0.06, 0.07, 0.02), M(C.woodDark), { p: [0.13, 1.18, 0] }, g);
  const lantern = group(g, [0.27, 1.03, 0]);
  part(G.rbox(0.15, 0.03, 0.15, 0.01), M(C.iron, { metal: 0.5, rough: 0.5 }), { p: [0, 0.1, 0] }, lantern);
  part(G.cone(0.11, 0.08, 4), M(C.iron, { metal: 0.5, rough: 0.5 }), { p: [0, 0.15, 0], r: [0, Math.PI / 4, 0] }, lantern);
  part(G.rbox(0.12, 0.16, 0.12, 0.02), Glow.lantern.mat, { p: [0, 0, 0], shadow: false }, lantern);
  part(G.rbox(0.15, 0.03, 0.15, 0.01), M(C.iron, { metal: 0.5, rough: 0.5 }), { p: [0, -0.09, 0] }, lantern);
  part(G.cyl(0.005, 0.005, 0.06, 4), M(C.iron), { p: [0, 0.14, 0] }, lantern);
  g.userData.lightAt = new THREE.Vector3(0.27, 1.03, 0);
  return g;
}

export function tombstone(r: () => number): THREE.Group {
  const g = group();
  const s = part(G.rbox(0.26, 0.36, 0.08, 0.06), M(C.stoneDark, { rough: 0.95 }), { p: [0, 0.16, 0] }, g);
  s.rotation.set((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.3);
  part(G.sphere(0.07, 8, 6), M(C.moss), { p: [0.06, 0.17, 0.02], s: [1, 0.4, 0.6] }, s);
  return g;
}

/** Stone mausoleum the zombies stumble out of. Door faces +x. */
export function crypt(): THREE.Group {
  const g = group();
  const stone = M(0x9c958c, { rough: 0.95 });
  const dark = M(0x7a736b, { rough: 0.95 });
  part(G.rbox(1.7, 0.2, 2.5, 0.05), dark, { p: [0, 0.1, 0] }, g);
  part(G.rbox(1.35, 1.15, 1.9, 0.06), stone, { p: [-0.1, 0.77, 0] }, g);
  // pillars flanking the door
  for (const z of [-0.55, 0.55]) {
    part(G.cyl(0.11, 0.13, 1.15, 10), M(0xb5aea4), { p: [0.66, 0.77, z] }, g);
    part(G.rbox(0.3, 0.1, 0.3, 0.03), dark, { p: [0.66, 1.38, z] }, g);
  }
  part(G.rbox(0.45, 0.14, 1.55, 0.04), dark, { p: [0.62, 1.48, 0] }, g);
  const roof = part(G.roof(1.6, 0.6, 2.1), M(0x6d6862, { rough: 0.9 }), { p: [-0.1, 1.38, 0] }, g);
  roof.rotation.y = 0;
  // glowing doorway
  part(G.rbox(0.06, 0.75, 0.6, 0.02), M(0x1a1f1a), { p: [0.56, 0.6, 0] }, g);
  part(G.cyl(0.3, 0.3, 0.06, 16, false), M(0x1a1f1a), { p: [0.56, 0.97, 0], r: [0, 0, Math.PI / 2] }, g);
  part(G.rbox(0.03, 0.68, 0.5, 0.02), Glow.crypt.mat, { p: [0.58, 0.58, 0], shadow: false }, g);
  // urn and cracked details
  part(G.sphere(0.12, 10, 8), stone, { p: [-0.1, 2.05, 0], s: [1, 1.3, 1] }, g);
  part(G.cyl(0.06, 0.1, 0.12, 8), stone, { p: [-0.1, 1.93, 0] }, g);
  for (const [z, y] of [[-0.8, 0.5], [0.7, 1.0], [-0.3, 1.2]]) {
    part(G.sphere(0.13, 8, 6), M(C.moss, { rough: 1 }), { p: [-0.77, y, z], s: [0.4, 0.8, 1.3] }, g);
  }
  const rr = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const t1 = tombstone(rr); t1.position.set(0.55, 0, 1.05); g.add(t1);
  const t2 = tombstone(rr); t2.position.set(0.5, 0, -1.05); t2.rotation.y = 0.4; g.add(t2);
  g.userData.door = new THREE.Vector3(0.7, 0.5, 0);
  return g;
}

/** The cosy cottage at the end of the road. Door faces -x (the road); ridge runs east-west. */
export function cottage(): THREE.Group {
  const g = group();
  const timber = M(C.timber);
  const plaster = M(C.plaster, { rough: 0.95 });
  const thatch = M(C.thatch, { rough: 1 });
  const thatchDark = M(0xc59a4c, { rough: 1 });
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // foundation and walls
  part(G.rbox(2.55, 0.32, 2.35, 0.08), M(C.stone, { rough: 0.95 }), { p: [0, 0.16, 0] }, g);
  for (let i = 0; i < 14; i++) {
    const side = i % 4, t = rnd() * 2 - 1;
    const x = side < 2 ? t * 1.2 : (side === 2 ? 1.27 : -1.27), z = side < 2 ? (side === 0 ? 1.17 : -1.17) : t * 1.1;
    part(G.rock(0.09, i % 6), M(i % 2 ? C.stoneDark : C.stone, { flat: true }), { p: [x, 0.12 + rnd() * 0.12, z] }, g);
  }
  part(G.rbox(2.2, 1.15, 2.0, 0.05), plaster, { p: [0, 0.89, 0] }, g);
  // timber framing: corner posts, sill and top plates, a few braces
  for (const x of [-1.1, 1.1]) for (const z of [-1.0, 1.0]) part(G.rbox(0.13, 1.18, 0.13, 0.02), timber, { p: [x, 0.89, z] }, g);
  for (const z of [-1.01, 1.01]) {
    part(G.rbox(2.3, 0.1, 0.1, 0.02), timber, { p: [0, 1.45, z] }, g);
    part(G.rbox(2.25, 0.08, 0.08, 0.02), timber, { p: [0, 0.55, z] }, g);
    part(G.rbox(0.08, 0.7, 0.08, 0.02), timber, { p: [-0.45, 1.05, z * 1.005], r: [0, 0, 0.6] }, g);
  }
  for (const x of [-1.11, 1.11]) part(G.rbox(0.1, 0.1, 2.1, 0.02), timber, { p: [x, 1.45, 0] }, g);

  // gable ends (east & west) and the thatched roof, ridge along x
  const gable = part(G.roof(2.0, 1.05, 2.18), plaster, { p: [0, 1.47, 0] }, g);
  gable.rotation.y = Math.PI / 2;
  for (const x of [-1.1, 1.1]) {
    part(G.rbox(0.07, 0.95, 0.08, 0.02), timber, { p: [x, 1.9, 0] }, g);
    part(G.rbox(0.07, 0.07, 1.5, 0.02), timber, { p: [x, 1.62, 0] }, g);
  }
  // round attic window on the east gable, facing the camera
  part(G.cyl(0.17, 0.17, 0.06, 18), timber, { p: [1.12, 1.95, 0], r: [0, 0, Math.PI / 2] }, g);
  part(G.cyl(0.13, 0.13, 0.07, 18), Glow.window.mat, { p: [1.13, 1.95, 0], r: [0, 0, Math.PI / 2], shadow: false }, g);
  part(G.rbox(0.08, 0.26, 0.025, 0.005), timber, { p: [1.15, 1.95, 0] }, g);
  part(G.rbox(0.08, 0.025, 0.26, 0.005), timber, { p: [1.15, 1.95, 0] }, g);

  const roof = part(G.roof(2.8, 1.4, 2.75), thatch, { p: [0, 1.36, 0] }, g);
  roof.rotation.y = Math.PI / 2;
  // a second, slightly smaller layer gives the thatch a stepped, bundled look
  const roof2 = part(G.roof(2.45, 1.2, 2.82), thatchDark, { p: [0, 1.6, 0] }, g);
  roof2.rotation.y = Math.PI / 2;
  part(G.cyl(0.12, 0.12, 2.95, 12), M(0xb98a42, { rough: 1 }), { p: [0, 2.78, 0], r: [0, 0, Math.PI / 2] }, g);
  // lumpy fringe along both eaves
  for (const z of [-1.38, 1.38]) for (let i = 0; i < 12; i++) {
    const x = -1.32 + i * 0.24;
    part(G.sphere(0.13, 10, 8), i % 2 ? thatch : thatchDark, { p: [x, 1.36, z], s: [1.1, 0.55, 0.9] }, g);
  }
  // moss and fallen leaves resting on the south slope
  const slopeY = (z: number) => 1.6 + 1.2 * (1 - Math.abs(z) / 1.225) + 0.08;
  for (let i = 0; i < 16; i++) {
    const x = (rnd() - 0.5) * 2.4, z = 0.2 + rnd() * 0.95;
    if (Math.abs(x + 0.35) < 0.4 && z > 0.4) continue; // keep clear of the dormer
    const leaf = i < 6;
    const blob = part(G.sphere(leaf ? 0.05 : 0.1, 8, 6), leaf ? M([C.maple, C.mapleOrange, C.mapleGold][i % 3]) : M(0x8a9a4a, { rough: 1 }),
      { p: [x, slopeY(z) - (leaf ? 0 : 0.03), z], s: leaf ? [1.4, 0.3, 1] : [1.8 + rnd(), 0.22, 1.1 + rnd() * 0.6] }, g);
    blob.rotation.x = 0.75;
  }

  // dormer window on the south slope
  const dormer = group(g, [-0.35, 0, 0.72]);
  part(G.rbox(0.56, 0.5, 0.5, 0.04), plaster, { p: [0, 2.05, 0] }, dormer);
  const dr = part(G.roof(0.78, 0.36, 0.66), thatch, { p: [0, 2.28, 0.03] }, dormer);
  dr.rotation.y = 0;
  part(G.rbox(0.36, 0.32, 0.05, 0.02), timber, { p: [0, 2.05, 0.26] }, dormer);
  part(G.rbox(0.27, 0.24, 0.06, 0.01), Glow.window.mat, { p: [0, 2.05, 0.27], shadow: false }, dormer);
  part(G.rbox(0.27, 0.025, 0.07, 0.005), timber, { p: [0, 2.05, 0.28] }, dormer);

  // chimney on the north slope, poking above the ridge
  const chim = group(g, [0.62, 0, -0.55]);
  part(G.rbox(0.44, 1.5, 0.44, 0.05), M(0xa39488, { rough: 0.95 }), { p: [0, 2.25, 0] }, chim);
  for (let i = 0; i < 5; i++) part(G.rbox(0.18, 0.1, 0.05, 0.02), M(0x8a7d72), { p: [(rnd() - 0.5) * 0.25, 1.9 + i * 0.18, 0.225] }, chim);
  part(G.rbox(0.52, 0.12, 0.52, 0.03), M(0x8a7d72), { p: [0, 3.02, 0] }, chim);
  part(G.cyl(0.08, 0.1, 0.16, 8), M(0xb06a3a), { p: [0.08, 3.14, 0.05] }, chim);
  g.userData.chimney = new THREE.Vector3(0.7, 3.25, -0.5);

  // round-topped door on the west wall, facing the road
  const door = group(g, [-1.13, 0, 0.1]);
  part(G.rbox(0.08, 0.62, 0.5, 0.02), M(0x7a4a2a), { p: [0, 0.63, 0] }, door);
  part(G.cyl(0.25, 0.25, 0.08, 16), M(0x7a4a2a), { p: [0, 0.94, 0], r: [0, 0, Math.PI / 2] }, door);
  for (const z of [-0.12, 0.12]) part(G.rbox(0.09, 0.5, 0.03, 0.01), M(0x5e3a20), { p: [-0.01, 0.7, z] }, door);
  part(G.sphere(0.035, 8, 6), M(C.brass, { metal: 0.7, rough: 0.35 }), { p: [-0.06, 0.65, 0.15] }, door);
  part(G.rbox(0.3, 0.08, 0.7, 0.03), M(C.stone), { p: [-0.12, 0.33, 0] }, door);
  // windows
  const windowAt = (x: number, y: number, z: number, ry: number) => {
    const w = group(g, [x, y, z]); w.rotation.y = ry;
    part(G.rbox(0.42, 0.42, 0.06, 0.02), M(C.timber), { p: [0, 0, 0] }, w);
    part(G.rbox(0.33, 0.33, 0.07, 0.01), Glow.window.mat, { p: [0, 0, 0.005], shadow: false }, w);
    part(G.rbox(0.33, 0.035, 0.08, 0.005), M(C.timber), { p: [0, 0, 0.01] }, w);
    part(G.rbox(0.035, 0.33, 0.08, 0.005), M(C.timber), { p: [0, 0, 0.01] }, w);
    for (const s of [-1, 1]) part(G.rbox(0.13, 0.4, 0.04, 0.02), M(0x5d7f5a), { p: [s * 0.28, 0, 0.02], r: [0, s * 0.35, 0] }, w);
    part(G.rbox(0.48, 0.08, 0.14, 0.02), M(C.woodDark), { p: [0, -0.25, 0.04] }, w);
    for (let i = 0; i < 4; i++) part(G.sphere(0.045, 6, 5), M([C.red, C.mapleGold, C.white, C.red][i]), { p: [-0.15 + i * 0.1, -0.19, 0.06] }, w);
    for (let i = 0; i < 3; i++) part(G.sphere(0.04, 6, 5), M(C.grassDark), { p: [-0.1 + i * 0.1, -0.2, 0.09], s: [1.2, 0.6, 1] }, w);
  };
  windowAt(-1.12, 0.95, -0.6, -Math.PI / 2);
  windowAt(-0.45, 0.95, 1.02, 0);
  windowAt(0.5, 0.95, 1.02, 0);
  windowAt(-0.5, 0.95, -1.02, Math.PI);
  windowAt(1.12, 0.95, 0.45, Math.PI / 2);
  // porch lantern beside the door
  const pl = group(g, [-1.2, 1.15, -0.32]);
  part(G.rbox(0.12, 0.15, 0.12, 0.02), Glow.lantern.mat, { shadow: false }, pl);
  part(G.cone(0.1, 0.07, 4), M(C.iron, { metal: 0.5 }), { p: [0, 0.11, 0], r: [0, Math.PI / 4, 0] }, pl);
  g.userData.porchLight = new THREE.Vector3(-1.45, 1.15, -0.32);

  // garden: bench, woodpile, hay, apple crate
  const bench = group(g, [0.0, 0.32, 1.38]);
  part(G.rbox(0.7, 0.05, 0.2, 0.02), M(C.plank), { p: [0, 0.2, 0] }, bench);
  for (const x of [-0.28, 0.28]) part(G.rbox(0.05, 0.2, 0.18, 0.01), M(C.woodDark), { p: [x, 0.1, 0] }, bench);
  const pile = group(g, [1.45, 0.32, -0.3]);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
    const log = part(G.cyl(0.07, 0.07, 0.5, 8), M(row % 2 ? 0x8a5a36 : 0x9a6a40), { p: [0, 0.07 + row * 0.12, -0.2 + i * 0.14 + row * 0.07], r: [0, 0, Math.PI / 2] }, pile);
    part(G.cyl(0.055, 0.055, 0.51, 8), M(0xd8b07a), {}, log);
  }
  const hay = part(G.rbox(0.5, 0.3, 0.32, 0.08), M(0xe0bd62, { rough: 1 }), { p: [0.75, 0.47, 1.45] }, g);
  hay.rotation.y = 0.3;
  part(G.rbox(0.36, 0.42, 0.36, 0.04), M(C.plank), { p: [-0.75, 0.53, -1.35] }, g);
  for (let i = 0; i < 3; i++) part(G.sphere(0.08, 8, 6), M(C.red), { p: [-0.85 + i * 0.1, 0.78, -1.35] }, g);
  return g;
}

/** Puffy cloud for under the island. */
export function cloud(r: () => number): THREE.Group {
  const g = group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xfff3e6, emissiveIntensity: 0.25 });
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const m = part(G.ico(0.6 + r() * 0.5, 2), mat, { p: [i * 0.7 - n * 0.35, r() * 0.3, (r() - 0.5) * 0.8], shadow: false, receive: false }, g);
    m.scale.y = 0.7;
  }
  g.userData.mat = mat;
  return g;
}
