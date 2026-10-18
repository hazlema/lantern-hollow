// Pooled particle systems: lit debris chunks (instanced), additive glow points,
// soft smoke/dust puffs, ground decals and lightning bolts.
import * as THREE from 'three';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Debris: little lit chunks that fly, tumble, bounce and shrink away.

export interface DebrisOpts {
  x: number; y: number; z: number;
  count?: number;
  color: number | number[];
  speed?: number;
  up?: number;
  size?: number;
  life?: number;
  gravity?: number;
  spread?: number;
}

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private n: number;
  private p: Float32Array; private v: Float32Array; private r: Float32Array; private w: Float32Array;
  private s: Float32Array; private life: Float32Array; private max: Float32Array; private g: Float32Array;
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private col = new THREE.Color();

  constructor(geo: THREE.BufferGeometry, capacity = 700, flat = true) {
    this.n = capacity;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: flat });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(capacity * 3); this.v = new Float32Array(capacity * 3);
    this.r = new Float32Array(capacity * 3); this.w = new Float32Array(capacity * 3);
    this.s = new Float32Array(capacity); this.life = new Float32Array(capacity); this.max = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, this.col.set(0xffffff)); }
  }

  spawn(o: DebrisOpts): void {
    const count = o.count ?? 8;
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 2) * rand(0.4, 1);
      const spread = o.spread ?? 0.05;
      this.p[i * 3] = o.x + rand(-spread, spread); this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z + rand(-spread, spread);
      this.v[i * 3] = Math.cos(a) * sp; this.v[i * 3 + 1] = (o.up ?? 2.5) * rand(0.6, 1.2); this.v[i * 3 + 2] = Math.sin(a) * sp;
      this.r[i * 3] = rand(0, 6); this.r[i * 3 + 1] = rand(0, 6); this.r[i * 3 + 2] = rand(0, 6);
      this.w[i * 3] = rand(-10, 10); this.w[i * 3 + 1] = rand(-10, 10); this.w[i * 3 + 2] = rand(-10, 10);
      this.s[i] = (o.size ?? 0.06) * rand(0.6, 1.3);
      this.max[i] = this.life[i] = (o.life ?? 0.9) * rand(0.7, 1.2);
      this.g[i] = o.gravity ?? 9;
      this.mesh.setColorAt(i, this.col.set(colors[k % colors.length]));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const j = i * 3;
      this.v[j + 1] -= this.g[i] * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      if (this.p[j + 1] < 0.02) {
        // bounce and skid on the ground
        this.p[j + 1] = 0.02;
        this.v[j + 1] *= -0.35; this.v[j] *= 0.6; this.v[j + 2] *= 0.6;
        this.w[j] *= 0.5; this.w[j + 2] *= 0.5;
      }
      this.r[j] += this.w[j] * dt; this.r[j + 1] += this.w[j + 1] * dt; this.r[j + 2] += this.w[j + 2] * dt;
      const t = this.life[i] / this.max[i];
      const sc = this.life[i] <= 0 ? 0 : this.s[i] * Math.min(1, t * 3);
      this.q.setFromEuler(this.e.set(this.r[j], this.r[j + 1], this.r[j + 2]));
      this.m4.compose(new THREE.Vector3(this.p[j], this.p[j + 1], this.p[j + 2]), this.q, new THREE.Vector3(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m4);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Points: additive glows (sparks, magic, embers) or soft alpha puffs (smoke, dust).

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPxPerUnit;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPxPerUnit;
  }
