import * as THREE from 'three'
import App from '../../App'
import createSparklingBoxes from 'threejs-components/build/cursors/attraction1.min.js'

export default class SparklingBoxes extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'sparkling-boxes'

    // This visualizer owns its own renderer/animation loop.
    this.rendersSelf = true

    this._layer = null
    this._canvas = null
    this._prevMainCanvasDisplay = null
    this._app = null

    this._lastBeatAt = 0
  }

  init() {
    this._mountCanvasLayer()

    this._app = createSparklingBoxes(this._canvas, {
      particles: {
        attractionIntensity: 0.75,
        size: 1.5,
      },
    })

    // Optional: transparent background like the rest of the app.
    this._app?.setBackgroundColor?.(null)
  }

  update(audioData) {
    if (!audioData || !this._app) return

    const bass = Math.max(0, Math.min(1, audioData.frequencies?.bass ?? 0))
    const mid = Math.max(0, Math.min(1, audioData.frequencies?.mid ?? 0))
    const high = Math.max(0, Math.min(1, audioData.frequencies?.high ?? 0))

    // Modulate attraction and particle size a bit (best-effort, API is internal).
    const uniforms = this._app?.particles?.compute?.uniforms
    const attraction = uniforms?.attractionIntensity
    if (attraction && typeof attraction === 'object' && 'value' in attraction) {
      attraction.value = 0.35 + mid * 1.15
    }

    const sizeUniform = this._app?.particles?.material?.size
    if (sizeUniform && typeof sizeUniform === 'object' && 'value' in sizeUniform) {
      sizeUniform.value = 0.9 + bass * 2.2
    }

    const light1 = this._app?.particles?.light1
    const light2 = this._app?.particles?.light2

    if (light1?.intensity != null) light1.intensity = 2 + high * 8
    if (light2?.intensity != null) light2.intensity = 2 + bass * 8

    // On beat: shuffle light colors (throttle a little).
    if (audioData.isBeat) {
      const now = performance.now()
      if (now - this._lastBeatAt > 180) {
        this._lastBeatAt = now
        if (light1?.color?.set) light1.color.set(Math.random() * 0xffffff)
        if (light2?.color?.set) light2.color.set(Math.random() * 0xffffff)
      }
    }
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
