import * as THREE from 'three'
import App from '../../App'

export default class SimpleParticles extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Simple Particles'

    this.params = {
      particleCount: 3000,
      cubeSize: 40,
      velocityScale: 0.1,
      size: 0.5,
    }

    this._positions = null
    this._colors = null
    this._velocities = null

    this._geometry = null
    this._material = null
    this._points = null

    this._lastNow = 0
  }

  init() {
    App.holder.add(this)
    this._createParticles()
  }

  _createParticles() {
    const { particleCount, cubeSize, velocityScale, size } = this.params

    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const velocities = new Float32Array(particleCount * 3)

    const half = cubeSize * 0.5

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * cubeSize
      positions[i + 1] = (Math.random() - 0.5) * cubeSize
      positions[i + 2] = (Math.random() - 0.5) * cubeSize

      velocities[i] = (Math.random() - 0.5) * velocityScale
      velocities[i + 1] = (Math.random() - 0.5) * velocityScale
      velocities[i + 2] = (Math.random() - 0.5) * velocityScale

      // Start dim; will be driven by audio.
      colors[i] = 0
      colors[i + 1] = 0
      colors[i + 2] = 0
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false

    this._positions = positions
    this._colors = colors
    this._velocities = velocities
    this._geometry = geometry
    this._material = material
    this._points = points

    this.add(points)

    // Keep points centered.
    points.position.set(0, 0, 0)

    // Small camera hint: many entities rely on App.camera default; no-op here.
    // Ensure a stable time base.
    this._lastNow = performance.now()

    // Cache for bounds.
    this._half = half
  }

  update(audioData) {
    if (!this._geometry || !this._positions || !this._colors || !this._velocities) return

    const now = performance.now()
    const dtMs = this._lastNow ? (now - this._lastNow) : 16.67
    this._lastNow = now
    const dt = Math.min(50, Math.max(0, dtMs)) / 16.67

    const bass = audioData?.frequencies?.bass ?? App.audioManager?.frequencyData?.low ?? 0
    const mid = audioData?.frequencies?.mid ?? App.audioManager?.frequencyData?.mid ?? 0
    const treble = audioData?.frequencies?.high ?? App.audioManager?.frequencyData?.high ?? 0

    // Similar to the tmp demo: combine bands into a single force.
    const audioForce = bass * 2 + mid * 1.5 + treble
    const t = now * 0.001

    const positions = this._positions
    const colors = this._colors
    const velocities = this._velocities
    const half = this._half || 20

    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += (velocities[i] + Math.sin(t + i) * audioForce * 0.1) * dt
      positions[i + 1] += (velocities[i + 1] + Math.cos(t + i) * audioForce * 0.1) * dt
      positions[i + 2] += (velocities[i + 2] + audioForce * 0.1) * dt

      // Soft wrap to keep the cloud bounded.
      if (positions[i] > half) positions[i] = -half
      else if (positions[i] < -half) positions[i] = half

      if (positions[i + 1] > half) positions[i + 1] = -half
      else if (positions[i + 1] < -half) positions[i + 1] = half

      if (positions[i + 2] > half) positions[i + 2] = -half
      else if (positions[i + 2] < -half) positions[i + 2] = half

      colors[i] = bass
      colors[i + 1] = mid
      colors[i + 2] = treble
    }

    const posAttr = this._geometry.getAttribute('position')
    const colAttr = this._geometry.getAttribute('color')
    if (posAttr) posAttr.needsUpdate = true
    if (colAttr) colAttr.needsUpdate = true

    // Gentle rotation for depth.
    this.rotation.y += (0.002 + treble * 0.01) * dt
    this.rotation.x += (0.001 + mid * 0.008) * dt
  }

  destroy() {
    try {
      if (this._points && this._points.parent) this._points.parent.remove(this._points)
    } catch {
      // ignore
    }

    try {
      this._geometry?.dispose?.()
    } catch {
      // ignore
    }

    try {
      this._material?.dispose?.()
    } catch {
      // ignore
    }

    try {
      if (this.parent) this.parent.remove(this)
    } catch {
      // ignore
    }

    this._positions = null
    this._colors = null
    this._velocities = null
    this._geometry = null
    this._material = null
    this._points = null
  }
}
