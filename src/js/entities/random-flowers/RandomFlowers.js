import App from '../../App'

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpColor(a, b, t) {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t)
  }
}

function rgbToCss({ r, g, b }, alpha = 1) {
  const rr = Math.max(0, Math.min(255, Math.round(r)))
  const gg = Math.max(0, Math.min(255, Math.round(g)))
  const bb = Math.max(0, Math.min(255, Math.round(b)))
  return `rgba(${rr}, ${gg}, ${bb}, ${alpha})`
}

function scaleRgb(c, s) {
  return {
    r: c.r * s,
    g: c.g * s,
    b: c.b * s
  }
}

function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

function randomInt(min, maxInclusive) {
  return Math.floor(randomRange(min, maxInclusive + 1))
}

function randomColor() {
  // Slightly biased toward pleasing brights
  const hue = Math.random()
  const sat = randomRange(0.65, 0.95)
  const light = randomRange(0.45, 0.65)

  // HSL -> RGB
  const h = hue
  const s = sat
  const l = light

  const hue2rgb = (p, q, tt) => {
    let t = tt
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  let r
  let g
  let b
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }

  return { r: r * 255, g: g * 255, b: b * 255 }
}

function generateFlower(ringCount) {
  const rings = []
  for (let i = 0; i < ringCount; i++) {
    const t = (i + 1) / ringCount
    // Outer rings are larger, inner rings are smaller.
    const radius = t

    rings.push({
      radius,
      color: randomColor(),
      waveAmp: randomRange(0.04, 0.11),
      waveFreq: randomInt(5, 18),
      phaseSpeed: randomRange(0.25, 1.1),
      audioGain: randomRange(0.35, 0.9)
    })
  }
  // Draw outer-to-inner (like a flower stack)
  rings.sort((a, b) => b.radius - a.radius)
  return { rings }
}

export default class RandomFlowers {
  constructor() {
    this.name = 'Random Flowers'

    // Canvas overlay renderer
    this.rendersSelf = true

    this.canvas = null
    this.ctx = null

    this.morphBeats = 16
    this.ringCount = 8

    // Stronger motion defaults (user request: much more pumping)
    this.pumpStrength = 1.35
    this.wobbleStrength = 2.4
    this.beatKickStrength = 0.55
    this._beatKick = 0

    // Keep expansion inside viewport
    this.edgePadding = 22

    // Motion gating so silence stays still
    this._volume = 0

    // Bass transient tracking (used only to decide if we apply the beat-kick pulse)
    this._lowFast = 0
    this._lowSlow = 0
    this._lowTransient = 0
    this._lowEnergy = 0

    this._from = generateFlower(this.ringCount)
    this._to = generateFlower(this.ringCount)

    this._beatIndex = 0
    this._lastBeatAt = performance.now()

    this._phase = 0
    this._lastFrameAt = performance.now()

    this._freqData = null
  }

  init() {
    this._mountCanvas()
    this._resize()

    // Ensure a clean black stage.
    if (App.renderer) {
      App.renderer.setClearColor(0x000000, 1)
    }

    // Centered framing.
    if (App.camera) {
      App.camera.position.set(0, 0, 12)
      App.camera.lookAt(0, 0, 0)
    }

    this._onResize = () => this._resize()
    window.addEventListener('resize', this._onResize)

    // Start immediately with a new morph cycle.
    this._beatIndex = 0
    this._lastBeatAt = performance.now()
  }

