import * as THREE from 'three'
import { ENTITY_VISUALIZER_NAMES, createEntityVisualizerByName } from './visualizers/entityRegistry'
import { SHADER_VISUALIZER_NAMES, createShaderVisualizerByName } from './visualizers/shaderRegistry'

// MilkDrop (Butterchurn) presets are lazy-loaded to keep the initial bundle small.
// The module and its heavy dependencies (~800 kB) are fetched on first use.
let _milkdropModule = null
const _milkdropReady = import('./visualizers/milkdropRegistry').then((m) => {
  _milkdropModule = m
  return m
})
import { loadSpectrumFilters } from './spectrumFilters'
import GUI from 'lil-gui'
import BPMManager from './managers/BPMManager'
import { VideoSyncClient } from './sync-client/SyncClient.mjs'
import AudioManager from './managers/AudioManager'
import { createShaderControls } from './shaderCustomization'

class WebGLGpuTimer {
  constructor(gl) {
    this.gl = gl || null
    this.isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
    this.ext = null
    this.supported = false

    this.currentQuery = null
    this.pendingQueries = []
    this.lastGpuMs = null

    if (!this.gl) return

    try {
      if (this.isWebGL2) {
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')
      } else {
        this.ext = this.gl.getExtension('EXT_disjoint_timer_query')
      }
      this.supported = !!this.ext
    } catch (e) {
      this.ext = null
      this.supported = false
    }
  }

  begin() {
    if (!this.supported || !this.gl) return
    if (this.currentQuery) return

    try {
      if (this.isWebGL2) {
        const q = this.gl.createQuery()
        if (!q) return
        this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
        this.currentQuery = q
      } else {
        const q = this.ext.createQueryEXT()
        if (!q) return
        this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, q)
        this.currentQuery = q
      }
    } catch (e) {
      this.currentQuery = null
    }
  }

  end() {
    if (!this.supported || !this.gl) return
    if (!this.currentQuery) return

    try {
      if (this.isWebGL2) {
        this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
      } else {
        this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT)
      }

      this.pendingQueries.push(this.currentQuery)
      this.currentQuery = null

      // Avoid unbounded growth if polling falls behind.
      while (this.pendingQueries.length > 4) {
        const old = this.pendingQueries.shift()
        this._deleteQuery(old)
      }
    } catch (e) {
      this._deleteQuery(this.currentQuery)
      this.currentQuery = null
    }
  }

  poll() {
    if (!this.supported || !this.gl) return this.lastGpuMs
    if (this.pendingQueries.length === 0) return this.lastGpuMs

    const q = this.pendingQueries[0]
    try {
      const available = this.isWebGL2
        ? this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)
        : this.ext.getQueryObjectEXT(q, this.ext.QUERY_RESULT_AVAILABLE_EXT)

      if (!available) return this.lastGpuMs

      const disjoint = !!this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)

      const ns = this.isWebGL2
        ? this.gl.getQueryParameter(q, this.gl.QUERY_RESULT)
        : this.ext.getQueryObjectEXT(q, this.ext.QUERY_RESULT_EXT)

      this.pendingQueries.shift()
      this._deleteQuery(q)

      if (!disjoint && Number.isFinite(ns)) {
        this.lastGpuMs = ns / 1e6
      }
    } catch (e) {
      this.pendingQueries.shift()
      this._deleteQuery(q)
    }

    return this.lastGpuMs
  }

  _deleteQuery(q) {
    if (!q || !this.gl || !this.supported) return
    try {
      if (this.isWebGL2) this.gl.deleteQuery(q)
      else this.ext.deleteQueryEXT(q)
    } catch (e) {
      // ignore
    }
  }
}

export default class App {
  //THREE objects
  static holder = null
  static gui = null
  static camera = null
  static scene = null

  //Managers
  static audioManager = null
  static bpmManager = null

  // Visualizer management
  static currentVisualizer = null
  static visualizerType = 'Reactive Particles'
  static visualizerList = [...ENTITY_VISUALIZER_NAMES, ...SHADER_VISUALIZER_NAMES]
  static _milkdropNamesAppended = false

  constructor() {
    this.onClickBinder = () => this.init()
    document.addEventListener('click', this.onClickBinder)

    // Bind hotkey handler
    this.onKeyDown = (e) => this.handleKeyDown(e)

    // Bridge messaging (iframe -> parent)
    this.bridgeTarget = window.parent && window.parent !== window ? window.parent : null
    this.handleBridgeMessage = (event) => this.onBridgeMessage(event)
    window.addEventListener('message', this.handleBridgeMessage)

    // BroadcastChannel for popup controls window
    this._controlsChannel = null
    this._controlsPopup = null
    this._controlsPopupPollTimer = null
    this._setupControlsChannel()

    // GUI controller references
    this.visualizerSwitcherConfig = null
    this.visualizerController = null

    // Variant 3 GUI state
    this.variant3Folder = null
    this.variant3Controllers = {}
    this.variant3Config = null
    this.variant3PresetState = null
    this.variant3LoadSelect = null
    this.variant3LoadController = null
    this.variant3PresetRow = null
    this.variant3ScrollContainer = null
    this.variant3UploadInput = null
    this.variant3Overlay = null
    this.variant3PresetApplied = false

    this.bridgeGuiHotspotEnabled = false

    // Toast showing the current visualizer name
    this.visualizerToast = null
    this.visualizerToastHideTimer = null

    this.storageKeys = {
      playbackPosition: 'visualizer.playbackPosition',
      visualizerType: 'visualizer.lastType',
      fv3Presets: 'visualizer.fv3.presets',
      fv3SelectedPreset: 'visualizer.fv3.selectedPreset'
    }

    // Per-visualizer quality overrides (localStorage keys are derived from visualizer type).
    this.performanceQualityFolder = null
    this.performanceQualityConfig = null
    this.performanceQualityControllers = {
      antialias: null,
      pixelRatio: null,
      defaults: null,
    }
    this._syncingPerformanceQualityGui = false

    // Snapshot of the initial (URL/defaults-derived) quality state so we can
    // revert when per-visualizer overrides are cleared.
    this._baseQualityState = null

    // Lightweight rAF cadence stats for perf debugging.
    this.rafStats = { lastAt: 0, frames: 0, sumDt: 0, maxDt: 0 }
    this.lastFrameDtMs = null

    // Auto-quality runtime state (initialized in init()).
    this.autoQualityEnabled = true
    this.autoQualityDynamic = false
    this.autoQualityDynamicRequested = null
    this.pixelRatioOverridden = false
    this.pixelRatioLocked = false
    this.antialiasOverridden = false
    this.quality = null
    // Short sliding window for auto-quality sampling.
    // Important: a lifetime average reacts far too slowly after a sudden perf drop.
    this.qualityWindow = { frames: 0, sumDt: 0, maxDt: 0, startAt: 0 }
  }

  // -------------------------------------------------------------------
  // Pop-out controls (BroadcastChannel)
  // -------------------------------------------------------------------

  _setupControlsChannel() {
    try {
      this._controlsChannel = new BroadcastChannel('visualizer-controls')
      this._controlsChannel.onmessage = (e) => this._onControlsChannelMessage(e)
    } catch {
      // BroadcastChannel not supported — pop-out will be unavailable
    }
  }

  _broadcastToControls(msg) {
    try { this._controlsChannel?.postMessage(msg) } catch { /* */ }
  }

  _onControlsChannelMessage(event) {
    const msg = event?.data
    if (!msg || typeof msg !== 'object') return

    switch (msg.type) {
      case 'controls-ready':
        // Popup is open and waiting — send full init state
        this._sendControlsInit()
        break

      case 'controls-closed':
        this._onControlsPopupClosed()
        break

      case 'select-visualizer':
        if (msg.name) this.switchVisualizer(msg.name)
        break

      case 'set-quality': {
        const type = App.visualizerType
        if (typeof msg.antialias === 'boolean') {
          this._writePerVisualizerQualityOverride(type, { antialias: msg.antialias })
        }
        if (Number.isFinite(msg.pixelRatio)) {
          this._writePerVisualizerQualityOverride(type, { pixelRatio: msg.pixelRatio })
        }
        this._applyPerVisualizerQualityOverrides(type)
        this._syncPerformanceQualityControls(type)
        break
      }

      case 'save-quality-defaults':
        if (this.performanceQualityConfig?.saveAsDefaults) {
          this.performanceQualityConfig.saveAsDefaults()
        }
        break

      case 'clear-quality-overrides':
        if (this.performanceQualityConfig?.clearUserValues) {
          this.performanceQualityConfig.clearUserValues()
        }
        break

      case 'set-fv3-param':
        if (App.currentVisualizer && typeof App.currentVisualizer.setParam === 'function') {
          App.currentVisualizer.setParam(msg.key, msg.value)
        }
        // Also update the inline FV3 controls if visible
        if (this.variant3Config && msg.key in this.variant3Config) {
          this.variant3Config[msg.key] = msg.value
          this.variant3Controllers?.[msg.key]?.updateDisplay?.()
        }
        break

      case 'apply-fv3-params':
        if (App.currentVisualizer && typeof App.currentVisualizer.applyParams === 'function') {
          App.currentVisualizer.applyParams(msg.params)
        } else if (App.currentVisualizer && msg.params) {
          // Fallback: apply each param individually
          for (const [k, v] of Object.entries(msg.params)) {
            if (typeof App.currentVisualizer.setParam === 'function') {
              App.currentVisualizer.setParam(k, v)
            }
          }
        }
        // Sync inline controls
        if (this.variant3Config && msg.params) {
          Object.assign(this.variant3Config, msg.params)
          Object.values(this.variant3Controllers).forEach((c) => c?.updateDisplay?.())
        }
        break

      case 'set-shader-uniform':
        if (App.currentVisualizer?.material?.uniforms?.[msg.uniform]) {
          App.currentVisualizer.material.uniforms[msg.uniform].value = msg.value
        }
        break

      default:
        break
    }
  }

  _sendControlsInit() {
    this._broadcastToControls({
      type: 'init',
      visualizerList: [...App.visualizerList],
      activeVisualizer: App.visualizerType || '',
    })
    // Also send current visualizer details
    this._broadcastVisualizerChanged()
    // And quality state
    this._broadcastQualityState()
  }

  _broadcastVisualizerChanged() {
    if (!this._controlsChannel) return
    const v = App.currentVisualizer
    const type = App.visualizerType
    const msg = {
      type: 'visualizer-changed',
      name: type,
      hasFV3: type === 'Frequency Visualization 3' && v != null,
      hasShaderConfig: !!(v?.shaderConfig),
    }
    if (msg.hasFV3 && v) {
      msg.fv3Params = { ...(v.getParams?.() || v.params || {}) }
    }
    if (msg.hasShaderConfig && v?.shaderConfig) {
      msg.shaderConfig = v.shaderConfig
    }
    this._broadcastToControls(msg)
  }

  _broadcastQualityState() {
    if (!this._controlsChannel) return
    const aa = this._getContextAntialias()
    const pr = this.renderer?.getPixelRatio?.() || 1
    this._broadcastToControls({
      type: 'quality-update',
      antialias: typeof aa === 'boolean' ? aa : false,
      pixelRatio: this._snapPixelRatio(pr, { min: 0.25, max: 2 }),
    })
  }

