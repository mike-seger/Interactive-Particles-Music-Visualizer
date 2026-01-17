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

// Port of a Shadertoy-style fragment (source path: tmp/shaders/frequency-visualization.glsl)
// Shadertoy uniforms mapped:
// - iResolution -> uniform vec3 iResolution
// - iTime       -> uniform float iTime
// - iChannel0    -> 512x1 audio spectrum texture (R channel)
const FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

uniform float uVBars;
uniform float uHSpacing; // treated as bar fill ratio (0..1)

vec3 B2_spline(vec3 x) {
  vec3 t = 3.0 * x;
  vec3 b0 = step(0.0, t) * step(0.0, 1.0 - t);
  vec3 b1 = step(0.0, t - 1.0) * step(0.0, 2.0 - t);
  vec3 b2 = step(0.0, t - 2.0) * step(0.0, 3.0 - t);
  return 0.5 * (
    b0 * pow(t, vec3(2.0)) +
    b1 * (-2.0 * pow(t, vec3(2.0)) + 6.0 * t - 3.0) +
    b2 * pow(3.0 - t, vec3(2.0))
  );
}

void main() {
  // Use pixel coordinates for perfectly regular tiles.
  vec2 fragCoord = floor(gl_FragCoord.xy);
  vec2 uv = fragCoord.xy / iResolution.xy;

  float bins = max(1.0, floor(uVBars + 0.5));
  float fill = clamp(uHSpacing, 0.10, 0.98);

  // Choose an integer pitch in pixels so the grid is perfectly regular.
  float pitch = max(1.0, floor(iResolution.x / bins));
  float totalW = pitch * bins;
  float xOffset = floor((iResolution.x - totalW) * 0.5);
  float xLocal = fragCoord.x - xOffset;

  // Outside the bar area.
  if (xLocal < 0.0 || xLocal >= totalW) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float binIdx = floor(xLocal / pitch);
  float localX = xLocal - binIdx * pitch;

  // Uniform gaps in both axes.
  float pad = max(1.0, floor((pitch * (1.0 - fill)) * 0.5));
  float inX = step(pad, localX) * step(localX, pitch - pad - 1.0);

  // Sample spectrum at the center of the bin.
  float x = (binIdx + 0.5) / bins;
  float fSample = texture2D(iChannel0, vec2(abs(2.0 * x - 1.0), 0.25)).x;

  // Bar baseline and height in pixels.
  float baseY = floor(iResolution.y * 0.30);
  float maxH = floor(iResolution.y * 0.55);
  float heightPx = floor(maxH * clamp(fSample, 0.0, 1.0));

  // Square tiles: use the same pitch in Y.
  float tilePitch = pitch;
  float yLocalUp = fragCoord.y - baseY;
  float localY = mod(yLocalUp, tilePitch);
  float inY = step(pad, localY) * step(localY, tilePitch - pad - 1.0);

  float above = step(0.0, yLocalUp) * step(yLocalUp, heightPx);

  // Reflection below baseline (mirrored tiles) with a simple fade.
  float yLocalDown = baseY - fragCoord.y;
  float reflMirrorY = yLocalDown;
  float reflLocalY = mod(reflMirrorY, tilePitch);
  float inYRefl = step(pad, reflLocalY) * step(reflLocalY, tilePitch - pad - 1.0);
  float below = step(0.0, yLocalDown) * step(yLocalDown, heightPx);
  float reflFade = exp(-yLocalDown / max(1.0, iResolution.y * 0.22));

  float tileMask = inX * inY;
  float tileMaskRefl = inX * inYRefl;

  vec2 centered = vec2(1.0) * uv - vec2(1.0);
  float t = iTime / 100.0;
  float polychrome = 1.0;
  vec3 spline_args = fract(vec3(polychrome * uv.x - t) + vec3(0.0, -1.0 / 3.0, -2.0 / 3.0));
  vec3 spline = B2_spline(spline_args);

  float f = abs(centered.y);
  vec3 base_color = vec3(1.0, 1.0, 1.0) - f * spline;
  vec3 flame_color = pow(base_color, vec3(3.0));

  vec3 col = flame_color;
  col *= tileMask * above;

  // Reflection: dimmer and faded.
  col += flame_color * tileMaskRefl * below * (0.28 * reflFade);

  gl_FragColor = vec4(col, 1.0);
}
`

export default class FrequencyVisualization extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Frequency Visualization'

    this._mesh = null
    this._mat = null
    this._geo = null

    this._scenePrevBackground = null
    this._startAt = performance.now()

    this._analyser = null
    this._fftBytes = null

    this._audioTex = null
    this._audioTexData = null

    // Visual bins (bars) count. Doubled when analyser provides enough bins.
    this._vBars = 100
    // Bar fill ratio (0..1). Lower means larger gaps.
    this._hSpacing = 0.78

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
        uVBars: { value: this._vBars },
        uHSpacing: { value: this._hSpacing },
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

      const maxBars = 200
      const available = this._analyser.frequencyBinCount || 0

      // Use all bins up to 200.
      this._vBars = Math.max(1, Math.min(maxBars, available || 0))
      if (!available) this._vBars = 100
      this._hSpacing = 0.78

      if (this._mat?.uniforms?.uVBars) this._mat.uniforms.uVBars.value = this._vBars
      if (this._mat?.uniforms?.uHSpacing) this._mat.uniforms.uHSpacing.value = this._hSpacing
    }
  }

  _createAudioTexture() {
    const width = 512
    const height = 1
    this._audioTexData = new Uint8Array(width * height * 4)

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
