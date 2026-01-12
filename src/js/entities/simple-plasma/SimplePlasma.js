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

    this._freqData = null

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

      vec3 palette(float t) {
        // Tuned stops with added green and less near-white: red -> yellow -> green -> cyan -> cobalt -> violet
        vec3 c1 = vec3(0.98, 0.12, 0.08); // red
        vec3 c2 = vec3(1.00, 0.82, 0.10); // yellow
        vec3 c3 = vec3(0.18, 0.72, 0.28); // green
        vec3 c4 = vec3(0.50, 0.90, 0.95); // soft cyan (dimmer to reduce white)
        vec3 c5 = vec3(0.14, 0.24, 0.95); // cobalt blue
        vec3 c6 = vec3(0.30, 0.12, 0.62); // violet

        float t1 = smoothstep(0.00, 0.20, t);
        float t2 = smoothstep(0.15, 0.35, t);
        float t3 = smoothstep(0.30, 0.55, t);
        float t4 = smoothstep(0.50, 0.75, t);
        float t5 = smoothstep(0.70, 1.00, t);

        vec3 col = mix(c1, c2, t1);
        col = mix(col, c3, t2);
        col = mix(col, c4, t3);
        col = mix(col, c5, t4);
        col = mix(col, c6, t5);
        return col;
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        uv.x *= uResolution.x / uResolution.y;

        // Audio-warp the domain so loudness bends shapes, not just colors
        float warp = uBass * 0.35 + uAudio * 0.25;
        uv += vec2(
          sin(uTime * 0.7 + uv.y * 3.0),
          cos(uTime * 0.5 + uv.x * 2.5)
        ) * (0.12 * warp);

        float t = uTime;
        float a = sin(uv.x * (4.0 + uAudio * 2.0) + t * (1.6 + uBass * 1.4) + sin(uv.y * (3.5 + uAudio * 1.5) + t * (0.9 + uBass * 1.1)));
        float b = sin(uv.y * (5.0 + uBass * 2.4) - t * (1.2 + uAudio * 1.1) + cos(uv.x * (2.8 + uAudio * 1.8) - t * (0.6 + uBass * 0.8)));
        float c = sin((uv.x + uv.y) * (3.2 + uAudio * 1.6) + t * (1.4 + uBass * 1.2));
        float m = (a + b + c) / 3.0;

        float audioBoost = uAudio * 0.8 + uBass * 0.6;
        float tPlasma = clamp(0.5 + 0.5 * m + audioBoost * 0.15, 0.0, 1.0);

        vec3 color = palette(tPlasma);
        // Brighten with audio, but keep highlights restrained to reduce white-out
        color *= 0.75 + audioBoost * 0.65;

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
    // Keep time bounded to avoid long-run float precision artifacts in the shader.
    this.uniforms.uTime.value = elapsed % 10000
    this.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)

    const analyser = App.audioManager?.analyserNode
    if (analyser) {
      if (!this._freqData || this._freqData.length !== analyser.frequencyBinCount) {
        this._freqData = new Uint8Array(analyser.frequencyBinCount)
      }

      analyser.getByteFrequencyData(this._freqData)
      const len = this._freqData.length
      const third = Math.max(1, Math.floor(len / 3))
      let bassSum = 0
      for (let i = 0; i < third; i++) bassSum += this._freqData[i]
      let midSum = 0
      for (let i = third; i < third * 2; i++) midSum += this._freqData[i]
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
