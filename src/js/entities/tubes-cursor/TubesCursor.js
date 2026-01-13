import * as THREE from 'three'
import App from '../../App'
import createTubesCursor from 'threejs-components/build/cursors/tubes1.min.js'

export default class TubesCursor extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'tubes-cursor'

    // This visualizer owns its own renderer/animation loop.
    this.rendersSelf = true

    this._layer = null
    this._canvas = null
    this._prevMainCanvasDisplay = null
    this._app = null

    this._lastIntensity = null
    this._lastBeatColorAt = 0

    this._pump = {
      env: 0,
      lastBeatAt: 0,
    }

    this._baseCameraZ = null
    this._palette = {
      from: null,
      to: null,
      t: 1,
      duration: 1,
      lastUpdateAt: 0,
      lastAppliedKey: '',
    }

    this._snake = {
      head: new THREE.Vector3(0, 0, 0),
      angle: Math.random() * Math.PI * 2,
      turn: 0,
      turnTarget: (Math.random() * 2 - 1),
      nextTurnAt: 0,

      // Speed multiplier controller (smooth random accel/decel).
      speedMul: 6,
      speedMulVel: 0,
      speedMulTarget: 6,
      nextSpeedAt: 0,
    }
  }

  init() {
    this._mountCanvasLayer()

    const initialColors = ['#f967fb', '#53bc28', '#6958d5']

    // The library's default scene is already visually rich; we just set colors.
    this._app = createTubesCursor(this._canvas, {
      // Reduce aura/glow (bloom) while keeping some punch.
      bloom: {
        threshold: 0.6,
        strength: 0.22,
        radius: 0.06,
      },
      tubes: {
        colors: initialColors,
        // Make the tubes feel longer by increasing segment count and
        // increasing trailing (lower lerp => more stretch).
        minTubularSegments: 96,
        maxTubularSegments: 196,
        lerp: 0.33,
        // Reduce peak brightness by making the material less reflective.
        material: {
          // Slightly glossier, without going full mirror.
          metalness: 0.74,
          roughness: 0.5,
        },
        lights: {
          intensity: 115,
          colors: ['#83f36e', '#fe8a2e', '#ff008a', '#60aed5'],
        },
      },
    })

    if (this._app?.three?.camera?.position) {
      this._baseCameraZ = this._app.three.camera.position.z
    }

    // Initialize palette transition state to the initial colors.
    this._palette.from = initialColors.map((c) => new THREE.Color(c))
    this._palette.to = initialColors.map((c) => new THREE.Color(c))
    this._palette.t = 1
    this._palette.duration = 1
    this._palette.lastUpdateAt = performance.now() / 1000

    // Override the library's default pointer-follow behavior.
    // We drive the tube "head" with a smooth random-walk (snake-like) path.
    if (this._app?.three && this._app?.tubes) {
      this._app.three.onBeforeRender = (time) => {
        this._updateSnake(time)
        if (this._app?.tubes?.target?.copy) {
          this._app.tubes.target.copy(this._snake.head)
        }
        this._app?.tubes?.update?.(time)
      }
    }
  }

  update(audioData) {
    // Optional audio-reactive tweak: modulate light intensity with bass.
    if (!audioData || !this._app?.tubes) return

    const now = performance.now() / 1000
    const dt = this._palette.lastUpdateAt ? Math.max(0, Math.min(0.1, now - this._palette.lastUpdateAt)) : 0.016
    this._palette.lastUpdateAt = now

    const bass = Math.max(0, Math.min(1, audioData.frequencies?.bass ?? 0))
    // Emphasize loud bass hits without making low/medium bass too reactive.
    // Maps bass in [0.25..1] -> [0..1] with a steeper curve near 1.
    const bassHigh = Math.max(0, (bass - 0.25) / 0.75)
    const bassPunch = Math.pow(bassHigh, 1.7)

    // Pump envelope:
    // - rises quickly on beat when bass is high
    // - decays smoothly over time
    // - adds a rhythmic “breathing” feel when bass is sustained
    const decay = Math.exp(-dt / 0.22)
    this._pump.env *= decay

    if (audioData.isBeat && bass >= 0.18) {
      // Avoid double-triggering too fast.
      if (now - this._pump.lastBeatAt > 0.12) {
        this._pump.lastBeatAt = now
        this._pump.env = Math.min(1.25, this._pump.env + 0.55 + 0.55 * bassPunch)
      }
    }

    const osc = 0.5 + 0.5 * Math.sin(now * 6.2 * Math.PI * 2)
    const pump = bassPunch * (0.35 + 0.65 * osc) + this._pump.env * bassPunch

    // Keep changes smooth + avoid spamming setters.
    // Stronger response only when bass is loud + add a pump component.
    // Pump is gated by bassPunch so low bass stays calm.
    const intensity = 36 + bassPunch * 135 + pump * 95
    if (this._lastIntensity == null || Math.abs(intensity - this._lastIntensity) > 2) {
      this._app.tubes.setLightsIntensity(intensity)
      this._lastIntensity = intensity
    }

    // Subtle “zoom” pump (kept small to avoid nausea).
    if (this._baseCameraZ != null && this._app?.three?.camera?.position) {
      const z = this._baseCameraZ - 0.28 * pump
      this._app.three.camera.position.z += (z - this._app.three.camera.position.z) * (1 - Math.pow(0.001, dt))
    }

    // Intentionally avoid emissive pumping here: it quickly reads as "glow".

    // On beats, pick a new target palette. Transition duration depends on bass:
    // - no/very low bass: no change (prevents visible flashing)
    // - low bass: very slow cross-fade (gradual, non-intrusive)
    // - loud bass: faster, but still not abrupt
    if (audioData.isBeat) {
      // Avoid rapid changes on consecutive beats.
      if (now - this._lastBeatColorAt < 0.18) {
        // still advance any in-flight transition
      } else {
        this._lastBeatColorAt = now

        // No/very low bass => no visible flashing.
        if (bass >= 0.08) {
          // Bass-mapped brightness (capped so it's never too intrusive).
          // Use the same "punch" curve so low bass stays subtle.
          const beatBrightness = 0.16 + 0.52 * bassPunch // 0.16..0.68

          // Bass-mapped duration: quieter => slower transition.
          const duration = bass < 0.2
            ? (8 + Math.random() * 6) // 8..14s
            : bass < 0.33
              ? (5 + Math.random() * 4) // 5..9s
              : (1.4 + Math.random() * 1.4) // 1.4..2.8s

          const colors = this._randomHexColors(3, beatBrightness)
          this._setTargetPalette(colors, duration)
        }
      }
    }

    // Apply any in-progress palette cross-fade.
    this._advanceAndApplyPalette(dt)
  }

  destroy() {
    try {
      this._app?.dispose?.()
    } finally {
      this._app = null
      this._unmountCanvasLayer()
    }
  }

  _mountCanvasLayer() {
    const container = document.querySelector('.content') || document.body

    this._layer = document.createElement('div')
    this._layer.dataset.visualizerLayer = this.name
    this._layer.style.position = 'fixed'
    this._layer.style.inset = '0'
    this._layer.style.zIndex = '0'
    this._layer.style.pointerEvents = 'none'

    this._canvas = document.createElement('canvas')
    this._canvas.style.width = '100%'
    this._canvas.style.height = '100%'
    this._canvas.style.display = 'block'
    this._canvas.style.pointerEvents = 'none'

    this._layer.appendChild(this._canvas)
    container.appendChild(this._layer)

    // Hide the app's main renderer canvas to avoid "double canvases".
    const mainCanvas = App.renderer?.domElement
    if (mainCanvas) {
      this._prevMainCanvasDisplay = mainCanvas.style.display
      mainCanvas.style.display = 'none'
    }
  }

  _unmountCanvasLayer() {
    const mainCanvas = App.renderer?.domElement
    if (mainCanvas) {
      mainCanvas.style.display = this._prevMainCanvasDisplay ?? ''
    }

    this._prevMainCanvasDisplay = null

    if (this._layer?.parentNode) {
      this._layer.parentNode.removeChild(this._layer)
    }

    this._layer = null
    this._canvas = null
  }

  _randomHexColors(count, brightness = 1) {
    const b = Math.max(0, Math.min(1, brightness))

    // Rainbow palette: evenly-spaced hues with a random offset,
    // so the set reads as "rainbow" rather than arbitrary random RGB.
    const baseHue = Math.random()
    const sat = 1.0
    const light = 0.14 + 0.34 * b // 0.14..0.48 (caps max brightness)

    return new Array(count).fill(0).map((_, i) => {
      const hue = (baseHue + (i / Math.max(1, count))) % 1
      const color = new THREE.Color().setHSL(hue, sat, light)
      return `#${color.getHexString()}`
    })
  }

  _setTargetPalette(hexColors, durationSeconds) {
    if (!Array.isArray(hexColors) || hexColors.length === 0) return
    const dur = Math.max(0.5, Math.min(20, durationSeconds ?? 2))

    const current = this._getDisplayedPaletteColors()
    this._palette.from = current.map((c) => c.clone())
    this._palette.to = hexColors.map((c) => new THREE.Color(c))
    this._palette.t = 0
    this._palette.duration = dur
  }

  _getDisplayedPaletteColors() {
    if (!this._palette.from || !this._palette.to) {
      return ['#f967fb', '#53bc28', '#6958d5'].map((c) => new THREE.Color(c))
    }

    if (this._palette.t >= 1) {
      return this._palette.to.map((c) => c.clone())
    }

    const t = Math.max(0, Math.min(1, this._palette.t))
    return this._palette.from.map((from, i) => {
      const to = this._palette.to[i % this._palette.to.length]
      return from.clone().lerp(to, t)
    })
  }

  _advanceAndApplyPalette(dt) {
    if (!this._app?.tubes) return
    if (!this._palette.from || !this._palette.to) return

    if (this._palette.t < 1) {
      this._palette.t = Math.min(1, this._palette.t + (dt / Math.max(0.001, this._palette.duration)))
    }

    const display = this._getDisplayedPaletteColors()
    const hex = display.map((c) => `#${c.getHexString()}`)
    const key = hex.join(',')
    if (key !== this._palette.lastAppliedKey) {
      this._app.tubes.setColors(hex)
      this._palette.lastAppliedKey = key
    }
  }

  _updateSnake(time) {
    const three = this._app?.three
    const options = this._app?.options
    if (!three?.size || !options) return

    const dt = Math.max(0.001, Math.min(0.05, time?.delta ?? 0.016))
    const elapsed = time?.elapsed ?? performance.now() / 1000

    // Use the full visible world area (with a tiny margin) so the motion
    // can explore the entire screen.
    const margin = 0.96
    const fallbackScale = (three.size.wWidth && three.size.width) ? (three.size.wWidth / three.size.width) : 1
    const fallbackX = (options.sleepRadiusX ?? 300) * fallbackScale
    const fallbackY = (options.sleepRadiusY ?? 150) * fallbackScale

    const worldHalfW = (three.size.wWidth ?? (fallbackX * 2)) * 0.5
    const worldHalfH = (three.size.wHeight ?? (fallbackY * 2)) * 0.5

    const maxX = Math.max(1, worldHalfW * margin)
    const maxY = Math.max(1, worldHalfH * margin)
    const minBound = Math.max(1, Math.min(maxX, maxY))

    // Slowly vary the turning input so movement feels "snake-like" instead of jittery.
    if (elapsed >= this._snake.nextTurnAt) {
      this._snake.turnTarget = (Math.random() * 2 - 1)
      this._snake.nextTurnAt = elapsed + 0.35 + Math.random() * 0.75
    }

    // Pick a new random speed target periodically.
    if (elapsed >= this._snake.nextSpeedAt) {
      // 3x to 12x faster.
      this._snake.speedMulTarget = 3 + Math.random() * 9
      // Hold each target long enough to feel like "steady" accel/decel.
      this._snake.nextSpeedAt = elapsed + 2.8 + Math.random() * 4.2
    }

    // Ease current turn toward target.
    const turnLerp = 1 - Math.pow(0.001, dt) // frame-rate independent
    this._snake.turn += (this._snake.turnTarget - this._snake.turn) * turnLerp

    // Smoothly accelerate/decelerate speed multiplier toward the target.
    // Critically-damped 2nd order system (no oscillation, steady ramps).
    const k = 6 // stiffness (lower => slower, steadier ramps)
    const c = 2 * Math.sqrt(k) // critical damping
    this._snake.speedMulVel += (this._snake.speedMulTarget - this._snake.speedMul) * k * dt
    this._snake.speedMulVel *= Math.exp(-c * dt)
    this._snake.speedMul += this._snake.speedMulVel * dt
    this._snake.speedMul = Math.max(3, Math.min(12, this._snake.speedMul))

    const turnRate = 1.15 // rad/s
    const speed = (0.18 * minBound) * this._snake.speedMul // world units / s

    this._snake.angle += this._snake.turn * turnRate * dt

    const vx = Math.cos(this._snake.angle) * speed
    const vy = Math.sin(this._snake.angle) * speed

    this._snake.head.x += vx * dt
    this._snake.head.y += vy * dt

    // Bounce off bounds (reflect heading) to keep it "inside" the available space.
    if (this._snake.head.x > maxX) {
      this._snake.head.x = maxX
      this._snake.angle = Math.PI - this._snake.angle
    } else if (this._snake.head.x < -maxX) {
      this._snake.head.x = -maxX
      this._snake.angle = Math.PI - this._snake.angle
    }

    if (this._snake.head.y > maxY) {
      this._snake.head.y = maxY
      this._snake.angle = -this._snake.angle
    } else if (this._snake.head.y < -maxY) {
      this._snake.head.y = -maxY
      this._snake.angle = -this._snake.angle
    }

    // Keep Z on the interaction plane.
    this._snake.head.z = 0
  }
}