  _openControlsPopup() {
    const w = 460, h = 700
    const left = window.screenX + window.outerWidth - w - 20
    const top = window.screenY + 60

    // If already open and alive, move it near the button and focus it
    if (this._controlsPopup && !this._controlsPopup.closed) {
      try {
        this._controlsPopup.moveTo(left, top)
        this._controlsPopup.resizeTo(w, h)
      } catch { /* cross-origin or permission error — ignore */ }
      this._controlsPopup.focus()
      return
    }

    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no`

    // Resolve the controls page URL relative to the current page
    const base = new URL('.', window.location.href).href
    const url = new URL('viz-controls.html', base).href

    // Use empty string as window name to avoid browser reusing a stale target
    this._controlsPopup = window.open(url, '', features)

    if (!this._controlsPopup) {
      alert('Popup blocked. Please allow popups for this site.')
      return
    }

    // Prefix popup title with parent window title when running inside an iframe
    const parentTitle = this._getParentWindowTitle()
    if (parentTitle) {
      this._controlsPopup.addEventListener('load', () => {
        try { this._controlsPopup.document.title = `${parentTitle} – VISUALIZER CONTROLS` } catch { /* */ }
      })
    }

    // Poll for popup close (beforeunload isn't always reliable cross-window)
    if (this._controlsPopupPollTimer) clearInterval(this._controlsPopupPollTimer)
    this._controlsPopupPollTimer = setInterval(() => {
      if (!this._controlsPopup || this._controlsPopup.closed) {
        this._onControlsPopupClosed()
      }
    }, 500)
  }

  _onControlsPopupClosed() {
    if (this._controlsPopupPollTimer) {
      clearInterval(this._controlsPopupPollTimer)
      this._controlsPopupPollTimer = null
    }
    this._controlsPopup = null
  }

  /** Try to read the parent/top window title (for iframe/bridge mode). */
  _getParentWindowTitle() {
    if (window === window.top) return null // not in an iframe
    try { return window.top.document.title || null } catch { /* cross-origin */ }
    try { return window.parent.document.title || null } catch { /* cross-origin */ }
    return null
  }

  _snapPixelRatio(value, { min = 0.25, max = 2 } = {}) {
    const v = Number.isFinite(value) ? value : 1
    const allowed = [0.25, 0.5, 1, 2]
    const candidates = allowed.filter((r) => r >= min - 1e-6 && r <= max + 1e-6)
    if (candidates.length === 0) return Math.max(min, Math.min(max, v))
    let best = candidates[0]
    let bestErr = Math.abs(v - best)
    for (let i = 1; i < candidates.length; i += 1) {
      const r = candidates[i]
      const err = Math.abs(v - r)
      if (err < bestErr) {
        bestErr = err
        best = r
      }
    }
    return best
  }

  getStoredPlaybackPosition() {
    try {
      const value = window.localStorage.getItem(this.storageKeys.playbackPosition)
      const parsed = value ? Number(value) : 0
      return Number.isFinite(parsed) ? parsed : 0
    } catch (error) {
      return 0
    }
  }

  savePlaybackPosition(time) {
    if (!Number.isFinite(time)) return
    try {
      window.localStorage.setItem(this.storageKeys.playbackPosition, String(time))
    } catch (error) {
      // ignore storage errors
    }
  }

  getStoredVisualizerType() {
    try {
      const value = window.localStorage.getItem(this.storageKeys.visualizerType)
      return value && App.visualizerList.includes(value) ? value : null
    } catch (error) {
      return null
    }
  }

  saveVisualizerType(type) {
    if (!type) return
    try {
      window.localStorage.setItem(this.storageKeys.visualizerType, type)
    } catch (error) {
      // ignore storage errors
    }
  }

  _getGlobalQualityDefaultKeys() {
    return {
      antiAlias: 'visualizer.defaults.quality.antiAlias',
      pixelRatio: 'visualizer.defaults.quality.pixelRatio',
    }
  }

  getStoredGlobalQualityDefaults() {
    try {
      const keys = this._getGlobalQualityDefaultKeys()
      const aaRaw = window.localStorage.getItem(keys.antiAlias)
      const prRaw = window.localStorage.getItem(keys.pixelRatio)

      let aa = null
      if (aaRaw != null) {
        const v = String(aaRaw).trim().toLowerCase()
        aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on')
      }

      let pr = null
      if (prRaw != null && prRaw !== '') {
        const parsed = Number.parseFloat(prRaw)
        const allowed = [0.25, 0.5, 1, 2]
        pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null
      }

      return { antialias: aa, pixelRatio: pr }
    } catch (e) {
      return { antialias: null, pixelRatio: null }
    }
  }

  saveGlobalQualityDefaults({ antialias, pixelRatio } = {}) {
    try {
      const keys = this._getGlobalQualityDefaultKeys()
      if (antialias == null) window.localStorage.removeItem(keys.antiAlias)
      else window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')

      if (pixelRatio == null) {
        window.localStorage.removeItem(keys.pixelRatio)
      } else {
        const allowed = [0.25, 0.5, 1, 2]
        const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio)
        else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch (e) {
      // ignore
    }
  }

  _getPerVisualizerAutoQualityKeys(type) {
    const t = String(type || '').trim()
    return {
      antiAlias: `visualizer[${t}].quality.auto.antiAlias`,
      pixelRatio: `visualizer[${t}].quality.auto.pixelRatio`,
    }
  }

  _readPerVisualizerAutoQuality(type) {
    try {
      const { antiAlias, pixelRatio } = this._getPerVisualizerAutoQualityKeys(type)
      const aaRaw = window.localStorage.getItem(antiAlias)
      const prRaw = window.localStorage.getItem(pixelRatio)

      let aa = null
      if (aaRaw != null) {
        const v = String(aaRaw).trim().toLowerCase()
        aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on')
      }

      let pr = null
      if (prRaw != null && prRaw !== '') {
        const parsed = Number.parseFloat(prRaw)
        const allowed = [0.25, 0.5, 1, 2]
        pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null
      }

      return { antialias: aa, pixelRatio: pr }
    } catch (e) {
      return { antialias: null, pixelRatio: null }
    }
  }

  _writePerVisualizerAutoQuality(type, { antialias, pixelRatio } = {}) {
    try {
      const keys = this._getPerVisualizerAutoQualityKeys(type)
      if (antialias == null) window.localStorage.removeItem(keys.antiAlias)
      else window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')

      if (pixelRatio == null) {
        window.localStorage.removeItem(keys.pixelRatio)
      } else {
        const allowed = [0.25, 0.5, 1, 2]
        const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio)
        else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch (e) {
      // ignore
    }
  }

  _persistAutoQualityForCurrentVisualizer() {
    try {
      if (!this.renderer) return
      const type = App.visualizerType
      if (!type) return

      const base = this._baseQualityState
      const user = this._readPerVisualizerQualityOverrides(type)
      const urlLocksAa = !!base?.antialiasOverridden
      const urlLocksPr = !!base?.pixelRatioOverridden

      const canPersistAa = !urlLocksAa && user.antialias == null
      const canPersistPr = !urlLocksPr && user.pixelRatio == null

      if (!canPersistAa && !canPersistPr) return

      const aa = this._getContextAntialias()
      const pr = this.renderer.getPixelRatio?.() || 1
      const next = {
        antialias: canPersistAa ? !!aa : null,
        pixelRatio: canPersistPr ? this._snapPixelRatio(pr, { min: 0.25, max: 2 }) : null,
      }
      this._writePerVisualizerAutoQuality(type, next)
    } catch (e) {
      // ignore
    }
  }

  _getPerVisualizerQualityKeys(type) {
    const t = String(type || '').trim()
    return {
      antiAlias: `visualizer[${t}].quality.antiAlias`,
      pixelRatio: `visualizer[${t}].quality.pixelRatio`,
    }
  }

  _readPerVisualizerQualityOverrides(type) {
    try {
      const { antiAlias, pixelRatio } = this._getPerVisualizerQualityKeys(type)
      const aaRaw = window.localStorage.getItem(antiAlias)
      const prRaw = window.localStorage.getItem(pixelRatio)

      let aa = null
      if (aaRaw != null) {
        const v = String(aaRaw).trim().toLowerCase()
        aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on')
      }

      let pr = null
      if (prRaw != null && prRaw !== '') {
        const parsed = Number.parseFloat(prRaw)
        const allowed = [0.25, 0.5, 1, 2]
        pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null
      }

      return { antialias: aa, pixelRatio: pr }
    } catch (e) {
      return { antialias: null, pixelRatio: null }
    }
  }

  _writePerVisualizerQualityOverride(type, { antialias, pixelRatio } = {}) {
    try {
      const keys = this._getPerVisualizerQualityKeys(type)

      if (antialias == null) {
        window.localStorage.removeItem(keys.antiAlias)
      } else {
        window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')
      }

      if (pixelRatio == null) {
        window.localStorage.removeItem(keys.pixelRatio)
      } else {
        const allowed = [0.25, 0.5, 1, 2]
        const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio)
        else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch (e) {
      // ignore storage errors
    }
  }

  _clearPerVisualizerQualityOverrides(type) {
    try {
      const keys = this._getPerVisualizerQualityKeys(type)
      window.localStorage.removeItem(keys.antiAlias)
      window.localStorage.removeItem(keys.pixelRatio)
    } catch (e) {
      // ignore
    }
  }

  _applyPerVisualizerQualityOverrides(type, { applyBaseIfNoOverride = true } = {}) {
    const base = this._baseQualityState
    const overrides = this._readPerVisualizerQualityOverrides(type)
    const hasAaOverride = overrides.antialias != null
    const hasPrOverride = overrides.pixelRatio != null

    const auto = this._readPerVisualizerAutoQuality(type)
    const hasAutoAa = auto.antialias != null
    const hasAutoPr = auto.pixelRatio != null

    const urlLocksAa = !!base?.antialiasOverridden
    const urlLocksPr = !!base?.pixelRatioOverridden

    // Update effective flags (dynamic loop reads these).
    if (base) {
      // URL overrides always win. User overrides win next. Auto values are not overrides.
      this.antialiasOverridden = urlLocksAa ? true : !!hasAaOverride
      this.pixelRatioOverridden = urlLocksPr ? true : !!hasPrOverride
      this.pixelRatioLocked = urlLocksPr ? !!base.pixelRatioLocked : !!hasPrOverride

      const desiredAa = urlLocksAa
        ? base.debugAntialias
        : (hasAaOverride ? !!overrides.antialias : (hasAutoAa ? !!auto.antialias : base.debugAntialias))

      const desiredPr = urlLocksPr
        ? base.debugPixelRatio
        : (hasPrOverride ? overrides.pixelRatio : (hasAutoPr ? auto.pixelRatio : base.debugPixelRatio))

      this.debugAntialias = !!desiredAa
      this.debugPixelRatio = desiredPr

      // Keep dynamic quality disabled whenever pixelRatio is locked.
      this.autoQualityDynamic = !!base.autoQualityDynamic && !this.pixelRatioLocked
    }

    if (!this.renderer) return

    // Apply desired AA by recreating renderer if needed.
    {
      const curAa = this._getContextAntialias()
      const desiredAa = urlLocksAa
        ? !!base?.debugAntialias
        : (hasAaOverride
          ? !!overrides.antialias
          : (hasAutoAa
            ? !!auto.antialias
            : (applyBaseIfNoOverride
              ? !!base?.debugAntialias
              : (curAa ?? !!this.debugAntialias))))

      if (typeof desiredAa === 'boolean' && curAa !== desiredAa) {
        this._recreateRendererWithAntialias(desiredAa)
      }
    }

    // Apply desired pixelRatio.
    const targetPr = urlLocksPr
      ? base?.debugPixelRatio
      : (hasPrOverride
        ? overrides.pixelRatio
        : (hasAutoPr
          ? auto.pixelRatio
          : (applyBaseIfNoOverride && base && Number.isFinite(base.debugPixelRatio) ? base.debugPixelRatio : null)))

    if (targetPr != null && Number.isFinite(targetPr)) {
      const oldPr = this.renderer.getPixelRatio?.() || 1
      if (Math.abs(oldPr - targetPr) > 1e-6) {
        this.renderer.setPixelRatio(targetPr)
        if (Number.isFinite(this.width) && Number.isFinite(this.height)) {
          this.renderer.setSize(this.width, this.height, false)
        }
        try {
          const v = App.currentVisualizer
          if (v && typeof v.onPixelRatioChange === 'function') {
            v.onPixelRatioChange(targetPr, oldPr)
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  _syncPerformanceQualityControls(type) {
    if (!this.performanceQualityConfig || !this.renderer) return
    const overrides = this._readPerVisualizerQualityOverrides(type)

    const effectiveAa = (overrides.antialias != null)
      ? !!overrides.antialias
      : (this._getContextAntialias() ?? !!this.debugAntialias)

    const effectivePr = (overrides.pixelRatio != null)
      ? overrides.pixelRatio
      : (this.renderer.getPixelRatio?.() || 1)

    const snappedPr = this._snapPixelRatio(effectivePr, { min: 0.25, max: 2 })

    this._syncingPerformanceQualityGui = true
    this.performanceQualityConfig.antialias = !!effectiveAa
    this.performanceQualityConfig.pixelRatio = snappedPr
    this._syncingPerformanceQualityGui = false

    const ctrls = this.performanceQualityControllers
    if (ctrls?.antialias?.updateDisplay) ctrls.antialias.updateDisplay()
    if (ctrls?.pixelRatio?.updateDisplay) {
      // Force lil-gui to sync by temporarily setting to undefined then back
      const temp = this.performanceQualityConfig.pixelRatio
      this.performanceQualityConfig.pixelRatio = undefined
      ctrls.pixelRatio.updateDisplay()
      this.performanceQualityConfig.pixelRatio = temp
      ctrls.pixelRatio.updateDisplay()
    }
  }

  restoreSessionOnPlay() {
    if (!App.audioManager || !App.audioManager.audio || App.audioManager.isUsingMicrophone) return

    const storedVisualizer = this.getStoredVisualizerType()
    if (storedVisualizer && storedVisualizer !== App.visualizerType) {
      this.switchVisualizer(storedVisualizer, { notify: false })
    }

    const storedTime = this.getStoredPlaybackPosition()
    if (storedTime > 0 && Number.isFinite(App.audioManager.audio.duration)) {
      const clamped = Math.min(storedTime, App.audioManager.audio.duration)
      App.audioManager.seek(clamped)
    }
  }

  initPlayerControls() {
    const controls = document.getElementById('player-controls')
    if (!controls) return

    const playPauseBtn = document.getElementById('play-pause-btn')
    const muteBtn = document.getElementById('mute-btn')
    const micBtn = document.getElementById('mic-btn')
    const lockBtn = document.getElementById('lock-btn')
    const openControlsBtn = document.getElementById('open-controls-btn')
    const syncButton = document.getElementById('syncButton')
    const positionSlider = document.getElementById('position-slider')
    const timeDisplay = document.getElementById('time-display')
    const fpsDisplay = document.getElementById('fps-display')

    // Lock state management
    let isLocked = localStorage.getItem('playerControlsLocked') === 'true'

    // Optional FPS counter (standalone UI only)
    this.fpsDisplay = fpsDisplay || null
    if (this.fpsDisplay && !this.fpsState) {
      this.fpsState = {
        prevFrameAt: 0,
        sampleStartAt: 0,
        frames: 0,
        fpsEma: 0,
      }
      this.fpsDisplay.textContent = 'FPS: --'
    }

    const rendererRoot = this.renderer?.domElement?.parentElement || document.querySelector('.content') || document.body

    let isSeeking = false
    let idleTimer = null
    let pointerInside = false
    const idleDelayMs = 10000

    const showControls = () => {
      controls.style.display = 'flex'
      controls.style.opacity = '1'
      controls.style.pointerEvents = 'auto'
    }

    const hideControls = () => {
      if (isLocked) return
      controls.style.display = 'none'
      controls.style.pointerEvents = 'none'
    }

    const clearTimers = () => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const scheduleIdle = () => {
      clearTimers()
      if (isLocked) return
      idleTimer = setTimeout(() => {
        if (!pointerInside) hideControls()
      }, idleDelayMs)
    }

    const resetVisibility = () => {
      showControls()
      clearTimers()
      scheduleIdle()
    }

    const getSyncServerAddress = () => {
      const params = new URLSearchParams(window.location.search || '')
      return params.get('sync') || params.get('syncServer') || null
    }

    // Make the overlay visible and interactive initially
    resetVisibility()

    // Sync client toggle (optional)
    if (syncButton && App.audioManager?.audio && !this.syncClient) {
      const serverAddress = getSyncServerAddress() || 'localhost:5001'

      const getMainWindowAssetUrl = (assetPath) => {
        const normalized = assetPath.replace(/^\/+/, '')

        const getBaseHref = () => {
          // Prefer top window document base (same-origin only).
          try {
            const topBase = window.top?.document?.baseURI
            if (topBase) return topBase
          } catch (e) {
            // Cross-origin iframe
          }

          // Next best: top window location (same-origin only)
          try {
            const topHref = window.top?.location?.href
            if (topHref) return topHref
          } catch (e) {
            // Cross-origin iframe
          }

          // Fallbacks in the current frame
          return document.baseURI || window.location.href
        }

        try {
          return new URL(normalized, getBaseHref()).toString()
        } catch (e) {
          return normalized
        }
      }

      // NOTE: AudioManager already uses WebAudio + createMediaElementSource(audio).
      // Creating a second media element source in SyncClient can throw.
      this.syncClient = new VideoSyncClient(App.audioManager.audio, null, serverAddress, {
        container: syncButton,
        svgUrl: getMainWindowAssetUrl('img/link.svg'),
        size: 44,
        iconScale: 0.55,
        colorConnected: '#cc0000',
        colorDisconnected: '#ffffff',
        colorUnavailable: '#a8b3c7',
        autoConnect: false,
        pauseOnInit: false,
        enableWebAudio: false,
        onBeforeToggle: () => {
          // Ensure the visualizer's AudioContext is active when user toggles sync.
          try {
            App.audioManager?.audioContext?.resume?.()
          } catch (e) {
            // ignore
          }
          return true
        },
      })
    }

    const updatePlayState = () => {
      if (!App.audioManager?.audio) return
      const isPlaying = !App.audioManager.audio.paused
      playPauseBtn.textContent = isPlaying ? 'pause_circle' : 'play_circle'
    }

    const updateMuteState = () => {
      if (!App.audioManager) return
      const isMuted = !!App.audioManager.isMuted
      muteBtn.textContent = isMuted ? 'volume_off' : 'volume_up'
    }

    const formatTime = (seconds) => {
      const mins = Math.floor(seconds / 60)
      const secs = Math.floor(seconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const updateTime = () => {
      if (!App.audioManager?.audio) return
      const audio = App.audioManager.audio
      const current = audio.currentTime || 0
      const duration = audio.duration || 0
      if (!isSeeking) {
        positionSlider.value = duration ? (current / duration) * 100 : 0
      }
      timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration || 0)}`
    }

    playPauseBtn?.addEventListener('click', () => {
      if (!App.audioManager?.audio) return
      const audio = App.audioManager.audio
      if (audio.paused) {
        audio.play()
      } else {
        audio.pause()
      }
      updatePlayState()
      resetVisibility()
    })

    if (App.audioManager?.audio) {
      App.audioManager.audio.addEventListener('play', updatePlayState)
      App.audioManager.audio.addEventListener('pause', updatePlayState)
    }

    muteBtn?.addEventListener('click', () => {
      if (!App.audioManager) return
      App.audioManager.setMuted(!App.audioManager.isMuted)
      updateMuteState()
      resetVisibility()
    })

    // Microphone toggle not implemented; keep button disabled.
    if (micBtn) {
      micBtn.disabled = true
      micBtn.title = 'Microphone input not available in this build'
      micBtn.textContent = 'mic_off'
    }

    // Lock button functionality
    const updateLockState = () => {
      if (!lockBtn) return
      if (isLocked) {
        lockBtn.textContent = 'lock'
        lockBtn.title = 'Unlock controls (allow auto-hide)'
      } else {
        lockBtn.textContent = 'lock_open_right'
        lockBtn.title = 'Lock controls visible'
      }
    }

    lockBtn?.addEventListener('click', () => {
      isLocked = !isLocked
      localStorage.setItem('playerControlsLocked', isLocked.toString())
      updateLockState()
      if (isLocked) {
        showControls()
        clearTimers()
      } else {
        scheduleIdle()
      }
    })

