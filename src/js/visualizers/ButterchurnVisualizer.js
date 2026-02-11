import butterchurn from 'butterchurn'
import App from '../App'

/**
 * ButterchurnVisualizer – wraps the Butterchurn MilkDrop engine as a
 * first-class visualizer alongside entities and shaders.
 *
 * Canvas strategy:
 *   Butterchurn renders to its own <canvas> (2D context – it copies from an
 *   internal OffscreenCanvas / WebGL2 context).  During init() we hide the
 *   Three.js renderer canvas and show ours; during destroy() we reverse that.
 *
 * Audio:
 *   We connect Butterchurn to App.audioManager.analyserNode.  Bridge mode
 *   patches AnalyserNode.prototype so the same node works transparently.
 */
export default class ButterchurnVisualizer {
  /**
   * @param {Object} opts
   * @param {string}  opts.name          Display name (e.g. "MilkDrop: Geiss – Spiral")
   * @param {Object}  opts.preset        Pre-parsed butterchurn preset object
   * @param {number}  [opts.blendTime=0] Seconds to blend when loading
   */
  constructor({ name, preset, blendTime = 0 } = {}) {
    this.name = name
    this.preset = preset
    this.blendTime = blendTime

    this._visualizer = null   // butterchurn Visualizer instance
    this._canvas = null       // our output <canvas>
    this._raf = null          // requestAnimationFrame id (not used – App drives update())
    this._resizeHandler = null
  }

  /* ──────────────────── Visualizer interface ──────────────────── */

  init() {
    const audioCtx = App.audioManager?.audioContext ?? null
    const w = window.innerWidth
    const h = window.innerHeight

    // --- Create canvas & insert into DOM ---
    this._canvas = document.createElement('canvas')
    this._canvas.width = w
    this._canvas.height = h
    this._canvas.style.position = 'absolute'
    this._canvas.style.top = '0'
    this._canvas.style.left = '0'
    this._canvas.style.width = '100%'
    this._canvas.style.height = '100%'
    this._canvas.style.display = 'block'
    this._canvas.style.zIndex = '1' // above Three.js canvas (z-index 0)

    const container = document.querySelector('.content') || document.body
    container.appendChild(this._canvas)

    // Hide Three.js canvas while Butterchurn is active
    this._threeCanvas = App.renderer?.domElement ?? null
    if (this._threeCanvas) {
      this._threeCanvasPrevDisplay = this._threeCanvas.style.display
      this._threeCanvas.style.display = 'none'
    }

    // --- Create Butterchurn instance ---
    this._visualizer = butterchurn.createVisualizer(audioCtx, this._canvas, {
      width: w,
      height: h,
      pixelRatio: window.devicePixelRatio || 1,
      textureRatio: 1,
    })

    // Connect audio
    const analyser = App.audioManager?.analyserNode
    if (analyser) {
      this._visualizer.connectAudio(analyser)
    }

    // Load preset
    if (this.preset) {
      this._visualizer.loadPreset(this.preset, this.blendTime)
    }

    // Handle resize
    this._resizeHandler = () => this._onResize()
    window.addEventListener('resize', this._resizeHandler)
  }

  update() {
    if (!this._visualizer) return
    this._visualizer.render()
  }

  destroy() {
    // Remove resize listener
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler)
      this._resizeHandler = null
    }

    // Disconnect audio
    const analyser = App.audioManager?.analyserNode
    if (analyser && this._visualizer) {
      try { this._visualizer.disconnectAudio(analyser) } catch { /* ignore */ }
    }

    // Lose WebGL context to free GPU memory
    if (this._visualizer) {
      try { this._visualizer.loseGLContext() } catch { /* ignore */ }
      this._visualizer = null
    }

    // Remove canvas from DOM
    if (this._canvas && this._canvas.parentElement) {
      this._canvas.parentElement.removeChild(this._canvas)
    }
    this._canvas = null

    // Restore Three.js canvas visibility
    if (this._threeCanvas) {
      this._threeCanvas.style.display = this._threeCanvasPrevDisplay ?? 'block'
      this._threeCanvas = null
    }
  }

  onBPMBeat() {
    // Butterchurn handles beat detection internally – nothing to do here.
  }

  /* ──────────────────── Preset management ──────────────────── */

  /**
   * Load a new preset with optional blend transition.
   * Can be called while running (e.g. from a preset-cycle feature).
   */
  loadPreset(preset, blendTime = 2.7) {
    if (!this._visualizer) return
    this._visualizer.loadPreset(preset, blendTime)
  }

  /* ──────────────────── Internal helpers ──────────────────── */

  _onResize() {
    if (!this._visualizer || !this._canvas) return
    const w = window.innerWidth
    const h = window.innerHeight
    this._canvas.width = w
    this._canvas.height = h
    this._visualizer.setRendererSize(w, h)
  }
}
