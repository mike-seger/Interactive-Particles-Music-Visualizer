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

// Port of "3D Audio Visualizer" by @kishimisu (2022)
// Source: https://www.shadertoy.com/view/dtl3Dr
// License noted in original header: CC BY-NC-SA 4.0
//
// Shadertoy uniforms mapped:
// - iResolution -> uniform vec3 iResolution
// - iTime       -> uniform float iTime
// - iChannel0    -> 512x1 audio spectrum texture (R channel)
// - iChannelTime -> replaced with iChannelTime0
const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;
uniform float iChannelTime0;
#define light(d, att) 1. / (1. + pow(abs(d * att), 1.3))

/* Audio-related functions */
float getLevel(float x) {
  // Shadertoy uses a 512-wide FFT texture; sample along X.
  return texture2D(iChannel0, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}

float logX(float x, float a, float c) { return (1. / (exp(-a * (x - c)) + 1.)); }

float logisticAmp(float amp) {
  // Keep amplitude mapping stable over time.
  // A previous version slowly increased c during the first seconds, which
  // makes the scene fade darker as the threshold rises.
  float c = 0.88, a = 20.;
  return (logX(amp, a, c) - logX(0.0, a, c)) / (logX(1.0, a, c) - logX(0.0, a, c));
}

float getPitch(float freq, float octave) {
  freq = pow(2., freq) * 261.;
  freq = pow(2., octave) * freq / 12000.;
  return logisticAmp(getLevel(freq));
}

float getVol(float samples) {
  float avg = 0.;
  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    if (fi >= samples) break;
    avg += getLevel(fi / samples);
  }
  return avg / samples;
}
/* ----------------------- */

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 uv = (2. * fragCoord - iResolution.xy) / iResolution.y;
  vec3 col = vec3(0.);
  float vol = getVol(8.);

  float hasSound = step(0.0001, iChannelTime0);

  float t = 0.;
  for (int i = 0; i < 30; i++) {
    vec3 p = t * normalize(vec3(uv, 1.));

    vec3 id = floor(abs(p));
    vec3 q = fract(p) - .5;

    float boxRep = sdBox(q, vec3(.3));
    float boxCtn = sdBox(p, vec3(7.5, 6.5, 16.5));

    float dst = max(boxRep, abs(boxCtn) - vol * .2);
    float freq = smoothstep(16., 0., id.z) * 3. * hasSound + hash13(id) * 1.5;

    col += vec3(.8, .6, 1.) * (cos(id * .4 + vec3(0., 1., 2.) + iTime) + 2.)
      * light(dst, 10. - vol)
      * getPitch(freq, 1.);

    t += dst;
  }

  gl_FragColor = vec4(col, 1.0);
}
`

export default class ThreeDAudioVisualizer extends THREE.Object3D {
  constructor() {
    super()
    this.name = '3D Audio Visualizer'

    this._mesh = null
    this._mat = null
    this._geo = null

    this._scenePrevBackground = null

    this._startAt = performance.now()

    this._analyser = null
    this._fftBytes = null

    this._audioTex = null
    this._audioTexData = null // Uint8Array RGBA

    this._onResize = () => this._syncResolution()
  }

  init() {
    this._scenePrevBackground = App.scene?.background ?? null
    if (App.scene) {
      App.scene.background = new THREE.Color(0x000000)
    }

    this._startAt = performance.now()

    this._bindAnalyser()
    this._createAudioTexture()

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
        iResolution: { value: new THREE.Vector3(1, 1, 1) },
        iTime: { value: 0 },
        iChannel0: { value: this._audioTex },
        iChannelTime0: { value: 0 },
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

  _bindAnalyser() {
    if (App.audioManager?.analyserNode) {
      this._analyser = App.audioManager.analyserNode
      this._fftBytes = new Uint8Array(this._analyser.frequencyBinCount)
    }
  }

  _createAudioTexture() {
    const width = 512
    const height = 1
    this._audioTexData = new Uint8Array(width * height * 4)

    // Initialize to silence.
    for (let i = 0; i < width; i++) {
      const o = i * 4
      this._audioTexData[o + 0] = 0
      this._audioTexData[o + 1] = 0
      this._audioTexData[o + 2] = 0
      this._audioTexData[o + 3] = 255
    }

    const tex = new THREE.DataTexture(this._audioTexData, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true

    this._audioTex = tex
  }

  _updateAudioTexture() {
    if (!this._analyser || !this._fftBytes || !this._audioTexData || !this._audioTex) return

    // Re-bind if audio source changed.
    if (this._analyser !== App.audioManager?.analyserNode && App.audioManager?.analyserNode) {
      this._bindAnalyser()
    }

    const isPlaying = !!App.audioManager?.isPlaying || !!App.audioManager?.isUsingMicrophone
    if (!isPlaying) return

    this._analyser.getByteFrequencyData(this._fftBytes)

    const width = 512
    const n = this._fftBytes.length

    for (let i = 0; i < width; i++) {
      const srcIdx = Math.min(n - 1, Math.floor((i / (width - 1)) * (n - 1)))
      const v = this._fftBytes[srcIdx]
      const o = i * 4
      this._audioTexData[o + 0] = v
      this._audioTexData[o + 1] = v
      this._audioTexData[o + 2] = v
      this._audioTexData[o + 3] = 255
    }

    this._audioTex.needsUpdate = true

    if (this._mat) {
      this._mat.uniforms.iChannelTime0.value = isPlaying ? (performance.now() - this._startAt) / 1000 : 0
    }
  }

  update() {
    if (!this._mat) return

    const now = performance.now()
    this._mat.uniforms.iTime.value = (now - this._startAt) / 1000

    this._updateAudioTexture()
  }

  _syncResolution() {
    if (!this._mat) return
    this._mat.uniforms.iResolution.value.set(window.innerWidth, window.innerHeight, 1)
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

    if (this._audioTex) {
      this._audioTex.dispose()
      this._audioTex = null
    }

    this._audioTexData = null
    this._fftBytes = null
    this._analyser = null

    if (App.scene) {
      App.scene.background = this._scenePrevBackground
    }
  }
}
