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

float sdRoundBox(vec2 p, vec2 b, float r) {
  // Rounded rectangle SDF.
  // b: half extents of the rectangle (before rounding).
  // r: corner radius in the same units as p.
  vec2 q = abs(p) - (b - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
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
  // Keep a visible gap between bars (AE has distinct columns).
  float pad = max(2.0, floor((pitch * (1.0 - fill)) * 0.5));
  float barW = max(1.0, (pitch - 2.0 * pad));

  // Sample spectrum at the center of the bin.
  // Compress highs so the top end effectively has fewer unique bars (AE-like).
  float x = (binIdx + 0.5) / bins;
  float logGamma = 1.55;
  float sampleX = pow(clamp(x, 0.0, 1.0), logGamma);
  float fSample = texture2D(iChannel0, vec2(sampleX, 0.25)).x;

  // Bar baseline and height in pixels (closer to AE reference: lower + shorter).
  float baseY = floor(iResolution.y * 0.14);
  float maxH = floor(iResolution.y * 0.26);

  // The audio texture is already shaped/leveled in JS; keep mapping gentle.
  float s = pow(clamp(fSample, 0.0, 1.0), 1.10);
  float heightPx = floor(maxH * s);

  // Minimum bar height is a square (use bar width as min height).
  float minHPx = barW;
  // Always draw at least a square so there are no missing bins.
  heightPx = max(heightPx, minHPx);

  // Signed-distance boxes for soft edges + glow.
  float yLocalUp = fragCoord.y - baseY;
  float yLocalDown = baseY - fragCoord.y;

  // Center bar in its pitch cell.
  float cx = (localX - pitch * 0.5);
  float cyUp = (yLocalUp - heightPx * 0.5);
  float cyDn = (yLocalDown - heightPx * 0.5);

  vec2 halfSize = vec2(barW * 0.5, max(0.5, heightPx * 0.5));
  // More obvious rounding, especially on the minimum-height squares.
  float radius = min(4.0, 0.42 * barW);
  radius = min(radius, min(halfSize.x, halfSize.y));

  float distUp = sdRoundBox(vec2(cx, cyUp), halfSize, radius);
  float distDn = sdRoundBox(vec2(cx, cyDn), halfSize, radius);

  // NOTE: Avoid fwidth/dFdx/dFdy to keep compatibility with WebGL1 without
  // OES_standard_derivatives. Use a constant AA width in pixel-space.
  float aa = 1.0;
  float fillUp = smoothstep(aa, -aa, distUp);
  float fillDn = smoothstep(aa, -aa, distDn);

  // Glow extends outside the bar, but keep it tight so gaps remain visible.
  float glowUp = exp(-max(distUp, 0.0) * 0.38);
  float glowDn = exp(-max(distDn, 0.0) * 0.42);

  float reflFade = exp(-yLocalDown / max(1.0, iResolution.y * 0.22));

  // AE-like palette: red -> yellow across the spectrum.
  // IMPORTANT: color should be based on screen bin position (x), not sampleX,
  // otherwise high-end compression also shifts colors toward red.
  vec3 lowCol = vec3(1.0, 0.06, 0.00);
  vec3 highCol = vec3(1.0, 0.98, 0.08);
  float colorX = pow(clamp(x, 0.0, 1.0), 0.55);
  vec3 baseCol = mix(lowCol, highCol, colorX);

  // Keep bar tops the same hue (no white caps). Only add a subtle brightness lift.
  float yInBar = (heightPx > 0.0) ? clamp(yLocalUp / max(1.0, heightPx), 0.0, 1.0) : 0.0;
  float tip = smoothstep(0.82, 1.0, yInBar);
  vec3 tipCol = min(vec3(1.0), baseCol * (1.0 + 0.10 * tip));

  // Uniform brightness: height encodes level, not intensity.
  vec3 col = vec3(0.0);

  // Main bar: fill + glow.
  col += tipCol * fillUp;
  col += tipCol * (0.45 * glowUp);

  // Reflection: dimmer and faded.
  col += tipCol * (0.16 * fillDn * reflFade);
  col += tipCol * (0.08 * glowDn * reflFade);

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
    this._fftFloats = null

    this._audioTex = null
    this._audioTexData = null

    this._audioSmooth = null

    // Histogram buffer for fast percentile baseline estimation.
    this._hist = new Uint16Array(64)

    // Visual bins (bars) count.
    this._vBars = 140
    // Bar fill ratio (0..1). Lower means thinner bars / larger gaps.
    this._hSpacing = 0.62

    // Slow auto-gain (AGC) to prevent per-frame pumping.
    this._agcGain = 1.0

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
      this._fftFloats = new Float32Array(this._analyser.frequencyBinCount)

      const maxBars = 220
      const available = this._analyser.frequencyBinCount || 0

      // Choose a bar count that keeps bars thin/consistent in pixels.
      const viewportW = Math.max(1, window.innerWidth || 1)
      const desiredPitchPx = 7 // ~AE look: narrow columns
      const fromViewport = Math.floor(viewportW / desiredPitchPx)

      // Cap by analyser bins and maxBars.
      const upper = Math.max(1, Math.min(maxBars, available || maxBars))
      this._vBars = Math.max(40, Math.min(upper, fromViewport))

      // Slightly thinner bars when there are fewer bins.
      this._hSpacing = this._vBars < 90 ? 0.58 : 0.62

      if (this._mat?.uniforms?.uVBars) this._mat.uniforms.uVBars.value = this._vBars
      if (this._mat?.uniforms?.uHSpacing) this._mat.uniforms.uHSpacing.value = this._hSpacing
    }
  }

  _createAudioTexture() {
    const width = 512
    const height = 1
    this._audioTexData = new Uint8Array(width * height * 4)
    this._audioSmooth = new Float32Array(width)

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

    const hasFloatFFT = typeof this._analyser.getFloatFrequencyData === 'function'
    if (hasFloatFFT && this._fftFloats) {
      this._analyser.getFloatFrequencyData(this._fftFloats)
    } else {
      this._analyser.getByteFrequencyData(this._fftBytes)
    }

    const width = 512
    const n = this._fftBytes.length

    // AE-like stability: attack/release smoothing + noise floor + strong peak emphasis.
    const attack = 0.60
    const release = 0.10
    const noiseFloor = 0.03
    const peakCurve = 1.75

    // Map dB -> 0..1 (AE-style: fixed dB window).
    // These are deliberately conservative so most bins sit near zero.
    const minDb = -90
    const maxDb = -25

    // Percentile baseline removal (noise floor) + gentle LF emphasis.
    const baselinePercentile = 0.25
    const baselineStrength = 0.78
    const displayThreshold = 0.01

    // Very limited AGC: only compensates when overall output is too quiet.
    const targetPeak = 0.85
    const minGain = 0.90
    const maxGain = 1.25
    const agcAttack = 0.08
    const agcRelease = 0.02

    if (!this._audioSmooth || this._audioSmooth.length !== width) {
      this._audioSmooth = new Float32Array(width)
    }

    let peak = 0

    // Pass 1: smooth + shape + histogram
    this._hist.fill(0)
    for (let i = 0; i < width; i++) {
      const srcIdx = Math.min(n - 1, Math.floor((i / (width - 1)) * (n - 1)))

      let raw = 0
      if (hasFloatFFT && this._fftFloats) {
        const db = this._fftFloats[srcIdx]
        raw = (db - minDb) / (maxDb - minDb)
      } else {
        raw = this._fftBytes[srcIdx] / 255
      }
      raw = Math.max(0, Math.min(1, raw))

      const prev = this._audioSmooth[i] ?? 0
      const next = raw > prev
        ? prev + (raw - prev) * attack
        : prev + (raw - prev) * release

      // Remove floor then strongly emphasize peaks (AE-like).
      const floored = Math.max(0, (next - noiseFloor) / (1 - noiseFloor))
      const shaped = Math.pow(Math.max(0, Math.min(1, floored)), peakCurve)
      this._audioSmooth[i] = shaped

      const b = Math.min(this._hist.length - 1, Math.floor(shaped * (this._hist.length - 1)))
      this._hist[b]++
    }

    // Estimate baseline from histogram percentile.
    let baseline = 0
    {
      const targetCount = Math.floor(width * baselinePercentile)
      let acc = 0
      let idx = 0
      for (; idx < this._hist.length; idx++) {
        acc += this._hist[idx]
        if (acc >= targetCount) break
      }
      baseline = idx / Math.max(1, this._hist.length - 1)
    }

    // Pass 2: baseline subtraction + LF weighting + peak for AGC
    for (let i = 0; i < width; i++) {
      const shaped = this._audioSmooth[i] ?? 0

      // Subtract percentile baseline to keep the band from filling up.
      const deBiased = Math.max(0, shaped - baseline * baselineStrength)

      // Low-frequency emphasis (bass reads stronger like AE) while keeping
      // highs from dominating.
      const t = i / (width - 1)
      // High frequencies should be ~2x taller than lows.
      const hfBoost = 1.0 + 1.0 * Math.pow(t, 0.70) // ~1.0 at bass -> ~2.0 at highs
      const weighted = Math.max(0, deBiased * hfBoost - displayThreshold)

      if (weighted > peak) peak = weighted
    }

    const desiredGain = peak > 1e-4 ? (targetPeak / peak) : 1
    const clamped = Math.max(minGain, Math.min(maxGain, desiredGain))
    const prevGain = this._agcGain ?? 1
    this._agcGain = clamped > prevGain
      ? prevGain + (clamped - prevGain) * agcAttack
      : prevGain + (clamped - prevGain) * agcRelease

    // Pass 3: baseline + weighting + AGC into texture
    for (let i = 0; i < width; i++) {
      const shaped = this._audioSmooth[i] ?? 0

      const deBiased = Math.max(0, shaped - baseline * baselineStrength)
      const t = i / (width - 1)
      const hfBoost = 1.0 + 1.0 * Math.pow(t, 0.70)
      const weighted = Math.max(0, deBiased * hfBoost - displayThreshold)

      // Final gain. Keep quiet bins quiet.
      const leveled = Math.max(0, Math.min(1, weighted * (this._agcGain ?? 1)))
      const out = Math.max(0, Math.min(1, leveled))
      const v = Math.max(0, Math.min(255, Math.round(out * 255)))
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

    // Keep bar pixel pitch stable on resize.
    if (this._analyser) {
      this._bindAnalyser()
    }
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
