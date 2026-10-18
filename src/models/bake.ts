// Draw-call diet. The procedural models are built from dozens of little meshes,
// which is lovely to author but means thousands of draw calls in a big fight.
// `bake` collapses every rigid cluster into a handful of merged meshes: colours
// move into vertex colours, so a whole cluster becomes a single draw.
//
// With `flatten`, every group is treated as rigid unless it's marked as a pivot
// (`pivot()` in kit.ts) — pivots are the bits code moves: limbs, barrels,
// catapult arms, owl wings. Plain Object3D markers (muzzles) survive and are
// re-parented with their accumulated transform. Emissive/transparent materials
// keep their own mesh so night glows can still animate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BakeOpts {
  /** flatten unmarked groups into their pivot */
  flatten?: boolean;
  /** material for plain (non-metal) parts; must have vertexColors enabled */
  plain?: THREE.Material;
  /** material for glossy parts (defaults to a shared glossy one) */
  glossy?: THREE.Material;
  /** material for parts under a `userData.foliage` group (e.g. wind-swayed) */
  foliage?: THREE.Material;
}

const vcCache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared vertex-coloured clay material. */
export function vcMat(rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  const key = `${rough}:${metal}`;
  let m = vcCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
    vcCache.set(key, m);
  }
  return m;
}

interface Part { mesh: THREE.Mesh; m: THREE.Matrix4 }
interface Bucket { material: THREE.Material; recolor: boolean; parts: Part[] }

function classify(mat: THREE.Material, foliage: boolean, opts: BakeOpts): { key: string; material: THREE.Material; recolor: boolean } {
  const s = mat as THREE.MeshStandardMaterial;
  const special = !s.isMeshStandardMaterial || s.transparent || (s.emissive && s.emissive.getHex() !== 0) || s.map || s.vertexColors;
  if (special) return { key: `keep:${mat.uuid}`, material: mat, recolor: false };
  if (s.metalness > 0.3) return { key: 'metal', material: vcMat(0.35, 0.65), recolor: true };
  if (foliage && opts.foliage) return { key: 'foliage', material: opts.foliage, recolor: true };
  if (s.roughness < 0.5) return { key: 'glossy', material: opts.glossy ?? vcMat(0.3, 0), recolor: true };
  return { key: 'plain', material: opts.plain ?? vcMat(), recolor: true };
}

function prepGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color | null, keepColor: boolean): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  g.applyMatrix4(m);
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) {
    if (name === 'position' || name === 'normal' || (keepColor && name === 'color')) continue;
    g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (color) {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

const isGroup = (o: THREE.Object3D) => (o as THREE.Group).isGroup === true;
const keepsShape = (o: THREE.Object3D) => !!(o.userData.pivot || o.userData.noBake);

function bakePivot(pivot: THREE.Object3D, opts: BakeOpts): void {
  if (pivot.userData.noBake) return;
  const buckets = new Map<string, Bucket>();
  const meshes: THREE.Mesh[] = [];
  const flattened: THREE.Object3D[] = [];
  const rehome: { obj: THREE.Object3D; m: THREE.Matrix4 }[] = [];

  const visit = (obj: THREE.Object3D, parentM: THREE.Matrix4, foliage: boolean) => {
    for (const child of [...obj.children]) {
      child.updateMatrix();
      const m = parentM.clone().multiply(child.matrix);
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        if (mesh.userData.noBake || !mesh.visible || Array.isArray(mesh.material)) {
          if (obj !== pivot) rehome.push({ obj: child, m });
          continue;
        }
        const c = classify(mesh.material as THREE.Material, foliage, opts);
        let b = buckets.get(c.key);
        if (!b) { b = { material: c.material, recolor: c.recolor, parts: [] }; buckets.set(c.key, b); }
        b.parts.push({ mesh, m });
        meshes.push(mesh);
        visit(mesh, m, foliage);
        continue;
      }
      const flattenable = opts.flatten && isGroup(child) && !keepsShape(child) && child.visible;
      if (flattenable) {
        flattened.push(child);
        visit(child, m, foliage || !!child.userData.foliage);
      } else if (obj !== pivot) {
        // a pivot or marker living inside something we're dissolving: keep it, re-parented
        rehome.push({ obj: child, m });
      }
    }
  };
  visit(pivot, new THREE.Matrix4(), !!pivot.userData.foliage);
  if (meshes.length < 2 && flattened.length === 0) return;

  for (const [key, b] of buckets) {
    const geos = b.parts.map(({ mesh, m }) =>
      prepGeometry(mesh.geometry, m, b.recolor ? (mesh.material as THREE.MeshStandardMaterial).color : null, !b.recolor));
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const out = new THREE.Mesh(merged, b.material);
    out.castShadow = b.parts.some((p) => p.mesh.castShadow);
    out.receiveShadow = b.parts.some((p) => p.mesh.receiveShadow);
    out.renderOrder = Math.max(...b.parts.map((p) => p.mesh.renderOrder));
    out.name = `baked:${key.split(':')[0]}`;
    pivot.add(out);
  }
  for (const { obj, m } of rehome) {
    m.decompose(obj.position, obj.quaternion, obj.scale);
    pivot.add(obj);
  }
  for (const mesh of meshes) mesh.parent?.remove(mesh);
  for (const g of flattened) g.parent?.remove(g);
}

/** Bake `root`. Pivots are processed deepest-first so nested ones settle before their parents. */
export function bake(root: THREE.Object3D, opts: BakeOpts = {}): THREE.Object3D {
  const pivots: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) return;
    if (o === root || !opts.flatten || keepsShape(o)) pivots.push(o);
  });
  pivots.reverse();
  for (const p of pivots) bakePivot(p, opts);
  return root;
}
