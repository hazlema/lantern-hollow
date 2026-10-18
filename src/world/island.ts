// Builds the floating island from the GameMap: ground tiles, soil, underside,
// scenery, grass tufts and fallen leaves.
import * as THREE from 'three';
import type { GameMap } from '../data/map';
import { C, G, M, rng } from '../models/kit';
import * as P from '../models/props';
import { bake } from '../models/bake';

export interface Island {
  root: THREE.Group;
  lamps: THREE.Vector3[];
  cryptDoor: THREE.Vector3;
  chimney: THREE.Vector3;
  porch: THREE.Vector3;
  cottage: THREE.Group;
  trees: THREE.Object3D[];
  clouds: THREE.Group[];
  water: THREE.Mesh | null;
  /** hide decorative grass on a tile when a tower is built there */
  setTileClutter(c: number, r: number, visible: boolean): void;
  windUniforms: { uTime: { value: number } };
}

const GRASS_TOP = 0;
const PATH_TOP = -0.07;

/** Material that sways vertices by height in the wind. */
function windy(base: THREE.MeshStandardMaterial, uni: { uTime: { value: number } }, strength: number): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wp = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
        #else
          vec3 wp = vec3(0.0);
        #endif
        float h = max(position.y, 0.0);
        float sw = sin(uTime * 1.9 + wp.x * 0.7 + wp.z * 0.45) * 0.6 + sin(uTime * 3.7 + wp.x * 1.3) * 0.25;
        transformed.x += sw * h * ${strength.toFixed(3)};
        transformed.z += cos(uTime * 1.6 + wp.z * 0.8) * h * ${(strength * 0.5).toFixed(3)};`);
  };
  m.customProgramCacheKey = () => `windy${strength}`;
  return m;
}

/** Vertex-coloured foliage that sways with height, phase-shifted by position. */
function foliageMaterial(uni: { uTime: { value: number } }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float lift = max(position.y - 0.55, 0.0);
        float ph = position.x * 0.55 + position.z * 0.35;
        transformed.x += (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25) * lift * 0.045;
        transformed.z += cos(uTime * 1.1 + ph) * lift * 0.025;`);
  };
  m.customProgramCacheKey = () => 'foliage-vc';
  return m;
}

