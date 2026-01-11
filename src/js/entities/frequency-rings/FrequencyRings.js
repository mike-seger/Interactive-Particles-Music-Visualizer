import * as THREE from 'three'
import gsap from 'gsap'
import vertex from './glsl/vertex.glsl'
import fragment from './glsl/fragment.glsl'
import App from '../../App'

export default class FrequencyRings extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'FrequencyRings'
    this.rings = []
    this.numRings = 32
  }

  init() {
    App.holder.add(this)
    
    // Create multiple concentric rings for different frequencies
    const colors = [
      new THREE.Color(0xff0066), // Low freq - pink/red
      new THREE.Color(0x00ffff), // Mid freq - cyan
      new THREE.Color(0x00ff88), // High freq - green
    ]
    
    for (let i = 0; i < this.numRings; i++) {
      const ring = this.createRing(i, colors)
      this.rings.push(ring)
      this.add(ring)
    }
    
    // Rotate the whole structure slightly for better view
    this.rotation.x = Math.PI / 6
  }

  createRing(index, colors) {
    const ringGroup = new THREE.Object3D()
    const numPoints = 128
    const positions = new Float32Array(numPoints * 3)
    
    // Create points in a circle
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2
      positions[i * 3] = Math.cos(angle)
      positions[i * 3 + 1] = Math.sin(angle)
      positions[i * 3 + 2] = 0
    }
    
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    
    // Assign color based on frequency band
    const colorIndex = Math.floor((index / this.numRings) * 3)
    const color = colors[Math.min(colorIndex, colors.length - 1)]
    
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        radius: { value: 0.5 + index * 0.3 },
        ringIndex: { value: index },
        color: { value: color },
        opacity: { value: 0.8 },
        pointSize: { value: 3.0 },
        amplitude: { value: 0.0 }
      }
    })
    
    const points = new THREE.Points(geometry, material)
    ringGroup.add(points)
    
    ringGroup.userData = {
      baseRadius: 0.5 + index * 0.3,
      ringIndex: index,
      material: material
    }
    
    return ringGroup
  }

  update() {
    if (!App.audioManager) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio) {
        // Animate rings based on frequency bands
        this.rings.forEach((ring, index) => {
          const normalizedIndex = index / this.numRings
          const material = ring.userData.material
          const baseRadius = ring.userData.baseRadius
          
          // Map different rings to different frequency bands
          let amplitude = 0
          if (normalizedIndex < 0.33) {
            // Low frequency rings
            amplitude = App.audioManager.frequencyData.low
          } else if (normalizedIndex < 0.66) {
            // Mid frequency rings
            amplitude = App.audioManager.frequencyData.mid
          } else {
            // High frequency rings
            amplitude = App.audioManager.frequencyData.high
          }
          
          // Update amplitude uniform for circular wave effect
          material.uniforms.amplitude.value = amplitude * 1.5
          
          // Increment time for wave animation - 5-15 Hz response
          material.uniforms.time.value += 0.25 * (1 + amplitude * 2)
          
          // Set base radius (wave effect is in shader)
          material.uniforms.radius.value = baseRadius
          
          // Variable point size from 1-6 pixels based on amplitude
          const targetPointSize = 2.0 + amplitude * 4.0
          material.uniforms.pointSize.value = targetPointSize
          
          // Fade opacity based on amplitude
          material.uniforms.opacity.value = 0.4 + amplitude * 0.6
          
          // Rotate rings with varying speeds based on amplitude
          ring.rotation.z += 0.000133 * (1 + amplitude * 2)
        })
      } else {
        // No signal - show static rings at reduced opacity
        this.rings.forEach((ring) => {
          const material = ring.userData.material
          const baseRadius = ring.userData.baseRadius
          
          material.uniforms.radius.value = baseRadius
          material.uniforms.amplitude.value = 0
          material.uniforms.time.value += 0.05
          material.uniforms.pointSize.value = 2.0
          material.uniforms.opacity.value = 0.3
          ring.rotation.z += 0.000067
        })
      }
    } else {
      // Audio stopped - gentle rotation
      this.rings.forEach((ring) => {
        const material = ring.userData.material
        material.uniforms.amplitude.value = 0
        material.uniforms.time.value += 0.05
        material.uniforms.pointSize.value = 2.0
        material.uniforms.opacity.value = 0.3
        ring.rotation.z += 0.000067
      })
    }
  }

  destroy() {
    this.rings.forEach(ring => {
      const material = ring.children[0]?.material
      const geometry = ring.children[0]?.geometry
      
      if (material) material.dispose()
      if (geometry) geometry.dispose()
      
      this.remove(ring)
    })
    
    this.rings = []
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // React to BPM beats with a pulse effect
    this.rings.forEach((ring, index) => {
      const material = ring.userData.material
      gsap.to(material.uniforms.opacity, {
        value: 1.0,
        duration: 0.1,
        ease: 'power2.out',
        onComplete: () => {
          gsap.to(material.uniforms.opacity, {
            value: 0.4,
            duration: 0.3,
            ease: 'power2.in'
          })
        }
      })
    })
  }
}
