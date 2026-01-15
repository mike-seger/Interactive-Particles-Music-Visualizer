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

// Shadertoy port of https://www.shadertoy.com/view/ldVfWV
// Integrated with app uniforms (uResolution/uTime + audio).
const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;

#define s(a, b, t) smoothstep(a, b, t)
#define g -9.81

float distLine(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

float line(vec2 uv, vec2 a, vec2 b, float w) {
  return w / distLine(uv, a, b);
}

float N21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec2 N22(vec2 p) {
  float n = N21(p);
  return vec2(n, N21(p + n));
}

float N11(float n) {
  vec2 v = vec2(cos(n), sin(n));
  return fract(sin(dot(v, vec2(27.9898, 38.233))) * 88.5453);
}

float particle(vec2 uv, vec2 p, vec2 v, float r, float t) {
  float x = p.x + v.x * t;
  float y = p.y + v.y * t + g / 2.0 * t * t;
  vec2 j = (vec2(x, y) - uv) * 20.0;
  float sparkle = 1.0 / dot(j, j);
  return sparkle;
}

vec2 p1(vec2 p, float h, float t) {
  return vec2(p.x, p.y + clamp(pow(t, 5.0), 0.0, h));
}

vec2 p2(vec2 p, float h, float t) {
  return vec2(p.x, p.y + clamp(pow(0.95 * t, 5.0), 0.0, h));
}

float endTime(float h) {
  return pow(h, 1.0 / 5.0) * 1.1;
}

float seed = 0.32;

float explosion(vec2 uv, vec2 p, float s1, float n, float f, float t) {
  float m = 0.0;
  float dt = 0.5;
  for (float i = 0.0; i < 80.0; i += 1.0) {
    if (i >= n) break;
    seed += i;
    vec2 rand = vec2(1.0, 2.0) * (vec2(-1.0, 1.0) + 2.0 * N22(vec2(seed, i)));
    vec2 v = vec2(cos(seed), sin(seed)) + rand;
    m += particle(uv, p, v, s1, t)
      * s(2.0, 2.0 - dt, t)
      * s(0.0, dt, t);
  }
  return m;
}

float fireworks(vec2 uv, vec2 p, float h, float n, float s1, float f, float t) {
  vec2 pp1 = p1(p, h, t);
  float e = endTime(h);
  return explosion(uv, pp1, s1, n, f, t - e * 0.9);
}

float shaft(vec2 uv, vec2 p, float w, float h, float t) {
  vec2 pp1 = p1(p, h, t) + vec2(0.0, 0.3);
  vec2 pp2 = p2(p, h, t);
  float e = 1.0 / 0.95 * endTime(h);
  vec2 j = (pp1 - uv) * 15.0;
  float sparkle = 1.0 / dot(j, j);
  return (line(uv, pp1, pp2, w) + sparkle) * s(e, e - 0.5, t) * 0.5;
}

vec3 base(vec2 uv) {
  return 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0.0, 2.0, 4.0));
}

float back(vec2 uv, vec2 p, float t) {
  float dt = 0.3;
  float j = length(p - uv);
  float m = exp(-0.005 * j * j);
  return 0.2 * m * s(-dt / 4.0, 0.0, t) * s(dt, 0.0, t);
}

float stars(vec2 uv) {
  float r = N21(uv);
  return s(0.001, 0.0, r);
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 fragCoord = vUv * res;

  vec2 uv = (fragCoord - 0.5 * res) / res.y;

  float audio = clamp(0.55 * uBass + 0.30 * uMid + 0.15 * uHigh, 0.0, 1.0);

  float t = uTime / 10.0;
  float scale = 10.0;
  uv *= scale;

  // A little extra sparkle on beats/highs.
  vec3 col = vec3(0.05 + stars(uv) * (1.0 + 0.75 * uHigh + 0.25 * uBeat));

  float a = -0.035 * sin(t * 15.0);
  float co = cos(a);
  float si = sin(a);
  mat2 trans1 = mat2(co, si, -si, co);
  vec2 trans2 = vec2(-15.0 * a, 0.0);
  uv *= trans1;
  uv += trans2;

  // More activity with more energy.
  float bursts = mix(6.0, 10.0, audio);

  for (float i = 0.0; i < 1.0; i += 1.0 / 10.0) {
    if (i * 10.0 >= bursts) break;

    float ti = mod(t * 9.0 - i * 5.0, 4.0);
    float sc = mix(2.0, 0.3, ti / 4.0);
    vec2 uvs = uv * sc;

    float rand = N11(i);
    float h = 10.0 + rand * 4.0 + 3.0 * uBass;
    float w = 0.02;
    float n = 80.0;
    float s1 = 0.9;
    float f = 1.5;

    vec2 p = vec2(mix(-8.0, 8.0, rand), -10.0);

    col += back(uvs, vec2(p.x, p.y + h), ti - 1.8)
      + fireworks(uvs, p, h, n, s1, f, ti) * base(uv) * (0.75 + 0.75 * audio)
      + shaft(uvs, p, w, h, ti);
  }

  col = 1.0 - exp(-col);
  gl_FragColor = vec4(col, 1.0);
}
`

export default class FireworksNight extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Fireworks Night'

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
