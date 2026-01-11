import * as THREE from 'three'
import vertex from './glsl/vertex.glsl'
import fragment from './glsl/fragment.glsl'
import App from '../../App'

// https://github.com/adarkforce/3d-midi-audio-particles-threejs

export default class AudioParticles extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Audio Particles'
    
    this.params = {
      amplitude: 3,
      frequency: 0.01,
      maxDistance: 3,
      freq1: 60,
      freq2: 500,
      freq3: 6000,
      timeX: 2,
      timeY: 20,
      timeZ: 10,
      interpolation: 0.06,
      opacity: 0.1
    }
    
    this.frequencyValue1 = 0
    this.frequencyValue2 = 0
    this.frequencyValue3 = 0
    this.timeDomainValue = 0
    
    this.clock = new THREE.Clock()
  }

  init() {
    App.holder.add(this)
    
    this._createParticles()
  }

  _createParticles() {
    // Create tetrahedron geometry with lots of vertices for smooth particles
    const geometry = new THREE.TetrahedronGeometry(15, 126)
    
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTime: { value: 0 },
        uFrequency: { value: this.params.frequency },
        uAmplitude: { value: this.params.amplitude },
        uMaxDistance: { value: this.params.maxDistance },
        uTimeX: { value: this.params.timeX },
        uTimeY: { value: this.params.timeY },
        uTimeZ: { value: this.params.timeZ },
        uInterpolation: { value: this.params.interpolation },
        uOpacity: { value: this.params.opacity }
      },
      transparent: true,
      blending: THREE.AdditiveBlending
    })
    
    this.points = new THREE.Points(geometry, material)
    this.add(this.points)
    
    // Position camera to look at the center
    this.points.geometry.computeBoundingSphere()
  }

  _hertzToIndex(hz) {
    if (!App.audioManager?.analyserNode) return 0
    const analyser = App.audioManager.analyserNode
    return Math.floor(
      (hz * analyser.frequencyBinCount) / (App.audioManager.audioContext.sampleRate / 2)
    )
  }

  _processAudio() {
    if (!App.audioManager?.analyserNode) return
    
    const analyser = App.audioManager.analyserNode
    const freqData = new Uint8Array(analyser.frequencyBinCount)
    const timeDomainData = new Uint8Array(analyser.fftSize)
    
    analyser.getByteFrequencyData(freqData)
    analyser.getByteTimeDomainData(timeDomainData)
    
    const freq1Index = this._hertzToIndex(this.params.freq1)
    const freq2Index = this._hertzToIndex(this.params.freq2)
    const freq3Index = this._hertzToIndex(this.params.freq3)
    
    const freqValue1 = freqData[freq1Index]
    this.frequencyValue1 = freqValue1 / 255
    
    const freqValue2 = freqData[Math.floor(freq2Index)]
    this.frequencyValue2 = freqValue2 / 255
    
    const freqValue3 = freqData[Math.floor(freq3Index)]
    this.frequencyValue3 = freqValue3 / 255
    
    this.timeDomainValue = (128 - timeDomainData[Math.floor(analyser.fftSize / 2)]) / 127
  }

  update() {
    if (!this.points) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio) {
        this._processAudio()

        const elapsedTime = this.clock.getElapsedTime()
        const bass = App.audioManager.frequencyData.low || 0
        const mid = App.audioManager.frequencyData.mid || 0
        const high = App.audioManager.frequencyData.high || 0
        const intensity = (bass + mid + high) / 3

        // Audio-reactive uniform boosts
        const amplitude = this.params.amplitude * (1.0 + intensity * 1.8)
        const frequency = this.params.frequency * (1.0 + high * 1.1)
        const maxDistance = (this.params.maxDistance * (0.7 + bass * 0.9)) - this.timeDomainValue * 0.6
        const timeX = this.params.timeX * (0.4 + this.frequencyValue1 * 2.0)
        const timeY = this.params.timeY * (0.4 + this.frequencyValue2 * 2.0)
        const timeZ = this.params.timeZ * (0.4 + this.frequencyValue3 * 2.0)
        const interpolation = this.params.interpolation * (0.6 + intensity * 0.9)
        const opacity = 0.1 + intensity * 0.8

        this.points.material.uniforms.uTime.value = elapsedTime
        this.points.material.uniforms.uAmplitude.value = amplitude
        this.points.material.uniforms.uFrequency.value = frequency
        this.points.material.uniforms.uMaxDistance.value = maxDistance
        this.points.material.uniforms.uTimeX.value = timeX
        this.points.material.uniforms.uTimeY.value = timeY
        this.points.material.uniforms.uTimeZ.value = timeZ
        this.points.material.uniforms.uInterpolation.value = interpolation
        if (this.points.material.uniforms.uOpacity) {
          this.points.material.uniforms.uOpacity.value = opacity
        }

        // Rotate and pulse based on audio
        this.points.rotation.y += (this.timeDomainValue + intensity) * 0.003
        this.points.scale.setScalar(1 + intensity * 0.9)
      }
    }
  }

  destroy() {
    this.points?.geometry?.dispose()
    this.points?.material?.dispose()
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // Could add a pulse effect on beat
  }
}