`;
const POINT_FRAG = /* glsl */ `
  uniform float uSoft;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = smoothstep(1.0, uSoft, d);
    if (a * vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export interface PointOpts {
  x: number; y: number; z: number;
  count?: number;
  color: number | number[];
  size?: number;
  /** size multiplier at end of life */
  grow?: number;
  life?: number;
  speed?: number;
  up?: number;
  gravity?: number;
  drag?: number;
  spread?: number;
  alpha?: number;
}

export class Points {
  readonly obj: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private v: Float32Array; private life: Float32Array; private max: Float32Array; private s0: Float32Array;
  private grow: Float32Array; private g: Float32Array; private drag: Float32Array; private a0: Float32Array;
  private next = 0;
  readonly uniforms = { uPxPerUnit: { value: 50 }, uSoft: { value: 0.0 } };
  private c = new THREE.Color();

  constructor(private n: number, additive: boolean, soft = 0.0) {
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.s0 = new Float32Array(n); this.grow = new Float32Array(n); this.g = new Float32Array(n);
    this.drag = new Float32Array(n); this.a0 = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms.uSoft.value = soft;
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.obj = new THREE.Points(this.geo, mat);
    this.obj.frustumCulled = false;
    this.obj.renderOrder = additive ? 20 : 10;
  }

  spawn(o: PointOpts): void {
    const count = o.count ?? 10;
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      const j = i * 3;
      const sp = o.spread ?? 0.05;
      this.pos[j] = o.x + rand(-sp, sp); this.pos[j + 1] = o.y + rand(-sp, sp) * 0.5; this.pos[j + 2] = o.z + rand(-sp, sp);
      const a = Math.random() * Math.PI * 2;
      const el = rand(-0.3, 1);
      const speed = (o.speed ?? 1) * rand(0.3, 1);
      this.v[j] = Math.cos(a) * speed * Math.cos(el); this.v[j + 1] = (o.up ?? 0.5) * rand(0.5, 1.3) + Math.sin(el) * speed * 0.5; this.v[j + 2] = Math.sin(a) * speed * Math.cos(el);
      this.c.set(colors[k % colors.length]);
      this.col[j] = this.c.r; this.col[j + 1] = this.c.g; this.col[j + 2] = this.c.b;
      this.s0[i] = (o.size ?? 0.15) * rand(0.7, 1.3);
      this.grow[i] = o.grow ?? 0.3;
      this.max[i] = this.life[i] = (o.life ?? 0.6) * rand(0.7, 1.25);
      this.g[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.a0[i] = o.alpha ?? 1;
    }
  }

  update(dt: number, pxPerUnit: number): void {
    this.uniforms.uPxPerUnit.value = pxPerUnit;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      const dk = Math.exp(-this.drag[i] * dt);
      this.v[j] *= dk; this.v[j + 2] *= dk; this.v[j + 1] = this.v[j + 1] * dk - this.g[i] * dt;
      this.pos[j] += this.v[j] * dt; this.pos[j + 1] += this.v[j + 1] * dt; this.pos[j + 2] += this.v[j + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      this.size[i] = this.s0[i] * (1 + (this.grow[i] - 1) * t);
      // quick fade in, long fade out
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t * t);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Ground decals: splats, shockwave rings, syrup puddles, light pools.

type DecalKind = 'soft' | 'ring' | 'splat';

function makeTex(kind: DecalKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'soft') {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  } else if (kind === 'ring') {
    const grd = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.85, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  } else {
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(64, 64, 34, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const d = 30 + Math.random() * 26;
      g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 5 + Math.random() * 9, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Decal { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; r0: number; r1: number; a0: number }

export class Decals {
  readonly group = new THREE.Group();
  private tex: Record<DecalKind, THREE.CanvasTexture>;
  private pool: Decal[] = [];
  private live: Decal[] = [];
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor() {
    this.tex = { soft: makeTex('soft'), ring: makeTex('ring'), splat: makeTex('splat') };
  }

  spawn(kind: DecalKind, x: number, z: number, o: { color: number; r0: number; r1?: number; life: number; alpha?: number; additive?: boolean; y?: number; rot?: number }): void {
    let d = this.pool.pop();
    if (!d) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.renderOrder = 5;
      d = { mesh, mat, life: 0, max: 0, r0: 0, r1: 0, a0: 1 };
    }
    d.mat.map = this.tex[kind];
    d.mat.color.set(o.color);
    d.mat.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    d.mat.polygonOffset = true; d.mat.polygonOffsetFactor = -2;
    d.mat.needsUpdate = true;
    d.mesh.position.set(x, o.y ?? 0.015, z);
    d.mesh.rotation.y = o.rot ?? Math.random() * Math.PI * 2;
    d.life = d.max = o.life; d.r0 = o.r0; d.r1 = o.r1 ?? o.r0; d.a0 = o.alpha ?? 1;
    this.group.add(d.mesh);
    this.live.push(d);
    this.step(d);
  }

  private step(d: Decal) {
    const t = 1 - d.life / d.max;
    const s = d.r0 + (d.r1 - d.r0) * (1 - Math.pow(1 - t, 3));
    d.mesh.scale.set(s * 2, 1, s * 2);
    d.mat.opacity = d.a0 * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        this.live.splice(i, 1);
        this.pool.push(d);
        continue;
      }
      this.step(d);
    }
  }

  get softTexture() { return this.tex.soft; }

  /** A permanent glowing pool of light on the ground (lamps); fade it via material opacity. */
  pool_(x: number, z: number, radius: number, color: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex.soft, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
    const m = new THREE.Mesh(this.geo, mat);
    m.position.set(x, 0.02, z);
    m.scale.set(radius * 2, 1, radius * 2);
    m.renderOrder = 4;
    this.group.add(m);
    return m;
  }
}

// ---------------------------------------------------------------------------
// Lightning: jagged glowing ribbons that flicker for a moment.

interface Bolt { core: THREE.Mesh; glow: THREE.Mesh; life: number; max: number }

export class Bolts {
  readonly group = new THREE.Group();
  private live: Bolt[] = [];
  private coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 1.4), toneMapped: false, transparent: true });
  private glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 1.0, 0.25), toneMapped: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });

  zap(a: THREE.Vector3, b: THREE.Vector3, life = 0.18): void {
    const pts: THREE.Vector3[] = [];
    const segs = 7;
    const dir = b.clone().sub(a);
    const len = dir.length();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().addScaledVector(dir, t);
      if (i > 0 && i < segs) {
        const j = len * 0.09;
        p.addScaledVector(side, rand(-j, j));
        p.y += rand(-j, j);
      }
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const core = new THREE.Mesh(new THREE.TubeGeometry(curve, segs * 3, 0.018, 4, false), this.coreMat.clone());
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, segs * 3, 0.07, 5, false), this.glowMat.clone());
    core.renderOrder = glow.renderOrder = 21;
    this.group.add(core, glow);
    this.live.push({ core, glow, life, max: life });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      b.life -= dt;
      const t = Math.max(0, b.life / b.max);
      (b.core.material as THREE.MeshBasicMaterial).opacity = t > 0.5 ? 1 : t * 2;
      (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.35 * t;
      if (b.life <= 0) {
        this.group.remove(b.core, b.glow);
        b.core.geometry.dispose(); b.glow.geometry.dispose();
        (b.core.material as THREE.Material).dispose(); (b.glow.material as THREE.Material).dispose();
        this.live.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------

export class FX {
  readonly root = new THREE.Group();
  readonly chunks = new Debris(new THREE.IcosahedronGeometry(1, 0), 700);
  readonly glows = new Points(900, true, 0.0);
  readonly puffs = new Points(500, false, 0.35);
  readonly decals = new Decals();
  readonly bolts = new Bolts();

  constructor() {
    this.root.add(this.chunks.mesh, this.glows.obj, this.puffs.obj, this.decals.group, this.bolts.group);
  }

  update(dt: number, pxPerUnit: number): void {
    this.chunks.update(dt);
    this.glows.update(dt, pxPerUnit);
    this.puffs.update(dt, pxPerUnit);
    this.decals.update(dt);
    this.bolts.update(dt);
  }
}
