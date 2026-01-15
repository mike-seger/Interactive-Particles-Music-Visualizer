import * as THREE from 'three'
import App from '../../App'

const VERT = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`

// Inspired by https://www.shadertoy.com/view/ssySz1
// Shader written from scratch (inspired by the Shadertoy's vibe, not a copy).
const FRAG = /* glsl */ `
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;

varying vec2 vUv;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  vec3 rgb = clamp(p - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

float starfield(vec2 uv) {
  float d = 0.0;
  vec2 gv = fract(uv * 90.0) - 0.5;
  vec2 id = floor(uv * 90.0);
  float n = hash21(id);
  float s = smoothstep(0.02, 0.0, length(gv) - (0.03 + 0.03 * n));
  d += s * (0.15 + 0.85 * n);
  return d;
}

float ring(float r, float target, float width) {
  float x = (r - target) / max(1e-5, width);
  return exp(-x * x);
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 p = (vUv * res - 0.5 * res) / res.y;

  float t = uTime;

  // Background (very dark + stars)
  vec3 col = vec3(0.0);
  float stars = starfield(p + vec2(0.05 * t, 0.02 * t));
  col += vec3(0.04, 0.05, 0.06) * stars;

  // Burst cadence (audio-influenced)
  float rate = 0.55 + 0.55 * clamp(uBass, 0.0, 1.0);
  float baseId = floor(t * rate);

  float energy = clamp(0.55 * uBass + 0.30 * uMid + 0.15 * uHigh, 0.0, 1.0);
  float beatBoost = 1.0 + 0.35 * uBeat;

  // Multiple overlapping bursts
  for (int i = 0; i < 7; i++) {
    float id = baseId - float(i);
    float seed = id * 17.17 + float(i) * 3.71;

    float t0 = id / rate;
    float lt = t - t0;

    float life = 1.55 + 0.45 * hash11(seed + 1.3);
    if (lt < 0.0 || lt > life) {
      continue;
    }

    float u = lt / life;
    float fade = pow(1.0 - u, 2.4);

    // Burst center (slightly biased upward, like sky fireworks)
    vec2 c = vec2(hash11(seed + 2.1), hash11(seed + 5.2));
    c = (c - 0.5) * vec2(1.6, 1.2);
    c.y = c.y * 0.75 + 0.15;

    vec2 d = p - c;
    float r = length(d);
    float a = atan(d.y, d.x);

    // Radial expansion + slight turbulence
    float maxR = 0.65 + 0.35 * hash11(seed + 9.7);
    float speed = 0.9 + 0.45 * energy;
    float target = u * maxR * speed;
    float width = mix(0.012, 0.030, u) * (1.0 + 0.8 * uHigh);

    // Spokes/sparks pattern
    float spokes = 16.0 + floor(26.0 * hash11(seed + 6.9));
    float spoke = pow(abs(cos(a * spokes + seed)), 10.0 + 6.0 * hash11(seed + 8.4));

    // Spark ring
    float spark = ring(r, target, width) * spoke;

    // Inner glow (core)
    float core = exp(-r * r * 18.0) * exp(-u * 2.2);

    // Smoke-ish haze
    float haze = exp(-r * 3.0) * (0.15 + 0.85 * (1.0 - u));

    // Color palette
    float hue = fract(hash11(seed + 12.3) + 0.06 * sin(t * 0.2));
    float sat = 0.75 + 0.20 * uHigh;
    float val = 0.9;
    vec3 rgb = hsv2rgb(vec3(hue, sat, val));

    // Additive contributions
    col += rgb * (spark * (2.5 + 2.0 * energy) + core * (0.9 + 1.3 * beatBoost)) * fade;
    col += rgb * haze * 0.08 * fade;
  }

  // Slight vignette
  float vig = smoothstep(1.15, 0.25, length(p));
  col *= mix(0.85, 1.0, vig);

  // Tone map-ish clamp
  col = 1.0 - exp(-col);

  gl_FragColor = vec4(col, 1.0);
}
`

export default class Fireworks extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Fireworks'

    this._mesh = null
    this._mat = null
    this._geo = null

    this._startAt = performance.now()
    this._scenePrevBackground = null
    this._lastIsBeat = false

    this._onResize = () => this._syncResolution()
  }

  init() {
    this._scenePrevBackground = App.scene?.background ?? null
    if (App.scene) {
      App.scene.background = new THREE.Color(0x000000)
    }

    this._startAt = performance.now()
    this._lastIsBeat = false

    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, -1, 0,
      1, 1, 0,
      -1, 1, 0,
    ])
    const uvs = new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 0,
      1, 1,
      0, 1,
    ])

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

    const mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uHigh: { value: 0 },
        uBeat: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = -1000

    this._geo = geo
    this._mat = mat
    this._mesh = mesh

    App.holder.add(mesh)
    this._syncResolution()
    window.addEventListener('resize', this._onResize)
  }

  update(audioData) {
    if (!this._mat) return

    const now = performance.now()
    const t = (now - this._startAt) / 1000
    this._mat.uniforms.uTime.value = t

    const bass = Math.max(0, Math.min(1, audioData?.frequencies?.bass ?? 0))
    const mid = Math.max(0, Math.min(1, audioData?.frequencies?.mid ?? 0))
    const high = Math.max(0, Math.min(1, audioData?.frequencies?.high ?? 0))

    this._mat.uniforms.uBass.value = bass
    this._mat.uniforms.uMid.value = mid
    this._mat.uniforms.uHigh.value = high

    const isBeat = !!audioData?.isBeat
    const beatPulse = isBeat && !this._lastIsBeat ? 1 : 0
    this._lastIsBeat = isBeat

    // Quick pulse on beat, decays via shader time evolution.
    this._mat.uniforms.uBeat.value = beatPulse ? 1 : this._mat.uniforms.uBeat.value * 0.9
  }

  _syncResolution() {
    if (!this._mat) return
    this._mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)

    if (this._mesh?.parent) {
      this._mesh.parent.remove(this._mesh)
    }

    this._geo?.dispose()
    this._mat?.dispose()

    this._geo = null
    this._mat = null
    this._mesh = null

    if (App.scene) {
      App.scene.background = this._scenePrevBackground
    }
  }
}
