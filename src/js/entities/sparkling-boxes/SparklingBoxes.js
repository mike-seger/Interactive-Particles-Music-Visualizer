import * as THREE from 'three'
import App from '../../App'

export default class SparklingBoxes extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'sparkling-boxes'

    // This visualizer owns its own renderer/animation loop.
    this.rendersSelf = true

    this._layer = null
    this._canvas = null
    this._prevMainCanvasDisplay = null

    this._lastBeatAt = 0

    this._renderer = null
    this._scene = null
    this._camera = null

    this._points = null
    this._positions = null
    this._velocities = null
    this._colors = null

    this._pointer = new THREE.Vector3(0, 0, 0)
    this._pointerNdc = new THREE.Vector2(0, 0)
    this._pointerActive = false
    this._raycaster = new THREE.Raycaster()
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

    this._lastNow = 0

    this._onResize = () => this._resizeRendererToCanvas()
    this._onPointerMove = (e) => this._handlePointerMove(e)
    this._onPointerLeave = () => { this._pointerActive = false }
  }

  init() {
    this._mountCanvasLayer()

    const renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this._renderer = renderer

    this._scene = new THREE.Scene()
    this._camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
    this._camera.position.set(0, 0, 10)

    // Points cloud
    const count = 2200
    this._positions = new Float32Array(count * 3)
    this._velocities = new Float32Array(count * 3)
    this._colors = new Float32Array(count * 3)

    const spread = 8
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3
      this._positions[idx + 0] = (Math.random() * 2 - 1) * spread
      this._positions[idx + 1] = (Math.random() * 2 - 1) * spread
      this._positions[idx + 2] = (Math.random() * 2 - 1) * 1.5

      this._velocities[idx + 0] = (Math.random() * 2 - 1) * 0.02
      this._velocities[idx + 1] = (Math.random() * 2 - 1) * 0.02
      this._velocities[idx + 2] = (Math.random() * 2 - 1) * 0.01

      // Pastel-ish start colors
      const c = new THREE.Color().setHSL(Math.random(), 0.95, 0.65)
      this._colors[idx + 0] = c.r
      this._colors[idx + 1] = c.g
      this._colors[idx + 2] = c.b
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3))

    const material = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this._points = new THREE.Points(geometry, material)
    this._scene.add(this._points)

    // Minimal lighting vibe: a dim ambient + two point lights
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.2))
    const l1 = new THREE.PointLight(0xff66ff, 10, 60)
    l1.position.set(-5, 4, 12)
    const l2 = new THREE.PointLight(0x66aaff, 10, 60)
    l2.position.set(5, -4, 12)
    this._scene.add(l1)
    this._scene.add(l2)

    this._resizeRendererToCanvas()
    window.addEventListener('resize', this._onResize)
    window.addEventListener('pointermove', this._onPointerMove)
    window.addEventListener('pointerleave', this._onPointerLeave)

    this._lastNow = performance.now() / 1000
  }

  update(audioData) {
    if (!this._renderer || !this._scene || !this._camera || !this._points) return

    const now = performance.now() / 1000
    const dt = this._lastNow ? Math.max(0.001, Math.min(0.05, now - this._lastNow)) : 1 / 60
    this._lastNow = now

    const bass = Math.max(0, Math.min(1, audioData?.frequencies?.bass ?? 0))
    const mid = Math.max(0, Math.min(1, audioData?.frequencies?.mid ?? 0))
    const high = Math.max(0, Math.min(1, audioData?.frequencies?.high ?? 0))

    const attractionIntensity = 0.35 + mid * 1.15
    const maxVelocity = 0.08 + 0.15 * (0.4 * bass + 0.6 * high)
    const friction = 0.985
    const jitter = 0.006 + 0.014 * high

    // Update pointer world position when active.
    const target = this._pointerActive ? this._pointer : null

    const positions = this._positions
    const velocities = this._velocities

    // Integrate simple attraction + damping.
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i + 0]
      const py = positions[i + 1]
      const pz = positions[i + 2]

      let vx = velocities[i + 0]
      let vy = velocities[i + 1]
      let vz = velocities[i + 2]

      if (target) {
        const dx = target.x - px
        const dy = target.y - py
        const dz = target.z - pz
        const invLen = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.0001)
        vx += dx * invLen * attractionIntensity * dt
        vy += dy * invLen * attractionIntensity * dt
        vz += dz * invLen * attractionIntensity * dt
      } else {
        // Idle drift: gently orbit around origin.
        vx += -py * 0.02 * dt
        vy += px * 0.02 * dt
      }

      vx += (Math.random() * 2 - 1) * jitter * dt
      vy += (Math.random() * 2 - 1) * jitter * dt
      vz += (Math.random() * 2 - 1) * (jitter * 0.6) * dt

      vx *= friction
      vy *= friction
      vz *= friction

      // Clamp
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (len > maxVelocity) {
        const s = maxVelocity / Math.max(0.0001, len)
        vx *= s
        vy *= s
        vz *= s
      }

      positions[i + 0] = px + vx
      positions[i + 1] = py + vy
      positions[i + 2] = pz + vz

      velocities[i + 0] = vx
      velocities[i + 1] = vy
      velocities[i + 2] = vz
    }

    const geom = this._points.geometry
    if (geom?.attributes?.position) geom.attributes.position.needsUpdate = true

    // Beat: shuffle a subset of colors (throttled).
    if (audioData?.isBeat) {
      const nowMs = performance.now()
      if (nowMs - this._lastBeatAt > 180) {
        this._lastBeatAt = nowMs
        const colors = this._colors
        const count = Math.min(600, colors.length / 3)
        for (let i = 0; i < count; i += 1) {
          const idx = (Math.floor(Math.random() * (colors.length / 3)) * 3)
          const c = new THREE.Color().setHSL(Math.random(), 0.95, 0.55 + 0.25 * bass)
          colors[idx + 0] = c.r
          colors[idx + 1] = c.g
          colors[idx + 2] = c.b
        }
        if (geom?.attributes?.color) geom.attributes.color.needsUpdate = true
      }
    }

    // Subtle size modulation.
    const mat = this._points.material
    if (mat && 'size' in mat) {
      mat.size = 1.1 + bass * 1.6
    }

    this._renderer.render(this._scene, this._camera)
  }

  destroy() {
    try {
      window.removeEventListener('resize', this._onResize)
      window.removeEventListener('pointermove', this._onPointerMove)
      window.removeEventListener('pointerleave', this._onPointerLeave)

      if (this._points) {
        this._scene?.remove?.(this._points)
        this._points.geometry?.dispose?.()
        this._points.material?.dispose?.()
      }

      this._renderer?.dispose?.()
    } finally {
      this._renderer = null
      this._scene = null
      this._camera = null
      this._points = null
      this._unmountCanvasLayer()
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

  _handlePointerMove(event) {
    if (!this._canvas || !this._camera) return

    const rect = this._canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    this._pointerNdc.set(x, y)
    this._pointerActive = true

    this._raycaster.setFromCamera(this._pointerNdc, this._camera)
    this._raycaster.ray.intersectPlane(this._plane, this._pointer)
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
}
