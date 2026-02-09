import * as THREE from 'three'
import App from '../../App'
export default class TubesCursor extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'tubes-cursor'

    // This visualizer owns its own canvas + renderer.
    this.rendersSelf = true

    this._layer = null
    this._canvas = null
    this._prevMainCanvasDisplay = null

    this._renderer = null
    this._scene = null
    this._camera = null
    this._lights = []

    this._tubeMeshes = []
    this._tubeMaterials = []
    this._tubeGeometry = null
    this._tubeCurve = null
    this._tubePoints = []

    this._lastNow = 0
    this._lastIntensity = null
    this._lastBeatColorAt = 0
    this._baseCameraZ = null

    this._pump = {
      env: 0,
      lastBeatAt: 0,
    }

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
      speedMul: 6,
      speedMulVel: 0,
      speedMulTarget: 6,
      nextSpeedAt: 0,
    }

    this._onResize = () => this._resizeRendererToCanvas()
  }

  init() {
    this._mountCanvasLayer()

    const initialColors = ['#f967fb', '#53bc28', '#6958d5']

    const renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this._renderer = renderer

    const scene = new THREE.Scene()
    this._scene = scene

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 7)
    this._baseCameraZ = camera.position.z
    this._camera = camera

    scene.add(new THREE.AmbientLight(0xffffff, 0.15))
    this._lights = [
      new THREE.PointLight(0x83f36e, 60, 50),
      new THREE.PointLight(0xfe8a2e, 60, 50),
      new THREE.PointLight(0xff008a, 60, 50),
      new THREE.PointLight(0x60aed5, 60, 50),
    ]
    this._lights[0].position.set(-4, -3, 6)
    this._lights[1].position.set(4, -3, 6)
    this._lights[2].position.set(-4, 3, 6)
    this._lights[3].position.set(4, 3, 6)
    this._lights.forEach((l) => scene.add(l))

    // Tube path state
    const pointCount = 42
    this._tubePoints = new Array(pointCount).fill(0).map(() => new THREE.Vector3(0, 0, 0))
    this._tubeCurve = new THREE.CatmullRomCurve3(this._tubePoints)
    this._tubeCurve.curveType = 'catmullrom'
    this._tubeCurve.tension = 0.25

    this._tubeMaterials = initialColors.map((c) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(c),
        metalness: 0.74,
        roughness: 0.5,
      })
    )

    this._rebuildTubeGeometry(true)
    this._tubeMeshes = this._tubeMaterials.map((mat, i) => {
      const mesh = new THREE.Mesh(this._tubeGeometry, mat)
      // Small offsets so multiple tubes read as a bundle.
      mesh.position.z = -0.08 * i
      scene.add(mesh)
      return mesh
    })

    // Initialize palette transition state to the initial colors.
    this._palette.from = initialColors.map((c) => new THREE.Color(c))
    this._palette.to = initialColors.map((c) => new THREE.Color(c))
    this._palette.t = 1
    this._palette.duration = 1
    this._palette.lastUpdateAt = performance.now() / 1000

    this._resizeRendererToCanvas()
    window.addEventListener('resize', this._onResize)

    this._lastNow = performance.now() / 1000
  }

  update(audioData) {
    if (!this._renderer || !this._scene || !this._camera) return

    const now = performance.now() / 1000
    const dt = this._lastNow ? Math.max(0.001, Math.min(0.05, now - this._lastNow)) : 1 / 60
    this._lastNow = now

    this._updateSnake(dt, now)
    this._advanceTubePath(dt)

    // Optional audio-reactive tweaks: light intensity + subtle camera pump.
    if (audioData) {
      const bass = Math.max(0, Math.min(1, audioData.frequencies?.bass ?? 0))
      const bassHigh = Math.max(0, (bass - 0.25) / 0.75)
      const bassPunch = Math.pow(bassHigh, 1.7)

      const decay = Math.exp(-dt / 0.22)
      this._pump.env *= decay

      if (audioData.isBeat && bass >= 0.18) {
        if (now - this._pump.lastBeatAt > 0.12) {
          this._pump.lastBeatAt = now
          this._pump.env = Math.min(1.25, this._pump.env + 0.55 + 0.55 * bassPunch)
        }
      }

      const osc = 0.5 + 0.5 * Math.sin(now * 6.2 * Math.PI * 2)
      const pump = bassPunch * (0.35 + 0.65 * osc) + this._pump.env * bassPunch

      const intensity = 25 + bassPunch * 120 + pump * 85
      if (this._lastIntensity == null || Math.abs(intensity - this._lastIntensity) > 1.5) {
        this._lights.forEach((l) => {
          l.intensity = intensity
        })
        this._lastIntensity = intensity
      }

      if (this._baseCameraZ != null) {
        const targetZ = this._baseCameraZ - 0.25 * pump
        this._camera.position.z += (targetZ - this._camera.position.z) * (1 - Math.pow(0.001, dt))
      }

      if (audioData.isBeat) {
        if (now - this._lastBeatColorAt >= 0.18) {
          this._lastBeatColorAt = now
          if (bass >= 0.08) {
            const beatBrightness = 0.16 + 0.52 * bassPunch
            const duration = bass < 0.2
              ? (8 + Math.random() * 6)
              : bass < 0.33
                ? (5 + Math.random() * 4)
                : (1.4 + Math.random() * 1.4)

            const colors = this._randomHexColors(3, beatBrightness)
            this._setTargetPalette(colors, duration)
          }
        }
      }

      this._advanceAndApplyPalette(dt)
    }

    this._renderer.render(this._scene, this._camera)
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)

    try {
      this._tubeMeshes.forEach((m) => {
        if (m?.parent) m.parent.remove(m)
      })

      if (this._tubeGeometry) {
        this._tubeGeometry.dispose()
        this._tubeGeometry = null
      }

      this._tubeMaterials.forEach((m) => m?.dispose?.())
      this._tubeMaterials = []
      this._tubeMeshes = []

      this._renderer?.dispose?.()
    } finally {
      this._renderer = null
      this._scene = null
      this._camera = null
      this._lights = []
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
    if (!this._palette.from || !this._palette.to) return

    if (this._palette.t < 1) {
      this._palette.t = Math.min(1, this._palette.t + (dt / Math.max(0.001, this._palette.duration)))
    }

    const display = this._getDisplayedPaletteColors()
    const hex = display.map((c) => `#${c.getHexString()}`)
    const key = hex.join(',')
    if (key !== this._palette.lastAppliedKey) {
      // Apply across the three tube materials.
      hex.forEach((h, i) => {
        const mat = this._tubeMaterials[i % this._tubeMaterials.length]
        if (mat?.color?.set) mat.color.set(h)
      })
      this._palette.lastAppliedKey = key
    }
  }

  _resizeRendererToCanvas() {
    if (!this._renderer || !this._camera || !this._canvas) return
    const w = Math.max(1, this._canvas.clientWidth || window.innerWidth)
    const h = Math.max(1, this._canvas.clientHeight || window.innerHeight)
    this._renderer.setSize(w, h, false)
    this._camera.aspect = w / h
    this._camera.updateProjectionMatrix()
  }

  _rebuildTubeGeometry(force = false) {
    if (!this._tubeCurve) return
    // Reduce rebuild cost by keeping segments modest.
    const tubularSegments = 128
    const radius = 0.08
    const radialSegments = 10
    const closed = false

    const geom = new THREE.TubeGeometry(this._tubeCurve, tubularSegments, radius, radialSegments, closed)
    if (force || !this._tubeGeometry) {
      if (this._tubeGeometry) this._tubeGeometry.dispose()
      this._tubeGeometry = geom
      return
    }

    // Swap geometry on meshes.
    this._tubeMeshes.forEach((m) => {
      if (!m) return
      if (m.geometry) m.geometry.dispose()
      m.geometry = geom
    })
    this._tubeGeometry = geom
  }

  _advanceTubePath(dt) {
    if (!this._tubePoints?.length || !this._tubeCurve) return

    // Push the head into the point chain with smoothing.
    const head = this._snake.head
    const first = this._tubePoints[0]
    if (first) first.lerp(head, 1 - Math.pow(0.001, dt))

    for (let i = 1; i < this._tubePoints.length; i += 1) {
      this._tubePoints[i].lerp(this._tubePoints[i - 1], 1 - Math.pow(0.001, dt * 0.9))
    }

    // Rebuild geometry occasionally; doing it every frame is expensive.
    // 20–30Hz looks fine visually.
    const rebuildEvery = 1 / 24
    this._rebuildAccum = (this._rebuildAccum || 0) + dt
    if (this._rebuildAccum >= rebuildEvery) {
      this._rebuildAccum = 0
      this._rebuildTubeGeometry(false)
    }
  }

  _getVisibleBounds() {
    const cam = this._camera
    if (!cam) return { maxX: 3, maxY: 2 }

    const distance = Math.max(0.001, cam.position.z)
    const vFov = THREE.MathUtils.degToRad(cam.fov)
    const halfH = Math.tan(vFov / 2) * distance
    const halfW = halfH * cam.aspect
    const margin = 0.95
    return { maxX: Math.max(1, halfW * margin), maxY: Math.max(1, halfH * margin) }
  }

  _updateSnake(dt, elapsed) {
    const { maxX, maxY } = this._getVisibleBounds()
    const minBound = Math.max(1, Math.min(maxX, maxY))

    if (elapsed >= this._snake.nextTurnAt) {
      this._snake.turnTarget = (Math.random() * 2 - 1)
      this._snake.nextTurnAt = elapsed + 0.35 + Math.random() * 0.75
    }

    if (elapsed >= this._snake.nextSpeedAt) {
      this._snake.speedMulTarget = 3 + Math.random() * 9
      this._snake.nextSpeedAt = elapsed + 2.8 + Math.random() * 4.2
    }

    const turnLerp = 1 - Math.pow(0.001, dt)
    this._snake.turn += (this._snake.turnTarget - this._snake.turn) * turnLerp

    const k = 6
    const c = 2 * Math.sqrt(k)
    this._snake.speedMulVel += (this._snake.speedMulTarget - this._snake.speedMul) * k * dt
    this._snake.speedMulVel *= Math.exp(-c * dt)
    this._snake.speedMul += this._snake.speedMulVel * dt
    this._snake.speedMul = Math.max(3, Math.min(12, this._snake.speedMul))

    const turnRate = 1.15
    const speed = (0.18 * minBound) * this._snake.speedMul
    this._snake.angle += this._snake.turn * turnRate * dt

    const vx = Math.cos(this._snake.angle) * speed
    const vy = Math.sin(this._snake.angle) * speed
    this._snake.head.x += vx * dt
    this._snake.head.y += vy * dt

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

    this._snake.head.z = 0
  }
}