  _mountCanvas() {
    if (this.canvas) return

    const canvas = document.createElement('canvas')
    canvas.style.position = 'fixed'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '1'

    const host = document.querySelector('.content') || document.body
    host.appendChild(canvas)

    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  _resize() {
    if (!this.canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.floor(window.innerWidth * dpr)
    this.canvas.height = Math.floor(window.innerHeight * dpr)

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  _ensureFreqArray(length) {
    if (!this._freqData || this._freqData.length !== length) {
      this._freqData = new Uint8Array(length)
    }
    return this._freqData
  }

  _readSpectrum() {
    const analyser = App.audioManager?.analyserNode
    if (analyser) {
      const arr = this._ensureFreqArray(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(arr)
      return arr
    }

    // Bridge/passive mode fallback
    const audioAnalyser = App.audioManager?.audioAnalyser
    if (audioAnalyser?.getFrequencyData) {
      const data = audioAnalyser.getFrequencyData()
      if (data && data.length) {
        const arr = this._ensureFreqArray(data.length)
        arr.set(data.subarray(0, arr.length))
        return arr
      }
    }

    return null
  }

  _sampleSpectrum(spectrum, norm) {
    if (!spectrum || !spectrum.length) return 0
    const idx = Math.max(0, Math.min(spectrum.length - 1, Math.floor(norm * (spectrum.length - 1))))
    return (spectrum[idx] || 0) / 255
  }

  _estimateLowEnergy(spectrum) {
    if (!spectrum || !spectrum.length) return 0
    // Average the lowest bins (bass region). Keep it small for speed.
    const end = Math.max(1, Math.floor(spectrum.length * 0.08))
    let sum = 0
    for (let i = 0; i < end; i++) sum += spectrum[i]
    return (sum / end) / 255
  }

  onBPMBeat() {
    const am = App.audioManager
    const isLive = !!(am?.isUsingMicrophone || am?.isPlaying)
    if (!isLive) return

    this._beatIndex++
    this._lastBeatAt = performance.now()

    // Only apply the bass "kick" pulse if a bass transient is present.
    // This prevents pulsing in intros/white-noise sections while still allowing
    // continuous wobble/rotation from other frequencies.
    this._beatKick = this._lowTransient > 0.035 ? 1 : 0

    if (this._beatIndex >= this.morphBeats) {
      this._beatIndex = 0
      this._from = this._to
      this._to = generateFlower(this.ringCount)
    }
  }

  update(_audioData) {
    if (!this.ctx || !this.canvas) return

    const now = performance.now()
    const dt = Math.min(0.05, (now - this._lastFrameAt) / 1000)
    this._lastFrameAt = now

    const am = App.audioManager
    const isLive = !!(am?.isUsingMicrophone || am?.isPlaying)

    const spectrum = this._readSpectrum()

    // Overall energy (used for per-ring detailing; NOT used for pumping gate)
    const fd = am?.frequencyData
    const globalEnergy = fd ? (fd.low + fd.mid + fd.high) / 3 : 0

    // Track bass transient for beat-kick gating.
    // Use AudioManager's low band when available; fall back to spectrum sampling.
    this._lowEnergy = isLive ? (fd?.low ?? this._estimateLowEnergy(spectrum)) : 0
    const lowFastK = 1 - Math.pow(0.0004, dt)
    const lowSlowK = 1 - Math.pow(0.02, dt)
    this._lowFast = lerp(this._lowFast, this._lowEnergy, lowFastK)
    this._lowSlow = lerp(this._lowSlow, this._lowEnergy, lowSlowK)
    this._lowTransient = Math.max(0, this._lowFast - this._lowSlow - 0.012)

    // Smooth overall volume so motion scales naturally with loudness.
    const targetVol = isLive ? clamp01(globalEnergy) : 0
    const rise = 1 - Math.pow(0.0008, dt)
    const fall = 1 - Math.pow(0.06, dt)
    const k = targetVol > this._volume ? rise : fall
    this._volume = lerp(this._volume, targetVol, k)

    // Dead-zone near silence: no rotation/oscillation when quiet.
    const motion = isLive ? clamp01((this._volume - 0.03) / 0.97) : 0

    // Prevent stale beat-kick from affecting visuals when not live.
    if (!isLive) this._beatKick = 0

    const beatIntervalMs = App.bpmManager?.interval || 600
    const beatFrac = clamp01(((now - this._lastBeatAt) / beatIntervalMs) * motion)
    const morphT = clamp01((this._beatIndex + beatFrac) / this.morphBeats)

    // Freeze phase at silence so the flower doesn't animate.
    this._phase += dt * motion

    // Decay beat kick smoothly over time
    const kickDecay = Math.pow(0.06, dt) // ~fast decay, framerate independent
    this._beatKick *= kickDecay

    const w = window.innerWidth
    const h = window.innerHeight

    // Maximum radius that remains fully visible (in CSS pixels)
    const maxR = Math.max(0, Math.min(w, h) * 0.5 - this.edgePadding)

    // Black background
    this.ctx.clearRect(0, 0, w, h)
    this.ctx.fillStyle = 'rgb(0, 0, 0)'
    this.ctx.fillRect(0, 0, w, h)

    const size = Math.min(w, h) * 0.38

    this.ctx.save()
    this.ctx.translate(w * 0.5, h * 0.5)

    // Gentle drift
    const drift = 0.02
    this.ctx.rotate(Math.sin(now * 0.00008) * drift * motion)

    this.ctx.globalCompositeOperation = 'lighter'
    this.ctx.lineJoin = 'round'
    this.ctx.lineCap = 'round'

    const ringCount = this.ringCount
    for (let i = 0; i < ringCount; i++) {
      const a = this._from.rings[i]
      const b = this._to.rings[i]
      if (!a || !b) continue

      // Map each ring to a different part of the spectrum.
      // Outer rings lean lower, inner rings lean higher.
      const ringNorm = 1 - i / Math.max(1, ringCount - 1)
      const audio = this._sampleSpectrum(spectrum, ringNorm)

      const radius = lerp(a.radius, b.radius, morphT)
      const waveAmp = lerp(a.waveAmp, b.waveAmp, morphT)
      const waveFreq = Math.round(lerp(a.waveFreq, b.waveFreq, morphT))
      const phaseSpeed = lerp(a.phaseSpeed, b.phaseSpeed, morphT)
      const audioGain = lerp(a.audioGain, b.audioGain, morphT)

      const color = lerpColor(a.color, b.color, morphT)

      // Inner rings can blow out to white under 'lighter' blending;
      // dampen their brightness and opacity progressively.
      const innerT = ringCount > 1 ? i / (ringCount - 1) : 1
      const innerEase = innerT * innerT
      const brightness = lerp(1, 0.62, innerEase)
      const innerAlphaScale = lerp(1, 0.58, innerEase)
      const shadedColor = scaleRgb(color, brightness)

      const baseR = radius * size
      const energy = Math.max(audio, globalEnergy * 0.85)
      const pump = (energy * 0.95 * audioGain + this._beatKick * this.beatKickStrength * motion)
      const audioR = baseR * (1 + pump * this.pumpStrength)

      // More points => smoother, rounder petal tips.
      const angleStep = (Math.PI * 2) / 420

      this.ctx.beginPath()
      for (let ang = 0; ang <= Math.PI * 2 + angleStep * 0.5; ang += angleStep) {
        const wav = Math.sin(ang * waveFreq + this._phase * phaseSpeed)
        let wobble = (waveAmp * size) * (0.35 + energy * 2.1) * this.wobbleStrength

        // Scale down this ring if it would expand beyond the viewport.
        // This preserves the shape (relative wobble) while keeping it visible.
        const maxPossible = audioR + wobble
        if (maxPossible > maxR && maxPossible > 0) {
          const s = maxR / maxPossible
          wobble *= s
          // Scale center radius too so max stays bounded.
          // (Using a scaled copy keeps the math stable inside the loop.)
          const r0 = audioR * s
          const r = r0 + wav * wobble
          const x = r * Math.cos(ang)
          const y = r * Math.sin(ang)
          if (ang === 0) this.ctx.moveTo(x, y)
          else this.ctx.lineTo(x, y)
          continue
        }

        const r = audioR + wav * wobble
        const x = r * Math.cos(ang)
        const y = r * Math.sin(ang)
        if (ang === 0) this.ctx.moveTo(x, y)
        else this.ctx.lineTo(x, y)
      }

      const alpha = (0.22 + audio * 0.22) * innerAlphaScale
      this.ctx.fillStyle = rgbToCss(shadedColor, alpha)
      this.ctx.fill()

      // Thread-like outline
      this.ctx.lineWidth = 1
      this.ctx.strokeStyle = rgbToCss(shadedColor, (0.18 + audio * 0.25) * innerAlphaScale)
      this.ctx.stroke()
    }

    this.ctx.restore()
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }

    this.canvas = null
    this.ctx = null
    this._freqData = null
  }
}
