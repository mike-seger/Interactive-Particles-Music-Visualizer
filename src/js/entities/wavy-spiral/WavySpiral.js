import * as THREE from 'three'
import App from '../../App'

// https://github.com/soniaboller/audible-visuals

export default class WavySpiral extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'WavySpiral'
    this.numParticles = 150
    this.intensity = 0.18
    this.aWavy = 1.20
    this.bWavy = 0.76
    this.wavyAngle = 2.44
    this.waveAmplitude = 0.5
    this.waveFrequency = 8
    this.mouseX = 0
    this.mouseY = 0
    this.time = 0
  }

  init() {
    App.holder.add(this)
    
    // Create circular texture for particles
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
    
    const circleTexture = new THREE.CanvasTexture(canvas)
    
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(this.numParticles * 3)
    const colors = new Float32Array(this.numParticles * 3)
    const sizes = new Float32Array(this.numParticles)
    
    for (let i = 0; i < this.numParticles; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      
      colors[i * 3] = 1
      colors[i * 3 + 1] = 0
      colors[i * 3 + 2] = 1
      
      sizes[i] = 1.0
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
      depthWrite: false
    })
    
    this.particleSystem = new THREE.Points(geometry, material)
    this.add(this.particleSystem)
    
    this.setupMouseInteraction()
    
    App.camera.position.set(0, 0, 30)
    App.camera.lookAt(0, 0, 0)
  }

  setupMouseInteraction() {
    const onMouseMove = (event) => {
      this.mouseX = (event.clientX - window.innerWidth / 2) * 0.001
      this.mouseY = (event.clientY - window.innerHeight / 2) * 0.001
    }
    
    window.addEventListener('mousemove', onMouseMove)
    this.userData.mouseHandler = onMouseMove
  }

  update(deltaTime) {
    const audioManager = App.audioManager
    
    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) {
      return
    }
    
    this.time += 0.01
    
    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const freqData = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(freqData)
    
    const timeDomainData = new Uint8Array(audioManager.analyserNode.fftSize)
    audioManager.analyserNode.getByteTimeDomainData(timeDomainData)
    
    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array
    
    for (let i = 0; i < this.numParticles; i++) {
      const theta = (i / this.numParticles) * Math.PI * 2 * this.wavyAngle
      const radius = this.aWavy + this.bWavy * theta
      
      const freqIndex = Math.floor((i / this.numParticles) * bufferLength)
      const freqValue = freqData[freqIndex] / 255
      const timeValue = (timeDomainData[i % timeDomainData.length] - 128) / 128
      
      // Add wave modulation to the spiral
      const wave = Math.sin(theta * this.waveFrequency + this.time) * this.waveAmplitude
      const radiusWithWave = radius + wave + freqValue * this.intensity
      
      const x = Math.cos(theta) * radiusWithWave
      const y = Math.sin(theta) * radiusWithWave
      const z = timeValue * 0.5 + Math.sin(theta * 2 + this.time) * 0.3
      
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
      
      // Color gradient from blue (center) to red (outer)
      const normalizedRadius = radius / (this.aWavy + this.bWavy * Math.PI * 2 * this.wavyAngle)
      
      let r, g, b
      if (normalizedRadius < 0.33) {
        // Blue to cyan
        const t = normalizedRadius / 0.33
        r = 0
        g = t * 0.5
        b = 1
      } else if (normalizedRadius < 0.66) {
        // Cyan to magenta
        const t = (normalizedRadius - 0.33) / 0.33
        r = t
        g = 0.5 * (1 - t)
        b = 1
      } else {
        // Magenta to red
        const t = (normalizedRadius - 0.66) / 0.34
        r = 1
        g = 0
        b = 1 - t
      }
      
      // Add frequency brightness
      const brightness = 0.7 + freqValue * 0.3
      colors[i * 3] = r * brightness
      colors[i * 3 + 1] = g * brightness
      colors[i * 3 + 2] = b * brightness
      
      // Diameter grows from center (0.4) to outer (1.2) in world space
      const diameter = 0.4 + normalizedRadius * 0.8
      sizes[i] = diameter
    }
    
    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true
    
    this.rotation.z += 0.001
  }

  onBPMBeat(bpm, beat) {
    this.intensity = 0.25
    this.waveAmplitude = 0.8
    
    setTimeout(() => {
      this.intensity = 0.18
      this.waveAmplitude = 0.5
    }, 100)
  }

  destroy() {
    if (this.userData.mouseHandler) {
      window.removeEventListener('mousemove', this.userData.mouseHandler)
    }
    
    if (this.particleSystem) {
      this.particleSystem.geometry.dispose()
      this.particleSystem.material.dispose()
      this.remove(this.particleSystem)
    }
    
    App.holder.remove(this)
  }
}
