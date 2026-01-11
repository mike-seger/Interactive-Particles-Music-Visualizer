/**
 * AudioSphere
 * 3D audio-reactive sphere with spiral particle distribution
 * Based on https://github.com/jeromepl/3D-audio-sphere
 * Low frequencies affect equator particles, high frequencies affect poles
 */

import * as THREE from 'three'
import App from '../../App'

export default class AudioSphere extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'AudioSphere'
    this.particleSystem = null
    this.particles = null
    this.skipFrequencies = 0 // Use full spectrum so poles also react
    this.rotationSpeed = 0.001 // Slow rotation speed
    this.time = 0
  }

  init() {
    App.holder.add(this)

    if (App.camera) {
      App.camera.position.set(0, 100, 270)
      App.camera.lookAt(0, 0, 0)
    }

    // Create particle material with texture
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

    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 4,
      map: texture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    })

    // Create sphere using spiral discretization
    // See https://gist.github.com/aptxwang/628a2b038c6d01ecbc57
    const radius = 100
    const nbPoints = 4000
    const step = 2 / nbPoints
    const turns = 60 // Number of times to turn around the y-axis

    this.particles = new THREE.BufferGeometry()
    const positions = []
    const initialPositions = [] // Store initial positions for scaling

    for (let i = -1; i <= 1; i += step) {
      const phi = Math.acos(i)
      const theta = (2 * turns * phi) % (2 * Math.PI)

      // Note: y and z are flipped since Three.js uses different rotation
      const x = Math.cos(theta) * Math.sin(phi) * radius
      const y = Math.cos(phi) * radius
      const z = Math.sin(theta) * Math.sin(phi) * radius

      positions.push(x, y, z)
      initialPositions.push(x, y, z)
    }

    this.particles.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.particles.setAttribute('initialPosition', new THREE.Float32BufferAttribute(initialPositions, 3))

    // Create particle system
    this.particleSystem = new THREE.Points(this.particles, particleMaterial)
    this.add(this.particleSystem)
  }

  update() {
    if (!App.audioManager || !this.particleSystem) return

    const analyser = App.audioManager.analyserNode
    if (!analyser) return

    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(frequencyData)

    // Get audio reactivity values
    const bass = App.audioManager.frequencyData.low
    const mid = App.audioManager.frequencyData.mid
    const high = App.audioManager.frequencyData.high
    const intensity = (bass + mid + high) / 3

    // Time accumulator for subtle wobble
    this.time += 0.016 * (1 + intensity * 1.5)

    // Slow rotation
    this.rotation.y += this.rotationSpeed + (intensity * 0.002)
    this.rotation.x += this.rotationSpeed * 0.5

    // Audio-reactive particle size
    this.particleSystem.material.size = 3 + intensity * 3

    // Audio-reactive color
    const hue = 180 + mid * 180
    const saturation = 50 + high * 50
    const lightness = 60 + bass * 40
    this.particleSystem.material.color.setHSL(hue / 360, saturation / 100, lightness / 100)

    const positions = this.particles.getAttribute('position')
    const initialPositions = this.particles.getAttribute('initialPosition')
    const vertexCount = positions.count

    // Calculate available frequency range after skipping low frequencies
    const availableFrequencies = Math.max(1, frequencyData.length - this.skipFrequencies)
    const halfVertexCount = Math.floor(vertexCount / 2)

    // Update every single particle by mapping symmetrically from center
    // Particles at center (equator) get low frequencies, particles at edges (poles) get high frequencies
    for (let i = 0; i < vertexCount; i++) {
      // Calculate distance from center (equator is at halfVertexCount)
      const distanceFromCenter = Math.abs(i - halfVertexCount)
      
      // Map distance to frequency index and clamp to available range
      // Use a more inclusive range to ensure poles get data
      const normalizedDistance = Math.min(1.0, distanceFromCenter / halfVertexCount)
      const freqIndex = Math.min(
        frequencyData.length - 1,
        Math.max(this.skipFrequencies, Math.floor(normalizedDistance * availableFrequencies) + this.skipFrequencies)
      )
      
      // Enhanced factor range for more reactivity (1.1 to ~3.0)
      // Ensure minimum factor so all particles are always visible
      const freqValue = frequencyData[freqIndex] || 0
      const wobble = 0.08 * Math.sin(this.time + i * 0.003) // further reduce wobble
      const poleBoost = intensity * 0.35 * (0.5 + 0.5 * normalizedDistance) // softer pole push
      const factor = Math.max(1.1, (freqValue / 256) * 1.0 + 1 + poleBoost + wobble) // ~20% additional reduction

      const idx3 = i * 3
      positions.array[idx3] = initialPositions.array[idx3] * factor
      positions.array[idx3 + 1] = initialPositions.array[idx3 + 1] * factor
      positions.array[idx3 + 2] = initialPositions.array[idx3 + 2] * factor
    }

    positions.needsUpdate = true
  }

  destroy() {
    if (this.particleSystem) {
      this.particleSystem.geometry.dispose()
      this.particleSystem.material.dispose()
      this.remove(this.particleSystem)
    }
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
}
