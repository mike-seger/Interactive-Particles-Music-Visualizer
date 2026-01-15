import App from '../../App'

export default class CircularAudioWave {
  constructor() {
    this.name = 'CircularAudioWave'

    // Overlay-canvas visualizer
    this.rendersSelf = true
    this.canvas = null
    this.ctx = null
    this._dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))

    // Audio
    this.analyser = null
    this._fft = null

    // Wave parameters
    this.points = 361
    this.baseRadius = 140
    this.minRadius = 100
    this.maxRadius = 240
    this.radiusBoost = 130

    // Visual style
    this.background = '#000'
    this.fadeAlpha = 0.18 // trails
    this.lineWidth = 2.25
    this.glow = 16
    this.edgePadding = 20

    // Motion/state
    this._t = 0
    this._lastMaxRadius = this.minRadius
    this._maxDecayPerFrame = 1.6

    // Beat-ish pulse
    this._pulse = 0

    this._onResize = () => this._resizeCanvas()
  }

  init() {
    this._mountCanvas()

    if (App.audioManager?.analyserNode) {
      this.analyser = App.audioManager.analyserNode
      this._fft = new Uint8Array(this.analyser.frequencyBinCount)
    }

    window.addEventListener('resize', this._onResize)
  }

  update(audioData) {
    if (!this.ctx || !this.canvas) return

    // Keep analyser binding resilient to source switches.
    if (!this.analyser && App.audioManager?.analyserNode) {
      this.analyser = App.audioManager.analyserNode
      this._fft = new Uint8Array(this.analyser.frequencyBinCount)
    }

    const isPlaying = !!App.audioManager?.isPlaying || !!App.audioManager?.isUsingMicrophone

    if (this.analyser && this._fft && isPlaying) {
      this.analyser.getByteFrequencyData(this._fft)
    }

    const bass = audioData?.frequencies?.bass ?? 0
    const mid = audioData?.frequencies?.mid ?? 0
    const high = audioData?.frequencies?.high ?? 0
    const energy = (bass * 0.5 + mid * 0.35 + high * 0.15)

    // Pulse: quick attack, slower decay.
    const targetPulse = Math.min(1, bass * 1.6)
    this._pulse = Math.max(targetPulse, this._pulse * 0.9)

    // Motion is gated when audio is inactive.
    if (isPlaying && energy > 0.001) {
      this._t += 0.012 + energy * 0.06
    }

    this._draw(energy, bass)
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

    this._resizeCanvas()
  }

  _resizeCanvas() {
    if (!this.canvas || !this.ctx) return

    this._dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const w = Math.floor(window.innerWidth * this._dpr)
    const h = Math.floor(window.innerHeight * this._dpr)

    this.canvas.width = w
    this.canvas.height = h

    // Base radius scales with viewport so it feels similar across screens.
    const minDim = Math.min(w, h) / this._dpr
    const maxUsable = (minDim / 2) - this.edgePadding

    this.baseRadius = Math.max(90, Math.min(180, maxUsable * 0.55))
    this.minRadius = Math.max(60, this.baseRadius * 0.7)
    this.maxRadius = Math.max(this.minRadius + 30, Math.min(320, maxUsable))

    // Clear fully on resize.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, w, h)
  }

  _draw(energy, bass) {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height

    // Fade to create trails.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(0, 0, 0, ${this.fadeAlpha})`
    ctx.fillRect(0, 0, w, h)

    const cx = w * 0.5
    const cy = h * 0.5

    // Compute radii for each degree (0..360) by sampling FFT.
    const radii = this._computeRadii()

    // Track an outer "max ring" that decays slowly.
    const currentMax = radii.max
    if (currentMax > this._lastMaxRadius) {
      this._lastMaxRadius = currentMax + 3
    } else {
      this._lastMaxRadius = Math.max(this.minRadius, this._lastMaxRadius - this._maxDecayPerFrame)
    }

    // Colors: gradient similar vibe (pink -> indigo) but computed locally.
    const hueA = 320
    const hueB = 225
    const sat = 92
    const light = 58

    // Main wave
    ctx.save()
    ctx.translate(cx, cy)

    const grad = ctx.createLinearGradient(-this.baseRadius, 0, this.baseRadius, 0)
    grad.addColorStop(0.0, `hsla(${hueA}, ${sat}%, ${light}%, 0.95)`) 
    grad.addColorStop(1.0, `hsla(${hueB}, ${sat}%, ${light}%, 0.95)`) 

    ctx.lineWidth = this.lineWidth * this._dpr
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = grad
    ctx.shadowBlur = this.glow * this._dpr
    ctx.shadowColor = `hsla(${Math.round(hueB + (hueA - hueB) * 0.5)}, ${sat}%, ${light}%, 0.9)`

    ctx.beginPath()
    for (let i = 0; i < this.points; i++) {
      const a = (i / (this.points - 1)) * Math.PI * 2
      const r = radii.values[i]
      const x = Math.cos(a) * r * this._dpr
      const y = Math.sin(a) * r * this._dpr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Outer max ring
    ctx.shadowBlur = 0
    ctx.globalAlpha = 0.35
    ctx.strokeStyle = `hsla(${hueB}, ${sat}%, ${light}%, 0.9)`
    ctx.lineWidth = 1.25 * this._dpr
    ctx.beginPath()
    ctx.arc(0, 0, this._lastMaxRadius * this._dpr, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1

    // Center pulse (subtle)
    const pulseR = (18 + this._pulse * 46) * this._dpr
    const pulseAlpha = Math.min(0.9, 0.15 + this._pulse * 0.6)
    const pulseHue = hueB + (hueA - hueB) * (0.35 + bass * 0.5)

    const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, pulseR)
    radial.addColorStop(0, `hsla(${pulseHue}, 90%, 70%, ${pulseAlpha})`)
    radial.addColorStop(1, `hsla(${pulseHue}, 90%, 70%, 0)`)

    ctx.fillStyle = radial
    ctx.beginPath()
    ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()

    // Tiny HUD-like vignette when energy is high (adds depth).
    if (energy > 0.02) {
      ctx.globalCompositeOperation = 'screen'
      ctx.globalAlpha = Math.min(0.15, energy * 0.25)
      ctx.fillStyle = `hsla(${hueA}, 80%, 55%, 1)`
      ctx.fillRect(0, 0, w, 2 * this._dpr)
      ctx.fillRect(0, h - 2 * this._dpr, w, 2 * this._dpr)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }

  _computeRadii() {
    const values = new Array(this.points)

    const fft = this._fft
    const fftLen = fft ? fft.length : 0

    // Use up to the first ~1/2 of FFT bins (higher bins get noisy)
    const maxBin = Math.max(8, Math.floor(fftLen * 0.55))

    let maxR = this.minRadius

    for (let i = 0; i < this.points; i++) {
      // Map 0..360 points -> 0..maxBin bins
      const t = i / (this.points - 1)
      const binF = t * (maxBin - 1)
      const bin0 = Math.floor(binF)
      const bin1 = Math.min(maxBin - 1, bin0 + 1)
      const frac = binF - bin0

      const v0 = fftLen ? fft[bin0] : 0
      const v1 = fftLen ? fft[bin1] : 0
      const v = v0 + (v1 - v0) * frac

      // Normalize 0..255 -> 0..1, then shape it for nicer mid response.
      const n = (v / 255)
      const shaped = Math.pow(n, 0.75)

      // Add a little smooth angular wobble so it feels alive.
      const wobble = 1 + 0.08 * Math.sin(this._t + t * Math.PI * 6)

      const r = this.baseRadius + shaped * this.radiusBoost * wobble
      const clamped = Math.max(this.minRadius, Math.min(this.maxRadius, r))

      values[i] = clamped
      if (clamped > maxR) maxR = clamped
    }

    // Ensure closure is smooth
    values[this.points - 1] = values[0]

    return { values, max: maxR }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }

    this.canvas = null
    this.ctx = null
    this.analyser = null
    this._fft = null
  }
}
