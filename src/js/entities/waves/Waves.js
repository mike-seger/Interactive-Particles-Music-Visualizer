import * as THREE from 'three'
import App from '../../App'

// Inspired by https://github.com/soniaboller/audible-visuals (Apache-2.0)
// A time-domain “waves” particle line.

export default class Waves extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Waves'

    this.numParticles = 1024

    this.width = 46
    this.amplitude = 10
    this.intensity = 1.0

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
      const t = i / (this.numParticles - 1)
      const x = (t - 0.5) * this.width

      positions[i * 3] = x
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0

      const color = new THREE.Color().setHSL(t, 0.95, 0.55)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b

      sizes[i] = 0.6
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

    const material = new THREE.PointsMaterial({
      size: 1.0,
      map: circleTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    this.particleSystem = new THREE.Points(geometry, material)
    this.add(this.particleSystem)

    App.camera.position.set(0, 0, 55)
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

    this.time += 0.01

    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const freqData = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(freqData)

    const timeDomainData = new Uint8Array(audioManager.analyserNode.fftSize)
    audioManager.analyserNode.getByteTimeDomainData(timeDomainData)

    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array

    const step = Math.max(1, Math.floor(timeDomainData.length / this.numParticles))

    for (let i = 0; i < this.numParticles; i++) {
      const t = i / (this.numParticles - 1)

      const sample = (timeDomainData[i * step] - 128) / 128
      const y = sample * this.amplitude * this.intensity

      const freqIndex = Math.floor(t * (bufferLength - 1))
      const freqValue = freqData[freqIndex] / 255

      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = Math.sin(this.time + t * Math.PI * 2) * 0.35 + freqValue * 0.25

      // Animate hue slightly and add frequency-driven brightness.
      const hue = (t + this.time * 0.025) % 1
      const base = new THREE.Color().setHSL(hue, 0.95, 0.55)
      const brightness = 0.65 + freqValue * 0.35

      colors[i * 3] = base.r * brightness
      colors[i * 3 + 1] = base.g * brightness
      colors[i * 3 + 2] = base.b * brightness

      sizes[i] = 0.45 + freqValue * 0.9
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true
  }

  onBPMBeat() {
    const prev = this.intensity
    this.intensity = Math.min(1.6, this.intensity + 0.35)

    setTimeout(() => {
      this.intensity = prev
    }, 120)
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