export function buildIsland(map: GameMap): Island {
  const root = new THREE.Group();
  const r = rng(1337);
  const wind = { uTime: { value: 0 } };
  const lamps: THREE.Vector3[] = [];
  const trees: THREE.Object3D[] = [];

  // ---- ground caps (instanced) ---------------------------------------------
  const cells: { c: number; r: number; k: string }[] = [];
  map.forEach((c, rr, k) => { if (k !== 'void') cells.push({ c, r: rr, k }); });

  const capGeo = G.rbox(1.0, 0.34, 1.0, 0.012, 1);
  const grassCells = cells.filter((x) => x.k !== 'path' && x.k !== 'water');
  const pathCells = cells.filter((x) => x.k === 'path');
  const waterCells = cells.filter((x) => x.k === 'water');

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();

  const grass = new THREE.InstancedMesh(capGeo, M(0xffffff, { rough: 0.95 }), grassCells.length);
  grassCells.forEach((cell, i) => {
    const w = map.toWorld(cell.c, cell.r);
    m4.makeTranslation(w.x, GRASS_TOP - 0.17, w.z);
    grass.setMatrixAt(i, m4);
    // gentle checker + noise, warmer patches toward the cottage
    const checker = (cell.c + cell.r) % 2 === 0 ? 0 : 0.008;
    // soft meadow patches: low-frequency noise mixes in autumn gold and deeper greens
    const n1 = Math.sin(cell.c * 0.55 + 1.3) * Math.cos(cell.r * 0.7 - 0.4) * 0.5 + 0.5;
    const n2 = Math.sin(cell.c * 1.3 + cell.r * 0.9) * 0.5 + 0.5;
    col.set(C.grass).lerp(new THREE.Color(C.grassAutumn), n1 * 0.45 + r() * 0.06)
      .lerp(new THREE.Color(C.grassDark), n2 * 0.18).offsetHSL(0, 0, checker + (r() - 0.5) * 0.012);
    grass.setColorAt(i, col);
  });
  grass.receiveShadow = true;
  root.add(grass);

  const road = new THREE.InstancedMesh(G.rbox(1.0, 0.34, 1.0, 0.01, 1), M(0xffffff, { rough: 1 }), pathCells.length);
  pathCells.forEach((cell, i) => {
    const w = map.toWorld(cell.c, cell.r);
    m4.makeTranslation(w.x, PATH_TOP - 0.17, w.z);
    road.setMatrixAt(i, m4);
    col.set(C.dirt).offsetHSL((r() - 0.5) * 0.01, 0, (r() - 0.5) * 0.015);
    road.setColorAt(i, col);
  });
  road.receiveShadow = true;
  root.add(road);

  // grass lips that spill over the road edges so the dirt looks worn into the meadow
  const lips: THREE.Matrix4[] = [];
  const lipCols: THREE.Color[] = [];
  for (const cell of pathCells) {
    const w = map.toWorld(cell.c, cell.r);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = map.kind(cell.c + dc, cell.r + dr);
      if (k === 'path' || k === 'void' || k === 'water' || k === 'crypt' || k === 'house') continue;
      // a few lumpy segments per edge rather than one straight strip
      for (let i = 0; i < 3; i++) {
        const along = -0.33 + i * 0.33 + (r() - 0.5) * 0.1;
        const len = 0.3 + r() * 0.16;
        lips.push(new THREE.Matrix4().compose(
          new THREE.Vector3(w.x + dc * 0.47 + (dr !== 0 ? along : 0), -0.02, w.z + dr * 0.47 + (dc !== 0 ? along : 0)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dc !== 0 ? Math.PI / 2 : 0, 0)),
          new THREE.Vector3(len, 1, 0.75 + r() * 0.5),
        ));
        lipCols.push(new THREE.Color(C.grass).lerp(new THREE.Color(C.grassDark), 0.25 + r() * 0.3));
      }
    }
  }
  const lipMesh = new THREE.InstancedMesh(G.rbox(1, 0.1, 0.16, 0.05, 2), M(0xffffff, { rough: 1 }), lips.length);
  lips.forEach((mm, i) => { lipMesh.setMatrixAt(i, mm); lipMesh.setColorAt(i, lipCols[i]); });
  lipMesh.receiveShadow = true;
  root.add(lipMesh);

  // ---- soil body & underside ----------------------------------------------
  const soilGeo = G.box(1, 1, 1);
  const soil = new THREE.InstancedMesh(soilGeo, M(0xffffff, { rough: 1 }), cells.length * 2);
  let si = 0;
  const depthAt = (c: number, rr: number) => {
    // distance to the nearest void, so the underside tapers like a real floating rock
    let d = 9;
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      if (map.kind(c + dc, rr + dr) === 'void') d = Math.min(d, Math.hypot(dc, dr));
    }
    return d;
  };
  const under: { x: number; z: number; d: number }[] = [];
  for (const cell of cells) {
    const w = map.toWorld(cell.c, cell.r);
    const d = depthAt(cell.c, cell.r);
    // top soil layer
    m4.compose(new THREE.Vector3(w.x, -0.34 - 0.45, w.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.9, 1));
    soil.setMatrixAt(si, m4);
    col.set(C.soil);
    soil.setColorAt(si++, col);
    // deeper strata
    const deep = 0.7 + Math.min(d, 4) * 0.35 + r() * 0.3;
    m4.compose(new THREE.Vector3(w.x, -1.24 - deep / 2, w.z), new THREE.Quaternion(), new THREE.Vector3(1, deep, 1));
    soil.setMatrixAt(si, m4);
    col.set(C.soilDark);
    soil.setColorAt(si++, col);
    under.push({ x: w.x, z: w.z, d });
  }
  soil.count = si;
  root.add(soil);

  // hanging rocky stalactites
  const spikeGeo = new THREE.ConeGeometry(0.55, 1, 6);
  spikeGeo.rotateX(Math.PI);
  spikeGeo.translate(0, -0.5, 0);
  const spikes = new THREE.InstancedMesh(spikeGeo, M(0x5f4a3c, { flat: true, rough: 1 }), under.length);
  under.forEach((u, i) => {
    const len = 0.6 + Math.min(u.d, 5) * 0.75 + r() * 0.8;
    m4.compose(
      new THREE.Vector3(u.x + (r() - 0.5) * 0.3, -1.3 - (0.7 + Math.min(u.d, 4) * 0.35), u.z + (r() - 0.5) * 0.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.2, r() * 6, (r() - 0.5) * 0.2)),
      new THREE.Vector3(1 + r() * 0.4, len, 1 + r() * 0.4),
    );
    spikes.setMatrixAt(i, m4);
  });
  root.add(spikes);

  // dangling roots along the island rim
  const rootGeo = new THREE.CylinderGeometry(0.012, 0.03, 1, 5);
  rootGeo.translate(0, -0.5, 0);
  const rimRoots: THREE.Matrix4[] = [];
  for (const cell of cells) {
    const w = map.toWorld(cell.c, cell.r);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (map.kind(cell.c + dc, cell.r + dr) !== 'void' || r() > 0.45) continue;
      const len = 0.4 + r() * 0.9;
      rimRoots.push(new THREE.Matrix4().compose(
        new THREE.Vector3(w.x + dc * 0.5 + (r() - 0.5) * 0.6 * Math.abs(dr), -0.35, w.z + dr * 0.5 + (r() - 0.5) * 0.6 * Math.abs(dc)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(dr * 0.25, 0, -dc * 0.25)),
        new THREE.Vector3(1, len, 1),
      ));
    }
  }
  const roots = new THREE.InstancedMesh(rootGeo, M(C.root), rimRoots.length);
  rimRoots.forEach((mm, i) => roots.setMatrixAt(i, mm));
  root.add(roots);

  // ---- water ----------------------------------------------------------------
  let water: THREE.Mesh | null = null;
  if (waterCells.length) {
    const bed = new THREE.InstancedMesh(G.rbox(1, 0.34, 1, 0.05), M(0x8a7a5a), waterCells.length);
    waterCells.forEach((cell, i) => {
      const w = map.toWorld(cell.c, cell.r);
      m4.makeTranslation(w.x, -0.32 - 0.17, w.z);
      bed.setMatrixAt(i, m4);
    });
    root.add(bed);
    const wm = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82, emissive: 0x1d4a5a, emissiveIntensity: 0.25 });
    const shape = new THREE.Group();
    for (const cell of waterCells) {
      const w = map.toWorld(cell.c, cell.r);
      const sheet = new THREE.Mesh(G.plane(1.02, 1.02), wm);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(w.x, -0.1, w.z);
      sheet.receiveShadow = true;
      shape.add(sheet);
      // lily pads and reeds
      if (r() > 0.3) {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(0.13 + r() * 0.06, 14, 0.3, 5.7), M(C.lily));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(w.x + (r() - 0.5) * 0.6, -0.085, w.z + (r() - 0.5) * 0.6);
        root.add(pad);
        if (r() > 0.6) {
          const fl = new THREE.Mesh(G.sphere(0.04, 8, 6), M(0xf6c6d6));
          fl.position.copy(pad.position).add(new THREE.Vector3(0, 0.03, 0));
          root.add(fl);
        }
      }
    }
    root.add(shape);
    water = shape.children[0] as THREE.Mesh;
  }

  // ---- scenery from the map -------------------------------------------------
  const scenery = new THREE.Group();
  root.add(scenery);
  let cryptDoor = new THREE.Vector3();
  let chimney = new THREE.Vector3();
  let porch = new THREE.Vector3();
  let cottageGroup = new THREE.Group();
  let cryptPlaced = false, cottagePlaced = false;

  for (const cell of cells) {
    const w = map.toWorld(cell.c, cell.r);
    const place = (o: THREE.Object3D, jitter = 0.12) => {
      o.position.x += w.x + (r() - 0.5) * jitter;
      o.position.z += w.z + (r() - 0.5) * jitter;
      scenery.add(o);
      o.updateMatrixWorld(true);
      return o;
    };
    switch (cell.k) {
      case 'tree': {
        const nearCrypt = cell.c <= 3 && cell.r <= 5;
        const t = nearCrypt ? P.deadTree(r) : r() > 0.3 ? P.mapleTree(r) : P.pineTree(r);
        trees.push(place(t, 0.25));
        break;
      }
      case 'rock': place(P.rocks(r)); break;
      case 'pumpkin': place(P.pumpkinPatch(r)); break;
      case 'lamp': {
        const l = P.lampPost();
        l.scale.setScalar(1.3);
        // face the lantern toward the nearest road tile
        let best = 0, bd = 9;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dc, dr], i) => {
          const d = map.kind(cell.c + dc, cell.r + dr) === 'path' ? 0 : 1;
          if (d < bd) { bd = d; best = i; }
        });
        l.rotation.y = [0, Math.PI, -Math.PI / 2, Math.PI / 2][best];
        place(l, 0);
        l.updateMatrixWorld(true);
        lamps.push((l.userData.lightAt as THREE.Vector3).clone().applyMatrix4(l.matrixWorld));
        break;
      }
      case 'crypt': {
        if (cryptPlaced) break;
        cryptPlaced = true;
        // crypt occupies cols 0-1, rows 1-3: centre it on that block
        const cw = map.toWorld(0.5, 2);
        const cr = P.crypt();
        cr.position.set(cw.x, 0, cw.z);
        scenery.add(cr);
        cr.updateMatrixWorld(true);
        cryptDoor = (cr.userData.door as THREE.Vector3).clone().applyMatrix4(cr.matrixWorld);
        break;
      }
      case 'house': {
        if (cottagePlaced) break;
        cottagePlaced = true;
        const hw = map.toWorld(18, 9);
        const h = P.cottage();
        h.userData.pivot = true; // it wobbles when zombies bang on the door
        h.position.set(hw.x, 0, hw.z);
        h.scale.setScalar(1.18);
        scenery.add(h);
        h.updateMatrixWorld(true);
        chimney = (h.userData.chimney as THREE.Vector3).clone().applyMatrix4(h.matrixWorld);
        porch = (h.userData.porchLight as THREE.Vector3).clone().applyMatrix4(h.matrixWorld);
        cottageGroup = h;
        break;
      }
    }
  }

  // collapse all the scenery into a handful of draws; tree crowns sway in the vertex shader
  root.updateMatrixWorld(true);
  bake(scenery, { flatten: true, foliage: foliageMaterial(wind) });

  // ---- grass tufts, flowers and fallen leaves (non-blocking clutter) -------
  const bladeGeo = new THREE.ConeGeometry(0.035, 0.22, 4);
  bladeGeo.translate(0, 0.11, 0);
  const tuftMat = windy(M(0xffffff, { rough: 1 }), wind, 0.35);
  const buildable = cells.filter((x) => x.k === 'grass' || x.k === 'tree' || x.k === 'rock' || x.k === 'lamp');
  const perTile = 9;
  const tufts = new THREE.InstancedMesh(bladeGeo, tuftMat, buildable.length * perTile);
  const tileInstances = new Map<string, number[]>();
  const tileMatrices = new Map<number, THREE.Matrix4>();
  let ti = 0;
  for (const cell of buildable) {
    const w = map.toWorld(cell.c, cell.r);
    const ids: number[] = [];
    const clumps = 2 + Math.floor(r() * 2);
    for (let k = 0; k < clumps; k++) {
      const cx = w.x + (r() - 0.5) * 0.8, cz = w.z + (r() - 0.5) * 0.8;
      for (let b = 0; b < 3 && ti < tufts.count; b++) {
        const s = 0.6 + r() * 0.7;
        const mm = new THREE.Matrix4().compose(
          new THREE.Vector3(cx + (r() - 0.5) * 0.08, GRASS_TOP, cz + (r() - 0.5) * 0.08),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5)),
          new THREE.Vector3(s, s * (0.8 + r() * 0.6), s),
        );
        tufts.setMatrixAt(ti, mm);
        tileMatrices.set(ti, mm);
        col.set(C.grassDark).lerp(new THREE.Color(r() > 0.85 ? C.grassAutumn : C.grassB), r());
        tufts.setColorAt(ti, col);
        ids.push(ti++);
      }
    }
    tileInstances.set(`${cell.c},${cell.r}`, ids);
  }
  tufts.count = ti;
  tufts.castShadow = false;
  tufts.receiveShadow = true;
  root.add(tufts);

  // fallen maple leaves scattered everywhere
  const leafGeo = new THREE.CircleGeometry(0.06, 5);
  leafGeo.rotateX(-Math.PI / 2);
  const leafCells = cells.filter((x) => x.k !== 'water');
  const leaves = new THREE.InstancedMesh(leafGeo, M(0xffffff, { rough: 0.9 }), leafCells.length * 4);
  let li = 0;
  for (const cell of leafCells) {
    const w = map.toWorld(cell.c, cell.r);
    const n = cell.k === 'path' ? 2 : 3 + Math.floor(r() * 2);
    for (let k = 0; k < n && li < leaves.count; k++) {
      const top = cell.k === 'path' ? PATH_TOP : GRASS_TOP;
      leaves.setMatrixAt(li, new THREE.Matrix4().compose(
        new THREE.Vector3(w.x + (r() - 0.5) * 0.9, top + 0.006 + r() * 0.004, w.z + (r() - 0.5) * 0.9),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3)),
        new THREE.Vector3(1 + r() * 0.6, 1, 0.7 + r() * 0.5),
      ));
      leaves.setColorAt(li++, col.set([C.maple, C.mapleOrange, C.mapleGold, C.mapleOrange][Math.floor(r() * 4)]));
    }
  }
  leaves.count = li;
  leaves.receiveShadow = true;
  root.add(leaves);

  // little flowers dotted on the grass
  const flowerGeo = new THREE.IcosahedronGeometry(0.035, 0);
  flowerGeo.translate(0, 0.14, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, windy(M(0xffffff), wind, 0.35), 160);
  let fi = 0;
  const flowerMatrices: THREE.Matrix4[] = [];
  for (const cell of buildable) {
    if (r() > 0.35 || fi >= 160) continue;
    const w = map.toWorld(cell.c, cell.r);
    const fx = w.x + (r() - 0.5) * 0.8, fz = w.z + (r() - 0.5) * 0.8;
    flowerMatrices[fi] = new THREE.Matrix4().makeTranslation(fx, GRASS_TOP, fz);
    flowers.setMatrixAt(fi, flowerMatrices[fi]);
    flowers.setColorAt(fi, col.set([0xffffff, 0xf6d24a, 0xe8749a, 0xb59af0][Math.floor(r() * 4)]));
    const ids = tileInstances.get(`${cell.c},${cell.r}`);
    if (ids) ids.push(-1 - fi); // negative ids index the flower mesh
    fi++;
  }
  flowers.count = fi;
  root.add(flowers);

  // path pebbles
  const pebbles = new THREE.InstancedMesh(G.rock(0.05, 3), M(0xb8aa96, { flat: true }), pathCells.length * 3);
  let pi = 0;
  for (const cell of pathCells) {
    const w = map.toWorld(cell.c, cell.r);
    for (let k = 0; k < 3; k++) {
      if (r() > 0.6) continue;
      pebbles.setMatrixAt(pi++, new THREE.Matrix4().compose(
        new THREE.Vector3(w.x + (r() - 0.5) * 0.85, PATH_TOP + 0.01, w.z + (r() - 0.5) * 0.85),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)),
        new THREE.Vector3(1 + r(), 0.6 + r() * 0.5, 1 + r()),
      ));
    }
  }
  pebbles.count = pi;
  pebbles.receiveShadow = true;
  root.add(pebbles);

  // ---- clouds drifting beneath ------------------------------------------------
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const cl = P.cloud(r);
    const a = (i / 9) * Math.PI * 2;
    cl.position.set(Math.cos(a) * (9 + r() * 5), -4.5 - r() * 3, Math.sin(a) * (7 + r() * 4));
    cl.scale.setScalar(1 + r() * 0.8);
    cl.userData.speed = 0.15 + r() * 0.2;
    root.add(cl);
    clouds.push(cl);
  }

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    root, lamps, cryptDoor, chimney, porch, cottage: cottageGroup, trees, clouds, water,
    windUniforms: wind,
    setTileClutter(c, rr, visible) {
      const ids = tileInstances.get(`${c},${rr}`);
      if (!ids) return;
      for (const id of ids) {
        if (id >= 0) tufts.setMatrixAt(id, visible ? tileMatrices.get(id)! : hidden);
        else flowers.setMatrixAt(-1 - id, visible ? flowerMatrices[-1 - id] : hidden);
      }
      tufts.instanceMatrix.needsUpdate = true;
      flowers.instanceMatrix.needsUpdate = true;
    },
  };
}
