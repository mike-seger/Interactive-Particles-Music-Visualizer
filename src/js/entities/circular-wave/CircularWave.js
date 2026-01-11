import * as THREE from 'three'
import App from '../../App'

export default class CircularWave extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Circular Wave'
    
    this.segments = 256
    this.radius = 5
    this.innerRadius = 3
    this.waveLines = []
    this.dataArray = null
  }

  init() {
    App.holder.add(this)
    this._createWaveform()
  }

  _createWaveform() {
    if (!App.audioManager?.analyserNode) return
    
    const analyser = App.audioManager.analyserNode
    this.dataArray = new Uint8Array(analyser.frequencyBinCount)
    
    // Create multiple concentric circles for a layered effect
    const numCircles = 3
    
    for (let c = 0; c < numCircles; c++) {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color().setHSL(c * 0.3, 0.8, 0.5),
        linewidth: 2
      })
      
      const geometry = new THREE.BufferGeometry()
      const positions = new Float32Array(this.segments * 3)
      
      // Initialize circle positions
      for (let i = 0; i < this.segments; i++) {
        const angle = (i / this.segments) * Math.PI * 2
        const r = this.innerRadius + c * 0.8
        positions[i * 3] = Math.cos(angle) * r
        positions[i * 3 + 1] = Math.sin(angle) * r
        positions[i * 3 + 2] = 0
      }
      
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      
      const line = new THREE.Line(geometry, material)
      this.add(line)
      this.waveLines.push({
        line: line,
        baseRadius: this.innerRadius + c * 0.8,
        phase: c * Math.PI / 3
      })
    }
    
    // Add particles at wave peaks
    this.createWaveParticles()
  }

  createWaveParticles() {
    const particleCount = 64
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2
      positions[i * 3] = Math.cos(angle) * this.radius
      positions[i * 3 + 1] = Math.sin(angle) * this.radius
      positions[i * 3 + 2] = 0
      
      const color = new THREE.Color().setHSL(i / particleCount, 0.8, 0.6)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    
    const material = new THREE.PointsMaterial({
      size: 0.15,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    })
    
    this.particles = new THREE.Points(geometry, material)
    this.add(this.particles)
  }

  update() {
    if (!this.waveLines.length) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio && App.audioManager.analyserNode) {
        const analyser = App.audioManager.analyserNode
        analyser.getByteFrequencyData(this.dataArray)
        
        const time = Date.now() * 0.001
        
        // Update each wave circle
        this.waveLines.forEach((waveObj, circleIndex) => {
          const positions = waveObj.line.geometry.attributes.position.array
          const samplesPerSegment = Math.floor(this.dataArray.length / this.segments)
          
          for (let i = 0; i < this.segments; i++) {
            const angle = (i / this.segments) * Math.PI * 2
            
            // Get audio data for this segment
            const dataIndex = Math.min(i * samplesPerSegment, this.dataArray.length - 1)
            const audioValue = this.dataArray[dataIndex] / 255
            
            // Create wave effect
            const wave = Math.sin(angle * 3 + time * 2 + waveObj.phase) * 0.3 * audioValue
            const r = waveObj.baseRadius + audioValue * 1.5 + wave
            
            positions[i * 3] = Math.cos(angle) * r
            positions[i * 3 + 1] = Math.sin(angle) * r
            positions[i * 3 + 2] = wave * 2
          }
          
          waveObj.line.geometry.attributes.position.needsUpdate = true
          
          // Update color based on audio
          const avgAudio = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length / 255
          waveObj.line.material.color.setHSL(
            (circleIndex * 0.3 + time * 0.1) % 1,
            0.8,
            0.3 + avgAudio * 0.4
          )
        })
        
        // Update particles
        if (this.particles) {
          const positions = this.particles.geometry.attributes.position.array
          const particleCount = positions.length / 3
          
          for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2
            const dataIndex = Math.floor((i / particleCount) * this.dataArray.length)
            const audioValue = this.dataArray[dataIndex] / 255
            
            const r = this.radius + audioValue * 2
            positions[i * 3] = Math.cos(angle) * r
            positions[i * 3 + 1] = Math.sin(angle) * r
            positions[i * 3 + 2] = audioValue * 1.5
          }
          
          this.particles.geometry.attributes.position.needsUpdate = true
          this.particles.rotation.z += 0.005
        }
        
        // Rotate the entire visualization
        this.rotation.z += 0.002
      }
    }
  }

  destroy() {
    this.waveLines.forEach(waveObj => {
      waveObj.line.geometry.dispose()
      waveObj.line.material.dispose()
    })
    
    if (this.particles) {
      this.particles.geometry.dispose()
      this.particles.material.dispose()
    }
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // Pulse effect on beat
    if (this.waveLines.length > 0) {
      this.waveLines.forEach(waveObj => {
        waveObj.baseRadius *= 1.1
        setTimeout(() => {
          waveObj.baseRadius /= 1.1
        }, 100)
      })
    }
  }
}
