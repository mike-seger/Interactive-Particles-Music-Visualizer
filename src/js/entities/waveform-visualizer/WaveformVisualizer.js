import * as THREE from 'three'
import App from '../../App'

// Based on Waveform Visualiser - Circular waveform rings with bloom effect

export default class WaveformVisualizer extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'WaveformVisualizer'
    this.sampleLines = []
    this.maxLines = 40
    this.hue = 0
    this.fftSize = 128 * 8
    this.dimension = this.fftSize
  }

  init() {
    App.holder.add(this)

    // Position camera to match original perspective (looking up at an angle)
    if (App.camera) {
      App.camera.position.set(10, 4, -6)
      App.camera.lookAt(0, 0, 0)
    }

    // Give the disk a slight tilt for 3D rotation
    this.rotation.x = 0.35

    this.lastTime = Date.now()
    this.fpsInterval = 1000 / 60 // 60 fps
  }

  update(deltaTime) {
    const audioManager = App.audioManager

    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) {
      return
    }

    // FPS throttling
    const now = Date.now()
    const elapsed = now - this.lastTime

    if (elapsed > this.fpsInterval) {
      this.lastTime = now - (elapsed % this.fpsInterval)

      // Get waveform data
      const bufferLength = audioManager.analyserNode.fftSize
      const dataArray = new Uint8Array(bufferLength)
      audioManager.analyserNode.getByteTimeDomainData(dataArray)

      // Normalize waveform data to -1 to 1 range
      const normalizedData = new Float32Array(this.dimension)
      const step = bufferLength / this.dimension
      
      for (let i = 0; i < this.dimension; i++) {
        const index = Math.floor(i * step)
        normalizedData[i] = ((dataArray[index] / 128.0) - 1.0) * 2.0
      }

      // Remove oldest line if at max
      if (this.sampleLines.length >= this.maxLines) {
        const oldLine = this.sampleLines.shift()
        oldLine.geometry.dispose()
        oldLine.material.dispose()
        this.remove(oldLine)
      }

      // Create new waveform line
      const line = this.createWaveformLine(normalizedData)
      this.sampleLines.push(line)
      this.add(line)
    }

    // Animate all lines
    this.sampleLines.forEach((line, index) => {
      const delta = line.userData.delta
      const scale = delta
      line.scale.set(scale, scale, 1)
      
      // Fade out as it expands
      line.material.opacity = Math.max(0, 1 - (delta / 8))
      
      // Cyan to blue color shift (like original)
      const hueStart = 180 // Cyan
      const hueEnd = 200   // Blue
      const progress = Math.min(1, delta / 8)
      const hue = hueStart + (hueEnd - hueStart) * progress
      const lightness = Math.max(30, 90 - delta * 8) // Bright cyan/blue
      line.material.color.setHSL(hue / 360, 1.0, lightness / 100)
      
      line.userData.delta += 0.12
    })

    // Slow 3D rotation of the disk
    this.rotation.y += 0.0025
    this.rotation.z += 0.0008

    // Remove hue cycling for more consistent cyan color
  }

  createWaveformLine(data) {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(180/360, 1.0, 0.8), // Bright cyan
      opacity: 1,
      transparent: true,
      linewidth: 2 // Thicker lines
    })

    const points = []
    const offset = (2 * Math.PI) / this.dimension

    for (let i = 0; i < this.dimension; i++) {
      const angle = i * offset
      const r = 1
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      const z = data[i] / 1.5 // Slightly more pronounced waveform

      points.push(new THREE.Vector3(x, y, z))
    }

    // Close the loop
    points.push(points[0].clone())

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.Line(geometry, material)
    
    line.userData.delta = 1
    
    return line
  }

  onBPMBeat(bpm, beat) {
    // Optional: add beat response
  }

  destroy() {
    this.sampleLines.forEach(line => {
      line.geometry.dispose()
      line.material.dispose()
    })
    this.sampleLines = []
    App.holder.remove(this)
  }
}
