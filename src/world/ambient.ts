// Life on the island: falling leaves, fireflies after dusk, chimney smoke,
// crypt mist, lamplight pools, swaying trees and drifting clouds.
import * as THREE from 'three';
import type { Island } from './island';
import type { FX } from '../fx/particles';
import { Debris } from '../fx/particles';
import { C } from '../models/kit';

export class Ambient {
  private leaves: Debris;
  private leafT = 0;
  private smokeT = 0;
  private mistT = 0;
  private flyT = 0;
  private pools: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private cryptLight: THREE.PointLight;

  constructor(scene: THREE.Scene, private island: Island, private fx: FX) {
    const leafGeo = new THREE.PlaneGeometry(1, 0.7);
    this.leaves = new Debris(leafGeo, 160, false);
    (this.leaves.mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    this.leaves.mesh.castShadow = false;
    scene.add(this.leaves.mesh);

    // warm pools of light under each lamp + a few real point lights for the glow on nearby things
    for (const l of island.lamps) {
      this.pools.push(fx.decals.pool_(l.x, l.z, 1.3, 0xffb050));
      const pl = new THREE.PointLight(0xffb45a, 0, 3.2, 1.6);
      pl.position.copy(l);
      scene.add(pl);
      this.lights.push(pl);
    }
    this.pools.push(fx.decals.pool_(island.porch.x, island.porch.z, 1.6, 0xffb050));
    const porch = new THREE.PointLight(0xffb45a, 0, 4, 1.5);
    porch.position.copy(island.porch);
    scene.add(porch);
    this.lights.push(porch);

    this.cryptLight = new THREE.PointLight(0x6dff8a, 0, 4, 1.4);
    this.cryptLight.position.copy(island.cryptDoor).add(new THREE.Vector3(0.4, 0.3, 0));
    scene.add(this.cryptLight);
    this.pools.push(fx.decals.pool_(island.cryptDoor.x + 0.5, island.cryptDoor.z, 1.4, 0x60ff80));
  }

  update(dt: number, time: number, night: number): void {
    const flick = 0.9 + Math.sin(time * 8.3) * 0.05 + Math.sin(time * 21.1) * 0.05;
    this.lights.forEach((l) => (l.intensity = night * 2.6 * flick));
    this.cryptLight.intensity = (0.6 + night * 2.2) * (0.85 + Math.sin(time * 1.7) * 0.15);
    this.pools.forEach((p, i) => {
      const m = p.material as THREE.MeshBasicMaterial;
      m.opacity = (i === this.pools.length - 1 ? 0.25 + night * 0.35 : night * 0.55) * flick;
    });

    // tumbling autumn leaves drifting off the trees
    this.leafT -= dt;
    if (this.leafT <= 0 && this.island.trees.length) {
      this.leafT = 0.25 + Math.random() * 0.3;
      const t = this.island.trees[Math.floor(Math.random() * this.island.trees.length)];
      this.leaves.spawn({
        x: t.position.x + (Math.random() - 0.5) * 0.6, y: 1.1 + Math.random() * 0.4, z: t.position.z + (Math.random() - 0.5) * 0.6,
        count: 1, color: [C.maple, C.mapleOrange, C.mapleGold][Math.floor(Math.random() * 3)],
        speed: 0.5, up: 0.1, size: 0.07, life: 4.5, gravity: 0.25,
      });
    }
    this.leaves.update(dt);

    // chimney smoke curls up lazily
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.22;
      const c = this.island.chimney;
      this.fx.puffs.spawn({ x: c.x, y: c.y, z: c.z, count: 1, color: night > 0.5 ? 0x9a9ab0 : 0xe8e2d8, size: 0.3, grow: 3.2, speed: 0.15, up: 0.55, drag: 0.4, life: 3.2, alpha: 0.4 });
    }

    // eerie green mist seeping from the crypt
    this.mistT -= dt;
    if (this.mistT <= 0) {
      this.mistT = 0.15;
      const d = this.island.cryptDoor;
      this.fx.puffs.spawn({ x: d.x + 0.2, y: 0.12, z: d.z + (Math.random() - 0.5) * 0.5, count: 1, color: [0x9dffb0, 0x7fe0a0], size: 0.5, grow: 2.4, speed: 0.35, up: 0.05, drag: 0.8, life: 2.6, alpha: 0.22 });
    }

    // fireflies wander out at dusk
    this.flyT -= dt;
    if (night > 0.35 && this.flyT <= 0) {
      this.flyT = 0.12 / night;
      this.fx.glows.spawn({
        x: (Math.random() - 0.5) * 18, y: 0.3 + Math.random() * 1.2, z: (Math.random() - 0.5) * 13,
        count: 1, color: [0xdcff73, 0xfff3a0], size: 0.09, grow: 1, speed: 0.25, up: 0.05, drag: 0.1, life: 3.5, alpha: night,
      });
    }

    // trees sway, clouds drift, water shimmers
    for (const cl of this.island.clouds) {
      cl.position.x += (cl.userData.speed as number) * dt;
      if (cl.position.x > 18) cl.position.x = -18;
      const m = cl.userData.mat as THREE.MeshStandardMaterial;
      m.color.setHSL(0.62, 0.25 * night, 1 - night * 0.45);
      m.emissiveIntensity = 0.25 * (1 - night) + 0.05;
    }
  }
}
