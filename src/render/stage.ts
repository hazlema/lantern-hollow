// Renderer, isometric camera rig, lighting and post-processing, plus the
// day→night "mood" that every other system reads from.
import * as THREE from 'three';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export type Quality = 'high' | 'medium' | 'low';
/** The house-in-the-bottom-right view every game starts from. */
const DEFAULT_YAW = Math.PI / 4;
const smooth01 = (t: number) => t * t * (3 - 2 * t);

interface MoodKey {
  t: number;
  skyTop: THREE.Color; skyMid: THREE.Color; skyBottom: THREE.Color;
  sun: THREE.Color; sunI: number; sunElev: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  exposure: number;
}

const hex = (h: number) => new THREE.Color(h);
const MOOD: MoodKey[] = [
  { t: 0.0, skyTop: hex(0x78acd6), skyMid: hex(0xbcd5df), skyBottom: hex(0xffdcb5), sun: hex(0xffe2b4), sunI: 2.9, sunElev: 0.85, hemiSky: hex(0xd6e6ff), hemiGround: hex(0x8a6a48), hemiI: 1.15, exposure: 1.0 },
  { t: 0.35, skyTop: hex(0x5f88c4), skyMid: hex(0xe8b48c), skyBottom: hex(0xffc98a), sun: hex(0xffc58a), sunI: 2.6, sunElev: 0.55, hemiSky: hex(0xe0c6c0), hemiGround: hex(0x7a5236), hemiI: 1.1, exposure: 1.02 },
  { t: 0.65, skyTop: hex(0x2c3a6e), skyMid: hex(0x8d5d8f), skyBottom: hex(0xf09a6a), sun: hex(0xff9e6a), sunI: 1.5, sunElev: 0.32, hemiSky: hex(0x8f87b8), hemiGround: hex(0x4a3040), hemiI: 0.95, exposure: 1.05 },
  { t: 1.0, skyTop: hex(0x0e1530), skyMid: hex(0x223060), skyBottom: hex(0x4b3f72), sun: hex(0xa8bcff), sunI: 1.5, sunElev: 0.75, hemiSky: hex(0x6a80c4), hemiGround: hex(0x3a3048), hemiI: 1.25, exposure: 1.1 },
];

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly composer: EffectComposer;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** 0 = sunny afternoon, 1 = deep night. Read by lanterns, fireflies, windows… */
  night = 0;
  private nightTarget = 0;

  // camera rig
  readonly target = new THREE.Vector3(1.1, 0, 0.5);
  private targetGoal = new THREE.Vector3(1.1, 0, 0.5);
  private yaw = DEFAULT_YAW;
  private yawGoal = DEFAULT_YAW;
  private readonly pitch = THREE.MathUtils.degToRad(38);
  private zoom = 1;
  private zoomGoal = 1;
  private viewHeight = 19;
  private shake = 0;
  private shakeT = 0;

  private bgCanvas = document.createElement('canvas');
  private bgTex: THREE.CanvasTexture;
  private lastBgNight = -1;
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private bloom: BloomEffect;
  private ao: N8AOPostPass;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 200);

    // Sky backdrop painted into a canvas: gradient, stars, moon.
    this.bgCanvas.width = 512; this.bgCanvas.height = 512;
    this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTex;
    const r = Math.random;
    for (let i = 0; i < 140; i++) this.stars.push({ x: r(), y: r() * 0.7, r: 0.4 + r() * 1.3, tw: r() * Math.PI * 2 });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    // Post: AO grounds everything, bloom makes lanterns sing, AgX keeps colours filmic.
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new N8AOPostPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    Object.assign(this.ao.configuration, {
      aoRadius: 1.1, distanceFalloff: 0.6, intensity: 2.4, screenSpaceRadius: false, halfRes: true, gammaCorrection: false,
    });
    this.ao.configuration.color = new THREE.Color(0x2a1608);
    this.composer.addPass(this.ao);

    this.bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    const sat = new HueSaturationEffect({ saturation: 0.04 });
    const bc = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0.0 });
    const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, sat, bc, vignette));
    this.composer.addPass(new EffectPass(this.camera, smaa));

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyMood(0, 0);
  }

  get canvas() { return this.renderer.domElement; }

  quality: Quality = 'high';
  /** Trade sharpness for speed on weaker GPUs. */
  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.25) : 1);
    this.ao.enabled = q !== 'low';
    this.ao.configuration.halfRes = q !== 'high' || dpr > 1.5;
    const sm = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== sm) {
      this.sun.shadow.mapSize.set(sm, sm);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bgCanvas.width = 384;
    this.bgCanvas.height = Math.round(384 * (h / w));
    this.lastBgNight = -1;
    this.updateProjection();
  }

  private updateProjection(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / h;
    // Fit the island on narrow screens too.
    const vh = this.viewHeight * Math.max(1, 1.45 / aspect);
    const half = vh / 2 / this.zoom;
    this.camera.left = -half * aspect; this.camera.right = half * aspect;
    this.camera.top = half; this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  // --- camera controls -------------------------------------------------------
  rotate(dir: 1 | -1) { this.yawGoal += dir * Math.PI / 2; }
  zoomBy(f: number) { this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * f, 0.7, 2.6); }
  panBy(dxScreen: number, dyScreen: number) {
    // convert a screen-space drag into ground-plane movement
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const unitsPerPx = (this.camera.top - this.camera.bottom) / (this.container.clientHeight || window.innerHeight);
    this.targetGoal.addScaledVector(right, -dxScreen * unitsPerPx);
    this.targetGoal.addScaledVector(fwd, dyScreen * unitsPerPx / Math.sin(this.pitch));
    this.targetGoal.x = THREE.MathUtils.clamp(this.targetGoal.x, -9, 9);
    this.targetGoal.z = THREE.MathUtils.clamp(this.targetGoal.z, -7, 7);
  }
  /** Swoop in from a wide, rotated view when a game starts, always landing on the default angle. */
  intro() {
    this.yawGoal = DEFAULT_YAW;
    this.yaw = this.yawGoal - Math.PI * 0.6;
    this.zoom = 0.55;
    this.target.set(-3, 0, -3);
    this.targetGoal.set(1.1, 0, 0.5);
    this.zoomGoal = 1;
  }
  /** Back to the default framing (Home key). Picks the nearest equivalent angle so it doesn't spin round. */
  resetView() {
    const turns = Math.round((this.yaw - DEFAULT_YAW) / (Math.PI * 2));
    this.yawGoal = DEFAULT_YAW + turns * Math.PI * 2;
    this.targetGoal.set(1.1, 0, 0.5);
    this.zoomGoal = 1;
  }
  addShake(amount: number) { this.shake = Math.min(0.5, this.shake + amount); }
  get cameraYaw() { return this.yaw; }

  setNight(n: number, instant = false) {
    this.nightTarget = n;
    if (instant) this.night = n;
  }

  /** Screen position (CSS px) of a world point. */
  project(p: THREE.Vector3, out: { x: number; y: number }): void {
    const v = p.clone().project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * (this.container.clientWidth || window.innerWidth);
    out.y = (-v.y * 0.5 + 0.5) * (this.container.clientHeight || window.innerHeight);
  }

  /** Ground-plane (y = h) intersection under a screen point. */
  pick(clientX: number, clientY: number, h = 0): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), hit) ? hit : null;
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 7);
    this.yaw = lerp(this.yaw, this.yawGoal, k);
    this.zoom = lerp(this.zoom, this.zoomGoal, k);
    this.target.lerp(this.targetGoal, k);
    this.updateProjection();

    const dist = 50;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * dist,
      this.target.y + Math.sin(this.pitch) * dist,
      this.target.z + Math.cos(this.yaw) * cp * dist,
    );
    if (this.shake > 0.001) {
      this.shakeT += dt * 40;
      const s = this.shake * 0.25;
      this.camera.position.x += Math.sin(this.shakeT * 1.3) * s;
      this.camera.position.y += Math.cos(this.shakeT * 1.7) * s;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);

    // night eases toward its goal over a few seconds: dusk falls gently
    const nk = 1 - Math.exp(-dt * 0.9);
    this.night = lerp(this.night, this.nightTarget, nk);
    this.applyMood(this.night, time);
  }

  private applyMood(n: number, time: number): void {
    let i = 0;
    while (i < MOOD.length - 2 && n > MOOD[i + 1].t) i++;
    const a = MOOD[i], b = MOOD[i + 1];
    const t = smooth01(THREE.MathUtils.clamp((n - a.t) / (b.t - a.t), 0, 1));
    const col = (x: THREE.Color, y: THREE.Color) => x.clone().lerp(y, t);

    this.sun.color.copy(col(a.sun, b.sun));
    this.sun.intensity = lerp(a.sunI, b.sunI, t);
    const elev = lerp(a.sunElev, b.sunElev, t);
    // sun swings from the warm south-west in the day to a high moon at night
    const az = lerp(-0.65, 0.4, smooth01(n));
    const d = 30;
    this.sun.position.set(Math.sin(az) * Math.cos(elev) * d, Math.sin(elev) * d, Math.cos(az) * Math.cos(elev) * d);
    this.sun.target.position.set(0, 0, 0);
    this.hemi.color.copy(col(a.hemiSky, b.hemiSky));
    this.hemi.groundColor.copy(col(a.hemiGround, b.hemiGround));
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t);
    this.bloom.intensity = lerp(0.7, 1.25, smooth01(n));

    // Only repaint the sky when the mood actually moves (or stars twinkle at night).
    const twinkle = n > 0.5;
    if (Math.abs(n - this.lastBgNight) > 0.004 || (twinkle && Math.floor(time * 6) !== Math.floor((time - 0.016) * 6))) {
      this.lastBgNight = n;
      this.paintSky(col(a.skyTop, b.skyTop), col(a.skyMid, b.skyMid), col(a.skyBottom, b.skyBottom), n, time);
    }
  }

  private paintSky(top: THREE.Color, mid: THREE.Color, bottom: THREE.Color, n: number, time: number): void {
    const c = this.bgCanvas, g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, `#${top.getHexString()}`);
    grd.addColorStop(0.55, `#${mid.getHexString()}`);
    grd.addColorStop(1, `#${bottom.getHexString()}`);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    // stars fade in after dusk
    const sa = THREE.MathUtils.clamp((n - 0.55) / 0.35, 0, 1);
    if (sa > 0) {
      for (const s of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(time * 2 + s.tw);
        g.fillStyle = `rgba(255,248,225,${sa * tw * 0.85})`;
        g.beginPath(); g.arc(s.x * W, s.y * H, s.r * (W / 384), 0, Math.PI * 2); g.fill();
      }
    }
    // the harvest moon rises with the night
    const ma = THREE.MathUtils.clamp((n - 0.3) / 0.5, 0, 1);
    if (ma > 0) {
      const mx = W * 0.82, my = H * (0.3 - 0.12 * ma), mr = W * 0.055;
      const glow = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
      glow.addColorStop(0, `rgba(255,236,190,${0.35 * ma})`);
      glow.addColorStop(1, 'rgba(255,236,190,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(255,240,205,${ma})`;
      g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(230,205,160,${0.35 * ma})`;
      g.beginPath(); g.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.22, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.15, 0, Math.PI * 2); g.fill();
    }
    // soft cloud bank along the bottom
    const cloud = n < 0.6 ? 'rgba(255,250,240,0.55)' : `rgba(${Math.round(lerp(255, 120, (n - 0.6) / 0.4))},${Math.round(lerp(250, 125, (n - 0.6) / 0.4))},${Math.round(lerp(240, 180, (n - 0.6) / 0.4))},0.5)`;
    g.fillStyle = cloud;
    for (let i = 0; i < 9; i++) {
      const x = (i / 8) * W + Math.sin(time * 0.05 + i) * 6;
      g.beginPath(); g.ellipse(x, H * 0.98, W * 0.12, H * 0.07 + (i % 3) * 4, 0, 0, Math.PI * 2); g.fill();
    }
    this.bgTex.needsUpdate = true;
  }

  render(): void {
    this.composer.render();
  }
}
