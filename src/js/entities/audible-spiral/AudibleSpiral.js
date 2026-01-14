import * as THREE from 'three'
import App from '../../App'

// Inspired by https://github.com/soniaboller/audible-visuals (Apache-2.0)
// This project keeps the two original spiral variants:
// 1) Spiral  2) Wavy / 3D Spiral

export const MODES = {
  SPIRAL: 1,
  // This is the latest-tuned "3D" look (tilted flower spiral).
  FLOWER_3D: 2,
}

export class AudibleSpiralCore extends THREE.Object3D {
  constructor({ initialMode = MODES.SPIRAL, enableHotkeys = false } = {}) {
    super()
    this.name = 'AudibleSpiral'

    this.enableHotkeys = enableHotkeys

    this.numParticles = 1400

    // Global point-size scale ("dot radius" feel). User-requested: 3x.
    this.pointScale = 3.0

    // Shared
    // Note: original audible-visuals was in a different rendering scale.
    // In this project we scale audio influence up so motion/color clearly reacts.
    this.intensity = 0.18
    this.time = 0

    // Mode params (tuned for this project’s scale)
    this.a = 0.05
    this.b = 0.12
    // Use an animated angle closer to the original (roughly 9-13).
    this.angleBase = 11
    this.angleRange = 2

    // Mode radii scales (affect the overall visual radius only; dot sizes unchanged).
    this.spiralRadiusScale = 2.0 * 1.8

    this.aWavy = 1.2
    this.bWavy = 0.76
    this.wavyAngleBase = 2.44
    this.wavyAngleRange = 0.045
    this.waveAmplitude = 0.5
    this.waveFrequency = 8

    this.wavyRadiusScale = 1.0 * 1.5

    // 3D flower params (this is the variant we tuned most recently).
    this.flowerBaseRadius = 2.8
    this.flowerPetalsAmplitude = 1.6
    this.flowerPetals = 6
    this.flowerTurns = 6

    // Flower scale after tuning.
    this.flowerRadiusScale = 6.0

    // Bidirectional orthogonal lift multiplier.
    // User request: +60% then another +60% => 1.6 * 1.6.
    this.liftMultiplier3d = 1.6 * 1.6

    this.mode = initialMode

    this._tmpColor = new THREE.Color()
  }

