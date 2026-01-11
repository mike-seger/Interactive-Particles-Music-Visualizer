import * as THREE from 'three'
import gsap from 'gsap'
import vertex from './glsl/vertex.glsl'
import fragment from './glsl/fragment.glsl'
import App from '../../App'

export default class PlasmaField extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'PlasmaField'
  }

  init() {
    App.holder.add(this)
    
    // Create a large plane that fills the viewport
    const geometry = new THREE.PlaneGeometry(40, 30, 256, 192)
    
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        time: { value: 0 },
        lowFreq: { value: 0 },
        midFreq: { value: 0 },
        highFreq: { value: 0 }
      },
      side: THREE.DoubleSide
    })
    
    this.plane = new THREE.Mesh(geometry, this.material)
    this.add(this.plane)
    
    // Position to fill viewport
    this.position.z = 0
  }

  update() {
    if (!App.audioManager) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    const bass = App.audioManager?.frequencyData?.low || 0
    const mid = App.audioManager?.frequencyData?.mid || 0
    const high = App.audioManager?.frequencyData?.high || 0
    const bassThreshold = 0.08; // gate out tiny low-end to stop idle pulsing
    
    if (hasSignal) {
      const hasAudio = bass > bassThreshold || mid > 0 || high > 0
      
      if (hasAudio) {
        // Update frequency uniforms
        this.material.uniforms.lowFreq.value = Math.max(0, bass - bassThreshold)
        this.material.uniforms.midFreq.value = mid
        this.material.uniforms.highFreq.value = high
        
        // Slower, more controlled time progression; bass drives it less
        const intensity = (bass + mid + high) / 3;
        this.material.uniforms.time.value += 0.01 * (1 + intensity * 0.25)
      } else {
        // No signal - constant gentle flow
        this.material.uniforms.lowFreq.value = 0
        this.material.uniforms.midFreq.value = 0
        this.material.uniforms.highFreq.value = 0
        this.material.uniforms.time.value += 0.015  // Same speed for constant flow
      }
    } else {
      // Audio stopped - constant gentle flow
      this.material.uniforms.lowFreq.value = 0
      this.material.uniforms.midFreq.value = 0
      this.material.uniforms.highFreq.value = 0
      this.material.uniforms.time.value += 0.015  // Same speed for constant flow
    }
  }

  destroy() {
    if (this.material) this.material.dispose()
    if (this.plane?.geometry) this.plane.geometry.dispose()
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    const fd = App.audioManager?.frequencyData || { low: 0, mid: 0, high: 0 }
    const bass = fd.low || 0
    const mid = fd.mid || 0
    const high = fd.high || 0
    const bassThreshold = 0.08

    // Skip pulsing if there is no clear bass hit
    if (bass < bassThreshold) return

    // Pulse strength proportional to total energy, but much smaller overall
    const energy = (bass * 0.6) + (mid * 0.3) + (high * 0.1)
    const delta = Math.min(0.008, energy * 0.02) // ~5x smaller than before

    gsap.to(this.scale, {
      x: 1 + delta,
      y: 1 + delta,
      z: 1 + delta,
      duration: 0.12,
      ease: 'power2.out',
      onComplete: () => {
        gsap.to(this.scale, {
          x: 1.0,
          y: 1.0,
          z: 1.0,
          duration: 0.35,
          ease: 'power2.in'
        })
      }
    })
  }
}
