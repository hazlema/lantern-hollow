// Small modelling kit: cached geometries, a shared palette of clay-like materials,
// and a terse mesh helper so the procedural models read like recipes.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g as T;
}

export const G = {
  rbox: (w: number, h: number, d: number, r = 0.05, seg = 2) =>
    cached(`rbox:${w}:${h}:${d}:${r}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2))),
  box: (w: number, h: number, d: number) => cached(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt: number, rb: number, h: number, seg = 12, open = false) =>
    cached(`cyl:${rt}:${rb}:${h}:${seg}:${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  sphere: (r: number, ws = 16, hs = 12) => cached(`sph:${r}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  ico: (r: number, detail = 1) => cached(`ico:${r}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  dodeca: (r: number) => cached(`dod:${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  cone: (r: number, h: number, seg = 10) => cached(`cone:${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r: number, t: number, rs = 8, ts = 20, arc = Math.PI * 2) =>
    cached(`tor:${r}:${t}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  plane: (w: number, h: number) => cached(`pl:${w}:${h}`, () => new THREE.PlaneGeometry(w, h)),
  circle: (r: number, seg = 32) => cached(`circ:${r}:${seg}`, () => new THREE.CircleGeometry(r, seg)),
  /** Ribbed pumpkin: a squashed sphere with 8 soft lobes. */
  pumpkin: (r: number) => cached(`pump:${r}`, () => {
    const g = new THREE.SphereGeometry(r, 32, 16);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.z, v.x);
      const rib = 1 - 0.09 * Math.pow(Math.abs(Math.cos(a * 4)), 0.6);
      v.x *= rib; v.z *= rib;
      v.y *= 0.78;
      // dimple the top and bottom
      const dn = Math.abs(v.y) / (r * 0.78);
      if (dn > 0.85) v.y *= 1 - (dn - 0.85) * 0.6;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }),
  /** Lumpy rock: a dodecahedron with jittered vertices, flat shaded. */
  rock: (r: number, seed: number) => cached(`rock:${r}:${seed}`, () => {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 0);
    g = mergeVertices(g);
    const p = g.attributes.position as THREE.BufferAttribute;
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < p.count; i++) {
      const k = 0.78 + rnd() * 0.4;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
    }
    g = g.toNonIndexed();
    g.computeVertexNormals();
    return g;
  }),
  /** Thin triangular plank (no bevel), extruded along z. */
  tri: (w: number, h: number, d: number) => cached(`tri:${w}:${h}:${d}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(0, h); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 1 });
    g.translate(0, 0, -d / 2);
    g.computeVertexNormals();
    return g;
  }),
  /** Thatched roof: a triangular prism with soft bevels. */
  roof: (w: number, h: number, d: number) => cached(`roof:${w}:${h}:${d}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(0, h); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 1 });
    g.translate(0, 0, -d / 2);
    g.computeVertexNormals();
    return g;
  }),
};

// ---------------------------------------------------------------------------
// Palette

export const C = {
  grass: 0x86a84e, grassB: 0x9cb455, grassDark: 0x5f8a3e, grassAutumn: 0xc2a94c,
  dirt: 0xcf9f68, dirtDark: 0xa97a4d, soil: 0x7c5436, soilDark: 0x5a3b26, root: 0x6b4a33,
  stone: 0xb3ada3, stoneDark: 0x8d877f, moss: 0x7c9a4a,
  wood: 0xa86e3e, woodDark: 0x7a4a2a, woodLight: 0xcf9a5e, plank: 0xb98150,
  brass: 0xd8a64a, iron: 0x5b5652, copper: 0xc8763e,
  pumpkin: 0xf28a26, pumpkinDark: 0xd8691a, stem: 0x6b8a3a, vine: 0x5d8a3a,
  maple: 0xdc4a2f, mapleOrange: 0xef7f2c, mapleGold: 0xf3b63e, pine: 0x416e4c, pineDark: 0x2f5a3e, trunk: 0x6e4a32,
  thatch: 0xdcb366, plaster: 0xf3e5c7, timber: 0x70462a, window: 0xffcf6e,
  skin: 0x9fb889, skinB: 0x8fae7e, skinC: 0xa9bd8a, shirtA: 0x5d82a8, shirtB: 0xb05c4f, shirtC: 0x8a6fb0, shirtD: 0xd29a3e,
  pants: 0x4d5b73, pantsB: 0x6b5443, eye: 0xf8ffd0, mouth: 0x3b2a2a,
  syrup: 0xd8861c, glow: 0xffc860, firefly: 0xdcff73, owl: 0x9a6a44, owlBelly: 0xe9d3a8,
  water: 0x5fb4c9, lily: 0x6fa850, cream: 0xf3e6cc, red: 0xc94b3b, white: 0xf8f4ea,
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: number;
  emissiveIntensity?: number;
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
}

/** Shared clay material. Never mutate the result; use `matClone` for per-entity tweaks. */
export function M(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${o.rough ?? 0.82}:${o.metal ?? 0}:${o.emissive ?? 0}:${o.emissiveIntensity ?? 1}:${o.flat ?? false}:${o.transparent ?? false}:${o.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.82, metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
      flatShading: o.flat ?? false, transparent: o.transparent ?? false, opacity: o.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

export function matClone(m: THREE.Material): THREE.MeshStandardMaterial {
  return (m as THREE.MeshStandardMaterial).clone();
}

// ---------------------------------------------------------------------------
// Mesh helper

export interface PartOpts {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number] | number;
  shadow?: boolean;
  receive?: boolean;
  name?: string;
}

export function part(geo: THREE.BufferGeometry, mat: THREE.Material, o: PartOpts = {}, parent?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
  if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
  if (o.s !== undefined) typeof o.s === 'number' ? m.scale.setScalar(o.s) : m.scale.set(o.s[0], o.s[1], o.s[2]);
  m.castShadow = o.shadow ?? true;
  m.receiveShadow = o.receive ?? true;
  if (o.name) m.name = o.name;
  parent?.add(m);
  return m;
}

export function group(parent?: THREE.Object3D, p?: [number, number, number], name?: string): THREE.Group {
  const g = new THREE.Group();
  if (p) g.position.set(p[0], p[1], p[2]);
  if (name) g.name = name;
  parent?.add(g);
  return g;
}

/** Mark a node as a moving part so `bake` keeps it as its own pivot. */
export function pivot<T extends THREE.Object3D>(o: T): T {
  o.userData.pivot = true;
  return o;
}

/** Deterministic PRNG so the island looks the same every visit. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
