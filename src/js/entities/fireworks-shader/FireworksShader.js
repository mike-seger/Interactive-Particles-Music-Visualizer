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

// Shadertoy port (user-provided shader source)
const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;

#define NUM_EXPLOSIONS 5
#define NUM_PARTICLES 75

vec2 Hash12(float t) {
  float x = fract(sin(t * 674.3) * 453.2);
  float y = fract(sin((t + x) * 714.3) * 263.2);
  return vec2(x, y);
}

vec2 Hash12_Polar(float t) {
  float p_Angle = fract(sin(t * 674.3) * 453.2) * 6.2832;
  float p_Dist = fract(sin((t + p_Angle) * 714.3) * 263.2);
  return vec2(sin(p_Angle), cos(p_Angle)) * p_Dist;
}

float Explosion(vec2 uv, float t) {
  float sparks = 0.0;

  for (int i = 0; i < NUM_PARTICLES; i++) {
    float fi = float(i);
    vec2 dir = Hash12_Polar(fi + 1.0) * 0.5;
    float dist = length(uv - dir * t);

    // Original had a mix(.0005,.0005,...) which is constant.
    float brightness = 0.0005;

    brightness *= sin(t * 20.0 + fi) * 0.5 + 0.5;
    brightness *= smoothstep(1.0, 0.6, t);

    sparks += brightness / max(1e-3, dist);
  }

  return sparks;
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 fragCoord = vUv * res;

  vec2 uv = (fragCoord - 0.5 * res) / res.y;

  vec3 col = vec3(0.0);

  // Mild audio reactivity without changing the core look.
  float energy = clamp(0.55 * uBass + 0.30 * uMid + 0.15 * uHigh, 0.0, 1.0);
  float timeScale = mix(1.0, 1.35, energy);
  float boost = 1.0 + 0.35 * uBeat;

  for (int i = 0; i < NUM_EXPLOSIONS; i++) {
    float fi = float(i);

    float t = uTime * timeScale + fi / float(NUM_EXPLOSIONS);
    float ft = floor(t);

    vec3 color = sin(4.0 * vec3(0.34, 0.54, 0.43) * ft) * 0.25 + 0.75;

    vec2 offset = Hash12(fi + 1.0 + ft) - 0.5;
    offset *= vec2(1.77, 1.0);

    col += Explosion(uv - offset, fract(t)) * color;
  }

  col *= 2.0 * boost;

  // Simple tonemap to avoid harsh clipping.
  col = 1.0 - exp(-col);

  gl_FragColor = vec4(col, 1.0);
}
`

export default class FireworksShader extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Fireworks Shader'

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
