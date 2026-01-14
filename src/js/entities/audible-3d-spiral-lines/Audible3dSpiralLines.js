import * as THREE from 'three'
import App from '../../App'

export default class Audible3dSpiralLines extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Audible3dSpiralLines'

    this.numParticles = 1400
    this.pointsPerParticle = 3 // min / mid / current

    // Match the working shader-sprite sizing feel.
    this.pointScale = 3.0

    this.intensity = 0.18
    this.time = 0

    // 3D flower params (latest tuned variant)
    this.flowerBaseRadius = 2.8
    this.flowerPetalsAmplitude = 1.6
    this.flowerPetals = 6
    this.flowerTurns = 6
    this.flowerRadiusScale = 6.0

    // Bidirectional orthogonal lift multiplier (+60% then another +60%).
    this.liftMultiplier3d = 1.6 * 1.6

    this._tmpColor = new THREE.Color()
    this._spriteTex = null

    // Camera framing cache
    this._cameraTargetY = 0
  }

  init() {
    App.holder.add(this)

    // Tilt back 90° so local +Z reads as world +Y (up in viewport)
    this.rotation.x = -Math.PI / 2

    this._initPoints()

    // Camera framing (same as tuned 3D dotted spiral)
    const dist = 45
    const elev = THREE.MathUtils.degToRad(20)
    App.camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist)

    // Move apparent center ~20% upwards by aiming below origin.
    const fovRad = THREE.MathUtils.degToRad(App.camera.fov)
    const halfHeightAtDist = Math.tan(fovRad / 2) * dist
    const shift = 0.2 * (2 * halfHeightAtDist)
    this._cameraTargetY = -shift

    App.camera.lookAt(0, this._cameraTargetY, 0)
  }

  _initPoints() {
    const totalPoints = this.numParticles * this.pointsPerParticle

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(totalPoints * 3)
    const colors = new Float32Array(totalPoints * 3)
    const sizes = new Float32Array(totalPoints)

    for (let i = 0; i < totalPoints; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      colors[i * 3] = 1
      colors[i * 3 + 1] = 1
      colors[i * 3 + 2] = 1
      sizes[i] = 0.5
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

    this._spriteTex = this._createCircleTexture()

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSprite: { value: this._spriteTex },
        uOpacity: { value: 1.0 },
        uPointScale: { value: this.pointScale },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;

        varying vec4 vColor;
        uniform float uPointScale;

        void main() {
          vColor = vec4(color, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = size * uPointScale;
        }
      `,
      fragmentShader: `
        uniform sampler2D uSprite;
        uniform float uOpacity;
        varying vec4 vColor;

        void main() {
          vec4 sprite = texture2D(uSprite, gl_PointCoord);
          if (sprite.a < 0.02) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * sprite.a * uOpacity);
        }
      `,
    })

    this._geom = geometry
    this._mat = material
    this._points = new THREE.Points(geometry, material)
    this._points.frustumCulled = false
    this.add(this._points)
  }

  _createCircleTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)

    return new THREE.CanvasTexture(canvas)
  }

  _averageBand(freqData, start, end) {
    const s = Math.max(0, start)
    const e = Math.min(freqData.length - 1, end)
    if (e <= s) return 0

    let sum = 0
    for (let i = s; i <= e; i++) sum += freqData[i]
    return (sum / (e - s + 1)) / 255
  }

  _rmsAmplitude(timeDomainData) {
    const step = 8
    let sumSq = 0
    let count = 0
    for (let i = 0; i < timeDomainData.length; i += step) {
      const v = (timeDomainData[i] - 128) / 128
      sumSq += v * v
      count++
    }
    if (!count) return 0
    return Math.sqrt(sumSq / count)
  }

  update(_deltaTime) {
    const audioManager = App.audioManager
    if (!audioManager?.analyserNode) return

    this.time += 0.01

    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const freqData = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(freqData)

    const timeDomainData = new Uint8Array(audioManager.analyserNode.fftSize)
    audioManager.analyserNode.getByteTimeDomainData(timeDomainData)

    const amp = this._rmsAmplitude(timeDomainData)
    const eLow = this._averageBand(freqData, 2, 24)
    const eMid = this._averageBand(freqData, 25, 96)
    const eHigh = this._averageBand(freqData, 97, 220)
    const energy = eLow * 0.45 + eMid * 0.4 + eHigh * 0.15

    const positions = this._geom.attributes.position.array
    const colors = this._geom.attributes.color.array
    const sizes = this._geom.attributes.size.array

    const maxTheta = Math.PI * 2 * this.flowerTurns
    const liftBase = (amp * 6.0 + energy * 3.0) * this.liftMultiplier3d

    for (let i = 0; i < this.numParticles; i++) {
      const t = i / (this.numParticles - 1)
      const theta = t * maxTheta

      const freqIndex = Math.floor(t * (bufferLength - 1))
      const freqValue = freqData[freqIndex] / 255
      const timeValue = (timeDomainData[i % timeDomainData.length] - 128) / 128

      const spiralRamp = t * 1.8
      const petalWave = Math.sin(theta * (this.flowerPetals / this.flowerTurns) + this.time)
      const base = this.flowerBaseRadius + spiralRamp
      const flower = petalWave * this.flowerPetalsAmplitude
      const radius = (base + flower + freqValue * this.intensity * 6) * this.flowerRadiusScale

      const x = Math.cos(theta) * radius
      const y = Math.sin(theta) * radius

      const baseZ = timeValue * 0.9 + Math.sin(theta * 0.5 + this.time) * 0.25

      const liftAbsMax = liftBase * (0.35 + t * 0.85)
      const liftWave = Math.sin(theta * 0.35 + this.time * 1.4)
      const lift = liftAbsMax * liftWave

      const zMin = baseZ - liftAbsMax
      const zCur = baseZ + lift
      const zMid = (zMin + zCur) * 0.5

      const hue = ((theta / (Math.PI * 2)) + this.time * 0.04 + freqValue * 0.15) % 1
      this._tmpColor.setHSL(hue, 0.92, 0.56)
      const brightness = 0.35 + freqValue * 0.95

      const baseSize = 1.7 + t * 1.6 + freqValue * 0.9

      // 3 dots per particle: min (dim/smaller), mid, current (brightest)
      const dots = [
        { z: zMin, sizeMul: 0.75, colMul: 0.35 },
        { z: zMid, sizeMul: 0.9, colMul: 0.65 },
        { z: zCur, sizeMul: 1.05, colMul: 1.0 },
      ]

      for (let j = 0; j < 3; j++) {
        const pIndex = (i * 3 + j)
        const k = pIndex * 3

        positions[k] = x
        positions[k + 1] = y
        positions[k + 2] = dots[j].z

        const cm = dots[j].colMul * brightness
        colors[k] = this._tmpColor.r * cm
        colors[k + 1] = this._tmpColor.g * cm
        colors[k + 2] = this._tmpColor.b * cm

        sizes[pIndex] = baseSize * dots[j].sizeMul
      }
    }

    this._geom.attributes.position.needsUpdate = true
    this._geom.attributes.color.needsUpdate = true
    this._geom.attributes.size.needsUpdate = true

    this.rotation.z += 0.001 + energy * 0.008
  }

  destroy() {
    if (this._points) this.remove(this._points)
    if (this._geom) this._geom.dispose()
    if (this._mat) this._mat.dispose()
    if (this._spriteTex) this._spriteTex.dispose()
    App.holder.remove(this)
  }
}