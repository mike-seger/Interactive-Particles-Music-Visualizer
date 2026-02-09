import * as THREE from 'three'
import App from '../../App'

export default class SimpleParticles extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Simple Particles'

    this.params = {
      particleCount: 3000,
      cloudRadius: 31,
      size: 0.5,
      orbitSpeed: 0.045,
    }

    this._orbits = null
    this._positions = null
    this._colors = null
    this._geometry = null
    this._material = null
    this._points = null
  }

  init() {
    App.holder.add(this)
    this._createParticles()
  }

  _createParticles() {
    const { particleCount, cloudRadius, size } = this.params
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    const orbits = new Float32Array(particleCount * 6)

    for (let i = 0; i < particleCount; i++) {
      const minRadius = cloudRadius * 0.3
      const radius = minRadius + Math.pow(Math.random(), 0.4) * (cloudRadius - minRadius)
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const speedMul = 0.5 + Math.random() * 1.0
      const radialPhase = Math.random() * Math.PI * 2  // random phase for radial oscillation

      orbits[i * 6] = radius
      orbits[i * 6 + 1] = theta
      orbits[i * 6 + 2] = phi
      orbits[i * 6 + 3] = speedMul
      orbits[i * 6 + 4] = Math.cos(phi) * radius  // baseY
      orbits[i * 6 + 5] = radialPhase

      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius
      positions[i * 3 + 1] = Math.cos(phi) * radius
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius

      colors[i * 3] = 0.3
      colors[i * 3 + 1] = 0.35
      colors[i * 3 + 2] = 0.45
    }

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
    const circleTexture = new THREE.CanvasTexture(canvas)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size,
      map: circleTexture,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })

    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false

    this._orbits = orbits
    this._positions = positions
    this._colors = colors
    this._geometry = geometry
    this._material = material
    this._points = points

    this.add(points)
    points.position.set(0, 0, 0)

    App.camera.position.set(0, 0, 28)
    App.camera.lookAt(0, 0, 0)
  }

  update(audioData) {
    if (!this._geometry || !this._positions || !this._orbits) return

    const bass = audioData?.frequencies?.bass ?? App.audioManager?.frequencyData?.low ?? 0
    const mid = audioData?.frequencies?.mid ?? App.audioManager?.frequencyData?.mid ?? 0
    const treble = audioData?.frequencies?.high ?? App.audioManager?.frequencyData?.high ?? 0

    const t = performance.now() * 0.001
    const { orbitSpeed, particleCount, cloudRadius } = this.params
    const orbits = this._orbits
    const positions = this._positions
    const colors = this._colors

    const audioLift = (bass * 2.0 + mid * 1.0 + treble * 0.5) * 1.5

    for (let i = 0; i < particleCount; i++) {
      const baseRadius = orbits[i * 6]
      const baseAngle = orbits[i * 6 + 1]
      const phi = orbits[i * 6 + 2]
      const speedMul = orbits[i * 6 + 3]
      const baseY = orbits[i * 6 + 4]
      const radialPhase = orbits[i * 6 + 5]

      const angle = baseAngle + t * orbitSpeed * speedMul

      // Radial oscillation: +/-20% of base radius, each particle has its own phase
      const radius = baseRadius * (1.0 + 0.5 * Math.sin(t * 0.15 + radialPhase))

      // Orbit on a tilted plane based on phi — preserves spherical shape
      const sinPhi = Math.sin(phi)
      positions[i * 3] = Math.cos(angle) * sinPhi * radius
      positions[i * 3 + 2] = Math.sin(angle) * sinPhi * radius

      const radiusFraction = baseRadius / cloudRadius
      positions[i * 3 + 1] = Math.cos(phi) * radius + audioLift * radiusFraction * Math.sin(angle * 2.0)

      const brightness = 0.4 + (bass + mid + treble) * 0.5
      colors[i * 3] = brightness * 0.51      // R - steelblue: 70/255
      colors[i * 3 + 1] = brightness * 0.7  // G - steelblue: 130/255
      colors[i * 3 + 2] = brightness * 1.0   // B - steelblue: 180/255
    }

    this._geometry.getAttribute('position').needsUpdate = true
    this._geometry.getAttribute('color').needsUpdate = true
  }

  destroy() {
    try {
      if (this._points && this._points.parent) this._points.parent.remove(this._points)
    } catch { /* ignore */ }
    try { this._geometry?.dispose?.() } catch { /* ignore */ }
    try { this._material?.dispose?.() } catch { /* ignore */ }
    try { if (this.parent) this.parent.remove(this) } catch { /* ignore */ }

    this._orbits = null
    this._positions = null
    this._colors = null
    this._geometry = null
    this._material = null
    this._points = null
  }
}
