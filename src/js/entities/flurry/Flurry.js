/**
 * Flurry
 * Audio-reactive particle flurry inspired by mike-seger flurry demo.
 * Additive colored streaks on dark background; audio drives speed and curl.
 */

import * as THREE from 'three'
import App from '../../App'

// Lightweight simplex noise for flow field
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
    const X0 = i - t, Y0 = j - t, Z0 = k - t
    const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0
    let i1, j1, k1, i2, j2, k2
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1 }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1 }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1 }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1 }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0 }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3
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

export default class Flurry extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Flurry'

    this.count = 900
    this.bounds = 12
    this.positions = new Float32Array(this.count * 3)
    this.velocities = new Float32Array(this.count * 3)
    this.colors = new Float32Array(this.count * 3)
    this.noise = new SimplexNoise()
    this.dummy = new THREE.Object3D()
    this.tempColor = new THREE.Color()
  }

  init() {
    App.holder.add(this)

    if (App.renderer) {
      App.renderer.setClearColor(0x000000, 1)
    }

    if (App.camera) {
      App.camera.position.set(0, 0, 20)
      App.camera.lookAt(0, 0, 0)
    }

    // Seed positions/velocities/colors
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3 + 0] = (Math.random() - 0.5) * this.bounds * 2
      this.positions[i * 3 + 1] = (Math.random() - 0.5) * this.bounds * 2
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.bounds * 2

      this.velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.4
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4

      this.tempColor.setHSL(Math.random(), 0.8, 0.6)
      this.colors[i * 3 + 0] = this.tempColor.r
      this.colors[i * 3 + 1] = this.tempColor.g
      this.colors[i * 3 + 2] = this.tempColor.b
    }

    const geometry = new THREE.PlaneGeometry(0.1, 1.5)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
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
    let audioBoost = 0
    let bassBoost = 0
    if (analyser) {
      const freqData = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(freqData)
      const len = freqData.length
      const third = Math.max(1, Math.floor(len / 3))
      let bassSum = 0
      for (let i = 0; i < third; i++) bassSum += freqData[i]
      let midSum = 0
      for (let i = third; i < third * 2; i++) midSum += freqData[i]
      bassBoost = (bassSum / third) / 255
      audioBoost = (midSum / third) / 255
    }

    const time = (performance.now() - this.startTime) * 0.001
    const nScale = 0.18
    const flow = 0.8 + audioBoost * 2.2
    const speedBase = 0.16 + bassBoost * 0.7
    const decay = 0.985

    const up = new THREE.Vector3(0, 1, 0)
    const dir = new THREE.Vector3()

    for (let i = 0; i < this.count; i++) {
      const ix = i * 3
      let x = this.positions[ix]
      let y = this.positions[ix + 1]
      let z = this.positions[ix + 2]

      // Curl-like steering from simplex noise
      const nx = this.noise.noise(x * nScale, y * nScale, time * 0.4)
      const ny = this.noise.noise(y * nScale, z * nScale, time * 0.4 + 10.0)
      const nz = this.noise.noise(z * nScale, x * nScale, time * 0.4 + 20.0)

      // Update velocity
      this.velocities[ix] = (this.velocities[ix] + nx * flow) * decay
      this.velocities[ix + 1] = (this.velocities[ix + 1] + ny * flow) * decay
      this.velocities[ix + 2] = (this.velocities[ix + 2] + nz * flow) * decay

      // Integrate position
      x += this.velocities[ix] * speedBase
      y += this.velocities[ix + 1] * speedBase
      z += this.velocities[ix + 2] * speedBase

      // Wrap bounds to keep density
      const b = this.bounds
      if (x > b) x = -b; else if (x < -b) x = b
      if (y > b) y = -b; else if (y < -b) y = b
      if (z > b) z = -b; else if (z < -b) z = b

      this.positions[ix] = x
      this.positions[ix + 1] = y
      this.positions[ix + 2] = z

      // Orient streak along velocity vector
      dir.set(this.velocities[ix], this.velocities[ix + 1], this.velocities[ix + 2])
      const speed = dir.length() + 1e-5
      dir.normalize()

      this.dummy.position.set(x, y, z)
      this.dummy.quaternion.setFromUnitVectors(up, dir.lengthSq() > 0 ? dir : up)
      const len = THREE.MathUtils.clamp(speed * 16.0, 0.6, 8.0)
      const wid = 0.06 + audioBoost * 0.08
      this.dummy.scale.set(wid, len, 1)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.mesh.instanceMatrix.needsUpdate = true

    // Subtle camera drift
    if (App.camera) {
      App.camera.position.x = Math.sin(time * 0.12) * 1.6
      App.camera.position.y = Math.cos(time * 0.1) * 1.2
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