    // Open controls popup button
    openControlsBtn?.addEventListener('click', () => {
      this._openControlsPopup()
      resetVisibility()
    })

    updateLockState()

    positionSlider?.addEventListener('mousedown', () => { isSeeking = true })
    positionSlider?.addEventListener('mouseup', () => { isSeeking = false })
    positionSlider?.addEventListener('input', (e) => {
      if (!App.audioManager?.audio) return
      const duration = App.audioManager.audio.duration || 0
      const seekTime = (e.target.value / 100) * duration
      timeDisplay.textContent = `${formatTime(seekTime)} / ${formatTime(duration)}`
    })
    positionSlider?.addEventListener('change', (e) => {
      if (!App.audioManager?.audio) return
      const duration = App.audioManager.audio.duration || 0
      const seekTime = (e.target.value / 100) * duration
      App.audioManager.seek(seekTime)
      this.savePlaybackPosition(seekTime)
      isSeeking = false
    })

    updatePlayState()
    updateMuteState()
    updateTime()
    setInterval(updateTime, 1000)

    // Pointer tracking for fade/hide behavior
    controls.addEventListener('mouseenter', () => {
      pointerInside = true
      showControls()
      clearTimers()
    })
    controls.addEventListener('mouseleave', () => {
      pointerInside = false
      scheduleIdle()
    })

    // Visualizer clicks reset visibility or trigger hide when outside controls
    if (rendererRoot) {
      rendererRoot.addEventListener('click', (e) => {
        const clickedInsideControls = controls.contains(e.target)
        if (clickedInsideControls) {
          resetVisibility()
        } else if (controls.style.display === 'none') {
          resetVisibility()
        } else if (!isLocked) {
          pointerInside = false
          hideControls()
        }
      })
    }

