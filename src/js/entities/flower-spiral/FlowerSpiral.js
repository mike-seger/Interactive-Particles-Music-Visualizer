import * as THREE from 'three'
import App from '../../App'

// Inspired by https://github.com/soniaboller/audible-visuals (Apache-2.0)
// This implementation is a Three.js Points-based re-creation for this codebase.

export default class FlowerSpiral extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'FlowerSpiral'

    this.numParticles = 1400

    // Visual params
    this.intensity = 0.25
    this.baseRadius = 2.8
    this.petalsAmplitude = 1.6
    this.petals = 6
    this.turns = 6

    this.time = 0
  }

  init() {
    App.holder.add(this)

    const circleTexture = this.createCircleTexture()

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(this.numParticles * 3)
    const colors = new Float32Array(this.numParticles * 3)
    const sizes = new Float32Array(this.numParticles)

    for (let i = 0; i < this.numParticles; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0

      colors[i * 3] = 1
      colors[i * 3 + 1] = 1
      colors[i * 3 + 2] = 1

      sizes[i] = 0.35
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

    const material = new THREE.PointsMaterial({
      size: 1.0,
      map: circleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.particleSystem = new THREE.Points(geometry, material)
    this.add(this.particleSystem)

    App.camera.position.set(0, 0, 30)
    App.camera.lookAt(0, 0, 0)
  }

  createCircleTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)

    return new THREE.CanvasTexture(canvas)
  }

  update(_deltaTime) {
    const audioManager = App.audioManager
    if (!audioManager?.analyserNode) return
    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) return

    this.time += 0.012

    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const freqData = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(freqData)

    const timeDomainData = new Uint8Array(audioManager.analyserNode.fftSize)
    audioManager.analyserNode.getByteTimeDomainData(timeDomainData)

    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array

    const maxTheta = Math.PI * 2 * this.turns

    for (let i = 0; i < this.numParticles; i++) {
      const t = i / (this.numParticles - 1)
      const theta = t * maxTheta

      const freqIndex = Math.floor(t * (bufferLength - 1))
      const freqValue = freqData[freqIndex] / 255
      const timeValue = (timeDomainData[i % timeDomainData.length] - 128) / 128

      // Rose/flower modulation layered onto a spiral ramp.
      const spiralRamp = t * 1.8
      const petalWave = Math.sin(theta * (this.petals / this.turns) + this.time) // stable across turns
      const base = this.baseRadius + spiralRamp
      const flower = petalWave * this.petalsAmplitude

      const radius = base + flower + freqValue * this.intensity * 6

      const x = Math.cos(theta) * radius
      const y = Math.sin(theta) * radius
      const z = timeValue * 0.9 + Math.sin(theta * 0.5 + this.time) * 0.25

      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z

      // Color: hue by theta, brightness by frequency
      const hue = (theta / (Math.PI * 2)) % 1
      const color = new THREE.Color().setHSL(hue, 0.9, 0.55)
      const brightness = 0.65 + freqValue * 0.35

      colors[i * 3] = color.r * brightness
      colors[i * 3 + 1] = color.g * brightness
      colors[i * 3 + 2] = color.b * brightness

      sizes[i] = 0.25 + t * 0.55
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true

    this.rotation.z += 0.0009
  }

  onBPMBeat() {
    const prev = this.intensity
    this.intensity = Math.min(0.5, this.intensity + 0.12)
    setTimeout(() => {
      this.intensity = prev
    }, 110)
  }

  destroy() {
    if (this.particleSystem) {
      this.particleSystem.geometry.dispose()
      this.particleSystem.material.dispose()
      this.remove(this.particleSystem)
    }

    App.holder.remove(this)
  }
}
