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
uniform float uCutHi;    // 0..1, cutoff for highest frequency bars

// Color ramp controls (x across spectrum):
// - uColorStart/uColorEnd define where red transitions toward yellow.
// - uColorGamma shapes how fast the hue shifts (AE-like non-linear ramp).
uniform float uColorStart;
uniform float uColorEnd;
uniform float uColorGamma;
uniform float uYellowStart;

// Skip the first N low-frequency bars (e.g. if first bins are redundant).
uniform float uSkipLowBars;

// Post softness/bloom controls (AE-like unsharp/soft look).
// (disabled)

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

vec3 renderAt(vec2 fragCoord) {
  // Use pixel coordinates for perfectly regular tiles.
  vec2 fc = floor(fragCoord);
  vec2 uv = fc.xy / iResolution.xy;

  float binsAll = max(1.0, floor(uVBars + 0.5));
  float skip = max(0.0, floor(uSkipLowBars + 0.5));
  float bins = max(1.0, binsAll - skip);
  // Allow min 0.1 spacing
  float fill = clamp(uHSpacing, 0.10, 0.98);

  float targetWidth = floor(iResolution.x * 0.55);
  float pitch = max(1.0, floor(targetWidth / bins));
  
  float totalW = pitch * bins;
  float rightMargin = floor(iResolution.x * 0.04);
  float xOffset = floor(iResolution.x - totalW - rightMargin);
  float xLocal = fc.x - xOffset;

  // Outside the bar area.
  if (xLocal < 0.0 || xLocal >= totalW) {
    return vec3(0.0);
  }

  float binIdx = floor(xLocal / pitch);
  float localX = xLocal - binIdx * pitch;

  // Keep a visible gap between bars (AE has distinct columns).
  // Allow tighter gaps (1px pad = 2px total gap).
  float pad = max(1.0, floor((pitch * (1.0 - fill)) * 0.5));
  float barW = max(1.0, (pitch - 2.0 * pad));

  // Bin position across visible bars (0..1).
  float x = (binIdx + 0.5) / bins;

  // Map visual X (0..1) to freq range (start..cutHi) to eliminate empty right-side gap.
  // This ensures the visual block is fully filled with the selected freq band.
  float uStart = skip / max(1.0, binsAll);
  float uEnd = clamp(uCutHi, 0.0, 1.0);
  
  // AE-like non-linear distribution (logGamma) applied to the mapping.
  float logGamma = 1.55;
  float t = pow(clamp(x, 0.0, 1.0), logGamma);
  float sampleX = mix(uStart, uEnd, t);
  
  float fSample = texture2D(iChannel0, vec2(sampleX, 0.25)).x;

  // Bar baseline and height in pixels (closer to AE reference: lower + shorter).
  // Baseline raised to 30% from bottom.
  float baseY = floor(iResolution.y * 0.30);
  float maxH = floor(iResolution.y * 0.26);

  float s = pow(clamp(fSample, 0.0, 1.0), 1.10);
  // Reduce max height scalar to avoid massive bass blocks.
  float heightPx = floor((maxH * 0.9) * s);

  // Minimum bar height is a square (use bar width as min height).
  float minHPx = barW;
  heightPx = max(heightPx, minHPx);

  // Signed-distance rounded boxes for soft edges.
  float yLocalUp = fc.y - baseY;
  float yLocalDown = baseY - fc.y;

  // Center bar in its pitch cell.
  float cx = (localX - pitch * 0.5);
  float cyUp = (yLocalUp - heightPx * 0.5);
  float cyDn = (yLocalDown - heightPx * 0.5);

  vec2 halfSize = vec2(barW * 0.5, max(0.5, heightPx * 0.5));
  // Keep roundness high, even for thin bars -> capsule look.
  float radius = min(8.0, 0.5 * barW);
  radius = min(radius, min(halfSize.x, halfSize.y));

  float distUp = sdRoundBox(vec2(cx, cyUp), halfSize, radius);
  float distDn = sdRoundBox(vec2(cx, cyDn), halfSize, radius);

  // Soft edges (AE-like blur).
  // Reduced AA width to bring back gaps.
  float aa = 2.0;
  float fillUp = smoothstep(aa, -aa, distUp);
  float fillDn = smoothstep(aa, -aa, distDn);

  // Glow: limit to close proximity of the bars.
  // Anisotropic bloom: Horizontal only (spreads used X distance, restricted Y distance).
  // Calculate axis-aligned distances outside the box for glow shaping.
  vec2 qUp = abs(vec2(cx, cyUp)) - halfSize;
  float dxUp = max(qUp.x, 0.0);
  float dyUp = max(qUp.y, 0.0);
  
  vec2 qDn = abs(vec2(cx, cyDn)) - halfSize;
  float dxDn = max(qDn.x, 0.0);
  float dyDn = max(qDn.y, 0.0);

  // Glow falls off very fast on X to protect the black gaps.
  // X decay coeff increased to 3.0 to ensure gaps remain black.
  float glowUp = 1.0 * exp(-dxUp * 3.0 - dyUp * 2.0) + 0.5 * exp(-dxUp * 4.0 - dyUp * 3.0);
  float glowDn = 0.8 * exp(-dxDn * 3.0 - dyDn * 2.0) + 0.4 * exp(-dxDn * 4.0 - dyDn * 3.0);
  
  // Make reflections much more subtle and blurry
  float reflFade = exp(-yLocalDown / max(1.0, iResolution.y * 0.08));
  
  // Reflection blur simulation: increase AA for the reflection part
  float aaRefl = 6.0;
  fillDn = smoothstep(aaRefl, -aaRefl, distDn);

  // Palette: AE-like red→orange→yellow ramp, shaped with a non-linear curve.
  // The ramp is controlled in JS via uColorStart/uColorEnd/uColorGamma.
  vec3 redCol = vec3(1.0, 0.05, 0.00);
  vec3 orgCol = vec3(1.0, 0.34, 0.02);
  vec3 yelCol = vec3(1.0, 0.98, 0.12);

  // Make sure the ramp finishes within the visible bar range.
  float rampEnd = min(uColorEnd, clamp(uCutHi, 0.0, 1.0));
  float rampStart = min(uColorStart, rampEnd - 1e-4);
  float denom = max(1e-4, (rampEnd - rampStart));
  float tRamp = clamp((x - rampStart) / denom, 0.0, 1.0);
  tRamp = pow(tRamp, max(0.10, uColorGamma));

  // Two smooth blends so mid-range leans orange before reaching yellow.
  float toOrange = smoothstep(0.0, 0.58, tRamp);

  // Start yellow influence at a specific screen position.
  float yStart = clamp(uYellowStart, 0.0, 1.0);
  float yStartTRamp = clamp((yStart - rampStart) / denom, 0.0, 1.0);
  float toYellow = smoothstep(yStartTRamp, 1.0, tRamp);
  vec3 baseCol = mix(redCol, orgCol, toOrange);
  baseCol = mix(baseCol, yelCol, toYellow);

  // Keep bar tops the same hue (no white caps). Only subtle brightness lift.
  float yInBar = (heightPx > 0.0) ? clamp(yLocalUp / max(1.0, heightPx), 0.0, 1.0) : 0.0;
  float tip = smoothstep(0.92, 1.0, yInBar);
  // Add boost for bloom core
  vec3 tipCol = min(vec3(1.0), baseCol * (1.2 + 0.30 * tip));

  vec3 col = vec3(0.0);
  // Stronger core
  col += tipCol * fillUp * 0.95;
  // Tighter glow
  col += tipCol * (1.1 * glowUp);
  
  col += tipCol * (0.18 * fillDn * reflFade);
  col += tipCol * (0.22 * glowDn * reflFade); // Increased reflection glow

  return col;
}