    window.addEventListener('beforeunload', () => {
      if (!App.audioManager || !App.audioManager.audio || App.audioManager.isUsingMicrophone) return
      this.savePlaybackPosition(App.audioManager.getCurrentTime())
    })
  }

  init() {
    document.removeEventListener('click', this.onClickBinder)

    const getMergedUrlParams = () => {
      const merged = new URLSearchParams()

      const addFromQueryString = (queryString) => {
        if (!queryString) return

        let qs = String(queryString)
        if (qs.startsWith('#')) {
          const idx = qs.indexOf('?')
          if (idx === -1) return
          qs = qs.slice(idx)
        }

        const params = new URLSearchParams(qs)
        for (const [key, value] of params.entries()) {
          if (!merged.has(key)) merged.set(key, value)
        }

        // Preserve valueless params like `?gpuInfo`.
        for (const key of params.keys()) {
          if (!merged.has(key)) merged.set(key, '')
        }
      }

      // Prefer top-level URL params if same-origin.
      try {
        addFromQueryString(window.top?.location?.search)
        addFromQueryString(window.top?.location?.hash)
      } catch (e) {
        // ignore cross-origin
      }

      // When embedded cross-origin, `window.top` may be inaccessible, but
      // `document.referrer` often contains the host URL (and its query params).
      try {
        if (document.referrer) {
          const refUrl = new URL(document.referrer, window.location.href)
          addFromQueryString(refUrl.search)
          addFromQueryString(refUrl.hash)
        }
      } catch (e) {
        // ignore invalid referrer
      }

      addFromQueryString(window.location.search)
      addFromQueryString(window.location.hash)

      return merged
    }

    const isTruthyParam = (params, name) => {
      if (!params || !name) return false
      if (!params.has(name)) return false
      const raw = params.get(name)
      if (raw === null) return true
      const value = String(raw).trim().toLowerCase()
      if (value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
      if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
      return true
    }

    const getOptionalBool = (params, ...names) => {
      if (!params) return null
      for (const name of names) {
        if (params.has(name)) return isTruthyParam(params, name)
      }
      return null
    }

    const urlParams = getMergedUrlParams()

    const globalDefaults = this.getStoredGlobalQualityDefaults()

    // Default debug profile: if a setting isn't explicitly provided via URL,
    // apply a sensible default for performance diagnostics.
    // Disable with `&noDefaults=1` (or `&defaults=0`).
    const noDefaults =
      isTruthyParam(urlParams, 'noDefaults') ||
      isTruthyParam(urlParams, 'nodefaults') ||
      String(urlParams.get('defaults') || '').trim() === '0'

    if (!noDefaults) {
      const injected = new Set()
      const defaults = {
        // Baseline defaults (can be overridden by URL params or per-visualizer overrides).
        // Note: we still treat injected defaults as "soft" (not hard user overrides).
        dpr: String(globalDefaults.pixelRatio ?? 2),
        aa: String((globalDefaults.antialias ?? false) ? '1' : '0'),
        aqDynamic: '1',
      }

      for (const [key, value] of Object.entries(defaults)) {
        if (!urlParams.has(key)) {
          urlParams.set(key, value)
          injected.add(key)
        }
      }

      // Track which params came from our debug-profile defaults so we don't
      // treat them as hard user overrides later.
      this._injectedDefaultParams = injected

      // Only choose a default visualizer on first-run. If the user has a stored
      // last-visualizer choice, keep it unless they explicitly override via URL.
      const hasVisualizerOverride = urlParams.has('visualizer') || urlParams.has('viz') || urlParams.has('v')
      if (!hasVisualizerOverride) {
        const stored = this.getStoredVisualizerType()
        if (!stored) {
          urlParams.set('visualizer', 'Shader: Skinpeeler')
        }
      }
    }
    const wantsGpuInfo =
      isTruthyParam(urlParams, 'gpuInfo') ||
      isTruthyParam(urlParams, 'gpuinfo') ||
      isTruthyParam(urlParams, 'debugGpu') ||
      isTruthyParam(urlParams, 'debuggpu')

    const wantsPerf =
      isTruthyParam(urlParams, 'perf') ||
      isTruthyParam(urlParams, 'debugPerf') ||
      isTruthyParam(urlParams, 'debugperf')

    const qualityLogsEnabled = wantsPerf

    // Extra debug toggles useful for isolating rAF pacing vs GPU-bound rendering.
    // - `&skipRender=1` (or `&render=0`) bypasses `renderer.render`.
    // - `&dpr=1` (or `&pixelRatio=1`) forces renderer pixel ratio.
    this.debugSkipRender =
      isTruthyParam(urlParams, 'skipRender') ||
      isTruthyParam(urlParams, 'skiprender') ||
      isTruthyParam(urlParams, 'noRender') ||
      isTruthyParam(urlParams, 'norender') ||
      urlParams.get('render') === '0'

    const dprOverrideRaw = urlParams.get('dpr') || urlParams.get('pixelRatio') || urlParams.get('pixelratio') || urlParams.get('pr')
    const dprOverride = dprOverrideRaw != null && dprOverrideRaw !== '' ? Number.parseFloat(dprOverrideRaw) : NaN
    this.debugPixelRatio = Number.isFinite(dprOverride) ? dprOverride : null

    const dprKey = urlParams.has('dpr')
      ? 'dpr'
      : (urlParams.has('pixelRatio') ? 'pixelRatio' : (urlParams.has('pixelratio') ? 'pixelratio' : (urlParams.has('pr') ? 'pr' : null)))

    // autoQuality (default on) selects performance-friendly defaults unless
    // explicitly overridden via query params.
    const autoQualityOverride = getOptionalBool(urlParams, 'autoQuality', 'autoquality', 'aq')
    this.autoQualityEnabled = autoQualityOverride == null ? true : !!autoQualityOverride

    // Dynamic autoQuality can be explicitly controlled:
    // - `&autoQualityDynamic=1` (or `&aqDynamic=1`) forces the dynamic loop on.
    // - `&autoQualityDynamic=0` forces it off.
    // Default (param absent): dynamic is enabled only when pixel ratio isn't explicitly overridden.
    const autoQualityDynamicOverride = getOptionalBool(
      urlParams,
      'autoQualityDynamic',
      'autoqualitydynamic',
      'aqDynamic',
      'aqdynamic',
      'aqdyn'
    )
    this.autoQualityDynamicRequested = autoQualityDynamicOverride

    // `&aa=0` disables antialias/MSAA (useful for isolating MSAA cost regressions).
    const aaKey = urlParams.has('aa') ? 'aa' : (urlParams.has('antialias') ? 'antialias' : (urlParams.has('msaa') ? 'msaa' : null))
    const aaOverride = aaKey ? isTruthyParam(urlParams, aaKey) : null
    const injectedDefaults = this._injectedDefaultParams
    const hasAaOverride = aaOverride != null && !(aaKey === 'aa' && injectedDefaults?.has?.('aa'))
    // Baseline default: from stored global defaults (fallback: off) unless explicitly overridden.
    this.debugAntialias = hasAaOverride ? !!aaOverride : !!(globalDefaults.antialias ?? false)

    const hasPixelRatioOverride = this.debugPixelRatio != null && !(dprKey === 'dpr' && injectedDefaults?.has?.('dpr'))

    this.pixelRatioOverridden = !!hasPixelRatioOverride
    this.antialiasOverridden = !!hasAaOverride

    // If the user explicitly requests dynamic autoQuality, treat `dpr=` as a seed value
    // rather than a hard lock.
    this.pixelRatioLocked = !!hasPixelRatioOverride && autoQualityDynamicOverride !== true

    // Apply autoQuality defaults only when user didn't explicitly set them.
    // Heuristic: on high-DPR displays, cap render resolution to reduce fragment cost.
    // (This is intentionally conservative and can be overridden with `dpr=` / `aa=`)
    let qualityReason = 'manual'
    if (this.autoQualityEnabled) {
      // Leave antialias enabled by default; the dynamic controller will disable
      // it first if the frame-rate target isn't being met.

      if (!hasPixelRatioOverride) {
        const deviceDpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
        const seeded = Number.isFinite(globalDefaults.pixelRatio)
          ? globalDefaults.pixelRatio
          : 2
        this.debugPixelRatio = this._snapPixelRatio(seeded, { min: 0.25, max: 2 })
        qualityReason = `auto(dpr=${deviceDpr} seed=${seeded} snap=${this.debugPixelRatio})`
      } else {
        qualityReason = autoQualityDynamicOverride === true ? 'auto(with pixelRatio seed)' : 'auto(with pixelRatio override)'
      }
    }

    // Dynamic auto-quality: adjust pixelRatio over time to track display refresh.
    // Default: disabled when user explicitly sets pixel ratio.
    // If `autoQualityDynamic=1`, dynamic is enabled even with a pixelRatio override.
    // If `autoQualityDynamic=0`, dynamic is disabled regardless.
    if (autoQualityDynamicOverride === false) {
      this.autoQualityDynamic = false
    } else if (autoQualityDynamicOverride === true) {
      this.autoQualityDynamic = !!this.autoQualityEnabled
    } else {
      this.autoQualityDynamic = this.autoQualityEnabled && !this.pixelRatioLocked
    }

    // Best-effort refresh-rate probe (Chrome doesn't expose refresh Hz directly).
    // Runs a short rAF loop before heavy rendering starts and sets targetFps.
    this.quality = {
      // Start conservative; will be refined by the probe.
      targetFps: 60,
      refreshHz: null,
      minPixelRatio: 0.25,
      maxPixelRatio: Math.max(2, Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1),
      // Slower cadence reduces flicker/thrashing, especially for multipass shaders
      // that resize render targets on pixelRatio changes.
      adjustEveryMs: 2000,
      lastAdjustAt: 0,
      lastStatusAt: 0,
      lastMetric: null,

      // Smoothed metrics to avoid reacting to noisy single-sample GPU queries.
      gpuEmaMs: null,
      rafEmaDtMs: null,

      // Upscale gating: only increase quality slowly when there's sustained headroom.
      goodGpuWindows: 0,
      stableWindows: 0,
      lastIncreaseAt: 0,
      increaseCooldownMs: 12000,
      settled: false,
      settledAt: 0,
    }

    const probeRefreshRate = () => {
      try {
        const samples = []
        let last = 0
        const startAt = performance.now()
        const maxMs = 700
        const maxSamples = 90

        const step = (t) => {
          const now = Number.isFinite(t) ? t : performance.now()
          if (last) {
            const dt = now - last
            if (Number.isFinite(dt) && dt > 0 && dt < 100) samples.push(dt)
          }
          last = now

          const elapsed = now - startAt
          if (elapsed < maxMs && samples.length < maxSamples) {
            requestAnimationFrame(step)
            return
          }

          if (samples.length < 10) return
          const sorted = samples.slice().sort((a, b) => a - b)
          const mid = sorted[Math.floor(sorted.length / 2)]
          if (!Number.isFinite(mid) || mid <= 0) return
          const hz = 1000 / mid

          // Snap to common refresh rates.
          const candidates = [240, 165, 144, 120, 90, 75, 60]
          let snapped = 60
          let bestErr = Infinity
          for (const c of candidates) {
            const err = Math.abs(hz - c)
            if (err < bestErr) {
              bestErr = err
              snapped = c
            }
          }

          this.quality.refreshHz = snapped
          this.quality.targetFps = snapped
          if (qualityLogsEnabled) {
            console.log('[Quality] refresh probe', {
              medianDtMs: Number(mid.toFixed(2)),
              measuredHz: Number(hz.toFixed(1)),
              snappedHz: snapped,
            })
          }
        }

        requestAnimationFrame(step)
      } catch (e) {
        // ignore
      }
    }

    if (this.autoQualityDynamic) probeRefreshRate()

    try {
      const deviceDpr = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null
      if (qualityLogsEnabled) {
        console.log('[Quality]', {
          autoQuality: this.autoQualityEnabled,
          dynamic: this.autoQualityDynamic,
          dynamicRequested: this.autoQualityDynamicRequested,
          reason: qualityReason,
          defaultsInjected: Array.isArray(this._injectedDefaultParams ? Array.from(this._injectedDefaultParams) : null)
            ? Array.from(this._injectedDefaultParams)
            : null,
          deviceDpr,
          pixelRatio: this.debugPixelRatio,
          antialias: this.debugAntialias,
          pixelRatioOverridden: hasPixelRatioOverride,
          pixelRatioLocked: this.pixelRatioLocked,
          antialiasOverridden: hasAaOverride,
        })
      }
    } catch (e) {
      // ignore
    }

    // Persist debug flags/merged params for later (createManagers, per-frame timing).
    this.urlParams = urlParams

    // Capture baseline quality state (URL/debug-profile defaults) so per-visualizer
    // overrides can be reverted cleanly.
    if (!this._baseQualityState) {
      this._baseQualityState = {
        debugAntialias: this.debugAntialias,
        debugPixelRatio: this.debugPixelRatio,
        pixelRatioOverridden: this.pixelRatioOverridden,
        pixelRatioLocked: this.pixelRatioLocked,
        antialiasOverridden: this.antialiasOverridden,
        autoQualityDynamic: this.autoQualityDynamic,
      }
    }
    this.perfEnabled = wantsPerf
    this.qualityLogsEnabled = qualityLogsEnabled
    if (this.perfEnabled) {
      this.perfState = {
        visualizerUpdateMs: 0,
        audioUpdateMs: 0,
        renderMs: 0,
        totalMs: 0,
        gpuRenderMs: null,
      }
      console.log('[Perf] perf enabled (add `?perf=1` to the URL)')

      if (!this.perfIntervalId) {
        this.perfIntervalId = window.setInterval(() => {
          try {
            const snapshotNow = performance.now()
            const sampleMs = Number.isFinite(this.perfSnapshotLastAt) ? (snapshotNow - this.perfSnapshotLastAt) : null
            this.perfSnapshotLastAt = snapshotNow

            const lastFrameDtMs = Number.isFinite(this.lastFrameDtMs) ? this.lastFrameDtMs : null

            let rafFrames = null
            let avgRafDtMs = null
            let maxRafDtMs = null
            let rafFps = null
            if (this.rafStats && Number.isFinite(this.rafStats.frames) && this.rafStats.frames > 0) {
              rafFrames = this.rafStats.frames
              avgRafDtMs = this.rafStats.sumDt / this.rafStats.frames
              maxRafDtMs = this.rafStats.maxDt
              rafFps = avgRafDtMs > 0 ? (1000 / avgRafDtMs) : null

              // Reset sample window while keeping `lastAt` intact.
              this.rafStats.frames = 0
              this.rafStats.sumDt = 0
              this.rafStats.maxDt = 0
            }

            const fps = this.fpsState?.fpsEma
            const gl = this.renderer?.getContext?.()
            const ctxAttrs = gl?.getContextAttributes?.() || null
            const canvas = this.renderer?.domElement || null
            const snapshot = {
              t: Number((snapshotNow / 1000).toFixed(3)),
              sampleMs: Number.isFinite(sampleMs) ? Number(sampleMs.toFixed(0)) : null,
              fps: Number.isFinite(fps) ? Number(fps.toFixed(2)) : null,
              dpr: Number.isFinite(window.devicePixelRatio) ? Number(window.devicePixelRatio.toFixed(3)) : null,
              pixelRatio: Number.isFinite(this.renderer?.getPixelRatio?.()) ? Number(this.renderer.getPixelRatio().toFixed(3)) : null,
              autoQuality: typeof this.autoQualityEnabled === 'boolean' ? this.autoQualityEnabled : null,
              aaReq: typeof this.debugAntialias === 'boolean' ? this.debugAntialias : null,
              aa: typeof ctxAttrs?.antialias === 'boolean' ? ctxAttrs.antialias : null,
              skipRender: !!this.debugSkipRender,
              dbw: Number.isFinite(gl?.drawingBufferWidth) ? gl.drawingBufferWidth : null,
              dbh: Number.isFinite(gl?.drawingBufferHeight) ? gl.drawingBufferHeight : null,
              canvasW: Number.isFinite(canvas?.width) ? canvas.width : null,
              canvasH: Number.isFinite(canvas?.height) ? canvas.height : null,
              clientW: Number.isFinite(canvas?.clientWidth) ? canvas.clientWidth : null,
              clientH: Number.isFinite(canvas?.clientHeight) ? canvas.clientHeight : null,
              lastFrameDtMs: Number.isFinite(lastFrameDtMs) ? Number(lastFrameDtMs.toFixed(2)) : null,
              rafFrames,
              avgRafDtMs: Number.isFinite(avgRafDtMs) ? Number(avgRafDtMs.toFixed(2)) : null,
              maxRafDtMs: Number.isFinite(maxRafDtMs) ? Number(maxRafDtMs.toFixed(2)) : null,
              rafFps: Number.isFinite(rafFps) ? Number(rafFps.toFixed(2)) : null,
              updMs: Number.isFinite(this.perfState?.visualizerUpdateMs) ? Number(this.perfState.visualizerUpdateMs.toFixed(2)) : null,
              audMs: Number.isFinite(this.perfState?.audioUpdateMs) ? Number(this.perfState.audioUpdateMs.toFixed(2)) : null,
              rndMs: Number.isFinite(this.perfState?.renderMs) ? Number(this.perfState.renderMs.toFixed(2)) : null,
              gpuMs: Number.isFinite(this.perfState?.gpuRenderMs) ? Number(this.perfState.gpuRenderMs.toFixed(2)) : null,
              totMs: Number.isFinite(this.perfState?.totalMs) ? Number(this.perfState.totalMs.toFixed(2)) : null,
              visualizer: App.visualizerType || null,
              visibility: document.visibilityState || null,
            }

            console.log('[Perf]', snapshot)
            console.log('[PerfJSON]', JSON.stringify(snapshot))
          } catch (e) {
            // ignore
          }
        }, 5000)

        window.addEventListener('beforeunload', () => {
          try {
            if (this.perfIntervalId) {
              clearInterval(this.perfIntervalId)
              this.perfIntervalId = null
            }
          } catch (e) {
            // ignore
          }
        })
      }
    }

    // Hotkeys: numpad + / - to cycle visualizers
    window.addEventListener('keydown', this.onKeyDown)
    
    // Capture Num+/Num- before lil-gui can stop propagation
    document.addEventListener('keydown', (e) => {
      if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || 
          ((e.key === '+' || e.key === '-') && e.location === 3)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.code === 'NumpadAdd' || e.key === '+') {
          this.cycleVisualizer(1)
        } else {
          this.cycleVisualizer(-1)
        }
      }
    }, { capture: true })

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.debugAntialias,
      alpha: true,
      powerPreference: 'high-performance',
    })

    if (this.perfEnabled) {
      try {
        console.log('[Perf] antialias requested:', this.debugAntialias)
      } catch (e) {
        // ignore
      }
    }

    if (this.debugPixelRatio != null) {
      try {
        const clamped = Math.max(0.25, Math.min(4, this.debugPixelRatio))
        this.renderer.setPixelRatio(clamped)
        if (this.perfEnabled) console.log('[Perf] pixelRatio override:', clamped)

        // Keep quality bounds in sync with an explicitly set starting ratio.
        if (this.quality) {
          this.quality.maxPixelRatio = Math.max(this.quality.maxPixelRatio, clamped)
        }
      } catch (e) {
        // ignore
      }
    }

    if (wantsGpuInfo) {
      console.log('[GPU] gpuInfo enabled (add `?gpuInfo=1` to the URL)')
      try {
        console.log('[GPU] href', window.location.href)
        if (document.referrer) console.log('[GPU] referrer', document.referrer)
        console.log('[GPU] param keys', [...urlParams.keys()])
      } catch (e) {
        // ignore
      }
      this.logWebGLInfo(this.renderer.getContext(), 'THREE.WebGLRenderer')

      // Periodic logging helps compare Stable vs Canary over time.
      // Keep it low-frequency to avoid console overhead.
      if (!this.gpuInfoIntervalId) {
        this.gpuInfoIntervalId = window.setInterval(() => {
          try {
            this.logWebGLInfo(this.renderer?.getContext?.(), 'THREE.WebGLRenderer')
          } catch (e) {
            // ignore
          }
        }, 5000)

        window.addEventListener('beforeunload', () => {
          try {
            if (this.gpuInfoIntervalId) {
              clearInterval(this.gpuInfoIntervalId)
              this.gpuInfoIntervalId = null
            }
          } catch (e) {
            // ignore
          }
        })
      }
    }

    // Expose renderer for visualizers needing post-processing
    App.renderer = this.renderer

    if (this.perfEnabled) {
      try {
        const gl = this.renderer.getContext()
        this.gpuTimer = new WebGLGpuTimer(gl)
        console.log('[Perf] GPU timer query support:', !!this.gpuTimer?.supported)
      } catch (e) {
        this.gpuTimer = null
      }
    }

    this.renderer.setClearColor(0x000000, 0)
    // Use updateStyle=false; CSS sizing is handled explicitly.
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.autoClear = false
    const content = document.querySelector('.content')
    if (content) {
      this._applyMainCanvasStyle(this.renderer.domElement)
      content.appendChild(this.renderer.domElement)
    }

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 10000)
    this.camera.position.z = 12
    this.camera.frustumCulled = false
    App.camera = this.camera

    this.scene = new THREE.Scene()
    this.scene.add(this.camera)
    App.scene = this.scene

    App.holder = new THREE.Object3D()
    App.holder.name = 'holder'
    this.scene.add(App.holder)
    App.holder.sortObjects = false

    App.gui = new GUI({ title: 'VISUALIZER' })
    
    // Disable collapse functionality on root GUI
    App.gui.open()
    
    // Apply root GUI styles (border, shadow, padding)
    this.setupGuiCloseButton()

    // Keep the controls visible above any full-screen overlay canvases.
    // (Some visualizers render into their own 2D canvas and may clear to black.)
    if (App.gui?.domElement) {
      const guiRoot = App.gui.domElement
      // lil-gui autoPlace appends directly to document.body (no wrapper).
      // Only style the guiRoot element — never its parent (which is body).
      guiRoot.style.position = 'fixed'
      guiRoot.style.right = '12px'
      guiRoot.style.left = 'auto'
      guiRoot.style.top = '12px'
      guiRoot.style.zIndex = '2500'
      guiRoot.style.pointerEvents = 'auto'
      guiRoot.style.boxSizing = 'border-box'
    }

    this.createManagers()

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  _getContextAntialias() {
    try {
      const gl = this.renderer?.getContext?.()
      const attrs = gl?.getContextAttributes?.()
      return typeof attrs?.antialias === 'boolean' ? attrs.antialias : null
    } catch (e) {
      return null
    }
  }

  _applyMainCanvasStyle(canvas) {
    try {
      if (!canvas || !canvas.style) return
      // Ensure the canvas fills the app container even when we call
      // `renderer.setSize(..., false)` (which intentionally does not touch CSS).
      canvas.style.position = 'absolute'
      canvas.style.top = '0'
      canvas.style.left = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      canvas.style.zIndex = '0'
    } catch (e) {
      // ignore
    }
  }

  _recreateRendererWithAntialias(antialias) {
    try {
      if (!this.renderer) return false

      const old = this.renderer
      const oldCanvas = old.domElement
      const parent = oldCanvas?.parentElement || null

      // Preserve CSS sizing/positioning so the replacement canvas doesn't
      // fall back to the default 300x150 size (which looks like a shrink to
      // the top-left).
      const oldCanvasStyleText = oldCanvas?.style?.cssText || ''
      const oldCanvasClassName = oldCanvas?.className || ''

      const oldPixelRatio = old.getPixelRatio?.() || 1

      let size = { x: window.innerWidth, y: window.innerHeight }
      try {
        const v = new THREE.Vector2()
        old.getSize(v)
        if (Number.isFinite(v.x) && Number.isFinite(v.y) && v.x > 0 && v.y > 0) size = { x: v.x, y: v.y }
      } catch (e) {
        // ignore
      }

      let clearColor = new THREE.Color(0x000000)
      let clearAlpha = 0
      try {
        old.getClearColor(clearColor)
        clearAlpha = typeof old.getClearAlpha === 'function' ? old.getClearAlpha() : 0
      } catch (e) {
        // ignore
      }

      try {
        old.dispose()
      } catch (e) {
        // ignore
      }

      const next = new THREE.WebGLRenderer({
        antialias: !!antialias,
        alpha: true,
        powerPreference: 'high-performance',
      })

      next.setPixelRatio(oldPixelRatio)
      next.setClearColor(clearColor, clearAlpha)
      next.autoClear = false
      next.setSize(size.x, size.y, false)

      try {
        if (oldCanvasClassName) next.domElement.className = oldCanvasClassName
        if (oldCanvasStyleText) next.domElement.style.cssText = oldCanvasStyleText
      } catch (e) {
        // ignore
      }
      this._applyMainCanvasStyle(next.domElement)

      if (parent && oldCanvas) {
        parent.replaceChild(next.domElement, oldCanvas)
      }

      this.renderer = next
      App.renderer = next

      if (this.perfEnabled) {
        try {
          const gl = next.getContext()
          this.gpuTimer = new WebGLGpuTimer(gl)
        } catch (e) {
          this.gpuTimer = null
        }
      }

      // Keep viewport/camera and cached dims consistent.
      try {
        this.resize()
      } catch (e) {
        // ignore
      }

      // Visualizers that cache renderer-dependent resources may want to resync.
      try {
        const v = App.currentVisualizer
        if (v && typeof v.onRendererRecreated === 'function') {
          v.onRendererRecreated(next, old)
        }
      } catch (e) {
        // ignore
      }

      return true
    } catch (e) {
      return false
    }
  }

  logWebGLInfo(gl, label = 'WebGL') {
    try {
      if (!gl) return

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      const unmaskedVendor = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : null
      const unmaskedRenderer = debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : null

      const info = {
        unmaskedVendor,
        unmaskedRenderer,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      }

      console.log(`[${label}]`, info)
    } catch (e) {
      console.warn(`[${label}] Failed to query WebGL info:`, e)
    }
  }

  async createManagers() {
    App.audioManager = new AudioManager()
    
    // Show loading progress
    const loadingText = document.querySelector('.user_interaction')
    const originalHTML = loadingText.innerHTML
    
    await App.audioManager.loadAudioBuffer((progress, isComplete) => {
      loadingText.innerHTML = `<div style="font-family: monospace; font-size: 24px; color: white;">Loading: ${Math.round(progress)}%</div>`
    })

    App.bpmManager = new BPMManager()
    App.bpmManager.addEventListener('beat', () => {
      if (App.currentVisualizer && typeof App.currentVisualizer.onBPMBeat === 'function') {
        App.currentVisualizer.onBPMBeat()
      }
    })
    
    // Start with default BPM
    App.bpmManager.setBPM(140)

    loadingText.remove()

    // Initialize player controls
    this.initPlayerControls()

    // Initialize last-used visualizer (fallback to default)
    const storedVisualizer = this.getStoredVisualizerType()
    const urlParams = this.urlParams || new URLSearchParams(window.location.search || '')
    const urlVisualizerRaw = urlParams.get('visualizer') || urlParams.get('viz') || urlParams.get('v')

    const getAllVisualizerNames = () => {
      if (Array.isArray(App.visualizerList) && App.visualizerList.length > 0) return App.visualizerList
      return [...ENTITY_VISUALIZER_NAMES, ...SHADER_VISUALIZER_NAMES]
    }

    const resolveVisualizerName = (name) => {
      if (!name) return null
      const trimmed = String(name).trim()
      if (!trimmed) return null

      const all = getAllVisualizerNames()
      const exact = all.find((n) => n === trimmed)
      if (exact) return exact

      const lower = trimmed.toLowerCase()
      const ci = all.find((n) => String(n).toLowerCase() === lower)
      if (ci) return ci

      // Convenience: allow `Starbattle` instead of `Shader: Starbattle`.
      const shaderPrefixed = `Shader: ${trimmed}`
      const shaderExact = all.find((n) => n === shaderPrefixed)
      if (shaderExact) return shaderExact

      const shaderCi = all.find((n) => String(n).toLowerCase() === shaderPrefixed.toLowerCase())
      if (shaderCi) return shaderCi

      return null
    }

    const urlVisualizer = resolveVisualizerName(urlVisualizerRaw)
    if (urlVisualizerRaw && !urlVisualizer) {
      console.warn('[Visualizer] Unknown `visualizer` param:', urlVisualizerRaw)
    }
    if (urlVisualizer) {
      console.log('[Visualizer] URL override visualizer:', urlVisualizer)
    }

    const initialVisualizer = urlVisualizer || storedVisualizer || 'Reactive Particles'
    // Ensure the top selector reflects what we'll load.
    App.visualizerType = initialVisualizer

    // Build common controls first so they appear above visualizer-specific folders.
    this.addVisualizerSwitcher()
    this.addPerformanceQualityControls()

    // Now create the actual visualizer.
    this.switchVisualizer(initialVisualizer, { notify: false })

    // Restore last playback position before starting audio so reload resumes.
    this.restoreSessionOnPlay()

    // Start playback (user already clicked to initialize the app)
    App.audioManager.play()

    // Detect BPM in the background after 30 seconds
    setTimeout(async () => {
      console.log('Starting background BPM detection...')
      try {
        const bpmBuffer = await App.audioManager.getAudioBufferForBPM(60, 30)
        await App.bpmManager.detectBPM(bpmBuffer)
        console.log('BPM detection complete:', App.bpmManager.bpm)
      } catch (e) {
        console.warn('Background BPM detection failed, keeping default:', e)
      }
    }, 30000)

    // Emit available modules to parent (if embedded)
    if (this.bridgeTarget) {
      this.postModuleList(this.bridgeTarget)
    }

    this.update()

    this.enableBridgeGuiHotspot()
  }

  enableBridgeGuiHotspot() {
    if (this.bridgeGuiHotspotEnabled) return
    const isEmbedded = window.parent && window.parent !== window
    const params = new URLSearchParams(window.location.search || '')
    const wantsHide = params.get('hideui') === '1' || params.get('autostart') === '1'
    const guiContainer = document.querySelector('.lil-gui.autoPlace') || App.gui?.domElement
    if (!guiContainer) return
    const guiHidden = getComputedStyle(guiContainer).display === 'none'
    if (!(isEmbedded && (wantsHide || guiHidden))) return

    // With the bridge-collapsed approach the GUI is revealed via hover + click
    // on its own title bar — no blocking hotspot needed. Instead, use a
    // pointer-events-transparent overlay that only shows a cursor hint.
    const hotspot = document.createElement('div')
    hotspot.style.position = 'fixed'
    hotspot.style.top = '0'
    hotspot.style.right = '0'
    hotspot.style.width = '200px'
    hotspot.style.height = '200px'
    hotspot.style.zIndex = '2400'          // below lil-gui (2500)
    hotspot.style.cursor = 'pointer'
    hotspot.style.background = 'transparent'
    hotspot.style.pointerEvents = 'none'   // let clicks pass through to GUI
    hotspot.title = 'Show controls'

    document.body.appendChild(hotspot)
    this.bridgeGuiHotspotEnabled = true
  }

  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight

    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    // Avoid touching canvas CSS size; only update drawing buffer.
    this.renderer.setSize(this.width, this.height, false)

    // Some visualizers use raw WebGL calls; keep viewport/scissor sane.
    try {
      this.renderer.setScissorTest(false)
      this.renderer.setViewport(0, 0, this.width, this.height)
    } catch (e) {
      // ignore
    }
  }

  update(now) {
    requestAnimationFrame((t) => this.update(t))

    const frameNow = Number.isFinite(now) ? now : performance.now()
    const perfStart = this.perfEnabled ? performance.now() : 0

    // Track rAF cadence independent of FPS EMA.
    if (this.rafStats) {
      if (this.rafStats.lastAt) {
        const dt = frameNow - this.rafStats.lastAt
        if (Number.isFinite(dt) && dt >= 0) {
          this.rafStats.frames += 1
          this.rafStats.sumDt += dt
          if (dt > this.rafStats.maxDt) this.rafStats.maxDt = dt
          this.lastFrameDtMs = dt
        }
      }
      this.rafStats.lastAt = frameNow
    }

    // Track a *short* window for auto-quality adjustments.
    if (this.qualityWindow && Number.isFinite(this.lastFrameDtMs)) {
      const dt = this.lastFrameDtMs
      if (dt >= 0 && dt < 1000) {
        if (!this.qualityWindow.startAt) this.qualityWindow.startAt = frameNow
        const ageMs = frameNow - this.qualityWindow.startAt
        // Keep it responsive: ~1s window (or ~90 frames max).
        if (ageMs > 1000 || this.qualityWindow.frames > 90) {
          this.qualityWindow.startAt = frameNow
          this.qualityWindow.frames = 0
          this.qualityWindow.sumDt = 0
          this.qualityWindow.maxDt = 0
        }

        this.qualityWindow.frames += 1
        this.qualityWindow.sumDt += dt
        if (dt > this.qualityWindow.maxDt) this.qualityWindow.maxDt = dt
      }
    }

    this.tickFpsCounter(frameNow)

    // Update visualizer with audio data
    const audioData = App.audioManager ? {
      frequencies: {
        bass: App.audioManager.frequencyData.low,
        mid: App.audioManager.frequencyData.mid,
        high: App.audioManager.frequencyData.high
      },
      isBeat: App.bpmManager?.beatActive || false
    } : null
    
    const activeVisualizer = App.currentVisualizer
    const t0 = this.perfEnabled ? performance.now() : 0
    activeVisualizer?.update(audioData)
    const t1 = this.perfEnabled ? performance.now() : 0

    App.audioManager.update()
    const t2 = this.perfEnabled ? performance.now() : 0

    // Some visualizers render into their own canvas/renderer.
    if (!activeVisualizer?.rendersSelf) {
      const r0 = this.perfEnabled ? performance.now() : 0

      if (!this.debugSkipRender) {
        if (this.perfEnabled && this.gpuTimer?.supported) {
          this.gpuTimer.begin()
        }

        // Defensive: ensure viewport wasn't modified by raw GL code.
        if (Number.isFinite(this.width) && Number.isFinite(this.height)) {
          try {
            this.renderer.setScissorTest(false)
            this.renderer.setViewport(0, 0, this.width, this.height)
          } catch (e) {
            // ignore
          }
        }

        this.renderer.render(this.scene, this.camera)

        if (this.perfEnabled && this.gpuTimer?.supported) {
          this.gpuTimer.end()
        }
      }

      const r1 = this.perfEnabled ? performance.now() : 0
      if (this.perfEnabled && this.perfState) this.perfState.renderMs = r1 - r0
    } else if (this.perfEnabled && this.perfState) {
      this.perfState.renderMs = 0
    }

    if (this.perfEnabled && this.perfState) {
      this.perfState.visualizerUpdateMs = t1 - t0
      this.perfState.audioUpdateMs = t2 - t1
      this.perfState.totalMs = performance.now() - perfStart

      if (this.gpuTimer?.supported) {
        this.perfState.gpuRenderMs = this.gpuTimer.poll()
      } else {
        this.perfState.gpuRenderMs = null
      }
    }

    // Dynamic auto-quality adjustment (pixelRatio) to track target refresh.
    this.maybeAdjustQuality(frameNow)
  }

  maybeAdjustQuality(frameNow) {
    try {
      if (!this.autoQualityDynamic || !this.quality || !this.renderer) return
      if (this.pixelRatioLocked) return
      if (this.debugSkipRender) return

      const v = App.currentVisualizer
      if (v?.rendersSelf) return

      const getVisualizerQualityConstraints = () => {
        try {
          if (!v) return null
          if (typeof v.getQualityConstraints === 'function') return v.getQualityConstraints() || null
          return v.qualityConstraints || null
        } catch {
          return null
        }
      }

      const nowMs = Number.isFinite(frameNow) ? frameNow : performance.now()

      // Periodic status log (helps confirm the loop is running).
      if (!this.quality.lastStatusAt || (nowMs - this.quality.lastStatusAt) >= 5000) {
        this.quality.lastStatusAt = nowMs
        const cur = this.renderer.getPixelRatio?.() || 1
        if (this.qualityLogsEnabled) {
          console.log('[Quality] status', {
            targetFps: this.quality.targetFps,
            refreshHz: this.quality.refreshHz,
            pixelRatio: Number(cur.toFixed(3)),
            minPixelRatio: this.quality.minPixelRatio,
            maxPixelRatio: this.quality.maxPixelRatio,
            settled: !!this.quality.settled,
            rafEmaDtMs: Number.isFinite(this.quality.rafEmaDtMs) ? Number(this.quality.rafEmaDtMs.toFixed(2)) : null,
            gpuEmaMs: Number.isFinite(this.quality.gpuEmaMs) ? Number(this.quality.gpuEmaMs.toFixed(2)) : null,
            metric: this.quality.lastMetric,
          })
        }
      }

      const targetFps = Math.max(10, Math.min(240, this.quality.targetFps || 60))
      const targetFrameMs = 1000 / targetFps

      // Compute a fresh rAF cadence sample *before* any gating.
      // Note: if we gate using a stale EMA and also reset the window, we can
      // get stuck never adapting even when FPS is low.
      const avgDt = (this.qualityWindow?.frames > 0)
        ? (this.qualityWindow.sumDt / this.qualityWindow.frames)
        : null

      // Prefer instantaneous cadence for responsiveness; fall back to short-window avg.
      const dtSample = Number.isFinite(this.lastFrameDtMs)
        ? this.lastFrameDtMs
        : ((avgDt != null && Number.isFinite(avgDt) && avgDt > 0) ? avgDt : null)

      // Update EMA continuously so it reflects drops quickly.
      if (dtSample != null && Number.isFinite(dtSample) && dtSample > 0 && dtSample < 1000) {
        const a = 0.25
        this.quality.rafEmaDtMs = (this.quality.rafEmaDtMs == null)
          ? dtSample
          : (this.quality.rafEmaDtMs * (1 - a) + dtSample * a)
      }

      // Do not adjust quality if we are achieving at least 80% of the target.
      // This avoids constant churn and prevents breaking shaders that rely on
      // stable pixel-space behavior.
      const rafMetricForFps = Number.isFinite(this.quality.rafEmaDtMs)
        ? this.quality.rafEmaDtMs
        : dtSample
      const achievedFps = (rafMetricForFps && rafMetricForFps > 0) ? (1000 / rafMetricForFps) : null
      if (achievedFps != null && achievedFps >= targetFps * 0.8) {
        // Do not touch `lastAdjustAt` here; only update it when we *change*
        // quality. This allows immediate response if FPS later drops.
        return
      }

      // Gate adjustments *after* updating metrics so we can react faster when FPS is very low.
      const baseAdjustEveryMs = Number.isFinite(this.quality.adjustEveryMs) ? this.quality.adjustEveryMs : 2000
      const severeLowFps = achievedFps != null && achievedFps < targetFps * 0.5
      const effectiveAdjustEveryMs = severeLowFps ? Math.min(baseAdjustEveryMs, 800) : baseAdjustEveryMs
      if (this.quality.lastAdjustAt && (nowMs - this.quality.lastAdjustAt) < effectiveAdjustEveryMs) return

      const currentRatio = this.renderer.getPixelRatio?.() || 1
      const constraints = getVisualizerQualityConstraints()
      const constraintMin = Number.isFinite(constraints?.minPixelRatio) ? constraints.minPixelRatio : null
      const constraintMax = Number.isFinite(constraints?.maxPixelRatio) ? constraints.maxPixelRatio : null
      const minRatio = Math.max(this.quality.minPixelRatio, constraintMin != null ? constraintMin : this.quality.minPixelRatio)
      const maxRatio = Math.min(this.quality.maxPixelRatio, constraintMax != null ? constraintMax : this.quality.maxPixelRatio)

      // Use rAF cadence (frame pacing) to decide when to degrade.
      // GPU timer queries can be noisy and are not required for the 80% policy.
      const gpuMs = Number.isFinite(this.perfState?.gpuRenderMs) ? this.perfState.gpuRenderMs : null
      // `avgDt` and `rafEmaDtMs` were already updated above.

      if (gpuMs != null && Number.isFinite(gpuMs) && gpuMs > 0 && gpuMs < 1000) {
        const a = 0.18
        // If a sample jumps wildly, treat it as noise unless rAF cadence also indicates trouble.
        const prev = this.quality.gpuEmaMs
        const rafSuggestsSlow = Number.isFinite(this.quality.rafEmaDtMs)
          ? (this.quality.rafEmaDtMs > (1000 / targetFps) * 1.08)
          : false

        const isWildJump = (prev != null) ? (gpuMs > prev * 2.2 || gpuMs < prev * 0.45) : false
        if (!isWildJump || rafSuggestsSlow) {
          this.quality.gpuEmaMs = (prev == null) ? gpuMs : (prev * (1 - a) + gpuMs * a)
        }
      }

      let factor = 1
      let basis = 'none'
      let metric = null

      const rafMetric = Number.isFinite(this.quality.rafEmaDtMs) ? this.quality.rafEmaDtMs : avgDt
      if (rafMetric == null || !Number.isFinite(rafMetric) || rafMetric <= 0) return

      basis = 'rafEmaDtMs'
      metric = rafMetric

      // If we're under 80% of target FPS, degrade quality.
      const thresholdFrameMs = targetFrameMs / 0.8
      if (rafMetric <= thresholdFrameMs) {
        // (We should have returned earlier, but keep safe.)
        this.quality.lastAdjustAt = nowMs
        return
      }

      // Step 1: disable antialias (MSAA) before touching pixelRatio.
      const currentAa = this._getContextAntialias()
      const canChangeAa = !this.antialiasOverridden
      if (currentAa === true && canChangeAa) {
        const ok = this._recreateRendererWithAntialias(false)
        if (ok) {
          this.debugAntialias = false
          this._persistAutoQualityForCurrentVisualizer()
          this._syncPerformanceQualityControls(App.visualizerType)
          this.quality.lastAdjustAt = nowMs
          if (this.qualityWindow) {
            this.qualityWindow.startAt = nowMs
            this.qualityWindow.frames = 0
            this.qualityWindow.sumDt = 0
            this.qualityWindow.maxDt = 0
          }
          if (this.qualityLogsEnabled) {
            console.log('[Quality] adjust', {
              targetFps,
              targetFrameMs: Number(targetFrameMs.toFixed(2)),
              action: 'disableAA',
              basis,
              metric: Number(rafMetric.toFixed(2)),
            })
          }
          return
        }
      }

      // Step 2: reduce pixelRatio (only after AA is already off or locked by override).
      // Pixel cost is ~ratio^2, so scale ratio by sqrt(time ratio).
      const desired = Math.sqrt((thresholdFrameMs * 0.95) / rafMetric)
      factor = Math.max(0.60, Math.min(0.97, desired))

      this.quality.lastMetric = {
        basis,
        value: metric != null ? Number(metric.toFixed(2)) : null,
        targetFrameMs: Number(targetFrameMs.toFixed(2)),
      }

      const nextRatioRaw = currentRatio * factor
      const clamped = Math.max(minRatio, Math.min(maxRatio, nextRatioRaw))
      const nextRatio = this._snapPixelRatio(clamped, { min: minRatio, max: maxRatio })
      const delta = Math.abs(nextRatio - currentRatio)

      const minDelta = Math.max(0.005, currentRatio * 0.02)
      if (delta < minDelta) {
        // Still reset the window so the next decision uses fresh data.
        if (this.qualityWindow) {
          this.qualityWindow.startAt = nowMs
          this.qualityWindow.frames = 0
          this.qualityWindow.sumDt = 0
          this.qualityWindow.maxDt = 0
        }
        this.quality.lastAdjustAt = nowMs
        return
      }

      this.renderer.setPixelRatio(nextRatio)
      // Keep CSS size and camera projection stable; just refresh drawing buffer.
      if (Number.isFinite(this.width) && Number.isFinite(this.height)) {
        this.renderer.setSize(this.width, this.height, false)
      }

      // Notify active visualizer about pixelRatio change without doing a full
      // window-resize path (which can reset animation state or cause flicker).
      try {
        const v = App.currentVisualizer
        if (v && typeof v.onPixelRatioChange === 'function') {
          v.onPixelRatioChange(nextRatio, currentRatio)
        }
      } catch (e) {
        // ignore
      }

      // Resync renderer WebGL state after a drawing-buffer resize.
      // (Needed when other code uses raw `gl.viewport` / scissor and desyncs Three's state cache.)
      try {
        if (typeof this.renderer.resetState === 'function') {
          this.renderer.resetState()
        }
        if (Number.isFinite(this.width) && Number.isFinite(this.height)) {
          this.renderer.setScissorTest(false)
          this.renderer.setViewport(0, 0, this.width, this.height)
        }
        const gl = this.renderer.getContext?.()
        if (gl?.drawingBufferWidth && gl?.drawingBufferHeight) {
          gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
        }
      } catch (e) {
        // ignore
      }

      // Reset window after applying a change.
      if (this.qualityWindow) {
        this.qualityWindow.startAt = nowMs
        this.qualityWindow.frames = 0
        this.qualityWindow.sumDt = 0
        this.qualityWindow.maxDt = 0
      }

      this.quality.lastAdjustAt = nowMs

      this._persistAutoQualityForCurrentVisualizer()
      this._syncPerformanceQualityControls(App.visualizerType)

      if (this.qualityLogsEnabled) {
        console.log('[Quality] adjust', {
          targetFps,
          targetFrameMs: Number(targetFrameMs.toFixed(2)),
          from: Number(currentRatio.toFixed(3)),
          to: Number(nextRatio.toFixed(3)),
          basis,
          metric: metric != null ? Number(metric.toFixed(2)) : null,
        })
      }
    } catch (e) {
      // ignore
    }
  }

  tickFpsCounter(now) {
    if (!this.fpsDisplay || !this.fpsState) return

    const state = this.fpsState
    if (!state.sampleStartAt) {
      state.sampleStartAt = now
      state.prevFrameAt = now
      state.frames = 0
      return
    }

    state.frames += 1
    const dtMs = now - state.prevFrameAt
    state.prevFrameAt = now

    const elapsedMs = now - state.sampleStartAt
    if (elapsedMs < 500) return

    const fps = (state.frames * 1000) / elapsedMs
    state.fpsEma = state.fpsEma ? (state.fpsEma * 0.8 + fps * 0.2) : fps
    state.frames = 0
    state.sampleStartAt = now

    const fpsText = Number.isFinite(state.fpsEma) ? state.fpsEma.toFixed(1) : '--'
    const dtText = Number.isFinite(dtMs) ? dtMs.toFixed(1) : '--'

    this.fpsDisplay.textContent = `FPS: ${fpsText} (${dtText}ms)`
  }
  
  async switchVisualizer(type, { notify = true } = {}) {
    // Destroy current visualizer if exists
    if (App.currentVisualizer) {
      if (typeof App.currentVisualizer.destroy === 'function') {
        App.currentVisualizer.destroy()
      }
      App.currentVisualizer = null
    }

    // Reset camera/scene transforms to defaults so visualizers don't leak state
    this.resetView()

    // Clear App.holder (Three.js scene objects)
    while (App.holder.children.length > 0) {
      App.holder.remove(App.holder.children[0])
    }

    // Clear renderer
    // Apply any per-visualizer quality overrides before creating the new visualizer.
    this._applyPerVisualizerQualityOverrides(type)
    this.renderer.clear()

    // Create new visualizer (async now due to shader config loading)
    const shaderVisualizer = await createShaderVisualizerByName(type)
    const milkdropVisualizer = !shaderVisualizer
      ? (await _milkdropReady, _milkdropModule?.createMilkdropVisualizerByName(type) ?? null)
      : null
    App.currentVisualizer = shaderVisualizer || milkdropVisualizer || createEntityVisualizerByName(type)

    if (!App.currentVisualizer) {
      const fallbackName = ENTITY_VISUALIZER_NAMES.includes('Reactive Particles')
        ? 'Reactive Particles'
        : ENTITY_VISUALIZER_NAMES[0]

      App.currentVisualizer = (fallbackName ? createEntityVisualizerByName(fallbackName) : null)
        || await createShaderVisualizerByName(SHADER_VISUALIZER_NAMES[0])
    }

    if (!App.currentVisualizer) {
      console.warn('No visualizers available to instantiate')
      return
    }

    App.currentVisualizer.init()

    if (type === 'Frequency Visualization 3') {
      this.setupFrequencyViz3Controls(App.currentVisualizer)
    } else {
      this.teardownFrequencyViz3Controls()
    }

    // Setup shader-specific controls if config exists
    if (App.currentVisualizer.shaderConfig) {
      this.setupShaderControls(App.currentVisualizer)
    } else {
      this.teardownShaderControls()
    }

    App.visualizerType = type
    this.saveVisualizerType(type)

    this.updateVisualizerToast(type)

    // Keep the GUI dropdown in sync with the active visualizer.
    // Important: the controller is bound to `this.visualizerSwitcherConfig.visualizer`,
    // not `App.visualizerType`, so we must update the bound property and refresh display.
    if (this.visualizerSwitcherConfig) {
      this.visualizerSwitcherConfig.visualizer = type
    }

    if (this.visualizerController) {
      // Avoid setValue() here to prevent triggering onChange -> switchVisualizer() recursion.
      if (typeof this.visualizerController.updateDisplay === 'function') {
        this.visualizerController.updateDisplay()
      } else if (typeof this.visualizerController.setValue === 'function' && this.visualizerController.getValue?.() !== type) {
        this.visualizerController.setValue(type)
      }

      // lil-gui uses a native <select>. Some browsers won't visually update an open/focused
      // select's displayed value reliably from programmatic updates, so also force the
      // underlying element's value to match.
      const selectEl = this._getVisualizerSelectElement()
      if (selectEl && selectEl.value !== type) {
        try {
          selectEl.value = type
        } catch {
          // ignore
        }
      }
    }

    console.log('Switched to visualizer:', type)

    // Keep the Performance + Quality controls in sync.
    this._syncPerformanceQualityControls(type)

    // Notify popup controls window (if open)
    this._broadcastVisualizerChanged()
    this._broadcastQualityState()

    // Notify parent bridge about module change (only when embedded)
    if (notify && this.bridgeTarget) {
      this.postModuleSet(true, this.bridgeTarget)
    }
  }

  createVisualizerToast() {
    if (this.visualizerToast) return this.visualizerToast
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.bottom = '8px'
    el.style.right = '8px'
    el.style.padding = '2px 6px'
    el.style.height = '12px'
    el.style.lineHeight = '12px'
    el.style.fontSize = '11px'
    el.style.fontFamily = 'Inter, system-ui, -apple-system, sans-serif'
    el.style.color = '#fff'
    el.style.background = '#000'
    el.style.borderRadius = '3px'
    el.style.opacity = '0'
    el.style.transition = 'opacity 250ms ease'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '1000'
    document.body.appendChild(el)
    this.visualizerToast = el
    return el
  }

  updateVisualizerToast(name) {
    const el = this.createVisualizerToast()
    el.textContent = name || ''
    if (this.visualizerToastHideTimer) {
      clearTimeout(this.visualizerToastHideTimer)
      this.visualizerToastHideTimer = null
    }

    // Fade in immediately, then fade out after 5s.
    requestAnimationFrame(() => {
      el.style.opacity = '0.9'
      this.visualizerToastHideTimer = setTimeout(() => {
        el.style.opacity = '0'
      }, 5000)
    })
  }

  onBridgeMessage(event) {
    const msg = event?.data
    if (!msg || typeof msg !== 'object') return

    const target = event?.source || this.bridgeTarget || null

    switch (msg.type) {
      case 'LIST_MODULES':
        this.postModuleList(target)
        break
      case 'SET_MODULE': {
        const moduleName = typeof msg.module === 'string' ? msg.module : null
        const isValid = moduleName && App.visualizerList.includes(moduleName)

        if (isValid) {
          this.switchVisualizer(moduleName, { notify: false })
          this.postModuleSet(true, target)
        } else {
          this.postModuleSet(false, target)
        }
        break
      }
      default:
        break
    }
  }

  postModuleList(target = this.bridgeTarget) {
    if (!target) return
    try {
      target.postMessage({
        type: 'MODULE_LIST',
        modules: [...App.visualizerList],
        active: App.visualizerType
      }, '*')
    } catch (err) {
      console.warn('[Visualizer] Failed to post module list', err)
    }
  }

  postModuleSet(ok, target = this.bridgeTarget) {
    if (!target) return
    try {
      target.postMessage({
        type: 'MODULE_SET',
        ok: ok === true,
        active: App.visualizerType,
        modules: [...App.visualizerList]
      }, '*')
    } catch (err) {
      console.warn('[Visualizer] Failed to post module change', err)
    }
  }

  resetView() {
    if (this.camera) {
      this.camera.position.set(0, 0, 12)
      this.camera.up.set(0, 1, 0)
      this.camera.quaternion.identity()
      this.camera.lookAt(0, 0, 0)
      this.camera.zoom = 1
      this.camera.fov = 70
      this.camera.updateProjectionMatrix()
    }

    if (App.holder) {
      App.holder.position.set(0, 0, 0)
      App.holder.rotation.set(0, 0, 0)
      App.holder.scale.set(1, 1, 1)
    }

    if (this.scene) {
      this.scene.fog = null
    }
  }

  handleKeyDown(event) {
    const target = event.target
    const isFormElement = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    
    // For NumpadAdd/NumpadSubtract, always allow them to work (even in GUI)
    const isNumpadPlusMinus = event.code === 'NumpadAdd' || event.code === 'NumpadSubtract' || 
                               (event.key === '+' || event.key === '-')
    
    // Ignore form inputs, except for numpad +/- which should always work
    if (isFormElement && !isNumpadPlusMinus) return

    // Spacebar: toggle play/pause
    if (event.code === 'Space' || event.key === ' ') {
      if (!App.audioManager) return
      event.preventDefault()
      const playPauseBtn = document.getElementById('play-pause-btn')
      if (App.audioManager.isPlaying) {
        App.audioManager.pause()
        if (playPauseBtn) playPauseBtn.textContent = '▶'
      } else {
        this.restoreSessionOnPlay()
        App.audioManager.play()
        if (playPauseBtn) playPauseBtn.textContent = '❚❚'
      }
      return
    }

    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      if (!App.audioManager || !App.audioManager.audio) return
      event.preventDefault()
      const direction = event.code === 'ArrowLeft' ? -1 : 1
      const currentTime = App.audioManager.getCurrentTime()
      const duration = App.audioManager.audio.duration || 0
      const nextTime = Math.min(Math.max(currentTime + direction * 10, 0), duration)
      App.audioManager.seek(nextTime)
      this.savePlaybackPosition(nextTime)
      return
    }

    if (event.code === 'Digit1' || event.code === 'Numpad1' || event.key === '1') {
      event.preventDefault()
      this.cycleVisualizer(-1)
      return
    }

    if (event.code === 'Digit2' || event.code === 'Numpad2' || event.key === '2') {
      event.preventDefault()
      this.cycleVisualizer(1)
      return
    }

    if (event.code === 'NumpadAdd' || event.key === '+') {
      event.preventDefault()
      this.cycleVisualizer(1)
    } else if (event.code === 'NumpadSubtract' || event.key === '-') {
      event.preventDefault()
      this.cycleVisualizer(-1)
    }
  }

  cycleVisualizer(step) {
    const list = App.visualizerList
    if (!list || list.length === 0) return
    const currentIndex = Math.max(0, list.indexOf(App.visualizerType))
    const nextIndex = (currentIndex + step + list.length) % list.length
    const next = list[nextIndex]

    // If the dropdown's <select> currently has focus, blur it first so the UI updates
    // immediately and we don't leave the user with a focused control showing stale value.
    const selectEl = this._getVisualizerSelectElement()
    if (selectEl && document.activeElement === selectEl) {
      try {
        selectEl.blur()
      } catch {
        // ignore
      }
    }

    // Switch via the main codepath; it also keeps the GUI dropdown in sync.
    this.switchVisualizer(next)
  }

  _getVisualizerSelectElement() {
    try {
      const root = this.visualizerController?.domElement
      if (!root) return null
      const el = root.querySelector('select')
      return el instanceof HTMLSelectElement ? el : null
    } catch {
      return null
    }
  }

  _updateGuiWidthToFitVisualizerSelect() {
    try {
      const gui = App.gui
      const guiRoot = gui?.domElement
      if (!gui || !guiRoot) return

      const selectEl = this._getVisualizerSelectElement()
      if (!selectEl) return

      const options = Array.from(selectEl.options || [])
        .map((o) => (o?.textContent || o?.label || o?.value || '').trim())
        .filter(Boolean)

      if (options.length === 0) return

      const canvas = this._guiMeasureCanvas || (this._guiMeasureCanvas = document.createElement('canvas'))
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const selectStyle = window.getComputedStyle(selectEl)
      const selectFont = selectStyle.font || `${selectStyle.fontWeight} ${selectStyle.fontSize} ${selectStyle.fontFamily}`
      ctx.font = selectFont

      let maxOptionWidth = 0
      for (const label of options) {
        const w = ctx.measureText(label).width
        if (w > maxOptionWidth) maxOptionWidth = w
      }

      const selectPaddingLeft = parseFloat(selectStyle.paddingLeft) || 0
      const selectPaddingRight = parseFloat(selectStyle.paddingRight) || 0
      const selectHorizontalPadding = Math.max(0, selectPaddingLeft + selectPaddingRight)

      // Allowance for native select arrow + internal padding differences across browsers.
      const selectChromeAllowance = 56
      const desiredControlWidth = Math.ceil(maxOptionWidth + selectHorizontalPadding + selectChromeAllowance)

      const rowEl = selectEl.closest('.lil-controller')
      const labelEl = rowEl?.querySelector?.('.lil-name')
      const labelText = (labelEl?.textContent || '').trim()

      let desiredLabelWidth = 0
      if (labelText) {
        const labelStyle = window.getComputedStyle(labelEl)
        const labelFont = labelStyle.font || selectFont
        ctx.font = labelFont
        desiredLabelWidth = Math.ceil(ctx.measureText(labelText).width + 16)
      }

      const controlEl = rowEl?.querySelector?.('.lil-widget') || selectEl.parentElement

      let controlFrac = 0.6
      let labelFrac = 0.4
      const rowRect = rowEl?.getBoundingClientRect?.()
      const controlRect = controlEl?.getBoundingClientRect?.()
      const labelRect = labelEl?.getBoundingClientRect?.()

      if (rowRect?.width > 0 && controlRect?.width > 0) {
        controlFrac = Math.min(0.9, Math.max(0.1, controlRect.width / rowRect.width))
      }

      if (rowRect?.width > 0 && labelRect?.width > 0) {
        labelFrac = Math.min(0.9, Math.max(0.1, labelRect.width / rowRect.width))
      }

      const neededRowWidth = Math.ceil(
        Math.max(
          desiredControlWidth / (controlFrac || 0.6),
          desiredLabelWidth > 0 ? desiredLabelWidth / (labelFrac || 0.4) : 0
        )
      )

      const guiRect = guiRoot.getBoundingClientRect?.()
      const overhead = guiRect?.width > 0 && rowRect?.width > 0 ? Math.max(0, guiRect.width - rowRect.width) : 0
      let desiredGuiWidth = Math.ceil(neededRowWidth + overhead)

      // Clamp to viewport; our container is positioned with 12px gutters.
      // Also cap at max(35vw, 350px) to match the CSS --width rule.
      const maxByDesign = Math.max(window.innerWidth * 0.35, 350)
      const maxGuiWidth = Math.max(220, Math.min(window.innerWidth - 24, maxByDesign))
      desiredGuiWidth = Math.max(220, Math.min(desiredGuiWidth, maxGuiWidth))

      guiRoot.style.setProperty('--width', `${desiredGuiWidth}px`)

      // lil-gui uses $title as the toggle element (click title to open/close).
      // We inject a close X button into the VISUALIZER TYPE folder title.
      const titleEl = gui.$title
      if (titleEl) {
        const syncTitleClose = () => {
          try {
            const guiIsClosed = !!gui._closed

            // Find the VISUALIZER TYPE folder title for the X button.
            const folderTitles = Array.from(guiRoot.querySelectorAll('.title') || [])
            const vizTitle = folderTitles.find((el) => {
              const t = (el?.textContent || '').trim().toLowerCase()
              return t.startsWith('visualizer type')
            })

            if (vizTitle) {
              vizTitle.classList.add('gui-close-host')
              let xBtn = vizTitle.querySelector('.gui-close-x')
              if (!xBtn) {
                xBtn = document.createElement('button')
                xBtn.type = 'button'
                xBtn.className = 'gui-close-x'
                xBtn.textContent = '×'
                xBtn.setAttribute('aria-label', 'Close Controls')
                xBtn.setAttribute('title', 'Close Controls')

                xBtn.addEventListener('click', (e) => {
                  try {
                    e.preventDefault()
                    e.stopPropagation()
                  } catch {
                    // ignore
                  }
                  try {
                    gui.close()
                  } catch {
                    // ignore
                  }
                  window.setTimeout(syncTitleClose, 0)
                })

                vizTitle.appendChild(xBtn)
              }

              // Only show the X when the GUI is actually expanded.
              xBtn.style.display = guiIsClosed ? 'none' : ''
            }
          } catch (e) {
            // ignore
          }
        }

        // Update now.
        syncTitleClose()

        // Update after toggles too.
        if (!titleEl.dataset?.closeSizingBound) {
          titleEl.dataset.closeSizingBound = '1'
          gui.onOpenClose(() => {
            window.setTimeout(syncTitleClose, 0)
          })
        }
      }
    } catch (e) {
      // ignore
    }
  }

  getFV3Presets() {
    try {
      const raw = window.localStorage.getItem(this.storageKeys.fv3Presets)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (err) {
      return {}
    }
  }

  saveFV3Presets(presets = {}) {
    try {
      const cleaned = presets && typeof presets === 'object' ? presets : {}
      window.localStorage.setItem(this.storageKeys.fv3Presets, JSON.stringify(cleaned))
    } catch (err) {
      // ignore storage errors
    }
  }

  getStoredFV3PresetName() {
    try {
      return window.localStorage.getItem(this.storageKeys.fv3SelectedPreset) || ''
    } catch (err) {
      return ''
    }
  }

  saveFV3PresetName(name) {
    try {
      if (name) {
        window.localStorage.setItem(this.storageKeys.fv3SelectedPreset, name)
      } else {
        window.localStorage.removeItem(this.storageKeys.fv3SelectedPreset)
      }
    } catch (err) {
      // ignore storage errors
    }
  }

  ensureFV3UploadInput() {
    if (this.variant3UploadInput) return this.variant3UploadInput
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.style.display = 'none'
    document.body.appendChild(input)
    this.variant3UploadInput = input
    return input
  }

  setupGuiCloseButton() {
    if (!App.gui?.domElement) return
    
    const guiRoot = App.gui.domElement

    // Hide the inline GUI entirely – controls are pop-out only
    guiRoot.style.display = 'none'

    // Create pop-out hotzone (appears on hover at top-right corner)
    if (this._controlsChannel) {
      const popoutBtn = document.createElement('button')
      popoutBtn.className = 'gui-popout-btn'
      popoutBtn.innerHTML = '⧉'
      popoutBtn.title = 'Open controls'
      document.body.appendChild(popoutBtn)

      popoutBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._openControlsPopup()
      })
    }
  }

  teardownFrequencyViz3Controls() {
    if (!this.variant3Folder) return
    const folder = this.variant3Folder
    try {
      folder.destroy()
    } catch {
      // fallback: manual DOM removal
      const parent = folder.domElement?.parentElement
      if (parent && folder.domElement) {
        parent.removeChild(folder.domElement)
      }
    }
    this.variant3Folder = null
    this.variant3Controllers = {}
    this.variant3Config = null
    this.variant3PresetState = null
    this.variant3LoadSelect = null
    this.variant3PresetRow = null
    this.variant3ScrollContainer = null
    if (this.variant3FolderObserver) {
      this.variant3FolderObserver.disconnect()
      this.variant3FolderObserver = null
    }
    if (this.variant3Folder?.domElement) {
      this.variant3Folder.domElement.style.overflow = 'hidden'
    }
    if (this.variant3Overlay?.parentElement) {
      this.variant3Overlay.parentElement.removeChild(this.variant3Overlay)
    }
    this.variant3Overlay = null
  }

  setupShaderControls(visualizer) {
    this.teardownShaderControls()
    if (!visualizer?.shaderConfig || !App.gui) return

    // Use the generic createShaderControls from shaderCustomization.js
    this.shaderControlsFolder = createShaderControls(App.gui, visualizer, visualizer.shaderConfig)
  }

  teardownShaderControls() {
    if (!this.shaderControlsFolder) return
    const folder = this.shaderControlsFolder
    try {
      folder.destroy()
    } catch {
      // fallback: manual DOM removal
      const parent = folder.domElement?.parentElement
      if (parent && folder.domElement) {
        parent.removeChild(folder.domElement)
      }
    }
    this.shaderControlsFolder = null
  }

  setupFrequencyViz3Controls(visualizer) {
    this.teardownFrequencyViz3Controls()
    if (!visualizer || typeof visualizer.getControlParams !== 'function' || typeof visualizer.setControlParams !== 'function' || !App.gui) return

    this.variant3Config = { ...visualizer.getControlParams() }
    this.variant3PresetApplied = false
    const folderName = 'FREQUENCY VIZ 3 CONTROLS'
    const folder = App.gui.addFolder(folderName)
    folder.open()

    folder.domElement.classList.add('fv3-controls')
    folder.domElement.style.position = 'relative'

    if (this.variant3FolderObserver) {
      this.variant3FolderObserver.disconnect()
      this.variant3FolderObserver = null
    }
    if (folder.domElement) {
      this.variant3FolderObserver = new MutationObserver(() => {
        if (folder.domElement.classList.contains('closed')) {
          if (this.variant3Overlay) this.variant3Overlay.style.display = 'none'
        }
      })
      this.variant3FolderObserver.observe(folder.domElement, { attributes: true, attributeFilter: ['class'] })
    }

    this.variant3Folder = folder
    this.variant3Controllers = {}
    const presets = this.getFV3Presets()
    this.fv3FilePresets = this.fv3FilePresets || {}
    const mergedPresets = () => ({ ...(this.fv3FilePresets || {}), ...(presets || {}) })

    this.variant3PresetState = {
      presetName: '',
      loadPreset: this.getStoredFV3PresetName() || Object.keys(mergedPresets())[0] || ''
    }
    if (this.variant3PresetState.loadPreset) {
      this.saveFV3PresetName(this.variant3PresetState.loadPreset)
    }

    const formatValue = (value, step) => {
      if (!Number.isFinite(value)) return ''
      const s = Number.isFinite(step) ? step : 0.01
      const mag = Math.abs(s)
      const decimals = mag >= 1 ? 0 : mag >= 0.1 ? 1 : mag >= 0.01 ? 2 : 3
      return value.toFixed(decimals)
    }

    const sortObjectKeys = (obj) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
      return Object.keys(obj)
        .sort((a, b) => a.localeCompare(b))
        .reduce((acc, key) => {
          acc[key] = obj[key]
          return acc
        }, {})
    }

    const roundParamsForStorage = (params) => {
      if (!params || typeof params !== 'object') return params
      const rounded = {}
      Object.entries(params).forEach(([key, val]) => {
        if (Number.isFinite(val)) {
          rounded[key] = parseFloat(val.toFixed(6))
        } else {
          rounded[key] = val
        }
      })
      return sortObjectKeys(rounded)
    }

    const updateSliderValueLabel = (controller, value) => {
      // lil-gui: access DOM elements via $widget queries instead of dat.GUI internals
      const input = controller?.domElement?.querySelector('input')
      const step = controller?._step || controller?._stepExplicit || 0.01
      const display = formatValue(value, step)
      if (input) input.value = display
      if (controller?.updateDisplay) controller.updateDisplay()
    }

    const applyParams = (params) => {
      if (!params || typeof params !== 'object') return
      visualizer.setControlParams(params)
      this.variant3Config = { ...visualizer.getControlParams() }
      Object.entries(this.variant3Controllers).forEach(([prop, ctrl]) => {
        const val = this.variant3Config[prop]
        if (ctrl?.setValue) {
          ctrl.setValue(val)
        } else if (ctrl?.updateDisplay) {
          ctrl.updateDisplay()
        }
        updateSliderValueLabel(ctrl, val)
      })
    }

    const relaxGuiHeights = () => {
      const root = App.gui?.domElement
      if (!root) return
      // Ensure the root children container doesn't scroll
      const rootChildren = root.querySelector(':scope > .lil-children')
      if (rootChildren) {
        rootChildren.style.overflow = 'visible'
      }
      // The FV3 folder itself should not scroll; only .fv3-scroll inside it does
      const fv3El = root.querySelector('.fv3-controls')
      if (fv3El) {
        const fv3Children = fv3El.querySelector(':scope > .lil-children')
        if (fv3Children) fv3Children.style.overflow = 'visible'
      }
    }

    let isSyncingPreset = false

    const syncLoadDropdowns = (value) => {
      const ctrl = this.variant3LoadController
      if (!ctrl) return
      this.variant3PresetState.loadPreset = value || ''
      ctrl.updateDisplay()
    }

    const onPresetSelect = (value) => {
      if (!value || isSyncingPreset) return
      const preset = mergedPresets()[value]
      if (!preset) {
        console.warn('[FV3] preset not found', value)
        return
      }
      isSyncingPreset = true
      applyParams(preset)
      this.variant3PresetState.loadPreset = value
      this.saveFV3PresetName(value)
      syncLoadDropdowns(value)
      isSyncingPreset = false
      syncPresetNameInputs(value)
    }

    const refreshLoadOptions = () => {
      const names = Object.keys(mergedPresets())
      const currentPreset = this.variant3PresetState?.loadPreset || ''
      const preferred = currentPreset || this.getStoredFV3PresetName() || ''

      const updateLoadController = () => {
        const ctrl = this.variant3LoadController
        if (!ctrl) return

        // Build an options map: { displayName: value, ... }
        const optionsMap = {}
        names.forEach((name) => { optionsMap[name] = name })

        // Use lil-gui's .options() API so internal _values stays in sync
        ctrl.options(optionsMap)

        // Set the current value - use preferred if current isn't available yet
        if (!names.includes(this.variant3PresetState?.loadPreset)) {
          this.variant3PresetState.loadPreset = names.includes(preferred) ? preferred : (names[0] || '')
        }
        ctrl.updateDisplay()

        // Re-inject Edit button (options() rebuilds the select, removing our button)
        const widget = ctrl.domElement.querySelector('.lil-widget')
        if (widget && !widget.querySelector('.fv3-edit-btn')) {
          const editBtn = document.createElement('button')
          editBtn.type = 'button'
          editBtn.textContent = 'Edit'
          editBtn.className = 'fv3-edit-btn'
          editBtn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            openOverlay()
          })
          widget.appendChild(editBtn)
        }
      }

      updateLoadController()

      if (!names.includes(this.variant3PresetState?.loadPreset)) {
        this.variant3PresetState.loadPreset = names.includes(preferred) ? preferred : (names[0] || '')
        syncLoadDropdowns(this.variant3PresetState.loadPreset)
        if (this.variant3PresetState.loadPreset) this.saveFV3PresetName(this.variant3PresetState.loadPreset)
      }

      const effective = this.variant3PresetState.loadPreset
      if (!this.variant3PresetApplied && effective && names.includes(effective)) {
        onPresetSelect(effective)
        this.variant3PresetApplied = true
      }
    }

    // Asynchronously load built-in spectrum filters from disk and merge into presets
    if (!this.fv3FilePresetsLoaded) {
      this.fv3FilePresetsLoaded = true
      loadSpectrumFilters().then((loaded) => {
        this.fv3FilePresets = loaded || {}
        // Reset flag so stored preset can be applied after file presets load
        this.variant3PresetApplied = false
        refreshLoadOptions()
      }).catch((err) => {
        console.warn('Failed to load spectrum filters', err)
      })
    }

    // Preset save/load/upload/download controls

    let overlayNameInput = null
    let overlayContentEl = null
    let confirmEl = null

    const makeIconButton = (ligature, title, handler) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'icon-btn'
      btn.title = title
      const icon = document.createElement('span')
      icon.className = 'fv3-icon'
      icon.textContent = ligature
      btn.appendChild(icon)
      btn.addEventListener('click', handler)
      return btn
    }

    const syncPresetNameInputs = (value) => {
      const val = value ?? ''
      this.variant3PresetState.presetName = val
      if (overlayNameInput && overlayNameInput.value !== val) {
        overlayNameInput.value = val
      }
    }

    const confirmInOverlay = (message) => {
      if (!overlayContentEl || !overlayContentEl.isConnected) {
        const modal = this.variant3Overlay?.querySelector?.('.fv3-modal')
        if (modal) {
          overlayContentEl = modal
        } else {
          return Promise.resolve(window.confirm(message))
        }
      }

      if (confirmEl) {
        confirmEl.remove()
        confirmEl = null
      }

      confirmEl = document.createElement('div')
      confirmEl.className = 'fv3-confirm'

      const cardEl = document.createElement('div')
      cardEl.className = 'fv3-confirm-card'

      const msgEl = document.createElement('div')
      msgEl.className = 'msg'
      msgEl.textContent = message

      const actionsEl = document.createElement('div')
      actionsEl.className = 'actions'

      const makeButton = (label, intent) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = label
        if (intent === 'danger') {
          btn.style.borderColor = '#ff7b7b'
          btn.style.color = '#ffdede'
        }
        return btn
      }

      const cleanup = () => {
        if (confirmEl) {
          confirmEl.remove()
          confirmEl = null
        }
      }

      const promise = new Promise((resolve) => {
        const cancelBtn = makeButton('Cancel')
        cancelBtn.addEventListener('click', () => {
          cleanup()
          resolve(false)
        })

        const deleteBtn = makeButton('Delete', 'danger')
        deleteBtn.addEventListener('click', () => {
          cleanup()
          resolve(true)
        })

        actionsEl.appendChild(cancelBtn)
        actionsEl.appendChild(deleteBtn)
      })

      cardEl.appendChild(msgEl)
      cardEl.appendChild(actionsEl)
      confirmEl.appendChild(cardEl)
      overlayContentEl.appendChild(confirmEl)

      return promise
    }

    const presetActions = {
      savePreset: () => {
        const name = (this.variant3PresetState.presetName || '').trim()
        if (!name) {
          alert('Enter a preset name first.')
          return
        }
        presets[name] = roundParamsForStorage(visualizer.getControlParams())
        this.saveFV3Presets(presets)
        this.variant3PresetState.loadPreset = name
        this.saveFV3PresetName(name)
        refreshLoadOptions()
      },
      downloadPreset: () => {
        const data = {
          name: (this.variant3PresetState.presetName || '').trim() || 'preset',
          visualizer: 'Frequency Visualization 3',
          controls: roundParamsForStorage(visualizer.getControlParams())
        }
        const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset'
        // Object literal preserves insertion order; stringify without a restrictive replacer so control keys stay intact.
        const json = JSON.stringify({
          name: data.name,
          visualizer: data.visualizer,
          controls: data.controls
        }, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `fv3-preset-${slug}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      },
      uploadPreset: () => {
        const input = this.ensureFV3UploadInput()
        if (!input) return
        input.onchange = (e) => {
          const file = e.target?.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            try {
              const parsed = JSON.parse(reader.result)
              const controls = parsed?.controls && typeof parsed.controls === 'object' ? parsed.controls : parsed
              if (!controls || typeof controls !== 'object') throw new Error('Invalid preset file')
              const name = (parsed?.name && typeof parsed.name === 'string' ? parsed.name : file.name.replace(/\.json$/i, '')) || 'Imported preset'
              const normalized = roundParamsForStorage(controls)
              presets[name] = normalized
              this.saveFV3Presets(presets)
              syncPresetNameInputs(name)
              this.variant3PresetState.loadPreset = name
              this.saveFV3PresetName(name)
              applyParams(normalized)
              refreshLoadOptions()
            } catch (err) {
              alert('Failed to load preset: ' + (err?.message || err))
            } finally {
              input.value = ''
            }
          }
          reader.readAsText(file)
        }
        input.click()
      },
      deletePreset: async () => {
        const name = this.variant3PresetState.loadPreset || ''
        if (!name) {
          alert('Select a preset to delete first.')
          return
        }
        if (this.fv3FilePresets && this.fv3FilePresets[name]) {
          alert('Built-in presets cannot be deleted.')
          return
        }
        if (!presets[name]) {
          alert('Preset not found.')
          return
        }
        const confirmed = await confirmInOverlay(`Delete preset "${name}"? This cannot be undone.`)
        if (!confirmed) return
        delete presets[name]
        this.saveFV3Presets(presets)
        if (this.variant3PresetState.loadPreset === name) {
          this.variant3PresetState.loadPreset = Object.keys(presets)[0] || ''
          this.saveFV3PresetName(this.variant3PresetState.loadPreset)
        }
        refreshLoadOptions()
      }
    }

    const hideOverlay = () => {
      if (this.variant3Overlay) {
        this.variant3Overlay.style.display = 'none'
      }
      if (confirmEl) {
        confirmEl.remove()
        confirmEl = null
      }
      folder.domElement?.classList.remove('blur-active')
    }

    const buildOverlay = () => {
      if (this.variant3Overlay?.parentElement) return this.variant3Overlay

      const overlay = document.createElement('div')
      overlay.className = 'fv3-overlay'
      const modal = document.createElement('div')
      modal.className = 'fv3-modal'
      overlayContentEl = modal

      const header = document.createElement('header')
      const title = document.createElement('h3')
      title.textContent = 'Edit FV3 Presets'
      const closeBtn = document.createElement('button')
      closeBtn.className = 'close-btn'
      closeBtn.title = 'Close'
      closeBtn.textContent = '×'
      closeBtn.addEventListener('click', hideOverlay)
      header.appendChild(title)
      header.appendChild(closeBtn)
      modal.appendChild(header)

      const makeRow = (labelText, fieldEl) => {
        const rowEl = document.createElement('div')
        rowEl.className = 'row'
        const labelEl = document.createElement('div')
        labelEl.className = 'label'
        labelEl.textContent = labelText
        const field = document.createElement('div')
        field.className = 'field'
        field.appendChild(fieldEl)
        rowEl.appendChild(labelEl)
        rowEl.appendChild(field)
        return rowEl
      }

      const nameInput = document.createElement('input')
      nameInput.type = 'text'
      nameInput.placeholder = 'Preset name'
      nameInput.value = this.variant3PresetState.presetName
      nameInput.addEventListener('input', (e) => syncPresetNameInputs(e.target.value, 'overlay'))
      overlayNameInput = nameInput
      modal.appendChild(makeRow('Save as', nameInput))

      const actions = document.createElement('div')
      actions.className = 'actions'
      actions.appendChild(makeIconButton('save', 'Save preset', presetActions.savePreset))
      actions.appendChild(makeIconButton('file_download', 'Download preset JSON', presetActions.downloadPreset))
      actions.appendChild(makeIconButton('upload_file', 'Upload preset JSON', presetActions.uploadPreset))
      actions.appendChild(makeIconButton('delete', 'Delete preset', presetActions.deletePreset))

      const actionsRow = document.createElement('div')
      actionsRow.className = 'row'
      const actionsLabel = document.createElement('div')
      actionsLabel.className = 'label'
      actionsLabel.textContent = 'Actions'
      const actionsField = document.createElement('div')
      actionsField.className = 'field'
      actionsField.appendChild(actions)
      actionsRow.appendChild(actionsLabel)
      actionsRow.appendChild(actionsField)
      modal.appendChild(actionsRow)

      overlay.appendChild(modal)
      const container = folder?.domElement
      if (container && !container.style.position) {
        container.style.position = 'relative'
      }
      if (container) container.appendChild(overlay)
      this.variant3Overlay = overlay
      refreshLoadOptions()
      syncPresetNameInputs(this.variant3PresetState.presetName)
      return overlay
    }

    const openOverlay = () => {
      const overlay = buildOverlay()
      if (overlay) {
        refreshLoadOptions()
        const currentName = this.variant3PresetState.loadPreset || this.variant3PresetState.presetName || ''
        syncPresetNameInputs(currentName)
        overlay.style.display = 'flex'
        if (folder?.domElement) {
          folder.domElement.style.overflow = 'visible'
          folder.domElement.style.maxHeight = '70vh'
          folder.domElement.style.height = 'auto'
          folder.domElement.classList.add('blur-active')
        }
        relaxGuiHeights()
      }
    }

    const ensureScrollContainer = () => {
      if (this.variant3ScrollContainer && this.variant3ScrollContainer.isConnected) {
        return this.variant3ScrollContainer
      }
      const listEl = folder.$children || folder.domElement?.querySelector('ul') || folder.domElement
      if (!listEl) return null
      const scroller = document.createElement('div')
      scroller.className = 'fv3-scroll'
      listEl.appendChild(scroller)
      this.variant3ScrollContainer = scroller
      return scroller
    }

    const moveToScroller = (ctrl) => {
      const li = ctrl?.domElement
      const scroller = ensureScrollContainer()
      if (li && scroller && li.parentElement !== scroller) {
        scroller.appendChild(li)
      }
    }

    const addSlider = (prop, label, min, max, step = 1) => {
      const ctrl = folder.add(this.variant3Config, prop, min, max).step(step).name(label).listen()
      ctrl.onChange((value) => {
        if (Number.isFinite(value)) {
          visualizer.setControlParams({ [prop]: value })
          updateSliderValueLabel(ctrl, value)
        }
      })
      this.variant3Controllers[prop] = ctrl
      moveToScroller(ctrl)
      requestAnimationFrame(() => updateSliderValueLabel(ctrl, this.variant3Config[prop]))
      return ctrl
    }

    const addToggle = (prop, label) => {
      const ctrl = folder.add(this.variant3Config, prop).name(label).listen()
      ctrl.onChange((value) => {
        visualizer.setControlParams({ [prop]: !!value })
      })
      this.variant3Controllers[prop] = ctrl
      moveToScroller(ctrl)
      return ctrl
    }

    const addDropdown = (prop, label, options) => {
      const ctrl = folder.add(this.variant3Config, prop, options).name(label).listen()
      ctrl.onChange((value) => {
        visualizer.setControlParams({ [prop]: value })
      })
      this.variant3Controllers[prop] = ctrl
      moveToScroller(ctrl)
      return ctrl
    }

    // Load preset dropdown using standard lil-gui controls
    const addLoadRow = () => {
      // Create dropdown controller for preset selection
      const presetOptions = {}
      const ctrl = folder.add(this.variant3PresetState, 'loadPreset', presetOptions).name('Load preset')
      ctrl.onChange((value) => {
        if (isSyncingPreset) return
        onPresetSelect(value)
      })
      this.variant3LoadController = ctrl
      
      // Inject Edit button into the controller's widget area
      const widget = ctrl.domElement.querySelector('.lil-widget')
      if (widget) {
        const editBtn = document.createElement('button')
        editBtn.type = 'button'
        editBtn.textContent = 'Edit'
        editBtn.className = 'fv3-edit-btn'
        editBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openOverlay()
        })
        widget.appendChild(editBtn)
      }
      
      // Mark the preset dropdown controller
      ctrl.domElement.classList.add('fv3-load-preset')
      
      refreshLoadOptions()
      return ctrl
    }

    addLoadRow()

    const controlsToAdd = [
      { type: 'dropdown', prop: 'weightingMode', label: 'Weighting mode', options: ['ae', 'fv2'] },
      { type: 'dropdown', prop: 'spatialKernel', label: 'Smoothing kernel', options: ['wide', 'narrow'] },
      { type: 'toggle', prop: 'useBinFloor', label: 'Use per-bin floor' },
      { type: 'dropdown', prop: 'beatBoostEnabled', label: 'Beat accent enabled', options: [1, 0] },
      { type: 'slider', prop: 'analyserSmoothing', label: 'Analyser smoothing', min: 0.0, max: 1.0, step: 0.01 },

      { type: 'slider', prop: 'kickHz', label: 'Kick center Hz', min: 20, max: 200, step: 1 },
      { type: 'slider', prop: 'kickWidthOct', label: 'Kick width (oct)', min: 0.1, max: 2.0, step: 0.01 },
      { type: 'slider', prop: 'kickBoostDb', label: 'Kick boost (dB)', min: -12, max: 24, step: 0.25 },
      { type: 'slider', prop: 'subShelfDb', label: 'Sub shelf (dB)', min: -12, max: 24, step: 0.25 },
      { type: 'slider', prop: 'tiltLo', label: 'Tilt low mult', min: 0.1, max: 3.0, step: 0.01 },
      { type: 'slider', prop: 'tiltHi', label: 'Tilt high mult', min: 0.1, max: 2.5, step: 0.01 },

      { type: 'slider', prop: 'floorAtkLow', label: 'Floor atk low', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'floorRelLow', label: 'Floor rel low', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'floorAtkHi', label: 'Floor atk high', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'floorRelHi', label: 'Floor rel high', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'floorStrengthLow', label: 'Floor strength low', min: 0.0, max: 1.5, step: 0.01 },
      { type: 'slider', prop: 'floorStrengthHi', label: 'Floor strength high', min: 0.0, max: 1.5, step: 0.01 },

      { type: 'slider', prop: 'bassFreqHz', label: 'Bass boost freq (Hz)', min: 20, max: 140, step: 1 },
      { type: 'slider', prop: 'bassWidthHz', label: 'Boost width (Hz)', min: 1, max: 50, step: 1 },
      { type: 'slider', prop: 'bassGainDb', label: 'Boost gain (dB)', min: -6, max: 30, step: 0.5 },
      { type: 'slider', prop: 'hiRolloffDb', label: 'High rolloff (dB)', min: -24, max: 0, step: 0.5 },

      { type: 'slider', prop: 'beatBoost', label: 'Beat boost', min: 0.0, max: 2.0, step: 0.05 },

      { type: 'slider', prop: 'attack', label: 'Attack', min: 0.01, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'release', label: 'Release', min: 0.01, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'noiseFloor', label: 'Noise floor', min: 0.0, max: 0.2, step: 0.001 },
      { type: 'slider', prop: 'peakCurve', label: 'Peak curve', min: 0.5, max: 4.0, step: 0.05 },

      { type: 'slider', prop: 'minDb', label: 'Min dB', min: -120, max: -10, step: 1 },
      { type: 'slider', prop: 'maxDb', label: 'Max dB', min: -60, max: 0, step: 1 },

      { type: 'slider', prop: 'baselinePercentile', label: 'Baseline percentile', min: 0.01, max: 0.5, step: 0.005 },
      { type: 'slider', prop: 'baselineStrength', label: 'Baseline strength', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'displayThreshold', label: 'Display threshold', min: 0.0, max: 0.05, step: 0.0005 },

      { type: 'slider', prop: 'targetPeak', label: 'Target peak', min: 0.1, max: 1.5, step: 0.01 },
      { type: 'slider', prop: 'minGain', label: 'Min gain', min: 0.05, max: 3.0, step: 0.01 },
      { type: 'slider', prop: 'maxGain', label: 'Max gain', min: 0.1, max: 5.0, step: 0.01 },
      { type: 'slider', prop: 'agcAttack', label: 'AGC attack', min: 0.0, max: 1.0, step: 0.01 },
      { type: 'slider', prop: 'agcRelease', label: 'AGC release', min: 0.0, max: 1.0, step: 0.01 }
    ]

    controlsToAdd
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((cfg) => {
        if (cfg.type === 'slider') {
          addSlider(cfg.prop, cfg.label, cfg.min, cfg.max, cfg.step)
        } else if (cfg.type === 'dropdown') {
          addDropdown(cfg.prop, cfg.label, cfg.options)
        } else if (cfg.type === 'toggle') {
          addToggle(cfg.prop, cfg.label)
        }
      })

    Object.values(this.variant3Controllers).forEach((ctrl) => {
      if (ctrl?.updateDisplay) ctrl.updateDisplay()
      requestAnimationFrame(() => updateSliderValueLabel(ctrl, this.variant3Config[ctrl.property]))
    })

    // Ensure heights are unlocked after the controls are built
    requestAnimationFrame(relaxGuiHeights)
  }
  
  addVisualizerSwitcher() {
    const visualizerFolder = App.gui.addFolder('TYPE')
    visualizerFolder.open()
    
    this.visualizerSwitcherConfig = {
      visualizer: App.visualizerType
    }
    
    this.visualizerController = visualizerFolder
      .add(this.visualizerSwitcherConfig, 'visualizer', App.visualizerList)
      .name('Select Visualizer')
      .listen()
      .onChange((value) => {
        this.switchVisualizer(value)
      })

    // Size the GUI to fit the longest option label (no truncation).
    requestAnimationFrame(() => this._updateGuiWidthToFitVisualizerSelect())

    // Once MilkDrop presets finish lazy-loading, append them to the dropdown.
    if (!App._milkdropNamesAppended) {
      _milkdropReady.then((m) => {
        if (App._milkdropNamesAppended) return
        App._milkdropNamesAppended = true
        const names = m.MILKDROP_VISUALIZER_NAMES
        if (!names?.length) return
        App.visualizerList.push(...names)
        // Rebuild dropdown options to include MilkDrop presets
        if (this.visualizerController) {
          this.visualizerController.options(App.visualizerList)
          this.visualizerController.setValue(App.visualizerType)
          requestAnimationFrame(() => this._updateGuiWidthToFitVisualizerSelect())
        }
        // Notify popup controls about the updated list
        this._broadcastToControls({
          type: 'visualizer-list-update',
          visualizerList: [...App.visualizerList],
        })
      })
    }
  }

  addPerformanceQualityControls() {
    if (!App.gui) return
    if (this.performanceQualityFolder) return

    const folder = App.gui.addFolder('PERFORMANCE + QUALITY')
    folder.open()
    this.performanceQualityFolder = folder

    // lil-gui builds a dropdown from an object map. Integer-like keys ("1", "2")
    // are enumerated first by JS engines, which breaks ordering. Use labels that
    // render identically but are not integer-like keys.
    const prOptions = {
      '0.25': 0.25,
      '0.5': 0.5,
      '1 ': 1,
      '2 ': 2,
    }
    const initialPr = this.renderer?.getPixelRatio?.() || 1
    const initialAa = this._getContextAntialias()

    this.performanceQualityConfig = {
      antialias: typeof initialAa === 'boolean' ? initialAa : !!this.debugAntialias,
      pixelRatio: this._snapPixelRatio(initialPr, { min: 0.25, max: 2 }),
      saveAsDefaults: () => {
        const aa = this._getContextAntialias()
        const pr = this.renderer?.getPixelRatio?.() || 1
        const saved = {
          antialias: !!aa,
          pixelRatio: this._snapPixelRatio(pr, { min: 0.25, max: 2 }),
        }
        this.saveGlobalQualityDefaults(saved)

        // Update the baseline state in-session (only when not locked by URL overrides).
        if (this._baseQualityState) {
          if (!this._baseQualityState.antialiasOverridden) this._baseQualityState.debugAntialias = saved.antialias
          if (!this._baseQualityState.pixelRatioOverridden) this._baseQualityState.debugPixelRatio = saved.pixelRatio
        }
      },
      clearUserValues: () => {
        const type = App.visualizerType
        this._clearPerVisualizerQualityOverrides(type)
        // Re-apply effective quality (URL > user overrides > per-visualizer auto > global defaults).
        this._applyPerVisualizerQualityOverrides(type)
        this._syncPerformanceQualityControls(type)
      }
    }

    this.performanceQualityControllers.antialias = folder
      .add(this.performanceQualityConfig, 'antialias')
      .name('Antialiasing')
      .onChange((value) => {
        if (this._syncingPerformanceQualityGui) return
        const type = App.visualizerType
        this._writePerVisualizerQualityOverride(type, { antialias: !!value })
        this._applyPerVisualizerQualityOverrides(type)
        this._broadcastQualityState()
      })

    this.performanceQualityControllers.pixelRatio = folder
      .add(this.performanceQualityConfig, 'pixelRatio', prOptions)
      .name('PixelRatio')
      .onChange((value) => {
        if (this._syncingPerformanceQualityGui) return
        const type = App.visualizerType
        const pr = typeof value === 'string' ? Number.parseFloat(value) : value
        this._writePerVisualizerQualityOverride(type, { pixelRatio: pr })
        this._applyPerVisualizerQualityOverrides(type)
        this._broadcastQualityState()
      })

    this.performanceQualityControllers.defaults = folder
      .add(this.performanceQualityConfig, 'saveAsDefaults')
      .name('Save As Global PQ Defaults')

    folder
      .add(this.performanceQualityConfig, 'clearUserValues')
      .name('Clear Stored Local PQ Values')

    // Initialize displayed values from storage/effective state.
    this._syncPerformanceQualityControls(App.visualizerType)
  }
}
