/**
 * CoralReef
 * Audio-reactive instanced capsules that swirl like the reference coral-reef demo.
 * Dark mode, emissive tips, rainbow gradient, curl-ish flow field.
 */

import * as THREE from 'three'
import App from '../../App'

// Lightweight simplex noise (3D) for flow
class SimplexNoise {
  constructor() {
    this.perm = new Uint8Array(512)
    this.grad3 = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
    ]
    for (let i = 0; i < 256; i++) this.perm[i] = i
    for (let i = 255; i > 0; i--) {
      const n = Math.floor(Math.random() * (i + 1))
      const q = this.perm[i]
      this.perm[i] = this.perm[n]
      this.perm[n] = q
    }
    for (let i = 0; i < 256; i++) this.perm[i + 256] = this.perm[i]
  }

  dot(g, x, y, z) { return g[0] * x + g[1] * y + g[2] * z }

  noise(xin, yin, zin) {
    const F3 = 1 / 3
    const G3 = 1 / 6
    let n0, n1, n2, n3
    const s = (xin + yin + zin) * F3
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const k = Math.floor(zin + s)
    const t = (i + j + k) * G3
    const X0 = i - t
    const Y0 = j - t
    const Z0 = k - t
    const x0 = xin - X0
    const y0 = yin - Y0
    const z0 = zin - Z0
    let i1, j1, k1
    let i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }
    const x1 = x0 - i1 + G3
    const y1 = y0 - j1 + G3
    const z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3
    const y2 = y0 - j2 + 2 * G3
    const z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3
    const y3 = y0 - 1 + 3 * G3
    const z3 = z0 - 1 + 3 * G3
    const ii = i & 255, jj = j & 255, kk = k & 255
    const gi0 = this.perm[ii + this.perm[jj + this.perm[kk]]] % 12
    const gi1 = this.perm[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]] % 12
    const gi2 = this.perm[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]] % 12
    const gi3 = this.perm[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]] % 12
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0
    n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * this.dot(this.grad3[gi0], x0, y0, z0))
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1
    n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * this.dot(this.grad3[gi1], x1, y1, z1))
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2
    n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * this.dot(this.grad3[gi2], x2, y2, z2))
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3
    n3 = t3 < 0 ? 0 : (t3 *= t3, t3 * t3 * this.dot(this.grad3[gi3], x3, y3, z3))
    return 32 * (n0 + n1 + n2 + n3)
  }
}

export default class CoralReef extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Coral Reef'

    this.cols = 95
    this.rows = 55
    this.spacing = 0.32
    this.count = this.cols * this.rows

    this.noise = new SimplexNoise()
    this.dummy = new THREE.Object3D()
    this.colors = new Float32Array(this.count * 3)
    this.tempColor = new THREE.Color()
  }

  init() {
    App.holder.add(this)

    if (App.renderer) {
      App.renderer.setClearColor(0x000000, 1)
    }

    // Camera framing the field
    if (App.camera) {
      App.camera.position.set(0, 0, 14)
      App.camera.lookAt(0, 0, 0)
    }

    // Soft light for rim; main color via emissive
    const ambient = new THREE.AmbientLight(0x111111, 0.8)
    this.add(ambient)

    const geometry = new THREE.CapsuleGeometry(0.12, 0.72, 6, 10)
    const material = new THREE.MeshStandardMaterial({
      color: 0x111111,
      emissive: 0xffffff,
      emissiveIntensity: 1.0,
      roughness: 0.25,
      metalness: 0.0,
      transparent: true,
      opacity: 0.98
    })

    this.mesh = new THREE.InstancedMesh(geometry, material, this.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3)
    this.add(this.mesh)

    this.startTime = performance.now()
  }

  update() {
    if (!this.mesh) return

    const analyser = App.audioManager?.analyserNode
    let freqData = null
    if (analyser) {
      freqData = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(freqData)
    }

    const time = (performance.now() - this.startTime) * 0.001
    const scaleTime = time * 0.6
    const fieldFreq = 0.45
    const hueTime = time * 0.12

    let idx = 0
    for (let r = 0; r < this.rows; r++) {
      const yNorm = r / (this.rows - 1)
      for (let c = 0; c < this.cols; c++) {
        const xNorm = c / (this.cols - 1)

        // Map x to a frequency bin for per-column reactivity
        let amp = 0.2
        if (freqData) {
          const bin = Math.min(freqData.length - 1, Math.floor(xNorm * freqData.length))
          amp = freqData[bin] / 255
        }

        // Flow angle from simplex noise
        const n = this.noise.noise((c - this.cols * 0.5) * fieldFreq * 0.05, (r - this.rows * 0.5) * fieldFreq * 0.05, scaleTime)
        const angle = n * Math.PI * 1.2 + Math.sin(time * 0.4 + xNorm * 3.0 + yNorm * 2.0) * 0.35

        // Length reacts to audio and a swirl toward center
        const centerPull = 0.4 + Math.hypot(xNorm - 0.5, yNorm - 0.5)
        const length = 0.55 + amp * 1.6 + centerPull * 0.12

        // Position on plane
        const x = (c - this.cols / 2) * this.spacing
        const y = (r - this.rows / 2) * this.spacing
        this.dummy.position.set(x, y, 0)

        // Orient capsule in XY plane pointing along angle
        this.dummy.rotation.set(0, 0, angle)
        this.dummy.scale.set(1, 1 + length, 1)
        this.dummy.updateMatrix()
        this.mesh.setMatrixAt(idx, this.dummy.matrix)

        // Rainbow hue with audio pop
        const hue = (hueTime + xNorm * 1.2 + yNorm * 0.9 + amp * 0.2) % 1.0
        const light = 0.35 + amp * 0.45
        const sat = 0.65 + amp * 0.35
        this.tempColor.setHSL(hue, sat, light)
        this.mesh.instanceColor.setXYZ(idx, this.tempColor.r, this.tempColor.g, this.tempColor.b)

        idx++
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor.needsUpdate = true

    // Gentle camera sway
    if (App.camera) {
      App.camera.position.z = 14 + Math.sin(time * 0.2) * 0.6
      App.camera.position.x = Math.sin(time * 0.18) * 0.6
      App.camera.position.y = Math.cos(time * 0.22) * 0.6
      App.camera.lookAt(0, 0, 0)
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
