/**
 * VoxelLiquidSpectrum
 * 3D time-evolving spectrum made of voxel columns (inspired by mrdoob voxels_liquid)
 * Dark mode: emissive neon on black
 */

import * as THREE from 'three'
import App from '../../App'

export default class VoxelLiquidSpectrum extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Voxel Liquid Spectrum'

    this.widthBins = 64
    this.depthTrail = 64
    this.maxHeight = 12
    this.spacing = 0.9
    this.trail = new Array(this.depthTrail).fill(null).map(() => new Float32Array(this.widthBins))
    this.trailCursor = 0
    this.instanced = null
    this.color = new THREE.Color()
    this.clock = new THREE.Clock()
  }

  init() {
    App.holder.add(this)

    // Camera setup
    if (App.camera) {
      App.camera.position.set(0, 18, 38)
      App.camera.lookAt(0, 6, 0)
    }

    // Lights (subtle, mostly emissive)
    const ambient = new THREE.AmbientLight(0x222222)
    const dir = new THREE.DirectionalLight(0x555555, 0.6)
    dir.position.set(1, 2, 1)
    this.add(ambient)
    this.add(dir)

    // Material and geometry
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d1b2a,
      emissive: 0x3bf4ff,
      emissiveIntensity: 1.2,
      metalness: 0.1,
      roughness: 0.35,
      transparent: true
    })

    this.instanced = new THREE.InstancedMesh(geo, mat, this.widthBins * this.depthTrail)
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.instanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.widthBins * this.depthTrail * 3), 3)
    this.add(this.instanced)

    // Ground grid for depth sense
    const grid = new THREE.GridHelper(this.widthBins * this.spacing, this.widthBins, 0x0d1b2a, 0x0d1b2a)
    grid.position.z = -(this.depthTrail * this.spacing) * 0.5
    this.add(grid)

    // Dark scene
    if (App.renderer) {
      App.renderer.setClearColor(0x000000, 1)
    }
  }

  update() {
    if (!App.audioManager?.analyserNode || !this.instanced) return

    const analyser = App.audioManager.analyserNode
    const freqData = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(freqData)

    // Downsample to bins
    const binSize = Math.floor(freqData.length / this.widthBins)
    const newestRow = new Float32Array(this.widthBins)
    for (let i = 0; i < this.widthBins; i++) {
      let sum = 0
      for (let j = 0; j < binSize; j++) {
        sum += freqData[i * binSize + j]
      }
      newestRow[i] = sum / binSize / 255 // 0..1
    }

    // Insert into circular buffer
    this.trailCursor = (this.trailCursor + this.depthTrail - 1) % this.depthTrail
    this.trail[this.trailCursor] = newestRow

    // Instance update
    const dummy = new THREE.Object3D()
    const now = this.clock.getElapsedTime()

    let idx = 0
    for (let d = 0; d < this.depthTrail; d++) {
      const row = this.trail[(this.trailCursor + d) % this.depthTrail]
      const z = -d * this.spacing
      const depthFade = 1.0 - d / this.depthTrail
      for (let x = 0; x < this.widthBins; x++) {
        const amp = row[x]
        const h = Math.max(0.05, amp * this.maxHeight)
        dummy.position.set((x - this.widthBins / 2) * this.spacing, h * 0.5, z)
        dummy.scale.set(0.8, h, 0.8)
        dummy.updateMatrix()
        this.instanced.setMatrixAt(idx, dummy.matrix)

        // Color: cyan to magenta based on amplitude, depth tinted
        const hue = 180 + amp * 120
        const sat = 0.7 + amp * 0.3
        const light = 0.2 + amp * 0.5 + depthFade * 0.2
        this.color.setHSL(hue / 360, sat, light)
        this.instanced.instanceColor.setXYZ(idx, this.color.r, this.color.g, this.color.b)

        idx++
      }
    }

    this.instanced.instanceMatrix.needsUpdate = true
    this.instanced.instanceColor.needsUpdate = true

    // Slow camera orbit for motion
    if (App.camera) {
      const radius = 38
      App.camera.position.x = Math.cos(now * 0.08) * radius
      App.camera.position.z = Math.sin(now * 0.08) * radius
      App.camera.position.y = 18 + Math.sin(now * 0.3) * 2
      App.camera.lookAt(0, 6, -this.depthTrail * this.spacing * 0.25)
    }
  }

  destroy() {
    if (this.instanced) {
      this.instanced.geometry.dispose()
      this.instanced.material.dispose()
    }
    if (this.parent) this.parent.remove(this)
  }
}
