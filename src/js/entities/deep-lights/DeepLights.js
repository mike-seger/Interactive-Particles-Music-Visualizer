/**
 * DeepLights
 * Connected particle network with physics simulation
 * From br-g/Deep-Audio-Visualization using Particulate.js
 * Original by Jay Weeks - https://particulatejs.org
 */

import * as THREE from 'three'
import App from '../../App'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

// Minimal Particulate.js physics library (embedded)
const Particulate = (() => {
  const Vec3 = {
    distance(b0, ai, bi) {
      const aix = ai * 3, aiy = aix + 1, aiz = aix + 2
      const bix = bi * 3, biy = bix + 1, biz = bix + 2
      const dx = b0[aix] - b0[bix]
      const dy = b0[aiy] - b0[biy]
      const dz = b0[aiz] - b0[biz]
      return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
  }
  
  class Constraint {
    constructor(size, itemSize, indexOffset) {
      indexOffset = indexOffset || 0
      this.indices = new Uint16Array(size + indexOffset)
      this._count = size / itemSize
      this._itemSize = itemSize
      this._offset = indexOffset
    }
    
    setIndices(...args) {
      const offset = this._offset
      const inx = args[0].length ? args[0] : args
      const ii = this.indices
      for (let i = 0; i < inx.length; i++) {
        ii[i + offset] = inx[i]
      }
    }
  }
  
  class DistanceConstraint extends Constraint {
    constructor(distance, a, b) {
      const size = a.length || 2
      const min = distance.length ? distance[0] : distance
      const max = distance.length ? distance[1] : distance
      super(size, 2)
      this._min2 = min * min
      this._max2 = max * max
      this.setIndices(a, b)
    }
    
    setDistance(min, max) {
      this._min2 = min * min
      this._max2 = (max !== undefined ? max : min) * (max !== undefined ? max : min)
    }
    
    applyConstraint(index, p0, p1) {
      const ii = this.indices
      const ai = ii[index], bi = ii[index + 1]
      const ax = ai * 3, ay = ax + 1, az = ax + 2
      const bx = bi * 3, by = bx + 1, bz = bx + 2
      
      let dx = p0[bx] - p0[ax]
      let dy = p0[by] - p0[ay]
      let dz = p0[bz] - p0[az]
      
      if (!(dx || dy || dz)) {
        dx = dy = dz = 0.1
      }
      
      const dist2 = dx * dx + dy * dy + dz * dz
      const min2 = this._min2
      const max2 = this._max2
      
      if (dist2 < max2 && dist2 > min2) return
      
      const target2 = dist2 < min2 ? min2 : max2
      const diff = target2 / (dist2 + target2)
      const aDiff = diff - 0.5
      const bDiff = diff - 0.5
      
      p0[ax] -= dx * aDiff
      p0[ay] -= dy * aDiff
      p0[az] -= dz * aDiff
      
      p0[bx] += dx * bDiff
      p0[by] += dy * bDiff
      p0[bz] += dz * bDiff
    }
    
    static create(...args) {
      return new DistanceConstraint(...args)
    }
  }
  
  class Force {
    constructor(vector, opts) {
      opts = opts || {}
      this.vector = new Float32Array(3)
      if (opts.type) this.type = opts.type
      if (vector != null) this.set(vector)
    }
    
    set(x, y, z) {
      if (x.length) {
        this.vector[0] = x[0]
        this.vector[1] = x[1]
        this.vector[2] = x[2]
      } else {
        this.vector[0] = x
        this.vector[1] = y
        this.vector[2] = z
      }
    }
    
    static ATTRACTOR = 0
    static REPULSOR = 1
    static ATTRACTOR_REPULSOR = 2
  }
  
  class PointForce extends Force {
    constructor(position, opts) {
      super(position, opts)
      opts = opts || {}
      this.intensity = opts.intensity || 0.05
      this._radius2 = (opts.radius || 0) * (opts.radius || 0)
    }
    
    applyForce(ix, f0, p0, p1) {
      const v0 = this.vector
      const iy = ix + 1
      const iz = ix + 2
      
      const dx = p0[ix] - v0[0]
      const dy = p0[iy] - v0[1]
      const dz = p0[iz] - v0[2]
      
      const dist = dx * dx + dy * dy + dz * dz
      const diff = dist - this._radius2
      let isActive, scale
      
      switch (this.type) {
        case Force.ATTRACTOR:
          isActive = dist > 0 && diff > 0
          break
        case Force.REPULSOR:
          isActive = dist > 0 && diff < 0
          break
        case Force.ATTRACTOR_REPULSOR:
          isActive = dx || dy || dz
          break
      }
      
      if (isActive) {
        scale = diff / dist * this.intensity
        f0[ix] -= dx * scale
        f0[iy] -= dy * scale
        f0[iz] -= dz * scale
      }
    }
    
    static create(...args) {
      return new PointForce(...args)
    }
  }
  
  class ParticleSystem {
    constructor(particles, iterations) {
      const length = particles * 3
      const count = particles
      
      this.positions = new Float32Array(length)
      this.positionsPrev = new Float32Array(length)
      this.accumulatedForces = new Float32Array(length)
      this.weights = new Float32Array(count)
      
      for (let i = 0; i < count; i++) {
        this.weights[i] = 1
      }
      
      this._iterations = iterations || 1
      this._count = count
      this._globalConstraints = []
      this._localConstraints = []
      this._pinConstraints = []
      this._forces = []
    }
    
    setPosition(i, x, y, z) {
      const ix = i * 3, iy = ix + 1, iz = ix + 2
      this.positions[ix] = this.positionsPrev[ix] = x
      this.positions[iy] = this.positionsPrev[iy] = y
      this.positions[iz] = this.positionsPrev[iz] = z
    }
    
    setWeights(w) {
      for (let i = 0; i < this.weights.length; i++) {
        this.weights[i] = w
      }
    }
    
    each(iterator, context) {
      context = context || this
      for (let i = 0; i < this._count; i++) {
        iterator.call(context, i, this)
      }
    }
    
    addConstraint(constraint) {
      const buffer = constraint._isGlobal ? this._globalConstraints : this._localConstraints
      buffer.push(constraint)
    }
    
    addForce(force) {
      this._forces.push(force)
    }
    
    integrate(delta) {
      const d2 = delta * delta
      const p0 = this.positions
      const p1 = this.positionsPrev
      const f0 = this.accumulatedForces
      const w0 = this.weights
      
      for (let i = 0; i < this._count; i++) {
        const weight = w0[i]
        const ix = i * 3
        
        for (let j = 0; j < 3; j++) {
          const idx = ix + j
          const pt = p0[idx]
          p0[idx] += pt - p1[idx] + f0[idx] * weight * d2
          p1[idx] = pt
        }
      }
    }
    
    satisfyConstraints() {
      const iterations = this._iterations
      const global = this._globalConstraints
      const local = this._localConstraints
      const pins = this._pinConstraints
      
      for (let i = 0; i < iterations; i++) {
        this.satisfyConstraintGroup(global, this._count, 3)
        this.satisfyConstraintGroup(local)
        if (pins.length) {
          this.satisfyConstraintGroup(pins)
        }
      }
    }
    
    satisfyConstraintGroup(group, count, itemSize) {
      const p0 = this.positions
      const p1 = this.positionsPrev
      const hasUniqueCount = !count
      
      for (let i = 0; i < group.length; i++) {
        const constraint = group[i]
        
        if (hasUniqueCount) {
          count = constraint._count
          itemSize = constraint._itemSize
        }
        
        for (let j = 0; j < count; j++) {
          constraint.applyConstraint(j * itemSize, p0, p1)
        }
      }
    }
    
    accumulateForces(delta) {
      const forces = this._forces
      const f0 = this.accumulatedForces
      const p0 = this.positions
      const p1 = this.positionsPrev
      
      for (let i = 0; i < this._count; i++) {
        const ix = i * 3
        f0[ix] = f0[ix + 1] = f0[ix + 2] = 0
        
        for (let j = 0; j < forces.length; j++) {
          forces[j].applyForce(ix, f0, p0, p1)
        }
      }
    }
    
    tick(delta) {
      this.accumulateForces(delta)
      this.integrate(delta)
      this.satisfyConstraints()
    }
    
    static create(...args) {
      return new ParticleSystem(...args)
    }
  }
  
  // Export
  PointForce.Force = Force
  
  return {
    ParticleSystem,
    DistanceConstraint,
    PointForce,
    Force
  }
})()

export default class DeepLights {
  constructor() {
    this.group = new THREE.Group()
    this.simulation = null
    this.composer = null
    this.visParticles = null
    this.visConnectors = null
    this.bounds = null
    this.distances = null
    this.baseParticleSize = 0.6

    this._colors = null

    // Additional per-particle force to create distributed, audio-driven motion.
    this._audioWaveForce = null

    // Audio response shaping
    this._audioSmoothed = 0
    this._audioPeak = 0
    this._beatKick = 0
    this._lastUpdateMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()

    // Smoothed physics targets (helps avoid “blow-outs” on loud sections)
    this._boundsIntensity = 0.03
    this._boundsRadius = 24.0
    this._tickSpeed = 0.5
  }

  init() {
    // Camera setup
    if (App.camera) {
      App.camera.position.set(0, 50, -40)
      App.camera.lookAt(0, 0, 0)
    }
    
    // Scene fog
    App.scene.fog = new THREE.Fog(0x050505, 1, 200)
    
    // Init physics simulation
    const tris = 1000
    const particles = tris * 3
    const distance = 1.0
    
    this.simulation = Particulate.ParticleSystem.create(particles, 2)
    
    this.bounds = Particulate.PointForce.create([0, 0, 0], {
      type: Particulate.Force.ATTRACTOR_REPULSOR,
      intensity: 0.05,
      radius: 30.0
    })
    
    const linkIndices = []
    const visIndices = []
    
    for (let i = 2; i < particles; i++) {
      const a = i
      const b = a - 1
      const c = a - 2
      linkIndices.push(a, b, b, c, c, a)
      visIndices.push(a)
    }
    
    this.simulation.each((i) => {
      this.simulation.setPosition(i,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10)
    })
    
    this.distances = Particulate.DistanceConstraint.create([distance * 0.5, distance], linkIndices)
    
    this.simulation.addConstraint(this.distances)
    this.simulation.addForce(this.bounds)

    // Audio wave force: pushes particles with a traveling wave so the whole
    // "string" moves (not just one end).
    const particleCount = particles
    this._audioWaveForce = {
      intensity: 0,
      radialIntensity: 0,
      phase: 0,
      waveFreq: 10,
      count: particleCount,
      applyForce(ix, f0, p0) {
        const i = ix / 3
        const t = this.count > 1 ? i / (this.count - 1) : 0

        // Tangential direction around the Y axis (keeps motion "stringy").
        const x = p0[ix]
        const z = p0[ix + 2]
        let tx = -z
        let tz = x
        const len = Math.hypot(tx, tz) || 1
        tx /= len
        tz /= len

        // Radial direction from center in XZ (adds "breathing" expansion/contraction).
        const rLen = Math.hypot(x, z) || 1
        const rx = x / rLen
        const rz = z / rLen

        // Traveling wave (distributed across entire length)
        const w = Math.sin(this.phase + t * this.waveFreq)
        const w2 = Math.cos(this.phase * 1.15 + t * this.waveFreq * 0.85)
        const wR = Math.sin(this.phase * 0.9 - t * this.waveFreq * 0.6)

        const amp = this.intensity
        // `radialIntensity` is a desired displacement fraction of radius (0..0.05).
        // Convert that into a small force scaled by radius so the breathing stays
        // within ~0–5% of the current radius.
        const rTarget = rLen * this.radialIntensity
        f0[ix] += tx * w * amp
        f0[ix + 2] += tz * w * amp
        f0[ix + 1] += w2 * amp * 0.65

        // Radial push/pull (subtle; keeps the structure cohesive)
        f0[ix] += rx * wR * rTarget * 0.02
        f0[ix + 2] += rz * wR * rTarget * 0.02
      }
    }
    this.simulation.addForce(this._audioWaveForce)
    
    // Relax simulation
    for (let i = 0; i < 50; i++) {
      this.simulation.tick(1)
    }
    
    // Create particle visualization
    const vertices = new THREE.BufferAttribute(this.simulation.positions, 3)
    const indices = new THREE.BufferAttribute(new Uint16Array(visIndices), 1)

    // Per-vertex colors so the whole structure can react (not just a uniform tint).
    this._colors = new Float32Array(this.simulation.positions.length)
    const colorsAttr = new THREE.BufferAttribute(this._colors, 3)
    
    // Create particle texture
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const texture = new THREE.CanvasTexture(canvas)
    
    const dots = new THREE.BufferGeometry()
    dots.setAttribute('position', vertices)
    dots.setAttribute('color', colorsAttr)
    
    this.visParticles = new THREE.Points(dots, new THREE.PointsMaterial({
      color: new THREE.Color(0xffffff),
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      map: texture,
      size: this.baseParticleSize,
      opacity: 0.7
    }))
    
    // Connections
    const lines = new THREE.BufferGeometry()
    lines.setAttribute('position', vertices)
    // Share the same color buffer (colors are per-vertex position).
    lines.setAttribute('color', colorsAttr)
    lines.setIndex(indices)
    
    this.visConnectors = new THREE.LineSegments(lines, new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      transparent: true,
      color: new THREE.Color(0xffffff),
      vertexColors: true,
      opacity: 0.7
    }))
    
    this.group.add(this.visParticles)
    this.group.add(this.visConnectors)
    App.holder.add(this.group)
    
    // Post-processing
    this.composer = new EffectComposer(App.renderer)
    const renderPass = new RenderPass(App.scene, App.camera)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      2.0, // strength
      0.4, // radius
      0.85  // threshold
    )
    
    this.composer.addPass(renderPass)
    this.composer.addPass(bloomPass)
  }

  update() {
    if (!App.audioManager || !App.bpmManager) return
    
    const bass = App.audioManager.frequencyData.low
    const mid = App.audioManager.frequencyData.mid
    const high = App.audioManager.frequencyData.high

    // 0..1 base signal
    const intensity = (bass + mid + high) / 3

    // Estimate dt (seconds) for stable decay independent of frame rate.
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    const dt = Math.min(0.05, Math.max(0.001, (nowMs - this._lastUpdateMs) / 1000))
    this._lastUpdateMs = nowMs

    // Boost + contrast (more reactive at lower amplitudes)
    const clamp01 = (v) => Math.min(1, Math.max(0, v))
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
    // Higher gain + slightly stronger curve to bring back punch.
    const boosted = Math.pow(clamp01(intensity * 2.7), 0.55)
    const bassBoost = Math.pow(clamp01(bass * 3.0), 0.52)
    const midBoost = Math.pow(clamp01(mid * 2.7), 0.56)
    const highBoost = Math.pow(clamp01(high * 2.6), 0.6)

    // Smooth + peak-hold so transients pop.
    const smoothAlpha = 1 - Math.pow(0.000001, dt) // faster smoothing (more responsive)
    this._audioSmoothed += (boosted - this._audioSmoothed) * smoothAlpha
    const peakDecay = Math.pow(0.15, dt) // decay over ~1s
    this._audioPeak = Math.max(boosted, this._audioPeak * peakDecay)

    // Beat kick (short pulse)
    if (App.bpmManager.beatActive) this._beatKick = 1
    const kickDecay = Math.pow(0.02, dt) // decay quickly
    this._beatKick *= kickDecay

    // Amplify combined response, then apply a gentle curve so small signals still move.
    const combined = clamp01((this._audioSmoothed * 0.9 + this._audioPeak * 0.75 + this._beatKick * 0.45) * 1.25)
    const react = Math.pow(combined, 0.7)
    
    // Audio-reactive colors with more range
    const hueBase = (200 + midBoost * 260 + react * 90 + nowMs * 0.02) % 360
    const hueParticles = hueBase
    const hueLines = (hueBase + 70 + highBoost * 60) % 360
    const saturation = clamp(60 + highBoost * 40, 55, 100)
    const lightness = clamp(28 + bassBoost * 42 + react * 14, 22, 80)

    // Update per-vertex colors to make the whole structure reactive.
    if (this._colors && this.visParticles?.geometry?.getAttribute('color')) {
      const colorTmp = this._colorTmp || (this._colorTmp = new THREE.Color())
      const count = this.simulation ? this.simulation.positions.length / 3 : 0
      const time = nowMs * 0.001

      // Normalized HSL helpers
      const satN = clamp(saturation / 100, 0, 1)
      const lightBaseN = clamp(lightness / 100, 0, 1)
      const lightLineN = clamp((clamp(lightness + 6, 22, 85)) / 100, 0, 1)

      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0

        // Traveling hue wave + audio wobble along the chain.
        const wave = Math.sin(time * (1.3 + react * 1.6) + t * (10 + react * 18))
        const wobble = wave * (25 + react * 70) + this._beatKick * 35

        // Interpolate between particle/line palettes across the length.
        const h = ((hueParticles * (1 - t) + hueLines * t) + wobble + t * 120) % 360
        const l = clamp(lightBaseN + wave * 0.08 * react, 0.18, 0.92)

        colorTmp.setHSL((h < 0 ? h + 360 : h) / 360, satN, l)
        const idx = i * 3
        this._colors[idx] = colorTmp.r
        this._colors[idx + 1] = colorTmp.g
        this._colors[idx + 2] = colorTmp.b
      }

      this.visParticles.geometry.getAttribute('color').needsUpdate = true
      this.visConnectors.geometry.getAttribute('color').needsUpdate = true
    }
    
    // Audio-reactive opacity and size with stronger response
    // Keep a visible floor so the structure never “disappears” on hot sections.
    this.visConnectors.material.opacity = clamp(0.22 + react * 0.72, 0.22, 0.95)
    this.visParticles.material.opacity = clamp(0.30 + react * 0.62, 0.30, 0.95)
    this.visParticles.material.size = this.baseParticleSize * (0.80 + react * 1.45)
    
    // Audio-reactive distance constraints with more variation
    const edgesDistance = clamp(0.70 + midBoost * 1.75 + this._beatKick * 0.35, 0.70, 2.35)
    this.distances.setDistance(edgesDistance * 0.38, edgesDistance * 1.30)
    
    // Audio-reactive particle weights (affects physics movement)
    const particlesWeight = clamp(0.70 + highBoost * 1.35 + react * 0.35, 0.70, 2.1)
    this.simulation.setWeights(particlesWeight)
    
    // Audio-reactive attractor/repulsor force
    const targetBoundsIntensity = clamp(0.03 + bassBoost * 0.14 + this._beatKick * 0.07, 0.02, 0.16)
    const targetBoundsRadius = clamp(22.0 + midBoost * 18.0 + react * 4.0, 20.0, 40.0)
    // Faster interpolation so it “follows” the music.
    const physAlpha = 1 - Math.pow(0.0005, dt)
    this._boundsIntensity += (targetBoundsIntensity - this._boundsIntensity) * physAlpha
    this._boundsRadius += (targetBoundsRadius - this._boundsRadius) * physAlpha
    this.bounds.intensity = this._boundsIntensity
    this.bounds.radius = this._boundsRadius
    
    // Audio-reactive physics speed
    const targetTickSpeed = clamp(0.35 + react * 1.25 + this._beatKick * 0.35, 0.25, 1.55)
    this._tickSpeed += (targetTickSpeed - this._tickSpeed) * physAlpha

    // Drive the distributed wave force from audio so motion is visible across
    // the entire string, not just one side.
    if (this._audioWaveForce) {
      this._audioWaveForce.phase += dt * (1.8 + react * 4.2 + this._beatKick * 6)
      this._audioWaveForce.waveFreq = 8 + react * 22
      // Keep force small (integration uses delta^2); scale with audio.
      this._audioWaveForce.intensity = clamp(0.002 + react * 0.018 + bassBoost * 0.01 + this._beatKick * 0.02, 0.001, 0.045)
      // Bass-driven breathing: 0..5% of radius
      this._audioWaveForce.radialIntensity = clamp(bassBoost * 0.05 + this._beatKick * 0.02, 0.0, 0.05)
    }

    this.simulation.tick(this._tickSpeed)
    
    // Audio-reactive fog density
    if (App.scene.fog) {
      App.scene.fog.near = 0.8 - highBoost * 0.55
      App.scene.fog.far = 165 + bassBoost * 55 + react * 10
    }
    
    // Update geometry
    this.visParticles.geometry.getAttribute('position').needsUpdate = true
    
    // Render with bloom
    if (this.composer) {
      this.composer.render()
    }
  }

  destroy() {
    if (App.scene.fog) {
      App.scene.fog = null
    }
    
    if (this.group) {
      this.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose()
          obj.material.dispose()
        }
      })
    }
    
    if (this.composer) {
      this.composer.dispose()
    }
  }
}
