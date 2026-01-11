/**
 * SimplePlasma
 * Audio-reactive 2D plasma shader inspired by mike-seger simpleplasma demo.
 * Dark background; hue and intensity respond to audio energy.
 */

import * as THREE from 'three'
import App from '../../App'

export default class SimplePlasma extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Simple Plasma'
    this.clock = new THREE.Clock()

    this.uniforms = {
      uTime: { value: 0 },
      uAudio: { value: 0 },
      uBass: { value: 0 },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
    }
  }

  init() {
    App.holder.add(this)

    if (App.renderer) {
      App.renderer.setClearColor(0x000000, 1)
    }

    if (App.camera) {
      App.camera.position.set(0, 0, 2.2)
      App.camera.lookAt(0, 0, 0)
    }

    const geometry = new THREE.PlaneGeometry(2, 2, 1, 1)

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `

    const fragmentShader = `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform float uAudio;
      uniform float uBass;
      uniform vec2 uResolution;

      vec3 hsl2rgb(vec3 hsl) {
        vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        uv.x *= uResolution.x / uResolution.y;

        float t = uTime;
        float a = sin(uv.x * 4.0 + t * 1.6 + sin(uv.y * 3.5 + t * 0.9));
        float b = sin(uv.y * 5.0 - t * 1.2 + cos(uv.x * 2.8 - t * 0.6));
        float c = sin((uv.x + uv.y) * 3.2 + t * 1.4);
        float m = (a + b + c) / 3.0;

        // Audio influence
        float audioBoost = uAudio * 0.8 + uBass * 0.6;
        float hue = fract(0.55 + m * 0.35 + t * 0.05 + audioBoost * 0.2);
        float sat = clamp(0.65 + audioBoost * 0.35, 0.0, 1.0);
        float val = clamp(0.4 + 0.6 * (0.5 + 0.5 * m) + audioBoost * 0.4, 0.0, 1.0);

        vec3 color = hsl2rgb(vec3(hue, sat, val));
        gl_FragColor = vec4(color, 1.0);
      }
    `

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthWrite: false
    })

    this.mesh = new THREE.Mesh(geometry, material)
    // Position in front of camera; it already spans clip space due to vertex shader
    this.add(this.mesh)
  }

  update() {
    if (!this.mesh) return

    const elapsed = this.clock.getElapsedTime()
    this.uniforms.uTime.value = elapsed
    this.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)

    const analyser = App.audioManager?.analyserNode
    if (analyser) {
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(freqData)
      const len = freqData.length
      const third = Math.max(1, Math.floor(len / 3))
      let bassSum = 0
      for (let i = 0; i < third; i++) bassSum += freqData[i]
      let midSum = 0
      for (let i = third; i < third * 2; i++) midSum += freqData[i]
      const bass = (bassSum / third) / 255
      const mid = (midSum / third) / 255
      // Smooth the response
      this.uniforms.uBass.value = THREE.MathUtils.lerp(this.uniforms.uBass.value, bass, 0.18)
      this.uniforms.uAudio.value = THREE.MathUtils.lerp(this.uniforms.uAudio.value, mid, 0.18)
    }
  }

  destroy() {
    if (this.mesh) {
      this.mesh.geometry.dispose()
      this.mesh.material.dispose()
    }
    if (this.parent) this.parent.remove(this)
  }
}
