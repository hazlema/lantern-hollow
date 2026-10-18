// Goofy zombie rigs. Every zombie is a little puppet with hips, torso, head and
// limbs on pivots, so the walk cycle is done in code (see entities/zombie.ts).
import * as THREE from 'three';
import type { ZombieId } from '../data/zombies';
import { C, G, M, group, part, pick, pivot, rng } from './kit';
import { Glow } from './props';
import { bake } from './bake';

export interface ZombieRig {
  root: THREE.Group;
  body: THREE.Group;     // bobs and leans
  head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  scarf?: THREE.Group;
  /** materials cloned for this zombie, flashed white when hit */
  flash: THREE.MeshStandardMaterial[];
  /** syrup / burn tint target */
  tintables: THREE.MeshStandardMaterial[];
  height: number;
  baseScale: number;
}

/** Overall size per type: big enough to read their goofy faces at normal zoom. */
export const ZOMBIE_SCALE: Record<ZombieId, number> = { shambler: 1.3, sprinter: 1.2, pothead: 1.3, brute: 1.85, lumberjack: 1.4, king: 2.55 };

let seed = 1;

function own(color: number, rough = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

export function buildZombie(type: ZombieId): ZombieRig {
  const r = rng(seed++ * 7919);
  const root = group();
  const flash: THREE.MeshStandardMaterial[] = [];
  const skin = own(pick(r, [C.skin, C.skinB, C.skinC]));
  flash.push(skin);

  const jack = type === 'lumberjack';
  const shirtColor = type === 'brute' || jack ? C.shirtB : type === 'pothead' ? 0x8a6448 : pick(r, [C.shirtA, C.shirtC, C.shirtD, C.shirtA]);
  const shirt = own(shirtColor);
  const pants = own(type === 'sprinter' ? C.pantsB : C.pants);
  flash.push(shirt, pants);

  const thin = type === 'sprinter';
  const big = type === 'brute';
  const king = type === 'king';
  const torsoW = big ? 0.5 : thin ? 0.27 : 0.36;
  const torsoH = big ? 0.42 : 0.33;
  const legH = thin ? 0.34 : 0.28;
  const hipY = legH + 0.04;

  const body = pivot(group(root, [0, hipY, 0]));

  // legs
  const leg = (side: number) => {
    const g = pivot(group(root, [side * torsoW * 0.27, hipY, 0]));
    part(G.rbox(big ? 0.17 : 0.12, legH, 0.13, 0.04), pants, { p: [0, -legH / 2, 0] }, g);
    part(G.rbox(big ? 0.19 : 0.14, 0.07, 0.2, 0.03), M(0x4a3a30), { p: [0, -legH + 0.03, 0.03] }, g);
    return g;
  };
  const legL = leg(-1), legR = leg(1);

  // torso + overalls
  part(G.rbox(torsoW, torsoH, big ? 0.32 : 0.23, 0.07), shirt, { p: [0, torsoH / 2, 0] }, body);
  if (!king && !big && !jack) {
    const bib = own(type === 'pothead' ? 0x6b4f3a : C.shirtA);
    flash.push(bib);
    part(G.rbox(torsoW * 0.7, torsoH * 0.55, 0.03, 0.02), bib, { p: [0, torsoH * 0.3, 0.12] }, body);
    part(G.rbox(torsoW + 0.02, torsoH * 0.32, 0.25, 0.05), bib, { p: [0, torsoH * 0.12, 0] }, body);
    for (const s of [-1, 1]) part(G.rbox(0.04, torsoH * 0.6, 0.02, 0.01), bib, { p: [s * torsoW * 0.28, torsoH * 0.62, 0.122] }, body);
    // a patch or two
    part(G.rbox(0.07, 0.07, 0.02, 0.01), M(pick(r, [C.shirtD, C.red, 0x7fb069])), { p: [torsoW * 0.15, torsoH * 0.25, 0.14], r: [0, 0, 0.3] }, body);
  }
  if (jack) {
    // buffalo-plaid flannel: dark bands both ways, plus a belt
    const plaid = M(0x3a1a18);
    for (let i = 0; i < 3; i++) part(G.rbox(torsoW + 0.012, 0.03, 0.24, 0.01), plaid, { p: [0, 0.07 + i * 0.1, 0] }, body);
    for (const x of [-0.08, 0.08]) part(G.rbox(0.03, torsoH, 0.24, 0.01), plaid, { p: [x, torsoH / 2, 0] }, body);
    part(G.rbox(torsoW + 0.02, 0.05, 0.25, 0.02), M(0x4a3020), { p: [0, 0.03, 0] }, body);
    part(G.rbox(0.06, 0.05, 0.02, 0.01), M(C.brass, { metal: 0.7, rough: 0.35 }), { p: [0, 0.03, 0.13] }, body);
  }
  if (big) {
    // plaid stripes
    for (let i = 0; i < 3; i++) part(G.rbox(torsoW + 0.01, 0.035, 0.33, 0.01), M(0x6b2a24), { p: [0, 0.08 + i * 0.13, 0] }, body);
    part(G.rbox(0.035, torsoH, 0.33, 0.01), M(0x6b2a24), { p: [0.1, torsoH / 2, 0] }, body);
  }
  if (king) {
    // royal robe and vine cape
    part(G.cyl(0.22, 0.3, 0.3, 12), M(0x4b2f5e), { p: [0, 0.05, 0] }, body);
    const cape = part(G.sphere(0.3, 12, 8), M(C.vine, { rough: 0.9 }), { p: [0, torsoH * 0.55, -0.14], s: [1, 1.1, 0.35] }, body);
    for (let i = 0; i < 5; i++) {
      part(G.sphere(0.07, 6, 5), M([C.maple, C.mapleOrange, C.mapleGold][i % 3]), { p: [(i - 2) * 0.1, 0.15 + (i % 2) * 0.12, -0.08], s: [1, 0.5, 0.4] }, cape);
    }
  }

  // arms reach forward, zombie-style
  const armLen = big ? 0.36 : thin ? 0.3 : 0.28;
  const arm = (side: number) => {
    const g = pivot(group(body, [side * (torsoW / 2 + 0.04), torsoH - 0.06, 0]));
    part(G.rbox(big ? 0.14 : 0.085, armLen, big ? 0.14 : 0.09, 0.035), skin, { p: [0, -armLen / 2, 0] }, g);
    // sleeve
    part(G.rbox(big ? 0.17 : 0.11, armLen * 0.35, big ? 0.17 : 0.11, 0.035), shirt, { p: [0, -armLen * 0.15, 0] }, g);
    g.rotation.x = thin ? 0.6 : -1.25;
    return g;
  };
  const armL = arm(-1), armR = arm(1);

  // head
  const headS = big ? 0.22 : king ? 0.34 : 0.29;
  const head = pivot(group(body, [0, torsoH + 0.02, 0.02]));
  if (king) {
    const pumpkinHead = part(G.pumpkin(headS * 0.75), M(C.pumpkin, { rough: 0.6 }), { p: [0, headS * 0.55, 0] }, head);
    const face = group(pumpkinHead, [0, 0, headS * 0.7]);
    const gm = Glow.jack.mat;
    for (const s of [-1, 1]) part(G.cone(0.06, 0.07, 3), gm, { p: [s * 0.08, 0.04, 0], r: [Math.PI / 2, 0, Math.PI], s: [1, 0.3, 1], shadow: false }, face);
    part(G.rbox(0.2, 0.05, 0.03, 0.01), gm, { p: [0, -0.07, 0], shadow: false }, face);
    // crown
    const crown = group(head, [0, headS * 1.05, 0]);
    const gold = M(0xf2c14e, { metal: 0.8, rough: 0.3 });
    part(G.cyl(0.12, 0.13, 0.07, 14, true), gold, {}, crown);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(G.cone(0.03, 0.08, 5), gold, { p: [Math.cos(a) * 0.12, 0.07, Math.sin(a) * 0.12] }, crown);
    }
    crown.rotation.z = 0.2;
  } else {
    part(G.rbox(headS, headS * 0.92, headS * 0.9, headS * 0.28), skin, { p: [0, headS * 0.46, 0] }, head);
    // goofy mismatched eyes
    const eyeW = Glow.eyes.mat;
    const pupil = M(0x1d1d1d, { rough: 0.3 });
    const eL = 0.055 + r() * 0.02, eR = 0.045 + r() * 0.025;
    const ey = headS * 0.55;
    part(G.sphere(eL, 10, 8), eyeW, { p: [-headS * 0.22, ey, headS * 0.42] }, head);
    part(G.sphere(eR, 10, 8), eyeW, { p: [headS * 0.22, ey + 0.01, headS * 0.42] }, head);
    part(G.sphere(eL * 0.45, 8, 6), pupil, { p: [-headS * 0.22 + (r() - 0.5) * 0.02, ey, headS * 0.42 + eL * 0.8] }, head);
    part(G.sphere(eR * 0.45, 8, 6), pupil, { p: [headS * 0.22 + (r() - 0.5) * 0.02, ey + 0.015, headS * 0.42 + eR * 0.8] }, head);
    // mouth with a lonely tooth
    part(G.rbox(headS * 0.42, 0.04, 0.03, 0.012), M(C.mouth), { p: [0, headS * 0.2, headS * 0.45] }, head);
    part(G.rbox(0.03, 0.03, 0.02, 0.005), M(C.white), { p: [headS * 0.08, headS * 0.18, headS * 0.465] }, head);
    if (jack) {
      // bushy ginger beard and an orange knit beanie with a pom-pom
      const beard = M(0xb8622a, { rough: 1 });
      part(G.rbox(headS * 0.95, headS * 0.42, headS * 0.5, headS * 0.18), beard, { p: [0, headS * 0.14, headS * 0.24] }, head);
      part(G.rbox(headS * 0.5, 0.05, 0.03, 0.015), M(C.mouth), { p: [0, headS * 0.24, headS * 0.5] }, head);
      const knit = M(0xe8792a, { rough: 1 });
      part(G.sphere(headS * 0.56, 14, 8, ), knit, { p: [0, headS * 0.84, 0], s: [1, 0.72, 1] }, head);
      part(G.cyl(headS * 0.58, headS * 0.58, headS * 0.18, 16), M(0xc85c1c, { rough: 1 }), { p: [0, headS * 0.82, 0] }, head);
      part(G.ico(headS * 0.17, 1), M(C.cream, { rough: 1 }), { p: [0, headS * 1.24, 0] }, head);
    } else if (type === 'pothead') {
      const pot = group(head, [0, headS * 0.95, 0]);
      const copper = M(C.copper, { metal: 0.75, rough: 0.35 });
      part(G.cyl(headS * 0.62, headS * 0.55, headS * 0.5, 16), copper, { p: [0, 0, 0] }, pot);
      part(G.torus(headS * 0.6, 0.02, 6, 20), copper, { p: [0, -headS * 0.24, 0], r: [Math.PI / 2, 0, 0] }, pot);
      part(G.rbox(0.26, 0.035, 0.05, 0.015), M(0x3a2a20), { p: [headS * 0.72, 0.02, 0] }, pot);
      pot.rotation.z = -0.15;
    } else {
      // hair tufts
      for (let i = 0; i < 3; i++) {
        part(G.cone(0.035, 0.1, 5), M(0x4a3b2e), { p: [(i - 1) * 0.06, headS * 0.95, (r() - 0.5) * 0.06], r: [(r() - 0.5) * 0.6, 0, (i - 1) * 0.4] }, head);
      }
    }
  }

  if (jack) {
    // a trusty little axe in the right hand (held so the arm swing chops with it)
    const axe = group(armR, [0, -armLen + 0.02, 0.02]);
    part(G.cyl(0.018, 0.022, 0.42, 6), M(0x9a6a3c), { p: [0, 0, 0.16], r: [Math.PI / 2, 0, 0] }, axe);
    const head2 = group(axe, [0, 0, 0.34]);
    part(G.rbox(0.03, 0.12, 0.09, 0.012), M(0x8a8a90, { metal: 0.7, rough: 0.35 }), { p: [0, 0.04, 0] }, head2);
    part(G.rbox(0.032, 0.03, 0.1, 0.01), M(0xd8dde4, { metal: 0.8, rough: 0.25 }), { p: [0, 0.105, 0] }, head2);
  }

  let scarf: THREE.Group | undefined;
  if (thin) {
    // long striped scarf trailing behind
    scarf = pivot(group(body, [0, torsoH, -0.08]));
    const sA = M(C.mapleOrange), sB = M(C.cream);
    part(G.rbox(0.32, 0.07, 0.26, 0.03), sA, { p: [0, 0, 0.08] }, body).position.y = torsoH;
    for (let i = 0; i < 4; i++) part(G.rbox(0.08, 0.025, 0.1, 0.01), i % 2 ? sA : sB, { p: [0.05, -0.01, -i * 0.1] }, scarf);
    // sprinters lean into the run
    body.rotation.x = 0.35;
  }

  const baseScale = ZOMBIE_SCALE[type];
  root.scale.setScalar(baseScale);
  // zombies get cheap blob shadows (see core/world.ts) instead of shadow-map casting
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  const height = (hipY + torsoH + headS + 0.12) * baseScale;
  // collapse each limb into one vertex-coloured mesh; one material per zombie so hits can flash it
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  bake(root, { flatten: true, plain: bodyMat, glossy: bodyMat });
  flash.length = 0;
  flash.push(bodyMat);
  return { root, body, head, armL, armR, legL, legR, scarf, flash, tintables: [bodyMat], height, baseScale };
}