void main() {
  gl_FragColor = vec4(renderAt(gl_FragCoord.xy), 1.0);
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
    // AE reference shows much larger gaps (thin bars).
    this._hSpacing = 0.40

    // Cutoff for the highest frequency bars (0..1).
    this._cutHi = 0.80

    this._lastLoggedBars = null

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
        uCutHi: { value: this._cutHi },

        // Color ramp (tweak to match AE reference)
        // Yellow should be fully reached later to allow orange to breathe.
        uColorStart: { value: 0.15 },
        uColorEnd: { value: 0.85 },
        uColorGamma: { value: 1.60 },
        // Yellow influence begins later.
        uYellowStart: { value: 0.55 },

        // Drop the first 2 low-frequency bars.
        uSkipLowBars: { value: 0.0 },
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
      // But now we try to fit into 55% of the viewport width.
      const viewportW = Math.max(1, window.innerWidth || 1)
      const targetW = viewportW * 0.55
      const desiredPitchPx = 6 // Slightly thinner to fit more bars in 55%
      const fromViewport = Math.floor(targetW / desiredPitchPx)

      // Cap by analyser bins and maxBars.
      const upper = Math.max(1, Math.min(maxBars, available || maxBars))
      this._vBars = Math.max(40, Math.min(upper, fromViewport))

      // Slightly thinner bars when there are fewer bins.
      // this._hSpacing = this._vBars < 90 ? 0.78 : 0.92
      // Using fixed 0.50 for distinct detached bars.
      this._hSpacing = 0.50

      if (this._mat?.uniforms?.uVBars) this._mat.uniforms.uVBars.value = this._vBars
      if (this._mat?.uniforms?.uHSpacing) this._mat.uniforms.uHSpacing.value = this._hSpacing
      if (this._mat?.uniforms?.uCutHi) this._mat.uniforms.uCutHi.value = this._cutHi

      if (this._lastLoggedBars !== this._vBars) {
        this._lastLoggedBars = this._vBars
        console.info(`[FrequencyVisualization] displaying ${this._vBars} bars (cutHi=${this._cutHi})`)
      }
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
