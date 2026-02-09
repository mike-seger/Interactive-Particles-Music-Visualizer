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

// --- Slate / Noise Functions ---

float hash12(vec2 p) {
  vec3 p3  = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D Noise based on IQ
float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// FBM for slate texture
float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100);
    // Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
    for (int i = 0; i < 5; ++i) {
        v += a * noise(x);
        x = rot * x * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// Height map for water/slate: layering noise for ridges with movement
float getSlateHeight(vec2 uv) {
   float time = iTime * 0.25; 
   
   // --- Surf / Random Wave Logic ---
   float tSurf = iTime * 0.2; // Reduced speed

   // 3 Distinct Wave Components with varying angles (Bottom-Left to Top-Right general flow)
   // Wave 1: Main diagonal swell
   vec2 d1 = normalize(vec2(1.0, 0.4));
   float p1 = dot(uv, d1) + noise(uv * 0.5 + tSurf)*0.5; // warped
   float w1 = sin(p1 * 0.9 - tSurf * 3.2);

   // Wave 2: Steeper angle
   vec2 d2 = normalize(vec2(0.4, 1.0));
   float p2 = dot(uv, d2) + noise(uv * 0.6 - tSurf)*0.5;
   float w2 = sin(p2 * 1.1 - tSurf * 2.8 + 1.0);

   // Wave 3: Shallower angle
   vec2 d3 = normalize(vec2(1.0, 0.1));
   float p3 = dot(uv, d3) + noise(uv * 0.7 + tSurf*0.8)*0.5;
   float w3 = sin(p3 * 0.8 - tSurf * 3.5 + 2.0);

   // Composite: Interference of 3 waves
   // Averaging them keeps range checkable
   float composite = (w1 + w2 + w3) * 0.333; 

   // Peak sharpening:
   // Lower threshold slightly to allow more peaks (up to 3 active)
   // exp(composite * Sharpness - Threshold)
   float surf = exp(composite * 4.5 - 2.5); 

   // Amplitude
   float swell = surf * 16.0; // Slightly reduced max amp to prevent clipping/artifacts

   // Composite Height:
   // Add FBM *on top* of swell, but also scale FBM by swell derivative approximation?
   // Actually, just simple addition is correct for height maps.
   // To ensure FBM is visible, we boost it slightly.
   float h = swell;
   
   // Apply FBM detail
   h += 1.2 * fbm(uv * 3.0 + vec2(time * 0.5, time * 0.2));
   h += 0.6 * fbm(uv * 12.0 - vec2(time * 0.3));
   h += 0.3 * fbm(uv * 48.0 + vec2(0.0, time * 0.1));
   return h;
}

vec3 getSlateNormal(vec2 p) {
    vec2 e = vec2(0.005, 0.0);
    // Finite difference for normal
    float dX = getSlateHeight(p + e.xy) - getSlateHeight(p - e.xy);
    float dY = getSlateHeight(p + e.yx) - getSlateHeight(p - e.yx);
    // Scale normal strength (Rougher slate -> higher multiplier)
    return normalize(vec3(-dX * 8.0, -dY * 8.0, 1.0));
}

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
  vec3 col = vec3(0.0);
  
  // Distortion vector for floor reflections, shared with spectrum
  vec2 distort = vec2(0.0);

  // --- CONFIG ---
  float horizon = 0.40;
  
  // --- Circle Config ---
  // Reduced diameter (approx 70% of previous size)
  float circleRadius = iResolution.y * 0.245; 
  // Positioned slightly below spectrum baseline (0.30)
  float circleBottom = 0.29 * iResolution.y;
  float circleY = circleBottom + circleRadius;
  // Moved more to the left
  float circleX = iResolution.x * 0.18; 
  vec2 circleCenter = vec2(circleX, circleY);
  vec3 cyan = vec3(0.02, 1.0, 0.99);

  // --- Floor Rendering ---
  if (uv.y < horizon) {
      // SLATE FLOOR
      // Fake perspective projection
      float dy = horizon - uv.y;
      float depth = 0.3 / max(0.001, dy);
      
      // Texture coordinates 
      vec2 planeUV = vec2((uv.x - 0.5) * depth * 2.0, depth);
      planeUV.x *= (iResolution.x / iResolution.y);
      
      // Bump map from FBM (Slate ridges)
      vec3 N = getSlateNormal(planeUV * 1.5);
      
      // -- Reflection Logic --
      // Apply distortion from slate normal
      distort = N.xy * (100.0 * (1.0 - dy * 2.0)); 

      // Calculate mirrored position relative to the circle's contact point (circleBottom)
      // We mirror the pixel Y coordinate around the contact line.
      float mirrorYPixels = circleBottom + (circleBottom - fc.y); 
      vec2 reflPos = vec2(fc.x, mirrorYPixels);
      // Determine distance to center in the reflected space 
      reflPos += distort;

      // Circle Reflection
      float dRefl = length(reflPos - circleCenter) - circleRadius;
      float ringRefl = 1.0 - smoothstep(0.0, 5.0, abs(dRefl));
      float glowRefl = exp(-0.012 * abs(dRefl));
      
      // Mask reflection: visible only adjacent (below) the contact point
      float contactUV = circleBottom / iResolution.y;
      // Cut off reflection sharply above the contact point
      float maskRefl = smoothstep(contactUV + 0.01, contactUV, uv.y);
      // Fade at very bottom of screen
      maskRefl *= smoothstep(0.0, 0.1, uv.y);

      vec3 lightRefl = cyan * (ringRefl * 1.5 + glowRefl * 0.5) * maskRefl;

      // Floor Base + Lighting
      vec3 slateBase = vec3(0.02, 0.025, 0.03); 
      col = slateBase + lightRefl;
      
      // -- Masking Floor inside the Circle --
      // Occlude the floor where it would be seen "through" the bottom of the ring.
      // Increased radius to cover the ring's stroke width better.
      float distToCenter = length(fc - circleCenter);
      float maskRadius = circleRadius + 2.0; // Extend slightly outside to prevent edge bleeding
      if (distToCenter < maskRadius) {
          col *= 0.0; // Mask out completely
      }
      
      // Vignette / Fog
      float fog = smoothstep(0.0, 0.15, dy);
      col *= fog;
      col *= smoothstep(0.0, 0.2, uv.y);
  } else {
      col = vec3(0.0);
  }

  // --- Foreground Circle (Draw on top of scene) ---
  {
      float dCircle = length(fc - circleCenter) - circleRadius;
      float ring = 1.0 - smoothstep(0.0, 3.0, abs(dCircle));
      float glow = exp(-0.02 * abs(dCircle));
      col += cyan * (ring * 2.5 + glow * 0.6);
  }

  // --- Spectrum Logic ---
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

  // Only calc bars if inside horiz area
  if (xLocal >= 0.0 && xLocal < totalW) {
      float binIdx = floor(xLocal / pitch);
      float localX = xLocal - binIdx * pitch;

      // Compute an integer bar width from the fill ratio and use the leftover
      // pixels as a uniform gap. This keeps bar widths and gaps consistent.
      float barW = max(1.0, floor(pitch * fill));
      barW = min(barW, pitch);
      float gap = max(0.0, pitch - barW);
      float padL = floor(gap * 0.5);

      float x = (binIdx + 0.5) / bins;
      float uStart = skip / max(1.0, binsAll);
      float uEnd = clamp(uCutHi, 0.0, 1.0);
      
      // Lower gamma to expose more mids/highs detail (closer to AE)
      float logGamma = 1.55;
      float t = pow(clamp(x, 0.0, 1.0), logGamma);
      float sampleX = mix(uStart, uEnd, t);
      
      // Use single-tap sampling to preserve per-bin detail (no extra averaging here)
      float fSample = texture2D(iChannel0, vec2(sampleX, 0.25)).x;

      float baseY = floor(iResolution.y * 0.30);
      // Visual height scale (lifted to better match AE peak levels)
      float heightScale = 0.78;
      float maxH = floor(iResolution.y * 0.26);

      float s = pow(clamp(fSample, 0.0, 1.0), 1.10);
      
      // Smoothen left edge onset: specific dampening
      if (binIdx < 0.5) s *= 0.33;
      else if (binIdx < 1.5) s *= 0.66;

      float heightPx = floor((maxH * heightScale) * s);
      // Silence baseline thickness: keep it ~2px.
      float minHPx = 2.0;
      heightPx = max(heightPx, minHPx);

      float yLocalUp = fc.y - baseY;
      float yLocalDown = baseY - fc.y;

      float cx = (localX - (padL + barW * 0.5));
      float cyUp = (yLocalUp - heightPx * 0.5);
      float cyDn = (yLocalDown - heightPx * 0.5);

      vec2 halfSize = vec2(barW * 0.5, max(0.5, heightPx * 0.5));
      float radius = min(8.0, 0.5 * barW);
      radius = min(radius, min(halfSize.x, halfSize.y));

      // --- EXTEND BAR DOWNWARD for flat base look ---
      // We extend the geometry below the baseline so the bottom corners don't round off/point
      float extendDown = 60.0;
      vec2 halfSizeExt = halfSize;
      halfSizeExt.y += extendDown * 0.5;
      
      float cyUpExt = cyUp + extendDown * 0.5;
      float cyDnExt = cyDn + extendDown * 0.5; // Extend reflection geometry upwards into sky

      // Calculate SDF with extended geometry
      float distUp = sdRoundBox(vec2(cx, cyUpExt), halfSizeExt, radius);
      
      // Mirror extension for reflection so they meet flat at the baseline
      float distDn = sdRoundBox(vec2(cx, cyDnExt) + distort, halfSizeExt, radius);

      // Wide smoothstep for optical defocus/scattering.
      // Keep very small bars crisp so silence doesn't look like a thick baseline.
      float blurAmt = min(7.0, max(1.0, floor(heightPx * 0.5)));
      float fillUp = smoothstep(blurAmt, -blurAmt, distUp);
      
      // Mask the extended bottom part below the baseline
      float baseMask = smoothstep(baseY - 1.0, baseY + 1.0, fc.y); 
      fillUp *= baseMask;
      
      // Boost alpha curve to maintain core brightness despite heavy blur
      fillUp = pow(fillUp, 0.7);

      float aaRefl = blurAmt;
      float fillDn = smoothstep(aaRefl, -aaRefl, distDn);
      
      // Mask extended reflection part bleeding into sky
      fillDn *= (1.0 - baseMask);

      vec2 qUp = abs(vec2(cx, cyUp)) - halfSize;
      float dxUp = max(qUp.x, 0.0);
      float dyUp = max(qUp.y, 0.0);
      
      vec2 qDn = abs(vec2(cx, cyDn)) - halfSize;
      float dxDn = max(qDn.x, 0.0);
      float dyDn = max(qDn.y, 0.0);

      // Consistent glow params (Tuned for soft look but preserving gaps)
      // Decay coefs: 1.5/1.2 (Softer than orig 3.0, tighter than blob 0.5)
      float glowUp = 0.9 * exp(-dxUp * 1.5 - dyUp * 1.2) + 0.45 * exp(-dxUp * 2.0 - dyUp * 1.5);
      float glowDn = 0.7 * exp(-dxDn * 1.5 - dyDn * 1.2) + 0.35 * exp(-dxDn * 2.0 - dyDn * 1.5);
      
      float reflFade = exp(-yLocalDown / max(1.0, iResolution.y * 0.08));

      vec3 redCol = vec3(1.0, 0.05, 0.00);
      vec3 orgCol = vec3(1.0, 0.34, 0.02);
      vec3 yelCol = vec3(1.0, 0.98, 0.12);

      float rampEnd = min(uColorEnd, clamp(uCutHi, 0.0, 1.0));
      float rampStart = min(uColorStart, rampEnd - 1e-4);
      float denom = max(1e-4, (rampEnd - rampStart));
      float tRamp = clamp((x - rampStart) / denom, 0.0, 1.0);
      tRamp = pow(tRamp, max(0.10, uColorGamma));

      float toOrange = smoothstep(0.0, 0.58, tRamp);
      float yStart = clamp(uYellowStart, 0.0, 1.0);
      float yStartTRamp = clamp((yStart - rampStart) / denom, 0.0, 1.0);
      float toYellow = smoothstep(yStartTRamp, 1.0, tRamp);
      vec3 baseCol = mix(redCol, orgCol, toOrange);
      baseCol = mix(baseCol, yelCol, toYellow);

      float yInBar = (heightPx > 0.0) ? clamp(yLocalUp / max(1.0, heightPx), 0.0, 1.0) : 0.0;
      float tip = smoothstep(0.92, 1.0, yInBar);
      
      // Increased brightness to compensate for blur spreading
      // Removed min(1.0) clamp to allow over-driving brightness
      // Slightly brighter tips to match AE perceived levels
      vec3 tipCol = baseCol * (1.75 + 0.60 * tip);

      // Composite Bars (Opaque Body)
      // Mix the solid bar color over the background based on fillUp mask.
      col = mix(col, tipCol, fillUp);
      // Additive blending for glow/light
      col += tipCol * (1.1 * glowUp);
      
      // Composite Reflection (Additive on floor)
        // Dim reflection relative to AE target
        col += tipCol * (0.14 * fillDn * reflFade);
        col += tipCol * (0.17 * glowDn * reflFade);
  }

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

    // This visualizer relies on crisp pixel-scale geometry; if auto-quality
    // drops pixelRatio too low, bars/gaps become comically thick.
    this.qualityConstraints = {
      minPixelRatio: (Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio >= 2) ? 0.75 : 1,
    }

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

    this._beatPulse = 0
    this._lastUpdateMs = performance.now()

    // User-tweakable weighting controls (variant 3 only).
    this._controls = {
      // Mode: 'ae' (default) or 'fv2' style weighting/tilt/kick.
      weightingMode: 'ae',

      // Analyser smoothingTimeConstant override (0 => match FV2 snap). Non-null keeps slider usable.
      analyserSmoothing: 0.0,

      // Spatial smoothing kernel: 'wide' (9-tap, FV3 default) or 'narrow' (3-tap, FV1/FV2 feel).
      spatialKernel: 'wide',

      // Per-bin floor (FV2 transient feel).
      useBinFloor: false,
      floorAtkLow: 0.18,
      floorRelLow: 0.03,
      floorAtkHi: 0.10,
      floorRelHi: 0.015,
      floorStrengthLow: 0.8,
      floorStrengthHi: 0.6,

      // Kick/sub weighting (FV2 style) used when weightingMode = 'fv2'.
      kickHz: 70,
      kickWidthOct: 0.65,
      kickBoostDb: 8,
      subShelfDb: 4,
      tiltHi: 1.0,   // multiplier at highs (bass is implied by tilt curve)
      tiltLo: 1.45,  // multiplier at bass

      // Beat accent enable (FV3 only). Set to 0 to match FV1/FV2 behavior.
      beatBoostEnabled: 1,
      // Where the low shelf decays to zero boost (Hz).
      bassFreqHz: 130,
      // Transition width for the shelf decay (Hz).
      bassWidthHz: 40,
      // Gain applied below the shelf knee (dB).
      bassGainDb: 8.0,
      // High-frequency rolloff amount (negative dB).
      hiRolloffDb: -6.0,

      // Temporal smoothing
      attack: 0.75,
      release: 0.12,
      noiseFloor: 0.02,
      peakCurve: 1.25,

      // dB window
      minDb: -80,
      maxDb: -18,

      // Beat accent
      beatBoost: 0.65,

      // Baseline and thresholding
      baselinePercentile: 0.18,
      baselineStrength: 0.48,
      displayThreshold: 0.005,

      // AGC and leveling
      targetPeak: 0.95,
      minGain: 0.90,
      maxGain: 1.22,
      agcAttack: 0.18,
      agcRelease: 0.07,
    }

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

    // Ensure a holder exists in case init runs before App.holder is ready.
    if (!App.holder) {
      App.holder = new THREE.Object3D()
      App.holder.name = 'holder'
      if (App.scene) {
        App.scene.add(App.holder)
      }
    }

    App.holder.add(mesh)
    this._syncResolution()
    window.addEventListener('resize', this._onResize)
  }

  _bindAnalyser() {
    if (App.audioManager?.analyserNode) {
      this._analyser = App.audioManager.analyserNode
      this._fftBytes = new Uint8Array(this._analyser.frequencyBinCount)
      this._fftFloats = new Float32Array(this._analyser.frequencyBinCount)

      const smoothing = this._controls?.analyserSmoothing
      if (typeof smoothing === 'number' && smoothing >= 0 && smoothing <= 1 && Number.isFinite(smoothing)) {
        this._analyser.smoothingTimeConstant = smoothing
      }

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
    this._spatialBuf = new Float32Array(width)
    this._binFloor = new Float32Array(width)

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

  _normalizeControls(src = {}) {
    const clamp = (v, lo, hi, fallback) => {
      const n = Number.isFinite(v) ? v : fallback
      return Math.min(hi, Math.max(lo, n))
    }

    const normMode = (v) => (v === 'fv2' ? 'fv2' : 'ae')
    const normKernel = (v) => (v === 'narrow' ? 'narrow' : 'wide')
    const normBool01 = (v, fallback) => (v === 0 || v === 1 ? v : fallback)

    const minDbRaw = clamp(src.minDb, -120, -10, this._controls?.minDb ?? -80)
    const maxDbRaw = clamp(src.maxDb, -60, 0, this._controls?.maxDb ?? -18)
    const minDb = Math.min(minDbRaw, maxDbRaw - 1)
    const maxDb = Math.max(maxDbRaw, minDb + 1)

    const minGainRaw = clamp(src.minGain, 0.05, 3.0, this._controls?.minGain ?? 0.9)
    const maxGainRaw = clamp(src.maxGain, 0.1, 5.0, this._controls?.maxGain ?? 1.22)
    const minGain = Math.min(minGainRaw, maxGainRaw - 0.01)
    const maxGain = Math.max(maxGainRaw, minGain + 0.01)

    return {
      bassFreqHz: clamp(src.bassFreqHz, 20, 140, this._controls?.bassFreqHz ?? 130),
      bassWidthHz: clamp(src.bassWidthHz, 1, 50, this._controls?.bassWidthHz ?? 40),
      bassGainDb: clamp(src.bassGainDb, -6, 30, this._controls?.bassGainDb ?? 8),
      hiRolloffDb: clamp(src.hiRolloffDb, -24, 0, this._controls?.hiRolloffDb ?? -6),

      attack: clamp(src.attack, 0.01, 1.0, this._controls?.attack ?? 0.75),
      release: clamp(src.release, 0.01, 1.0, this._controls?.release ?? 0.12),
      noiseFloor: clamp(src.noiseFloor, 0.0, 0.2, this._controls?.noiseFloor ?? 0.02),
      peakCurve: clamp(src.peakCurve, 0.5, 4.0, this._controls?.peakCurve ?? 1.25),

      beatBoostEnabled: normBool01(src.beatBoostEnabled, this._controls?.beatBoostEnabled ?? 1),
      beatBoost: clamp(src.beatBoost, 0.0, 2.0, this._controls?.beatBoost ?? 0.65),

      minDb,
      maxDb,

      baselinePercentile: clamp(src.baselinePercentile, 0.01, 0.5, this._controls?.baselinePercentile ?? 0.18),
      baselineStrength: clamp(src.baselineStrength, 0.0, 1.0, this._controls?.baselineStrength ?? 0.48),
      displayThreshold: clamp(src.displayThreshold, 0.0, 0.05, this._controls?.displayThreshold ?? 0.005),

      targetPeak: clamp(src.targetPeak, 0.1, 1.5, this._controls?.targetPeak ?? 0.95),
      minGain,
      maxGain,
      agcAttack: clamp(src.agcAttack, 0.0, 1.0, this._controls?.agcAttack ?? 0.18),
      agcRelease: clamp(src.agcRelease, 0.0, 1.0, this._controls?.agcRelease ?? 0.07),

      weightingMode: normMode(src.weightingMode ?? this._controls?.weightingMode),
      analyserSmoothing: Number.isFinite(src.analyserSmoothing)
        ? Math.max(0, Math.min(1, src.analyserSmoothing))
        : (Number.isFinite(this._controls?.analyserSmoothing) ? this._controls.analyserSmoothing : 0.0),
      spatialKernel: normKernel(src.spatialKernel ?? this._controls?.spatialKernel),

      useBinFloor: !!(src.useBinFloor ?? this._controls?.useBinFloor),
      floorAtkLow: clamp(src.floorAtkLow, 0.0, 1.0, this._controls?.floorAtkLow ?? 0.18),
      floorRelLow: clamp(src.floorRelLow, 0.0, 1.0, this._controls?.floorRelLow ?? 0.03),
      floorAtkHi: clamp(src.floorAtkHi, 0.0, 1.0, this._controls?.floorAtkHi ?? 0.10),
      floorRelHi: clamp(src.floorRelHi, 0.0, 1.0, this._controls?.floorRelHi ?? 0.015),
      floorStrengthLow: clamp(src.floorStrengthLow, 0.0, 1.5, this._controls?.floorStrengthLow ?? 0.8),
      floorStrengthHi: clamp(src.floorStrengthHi, 0.0, 1.5, this._controls?.floorStrengthHi ?? 0.6),

      kickHz: clamp(src.kickHz, 20, 200, this._controls?.kickHz ?? 70),
      kickWidthOct: clamp(src.kickWidthOct, 0.1, 2.0, this._controls?.kickWidthOct ?? 0.65),
      kickBoostDb: clamp(src.kickBoostDb, -12, 24, this._controls?.kickBoostDb ?? 8),
      subShelfDb: clamp(src.subShelfDb, -12, 24, this._controls?.subShelfDb ?? 4),
      tiltHi: clamp(src.tiltHi, 0.1, 2.5, this._controls?.tiltHi ?? 1.0),
      tiltLo: clamp(src.tiltLo, 0.1, 3.0, this._controls?.tiltLo ?? 1.45),
    }
  }

  getControlParams() {
    return { ...this._controls }
  }

  setControlParams(next = {}) {
    this._controls = this._normalizeControls({ ...this._controls, ...next })
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

    // Re-apply analyser smoothing if a preset changed it
    const smoothing = this._controls?.analyserSmoothing
    if (typeof smoothing === 'number' && smoothing >= 0 && smoothing <= 1 && Number.isFinite(smoothing)) {
      this._analyser.smoothingTimeConstant = smoothing
    }

    // Ensure control params stay clamped to safe ranges.
    this._controls = this._normalizeControls(this._controls)
    const controls = this._controls

    const width = 512
    const n = this._fftBytes.length

    // Temporal smoothing + peak shaping.
    const attack = controls.attack
    const release = controls.release
    const noiseFloor = controls.noiseFloor
    const peakCurve = controls.peakCurve

    // Map dB -> 0..1 (AE-style: fixed dB window).
    // These are deliberately conservative so most bins sit near zero.
    const minDb = controls.minDb
    const maxDb = controls.maxDb

    // Percentile baseline removal + thresholding.
    const baselinePercentile = controls.baselinePercentile
    const baselineStrength = controls.baselineStrength
    const displayThreshold = controls.displayThreshold

    // Very limited AGC: only compensates when overall output is too quiet.
    const targetPeak = controls.targetPeak
    const minGain = controls.minGain
    const maxGain = controls.maxGain
    const agcAttack = controls.agcAttack
    const agcRelease = controls.agcRelease

    const beatPulse = this._beatPulse ?? 0
    const beatBoost = (controls.beatBoostEnabled ? controls.beatBoost : 0) ?? 0
    const beatFactorFor = (t) => 1 + beatPulse * beatBoost * Math.max(0, 1 - t * 4.0) // taper after ~25% of spectrum

    // --- AE-ish frequency shaping ---
    // AE spectra tend to be *mid-forward* with controlled sub-bass and a gentle high rolloff.
    // We approximate that with: low shelf attenuation + wide mid bell + high rolloff.
    const clamp01 = (x) => Math.max(0, Math.min(1, x))
    const smoothstep = (e0, e1, x) => {
      const t = clamp01((x - e0) / (e1 - e0))
      return t * t * (3 - 2 * t)
    }
    const dbToLin = (db) => Math.pow(10, db / 20)

    const sampleRate = this._analyser?.context?.sampleRate ?? 48000
    const nyquist = sampleRate * 0.5

    const aeWeight = (i) => {
      const t = i / (width - 1)
      const f = t * nyquist

      // Low shelf: gently lift deep lows/kick energy.
      const bassEdgeHi = Math.min(nyquist * 0.98, Math.max(20, controls.bassFreqHz))
      const bassEdgeLo = Math.max(5, Math.min(bassEdgeHi - 1, bassEdgeHi - controls.bassWidthHz))
      const lowCut = smoothstep(bassEdgeLo, bassEdgeHi, f) // 0 in sub-bass -> 1 above knee
      const lowDb = controls.bassGainDb * (1.0 - lowCut)

      // Mid bell: wide boost centered ~1.6 kHz.
      const midCenter = 1600.0
      const ratio = Math.max(1e-6, f / midCenter)
      const log2v = Math.log(ratio) / Math.log(2)
      const midWidthOct = 1.6                       // wide bell
      const sigma = (midWidthOct / 2.355)
      const midShape = Math.exp(-(log2v * log2v) / (2 * sigma * sigma))
      const midDb = 6.0 * midShape

      // High rolloff: gently reduce > ~10 kHz.
      const hiRoll = smoothstep(9000, 16000, f)     // 0 below 9k -> 1 above 16k
      const hiDb = controls.hiRolloffDb * hiRoll

      return dbToLin(lowDb + midDb + hiDb)
    }

    const fv2Weight = (i) => {
      const t = i / Math.max(1, width - 1)
      const f = t * nyquist

      const shelfT = 1.0 - smoothstep(120.0, 220.0, f)
      const shelf = dbToLin(controls.subShelfDb * shelfT)

      const oct = Math.log2(Math.max(1e-6, f) / controls.kickHz)
      const sigma = controls.kickWidthOct / 2.355
      const bell = Math.exp(-(oct * oct) / (2.0 * sigma * sigma))
      const kick = dbToLin(controls.kickBoostDb * bell)

      const tilt = controls.tiltLo - (controls.tiltLo - controls.tiltHi) * Math.pow(t, 0.55)

      return Math.max(0, shelf * kick * tilt)
    }

    if (!this._audioSmooth || this._audioSmooth.length !== width) {
      this._audioSmooth = new Float32Array(width)
    }
    if (!this._spatialBuf || this._spatialBuf.length !== width) {
      this._spatialBuf = new Float32Array(width)
    }

    let peak = 0

    // Pass 1: smooth + shape (Temporal)
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
    }
    
    // Pass 1.5: Spatial smoothing / banding (AE-ish)
    if (controls.spatialKernel === 'narrow') {
      // 3-tap for FV1/FV2 feel.
      for (let i = 0; i < width; i++) {
        const iL = Math.max(0, i - 1)
        const iR = Math.min(width - 1, i + 1)
        const val = (0.05 * this._audioSmooth[iL]) + (0.90 * this._audioSmooth[i]) + (0.05 * this._audioSmooth[iR])
        this._spatialBuf[i] = val
      }
    } else {
      // 9-tap wide kernel (FV3 default)
      const K = [1, 4, 9, 15, 20, 15, 9, 4, 1]
      const Ksum = 78
      for (let i = 0; i < width; i++) {
        let acc = 0
        for (let k = -4; k <= 4; k++) {
          const j = Math.max(0, Math.min(width - 1, i + k))
          acc += K[k + 4] * (this._audioSmooth[j] ?? 0)
        }
        this._spatialBuf[i] = acc / Ksum
      }
    }

    // Pass 1.8: Histogram (from spatially smoothed data)
    this._hist.fill(0)
    for (let i = 0; i < width; i++) {
      const s = this._spatialBuf[i]
      const b = Math.min(this._hist.length - 1, Math.floor(s * (this._hist.length - 1)))
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

    // Pass 2: baseline subtraction + weighting + peak for AGC
    for (let i = 0; i < width; i++) {
      const shaped = this._spatialBuf[i] ?? 0

      // Optional per-bin floor (FV2 transient extraction).
      let transient = shaped
      if (controls.useBinFloor) {
        const t = i / (width - 1)
        const isLow = t < 0.20
        const floorAtk = isLow ? controls.floorAtkLow : controls.floorAtkHi
        const floorRel = isLow ? controls.floorRelLow : controls.floorRelHi
        const fPrev = this._binFloor[i] ?? 0
        const fNext = shaped > fPrev
          ? fPrev + (shaped - fPrev) * floorAtk
          : fPrev + (shaped - fPrev) * floorRel
        this._binFloor[i] = fNext
        const strength = isLow ? controls.floorStrengthLow : controls.floorStrengthHi
        transient = Math.max(0, shaped - fNext * strength)
      }

      // Subtract percentile baseline to keep the band from filling up.
      const deBiased = Math.max(0, transient - baseline * baselineStrength)

      // Frequency weighting.
      const useFv2 = controls.weightingMode === 'fv2'
      const w = useFv2 ? fv2Weight(i) : aeWeight(i)
      const t = i / Math.max(1, width - 1)
      const weighted = Math.max(0, deBiased * w * beatFactorFor(t) - displayThreshold)

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
      const shaped = this._spatialBuf[i] ?? 0

      let transient = shaped
      if (controls.useBinFloor) {
        const t = i / (width - 1)
        const isLow = t < 0.20
        const strength = isLow ? controls.floorStrengthLow : controls.floorStrengthHi
        const f = this._binFloor[i] ?? 0
        transient = Math.max(0, shaped - f * strength)
      }

      const deBiased = Math.max(0, transient - baseline * baselineStrength)
      const useFv2 = controls.weightingMode === 'fv2'
      const w = useFv2 ? fv2Weight(i) : aeWeight(i)
      const t = i / Math.max(1, width - 1)
      const weighted = Math.max(0, deBiased * w * beatFactorFor(t) - displayThreshold)

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

  update(audioData) {
    if (!this._mat) return

    const now = performance.now()
    const dt = Math.min(0.1, Math.max(0.001, (now - (this._lastUpdateMs || now)) / 1000))
    this._lastUpdateMs = now

    if (audioData?.isBeat) {
      this._beatPulse = 1
    } else {
      const decay = Math.pow(0.05, dt) // fast decay so beat pulses are short
      this._beatPulse *= decay
    }

    this._mat.uniforms.iTime.value = (now - this._startAt) / 1000

    this._updateAudioTexture()
  }

  _syncResolution() {
    if (!this._mat) return

    // IMPORTANT: This shader uses `gl_FragCoord` (drawing-buffer pixels), so
    // `iResolution` must also be in drawing-buffer pixels. If we feed it CSS
    // pixels while the renderer uses a non-1 pixelRatio, the image will
    // shrink/shift into the corner.
    let w = Math.max(1, window.innerWidth || 1)
    let h = Math.max(1, window.innerHeight || 1)
    try {
      const r = App.renderer
      if (r && typeof r.getDrawingBufferSize === 'function') {
        const v = new THREE.Vector2()
        r.getDrawingBufferSize(v)
        if (Number.isFinite(v.x) && v.x > 0) w = Math.floor(v.x)
        if (Number.isFinite(v.y) && v.y > 0) h = Math.floor(v.y)
      } else if (r && typeof r.getPixelRatio === 'function') {
        const pr = r.getPixelRatio() || 1
        if (Number.isFinite(pr) && pr > 0) {
          w = Math.floor(w * pr)
          h = Math.floor(h * pr)
        }
      }
    } catch (e) {
      // ignore
    }

    this._mat.uniforms.iResolution.value.set(w, h, 1)

    // Keep bar pixel pitch stable on resize.
    if (this._analyser) {
      this._bindAnalyser()
    }
  }

  onPixelRatioChange() {
    this._syncResolution()
  }

  onRendererRecreated() {
    this._syncResolution()
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