  init() {
    App.holder.add(this)

    const circleTexture = this.createCircleTexture()

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(this.numParticles * 3)
    const colors = new Float32Array(this.numParticles * 3)
    const sizes = new Float32Array(this.numParticles)

    for (let i = 0; i < this.numParticles; i++) {
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

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSprite: { value: circleTexture },
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

          // Size is in pixels (small dots like the original).
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

    this.particleSystem = new THREE.Points(geometry, material)
    this.add(this.particleSystem)

    if (this.enableHotkeys) this.setupHotkeys()

    // Apply camera framing for the chosen initial mode.
    this.applyModeView()
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
    // timeDomainData is 0..255 centered at ~128.
    // Return RMS in 0..~1 range.
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

  setupHotkeys() {
    const onKeyDown = (e) => {
      // Ignore when user is typing into inputs.
      const target = e.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      if (e.key === '1') this.setMode(MODES.SPIRAL)
      if (e.key === '2') this.setMode(MODES.FLOWER_3D)
    }

    window.addEventListener('keydown', onKeyDown)
    this.userData.keyHandler = onKeyDown
  }

  setMode(mode) {
    if (this.mode === mode) return
    this.mode = mode

    // Small “kick” so mode change is noticeable.
    this.intensity = 0.25
    setTimeout(() => {
      this.intensity = 0.18
    }, 120)

    this.applyModeView()

    // Helpful for debugging / quick confirmation.
    const label = this.getModeLabel()
    // eslint-disable-next-line no-console
    console.log(`[AudibleSpiral] mode = ${label}`)
  }

  getModeLabel() {
    switch (this.mode) {
      case MODES.SPIRAL:
        return 'Spiral (1)'
      case MODES.FLOWER_3D:
        return '3D Spiral (2)'
      default:
        return 'Unknown'
    }
  }

  applyModeView() {
    // IMPORTANT: do NOT scale camera Z proportionally with radius scale.
    // Otherwise the visual appears the same size on-screen.
    // Use fixed per-mode framing so scaling is actually visible.
    this.rotation.set(0, 0, 0)

    let cameraTargetY = 0

    if (this.mode === MODES.SPIRAL) {
      App.camera.position.set(0, 0, 45)
    } else {
      // 3D Flower: tilt back 90° and view from a 20° downward angle.
      this.rotation.x = -Math.PI / 2

      const dist = 45
      const elev = THREE.MathUtils.degToRad(20)
      App.camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist)

      // Move the *apparent* rotation center ~20% upwards in the viewport by
      // aiming the camera slightly below the origin.
      const fovRad = THREE.MathUtils.degToRad(App.camera.fov)
      const halfHeightAtDist = Math.tan(fovRad / 2) * dist
      const shift = 0.2 * (2 * halfHeightAtDist)
      cameraTargetY = -shift
    }

    App.camera.lookAt(0, cameraTargetY, 0)
  }

  createCircleTexture() {
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

  update(_deltaTime) {
    const audioManager = App.audioManager
    if (!audioManager?.analyserNode) return
    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) return

    this.time += 0.01

    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const freqData = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(freqData)

    const timeDomainData = new Uint8Array(audioManager.analyserNode.fftSize)
    audioManager.analyserNode.getByteTimeDomainData(timeDomainData)

    // Time-domain amplitude (kick/volume feel).
    this._amplitude = this._rmsAmplitude(timeDomainData)

    // A little global energy helps make motion feel alive.
    this._energyLow = this._averageBand(freqData, 2, 24)
    this._energyMid = this._averageBand(freqData, 25, 96)
    this._energyHigh = this._averageBand(freqData, 97, 220)
    this._energy = (this._energyLow * 0.45 + this._energyMid * 0.4 + this._energyHigh * 0.15)

    switch (this.mode) {
      case MODES.SPIRAL:
        this.updateSpiral(freqData, timeDomainData)
        break
      case MODES.FLOWER_3D:
        this.updateFlower3d(freqData, timeDomainData)
        break
      default:
        this.updateSpiral(freqData, timeDomainData)
    }
  }

  updateSpiral(freqData, timeDomainData) {
    const bufferLength = freqData.length

    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array

    const dynamicAngle = this.angleBase + Math.sin(this.time * 0.35) * this.angleRange
    const maxRadius = this.a + this.b * Math.PI * 2 * dynamicAngle

    for (let i = 0; i < this.numParticles; i++) {
      const t = i / this.numParticles
      const theta = t * Math.PI * 2 * dynamicAngle
      const radius = this.a + this.b * theta

      const freqIndex = Math.floor(t * (bufferLength - 1))
      const freqValue = freqData[freqIndex] / 255
      const timeValue = (timeDomainData[i % timeDomainData.length] - 128) / 128

      // Stronger displacement than the old PointsMaterial version.
      const wobble = Math.sin(theta * 0.35 + this.time * 1.8) * (0.08 + this._energy * 0.35)
      const audioRadius = radius + wobble + freqValue * this.intensity * (6.0 + this._energy * 10.0)

      positions[i * 3] = Math.cos(theta) * audioRadius * this.spiralRadiusScale
      positions[i * 3 + 1] = Math.sin(theta) * audioRadius * this.spiralRadiusScale
      positions[i * 3 + 2] = timeValue * (0.55 + this._energy * 0.55)

      const normalizedRadius = radius / maxRadius

      // Keep a similar look to existing Spiral.js (blue->cyan->magenta->red).
      let r, g, b
      if (normalizedRadius < 0.33) {
        const u = normalizedRadius / 0.33
        r = 0
        g = u * 0.5
        b = 1
      } else if (normalizedRadius < 0.66) {
        const u = (normalizedRadius - 0.33) / 0.33
        r = u
        g = 0.5 * (1 - u)
        b = 1
      } else {
        const u = (normalizedRadius - 0.66) / 0.34
        r = 1
        g = 0
        b = 1 - u
      }

      // More visible audio-driven color changes.
      // User-requested: increase brightness for mode 1.
      const brightness = 0.55 + freqValue * 1.35 + this._energy * 0.35
      const pulse = 0.75 + Math.sin(this.time * 2.2 + theta * 0.02) * 0.25

      colors[i * 3] = r * brightness * pulse
      colors[i * 3 + 1] = g * brightness * pulse
      colors[i * 3 + 2] = b * brightness * pulse

      // Small dots like the original; slightly larger towards the outside.
      sizes[i] = 1.6 + normalizedRadius * 1.4 + freqValue * 0.8
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true

    this.rotation.z += 0.0012 + this._energy * 0.01
  }

  // Kept for reference; no longer used by the two-selection UI.
  updateWavy(freqData, timeDomainData) {
    const bufferLength = freqData.length

    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array

    const dynamicAngle = this.wavyAngleBase + Math.sin(this.time * 0.28) * this.wavyAngleRange
    const maxRadius = this.aWavy + this.bWavy * Math.PI * 2 * dynamicAngle

    for (let i = 0; i < this.numParticles; i++) {
      const t = i / this.numParticles
      const theta = t * Math.PI * 2 * dynamicAngle
      const radius = this.aWavy + this.bWavy * theta

      const freqIndex = Math.floor(t * (bufferLength - 1))
      const freqValue = freqData[freqIndex] / 255
      const timeValue = (timeDomainData[i % timeDomainData.length] - 128) / 128

      const wave = Math.sin(theta * this.waveFrequency + this.time * (1.0 + this._energyHigh * 0.8)) * (this.waveAmplitude + this._energy * 0.6)
      const radiusWithWave = radius + wave + freqValue * this.intensity * (5.0 + this._energy * 8.0)

      // Bidirectional orthogonal lift (3D feel), driven by amplitude/energy.
      const liftBase = (this._amplitude * 6.0 + this._energy * 3.0) * this.liftMultiplier3d
      const liftWave = Math.sin(theta * 0.35 + this.time * 1.4)
      const lift = liftBase * (0.25 + t * 0.95) * liftWave

      positions[i * 3] = Math.cos(theta) * radiusWithWave * this.wavyRadiusScale
      positions[i * 3 + 1] = Math.sin(theta) * radiusWithWave * this.wavyRadiusScale
      positions[i * 3 + 2] = timeValue * 0.5 + Math.sin(theta * 2 + this.time) * 0.3 + lift

      const normalizedRadius = radius / maxRadius

      // Same gradient as Spiral.
      let r, g, b
      if (normalizedRadius < 0.33) {
        const u = normalizedRadius / 0.33
        r = 0
        g = u * 0.5
        b = 1
      } else if (normalizedRadius < 0.66) {
        const u = (normalizedRadius - 0.33) / 0.33
        r = u
        g = 0.5 * (1 - u)
        b = 1
      } else {
        const u = (normalizedRadius - 0.66) / 0.34
        r = 1
        g = 0
        b = 1 - u
      }

      const brightness = 0.35 + freqValue * 0.95
      colors[i * 3] = r * brightness
      colors[i * 3 + 1] = g * brightness
      colors[i * 3 + 2] = b * brightness

      sizes[i] = 1.9 + normalizedRadius * 1.6 + freqValue * 0.9
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true

    this.rotation.z += 0.0012 + this._energy * 0.01
  }

  updateFlower3d(freqData, timeDomainData) {
    const bufferLength = freqData.length

    const positions = this.particleSystem.geometry.attributes.position.array
    const colors = this.particleSystem.geometry.attributes.color.array
    const sizes = this.particleSystem.geometry.attributes.size.array

    const maxTheta = Math.PI * 2 * this.flowerTurns

    // Bidirectional lift orthogonal to the spiral plane.
    // With the -90° X tilt, local +Z reads as world +Y (up in the viewport).
    const liftBase = (this._amplitude * 6.0 + this._energy * 3.0) * this.liftMultiplier3d

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

      positions[i * 3] = Math.cos(theta) * radius
      positions[i * 3 + 1] = Math.sin(theta) * radius

      const liftWave = Math.sin(theta * 0.35 + this.time * 1.4)
      const lift = liftBase * (0.35 + t * 0.85) * liftWave
      positions[i * 3 + 2] = timeValue * 0.9 + Math.sin(theta * 0.5 + this.time) * 0.25 + lift

      const hue = ((theta / (Math.PI * 2)) + this.time * 0.04 + freqValue * 0.15) % 1
      this._tmpColor.setHSL(hue, 0.92, 0.56)
      const brightness = 0.35 + freqValue * 0.95

      colors[i * 3] = this._tmpColor.r * brightness
      colors[i * 3 + 1] = this._tmpColor.g * brightness
      colors[i * 3 + 2] = this._tmpColor.b * brightness

      sizes[i] = 1.7 + t * 1.6 + freqValue * 0.9
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
    this.particleSystem.geometry.attributes.color.needsUpdate = true
    this.particleSystem.geometry.attributes.size.needsUpdate = true

    this.rotation.z += 0.001 + this._energy * 0.008
  }

  onBPMBeat() {
    const prevIntensity = this.intensity
    const prevWaveAmp = this.waveAmplitude

    this.intensity = Math.min(0.5, this.intensity + 0.12)
    this.waveAmplitude = Math.min(1.0, this.waveAmplitude + 0.3)

    setTimeout(() => {
      this.intensity = prevIntensity
      this.waveAmplitude = prevWaveAmp
    }, 120)
  }

  destroy() {
    if (this.userData.keyHandler) {
      window.removeEventListener('keydown', this.userData.keyHandler)
    }

    if (this.particleSystem) {
      this.particleSystem.geometry.dispose()
      this.particleSystem.material.dispose()
      this.remove(this.particleSystem)
    }

    App.holder.remove(this)
  }
}

export default class AudibleSpiral extends AudibleSpiralCore {
  constructor() {
    super({ initialMode: MODES.SPIRAL, enableHotkeys: false })
    this.name = 'AudibleSpiral'
  }
}
