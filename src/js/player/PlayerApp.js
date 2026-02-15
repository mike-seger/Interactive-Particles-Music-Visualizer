/**
 * PlayerApp – rendering, audio & visualizer management.
 *
 * This is the player-side concern extracted from the monolithic App.js.
 * It owns the THREE.js renderer, AudioManager, BPMManager, all visualiser
 * instances, the player-controls bar (play / pause / seek / volume / FPS),
 * and the dynamic auto-quality loop.
 *
 * Communication with the orchestrator (parent window) happens exclusively
 * via window.postMessage / addEventListener('message').
 */

import * as THREE from 'three'
import App from '../App'
import { ENTITY_VISUALIZER_NAMES, createEntityVisualizerByName } from '../visualizers/entityRegistry'
import { SHADER_VISUALIZER_NAMES, createShaderVisualizerByName } from '../visualizers/shaderRegistry'

let _milkdropModule = null
const _milkdropReady = import('../visualizers/milkdropRegistry').then((m) => {
  _milkdropModule = m
  return m
})

import BPMManager from '../managers/BPMManager'
import { VideoSyncClient } from '../sync-client/SyncClient.mjs'
import AudioManager from '../managers/AudioManager'

// ---------------------------------------------------------------------------
// WebGL GPU Timer (unchanged from App.js)
// ---------------------------------------------------------------------------

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
      this.ext = this.isWebGL2
        ? this.gl.getExtension('EXT_disjoint_timer_query_webgl2')
        : this.gl.getExtension('EXT_disjoint_timer_query')
      this.supported = !!this.ext
    } catch { this.ext = null; this.supported = false }
  }
  begin() {
    if (!this.supported || !this.gl || this.currentQuery) return
    try {
      const q = this.isWebGL2 ? this.gl.createQuery() : this.ext.createQueryEXT()
      if (!q) return
      if (this.isWebGL2) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
      else this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, q)
      this.currentQuery = q
    } catch { this.currentQuery = null }
  }
  end() {
    if (!this.supported || !this.gl || !this.currentQuery) return
    try {
      if (this.isWebGL2) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
      else this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT)
      this.pendingQueries.push(this.currentQuery)
      this.currentQuery = null
      while (this.pendingQueries.length > 4) this._deleteQuery(this.pendingQueries.shift())
    } catch { this._deleteQuery(this.currentQuery); this.currentQuery = null }
  }
  poll() {
    if (!this.supported || !this.gl || this.pendingQueries.length === 0) return this.lastGpuMs
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
      if (!disjoint && Number.isFinite(ns)) this.lastGpuMs = ns / 1e6
    } catch { this.pendingQueries.shift(); this._deleteQuery(q) }
    return this.lastGpuMs
  }
  _deleteQuery(q) {
    if (!q || !this.gl || !this.supported) return
    try { if (this.isWebGL2) this.gl.deleteQuery(q); else this.ext.deleteQueryEXT(q) } catch { /* */ }
  }
}

// ---------------------------------------------------------------------------
// PlayerApp
// ---------------------------------------------------------------------------

// Populate shared App state at import-time so entity visualizers can find the list.
App.visualizerList = [...ENTITY_VISUALIZER_NAMES, ...SHADER_VISUALIZER_NAMES]

export default class PlayerApp {

  constructor() {
    this.onClickBinder = () => this.init()
    document.addEventListener('click', this.onClickBinder)

    // Listen for commands from the orchestrator (parent)
    window.addEventListener('message', (e) => this.handleParentMessage(e))

    // Toast for visualizer name
    this.visualizerToast = null
    this.visualizerToastHideTimer = null

    // LocalStorage keys
    this.storageKeys = {
      playbackPosition: 'visualizer.playbackPosition',
      visualizerType: 'visualizer.lastType',
    }

    // Quality state
    this.performanceQualityConfig = null
    this._syncingPerformanceQualityGui = false
    this._baseQualityState = null

    // rAF stats
    this.rafStats = { lastAt: 0, frames: 0, sumDt: 0, maxDt: 0 }
    this.lastFrameDtMs = null

    // Auto-quality
    this.autoQualityEnabled = true
    this.autoQualityDynamic = false
    this.autoQualityDynamicRequested = null
    this.pixelRatioOverridden = false
    this.pixelRatioLocked = false
    this.antialiasOverridden = false
    this.quality = null
    this.qualityWindow = { frames: 0, sumDt: 0, maxDt: 0, startAt: 0 }
  }

  // -------------------------------------------------------------------
  // postMessage helpers
  // -------------------------------------------------------------------

  /** Send a message to the orchestrator (parent window). */
  sendToParent(msg) {
    try {
      const target = window.parent && window.parent !== window ? window.parent : null
      if (target) target.postMessage({ source: 'player', ...msg }, '*')
    } catch { /* cross-origin — ignore */ }
  }

  /** Handle commands from the orchestrator. */
  handleParentMessage(event) {
    const msg = event?.data
    if (!msg || typeof msg !== 'object') return
    // Only process messages intended for the player
    if (msg.source === 'player' || msg.source === 'controls') return

    switch (msg.type) {
      case 'switch-visualizer':
        if (msg.name) this.switchVisualizer(msg.name)
        break
      case 'cycle-visualizer':
        this.cycleVisualizer(msg.step || 1)
        break
      case 'play-pause':
        this._togglePlayPause()
        break
      case 'seek':
        if (Number.isFinite(msg.time)) this._seekTo(msg.time)
        break
      case 'seek-relative':
        if (Number.isFinite(msg.delta)) this._seekRelative(msg.delta)
        break
      case 'mute-toggle':
        this._toggleMute()
        break
      case 'set-quality': {
        const type = App.visualizerType
        const payload = {}
        if (msg.antialias !== undefined) payload.antialias = !!msg.antialias
        if (msg.pixelRatio !== undefined) payload.pixelRatio = msg.pixelRatio
        this._writePerVisualizerQualityOverride(type, payload)
        this._applyPerVisualizerQualityOverrides(type)
        this._notifyQualityState()
        break
      }
      case 'save-quality-defaults': {
        const aa = this._getContextAntialias()
        const pr = this.renderer?.getPixelRatio?.() || 1
        this.saveGlobalQualityDefaults({
          antialias: !!aa,
          pixelRatio: this._snapPixelRatio(pr, { min: 0.25, max: 2 }),
        })
        if (this._baseQualityState) {
          if (!this._baseQualityState.antialiasOverridden) this._baseQualityState.debugAntialias = !!aa
          if (!this._baseQualityState.pixelRatioOverridden) this._baseQualityState.debugPixelRatio = this._snapPixelRatio(pr)
        }
        break
      }
      case 'clear-quality-overrides': {
        const type = App.visualizerType
        this._clearPerVisualizerQualityOverrides(type)
        this._applyPerVisualizerQualityOverrides(type)
        this._notifyQualityState()
        break
      }
      case 'set-fv3-param': {
        const v = App.currentVisualizer
        if (v && typeof v.setControlParams === 'function' && msg.key) {
          v.setControlParams({ [msg.key]: msg.value })
        }
        break
      }
      case 'apply-fv3-params': {
        const v = App.currentVisualizer
        if (v && typeof v.setControlParams === 'function' && msg.params) {
          v.setControlParams(msg.params)
          this._notifyFV3Params()
        }
        break
      }
      case 'set-shader-uniform': {
        const v = App.currentVisualizer
        if (v && typeof v.setUniform === 'function' && msg.uniform !== undefined) {
          v.setUniform(msg.uniform, msg.value)
        }
        break
      }
      // Bridge pass-through from orchestrator
      case 'LIST_MODULES':
        this._postModuleList(event.source)
        break
      case 'SET_MODULE': {
        const name = typeof msg.module === 'string' ? msg.module : null
        if (name && App.visualizerList.includes(name)) {
          this.switchVisualizer(name, { notify: true })
        }
        break
      }
      default:
        break
    }
  }

  // -------------------------------------------------------------------
  // Playback helpers (called from orchestrator commands)
  // -------------------------------------------------------------------

  _togglePlayPause() {
    if (!App.audioManager?.audio) return
    const audio = App.audioManager.audio
    if (audio.paused) {
      this.restoreSessionOnPlay()
      audio.play()
    } else {
      audio.pause()
    }
    this._syncPlayPauseButton()
  }

  _seekTo(time) {
    if (!App.audioManager?.audio) return
    App.audioManager.seek(time)
    this.savePlaybackPosition(time)
  }

  _seekRelative(delta) {
    if (!App.audioManager?.audio) return
    const cur = App.audioManager.getCurrentTime()
    const dur = App.audioManager.audio.duration || 0
    const next = Math.max(0, Math.min(cur + delta, dur))
    App.audioManager.seek(next)
    this.savePlaybackPosition(next)
  }

  _toggleMute() {
    if (!App.audioManager) return
    App.audioManager.setMuted(!App.audioManager.isMuted)
    this._syncMuteButton()
  }

  _syncPlayPauseButton() {
    const btn = document.getElementById('play-pause-btn')
    if (!btn || !App.audioManager?.audio) return
    btn.textContent = App.audioManager.audio.paused ? 'play_circle' : 'pause_circle'
  }

  _syncMuteButton() {
    const btn = document.getElementById('mute-btn')
    if (!btn || !App.audioManager) return
    btn.textContent = App.audioManager.isMuted ? 'volume_off' : 'volume_up'
  }

  // -------------------------------------------------------------------
  // Notification helpers (send state to parent / orchestrator)
  // -------------------------------------------------------------------

  _notifyReady() {
    this.sendToParent({
      type: 'ready',
      visualizerList: [...App.visualizerList],
      activeVisualizer: App.visualizerType,
    })
  }

  _notifyVisualizerChanged(type) {
    const v = App.currentVisualizer
    const hasFV3 = type === 'Frequency Visualization 3' && v && typeof v.getControlParams === 'function'
    const fv3Params = hasFV3 ? v.getControlParams() : null
    const hasShaderConfig = !!(v?.shaderConfig)
    const shaderConfig = hasShaderConfig ? v.shaderConfig : null

    this.sendToParent({
      type: 'visualizer-changed',
      name: type,
      hasFV3,
      fv3Params,
      hasShaderConfig,
      shaderConfig,
    })
  }

  _notifyVisualizerListUpdate() {
    this.sendToParent({
      type: 'visualizer-list-update',
      visualizerList: [...App.visualizerList],
    })
  }

  _notifyQualityState() {
    const aa = this._getContextAntialias()
    const pr = this.renderer?.getPixelRatio?.() || 1
    this.sendToParent({
      type: 'quality-update',
      antialias: typeof aa === 'boolean' ? aa : !!this.debugAntialias,
      pixelRatio: this._snapPixelRatio(pr, { min: 0.25, max: 2 }),
    })
  }

  _notifyFV3Params() {
    const v = App.currentVisualizer
    if (v && typeof v.getControlParams === 'function') {
      this.sendToParent({ type: 'fv3-params', params: v.getControlParams() })
    }
  }

  // -------------------------------------------------------------------
  // Bridge messaging (backward compat for Polaris Player)
  // -------------------------------------------------------------------

  _postModuleList(target) {
    const t = target || (window.parent !== window ? window.parent : null)
    if (!t) return
    try {
      t.postMessage({
        type: 'MODULE_LIST',
        modules: [...App.visualizerList],
        active: App.visualizerType,
      }, '*')
    } catch { /* ignore */ }
  }

  _postModuleSet(ok, target) {
    const t = target || (window.parent !== window ? window.parent : null)
    if (!t) return
    try {
      t.postMessage({
        type: 'MODULE_SET',
        ok: ok === true,
        active: App.visualizerType,
        modules: [...App.visualizerList],
      }, '*')
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------
  // Pixel-ratio helpers (unchanged from App.js)
  // -------------------------------------------------------------------

  _snapPixelRatio(value, { min = 0.25, max = 2 } = {}) {
    const v = Number.isFinite(value) ? value : 1
    const allowed = [0.25, 0.5, 1, 2]
    const candidates = allowed.filter((r) => r >= min - 1e-6 && r <= max + 1e-6)
    if (candidates.length === 0) return Math.max(min, Math.min(max, v))
    let best = candidates[0], bestErr = Math.abs(v - best)
    for (let i = 1; i < candidates.length; i++) {
      const err = Math.abs(v - candidates[i])
      if (err < bestErr) { bestErr = err; best = candidates[i] }
    }
    return best
  }

  // -------------------------------------------------------------------
  // Storage helpers (unchanged from App.js)
  // -------------------------------------------------------------------

  getStoredPlaybackPosition() {
    try { const v = window.localStorage.getItem(this.storageKeys.playbackPosition); const p = v ? Number(v) : 0; return Number.isFinite(p) ? p : 0 } catch { return 0 }
  }
  savePlaybackPosition(time) { if (!Number.isFinite(time)) return; try { window.localStorage.setItem(this.storageKeys.playbackPosition, String(time)) } catch { /* */ } }
  getStoredVisualizerType() { try { const v = window.localStorage.getItem(this.storageKeys.visualizerType); return v && App.visualizerList.includes(v) ? v : null } catch { return null } }
  saveVisualizerType(type) { if (!type) return; try { window.localStorage.setItem(this.storageKeys.visualizerType, type) } catch { /* */ } }

  // -------------------------------------------------------------------
  // Quality storage / override helpers (unchanged from App.js)
  // -------------------------------------------------------------------

  _getGlobalQualityDefaultKeys() { return { antiAlias: 'visualizer.defaults.quality.antiAlias', pixelRatio: 'visualizer.defaults.quality.pixelRatio' } }

  getStoredGlobalQualityDefaults() {
    try {
      const keys = this._getGlobalQualityDefaultKeys()
      const aaRaw = window.localStorage.getItem(keys.antiAlias)
      const prRaw = window.localStorage.getItem(keys.pixelRatio)
      let aa = null
      if (aaRaw != null) { const v = String(aaRaw).trim().toLowerCase(); aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') }
      let pr = null
      if (prRaw != null && prRaw !== '') { const parsed = Number.parseFloat(prRaw); const allowed = [0.25, 0.5, 1, 2]; pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null }
      return { antialias: aa, pixelRatio: pr }
    } catch { return { antialias: null, pixelRatio: null } }
  }

  saveGlobalQualityDefaults({ antialias, pixelRatio } = {}) {
    try {
      const keys = this._getGlobalQualityDefaultKeys()
      if (antialias == null) window.localStorage.removeItem(keys.antiAlias); else window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')
      if (pixelRatio == null) { window.localStorage.removeItem(keys.pixelRatio) } else {
        const allowed = [0.25, 0.5, 1, 2]; const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio); else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch { /* */ }
  }

  _getPerVisualizerAutoQualityKeys(type) { const t = String(type || '').trim(); return { antiAlias: `visualizer[${t}].quality.auto.antiAlias`, pixelRatio: `visualizer[${t}].quality.auto.pixelRatio` } }

  _readPerVisualizerAutoQuality(type) {
    try {
      const { antiAlias, pixelRatio } = this._getPerVisualizerAutoQualityKeys(type)
      const aaRaw = window.localStorage.getItem(antiAlias); const prRaw = window.localStorage.getItem(pixelRatio)
      let aa = null; if (aaRaw != null) { const v = String(aaRaw).trim().toLowerCase(); aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') }
      let pr = null; if (prRaw != null && prRaw !== '') { const parsed = Number.parseFloat(prRaw); const allowed = [0.25, 0.5, 1, 2]; pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null }
      return { antialias: aa, pixelRatio: pr }
    } catch { return { antialias: null, pixelRatio: null } }
  }

  _writePerVisualizerAutoQuality(type, { antialias, pixelRatio } = {}) {
    try {
      const keys = this._getPerVisualizerAutoQualityKeys(type)
      if (antialias == null) window.localStorage.removeItem(keys.antiAlias); else window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')
      if (pixelRatio == null) { window.localStorage.removeItem(keys.pixelRatio) } else {
        const allowed = [0.25, 0.5, 1, 2]; const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio); else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch { /* */ }
  }

  _persistAutoQualityForCurrentVisualizer() {
    try {
      if (!this.renderer) return
      const type = App.visualizerType; if (!type) return
      const base = this._baseQualityState
      const user = this._readPerVisualizerQualityOverrides(type)
      const canPersistAa = !base?.antialiasOverridden && user.antialias == null
      const canPersistPr = !base?.pixelRatioOverridden && user.pixelRatio == null
      if (!canPersistAa && !canPersistPr) return
      const aa = this._getContextAntialias()
      const pr = this.renderer.getPixelRatio?.() || 1
      this._writePerVisualizerAutoQuality(type, {
        antialias: canPersistAa ? !!aa : null,
        pixelRatio: canPersistPr ? this._snapPixelRatio(pr, { min: 0.25, max: 2 }) : null,
      })
    } catch { /* */ }
  }

  _getPerVisualizerQualityKeys(type) { const t = String(type || '').trim(); return { antiAlias: `visualizer[${t}].quality.antiAlias`, pixelRatio: `visualizer[${t}].quality.pixelRatio` } }

  _readPerVisualizerQualityOverrides(type) {
    try {
      const { antiAlias, pixelRatio } = this._getPerVisualizerQualityKeys(type)
      const aaRaw = window.localStorage.getItem(antiAlias); const prRaw = window.localStorage.getItem(pixelRatio)
      let aa = null; if (aaRaw != null) { const v = String(aaRaw).trim().toLowerCase(); aa = (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on') }
      let pr = null; if (prRaw != null && prRaw !== '') { const parsed = Number.parseFloat(prRaw); const allowed = [0.25, 0.5, 1, 2]; pr = Number.isFinite(parsed) && allowed.includes(parsed) ? parsed : null }
      return { antialias: aa, pixelRatio: pr }
    } catch { return { antialias: null, pixelRatio: null } }
  }

  _writePerVisualizerQualityOverride(type, { antialias, pixelRatio } = {}) {
    try {
      const keys = this._getPerVisualizerQualityKeys(type)
      if (antialias == null) window.localStorage.removeItem(keys.antiAlias); else window.localStorage.setItem(keys.antiAlias, antialias ? '1' : '0')
      if (pixelRatio == null) { window.localStorage.removeItem(keys.pixelRatio) } else {
        const allowed = [0.25, 0.5, 1, 2]; const pr = Number.isFinite(pixelRatio) && allowed.includes(pixelRatio) ? pixelRatio : null
        if (pr == null) window.localStorage.removeItem(keys.pixelRatio); else window.localStorage.setItem(keys.pixelRatio, String(pr))
      }
    } catch { /* */ }
  }

  _clearPerVisualizerQualityOverrides(type) {
    try { const keys = this._getPerVisualizerQualityKeys(type); window.localStorage.removeItem(keys.antiAlias); window.localStorage.removeItem(keys.pixelRatio) } catch { /* */ }
  }

  _applyPerVisualizerQualityOverrides(type, { applyBaseIfNoOverride = true } = {}) {
    const base = this._baseQualityState
    const overrides = this._readPerVisualizerQualityOverrides(type)
    const auto = this._readPerVisualizerAutoQuality(type)
    const urlLocksAa = !!base?.antialiasOverridden
    const urlLocksPr = !!base?.pixelRatioOverridden

    if (base) {
      this.antialiasOverridden = urlLocksAa ? true : overrides.antialias != null
      this.pixelRatioOverridden = urlLocksPr ? true : overrides.pixelRatio != null
      this.pixelRatioLocked = urlLocksPr ? !!base.pixelRatioLocked : overrides.pixelRatio != null
      this.debugAntialias = urlLocksAa ? base.debugAntialias : (overrides.antialias != null ? !!overrides.antialias : (auto.antialias != null ? !!auto.antialias : base.debugAntialias))
      this.debugPixelRatio = urlLocksPr ? base.debugPixelRatio : (overrides.pixelRatio != null ? overrides.pixelRatio : (auto.pixelRatio != null ? auto.pixelRatio : base.debugPixelRatio))
      this.autoQualityDynamic = !!base.autoQualityDynamic && !this.pixelRatioLocked
    }

    if (!this.renderer) return

    // Apply desired AA
    const curAa = this._getContextAntialias()
    const desiredAa = urlLocksAa ? !!base?.debugAntialias : (overrides.antialias != null ? !!overrides.antialias : (auto.antialias != null ? !!auto.antialias : (applyBaseIfNoOverride ? !!base?.debugAntialias : (curAa ?? !!this.debugAntialias))))
    if (typeof desiredAa === 'boolean' && curAa !== desiredAa) this._recreateRendererWithAntialias(desiredAa)

    // Apply desired pixelRatio
    const targetPr = urlLocksPr ? base?.debugPixelRatio : (overrides.pixelRatio != null ? overrides.pixelRatio : (auto.pixelRatio != null ? auto.pixelRatio : (applyBaseIfNoOverride && base && Number.isFinite(base.debugPixelRatio) ? base.debugPixelRatio : null)))
    if (targetPr != null && Number.isFinite(targetPr)) {
      const oldPr = this.renderer.getPixelRatio?.() || 1
      if (Math.abs(oldPr - targetPr) > 1e-6) {
        this.renderer.setPixelRatio(targetPr)
        if (Number.isFinite(this.width) && Number.isFinite(this.height)) this.renderer.setSize(this.width, this.height, false)
        try { const v = App.currentVisualizer; if (v && typeof v.onPixelRatioChange === 'function') v.onPixelRatioChange(targetPr, oldPr) } catch { /* */ }
      }
    }
  }

  // -------------------------------------------------------------------
  // Session restore
  // -------------------------------------------------------------------

  restoreSessionOnPlay() {
    if (!App.audioManager || !App.audioManager.audio || App.audioManager.isUsingMicrophone) return
    const storedVisualizer = this.getStoredVisualizerType()
    if (storedVisualizer && storedVisualizer !== App.visualizerType) this.switchVisualizer(storedVisualizer, { notify: false })
    const storedTime = this.getStoredPlaybackPosition()
    if (storedTime > 0 && Number.isFinite(App.audioManager.audio.duration)) {
      App.audioManager.seek(Math.min(storedTime, App.audioManager.audio.duration))
    }
  }

  // -------------------------------------------------------------------
  // Player controls UI
  // -------------------------------------------------------------------

  initPlayerControls() {
    const controls = document.getElementById('player-controls')
    if (!controls) return

    const playPauseBtn = document.getElementById('play-pause-btn')
    const muteBtn = document.getElementById('mute-btn')
    const micBtn = document.getElementById('mic-btn')
    const lockBtn = document.getElementById('lock-btn')
    const syncButton = document.getElementById('syncButton')
    const positionSlider = document.getElementById('position-slider')
    const timeDisplay = document.getElementById('time-display')
    const fpsDisplay = document.getElementById('fps-display')

    let isLocked = localStorage.getItem('playerControlsLocked') === 'true'

    this.fpsDisplay = fpsDisplay || null
    if (this.fpsDisplay && !this.fpsState) {
      this.fpsState = { prevFrameAt: 0, sampleStartAt: 0, frames: 0, fpsEma: 0 }
      this.fpsDisplay.textContent = 'FPS: --'
    }

    const rendererRoot = this.renderer?.domElement?.parentElement || document.querySelector('.content') || document.body
    let isSeeking = false, idleTimer = null, pointerInside = false
    const idleDelayMs = 10000

    const showControls = () => { controls.style.display = 'flex'; controls.style.opacity = '1'; controls.style.pointerEvents = 'auto' }
    const hideControls = () => { if (isLocked) return; controls.style.display = 'none'; controls.style.pointerEvents = 'none' }
    const clearTimers = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } }
    const scheduleIdle = () => { clearTimers(); if (isLocked) return; idleTimer = setTimeout(() => { if (!pointerInside) hideControls() }, idleDelayMs) }
    const resetVisibility = () => { showControls(); clearTimers(); scheduleIdle() }
    resetVisibility()

    // Sync client
    const getSyncServerAddress = () => { const p = new URLSearchParams(window.location.search || ''); return p.get('sync') || p.get('syncServer') || null }
    if (syncButton && App.audioManager?.audio && !this.syncClient) {
      const serverAddress = getSyncServerAddress() || 'localhost:5001'
      const getMainWindowAssetUrl = (assetPath) => {
        const normalized = assetPath.replace(/^\/+/, '')
        const getBaseHref = () => { try { const tb = window.top?.document?.baseURI; if (tb) return tb } catch {} try { const th = window.top?.location?.href; if (th) return th } catch {} return document.baseURI || window.location.href }
        try { return new URL(normalized, getBaseHref()).toString() } catch { return normalized }
      }
      this.syncClient = new VideoSyncClient(App.audioManager.audio, null, serverAddress, {
        container: syncButton, svgUrl: getMainWindowAssetUrl('img/link.svg'), size: 56,
        colorConnected: '#cc0000', colorDisconnected: '#ffffff', colorUnavailable: '#a8b3c7',
        autoConnect: false, pauseOnInit: false, enableWebAudio: false,
        onBeforeToggle: () => { try { App.audioManager?.audioContext?.resume?.() } catch {} return true },
      })
    }

    const formatTime = (s) => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}` }

    const updatePlayState = () => {
      if (!App.audioManager?.audio) return
      playPauseBtn.textContent = App.audioManager.audio.paused ? 'play_circle' : 'pause_circle'
    }
    const updateMuteState = () => { if (!App.audioManager) return; muteBtn.textContent = App.audioManager.isMuted ? 'volume_off' : 'volume_up' }
    const updateTime = () => {
      if (!App.audioManager?.audio) return
      const audio = App.audioManager.audio; const cur = audio.currentTime || 0; const dur = audio.duration || 0
      if (!isSeeking) positionSlider.value = dur ? (cur / dur) * 100 : 0
      timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`
    }

    playPauseBtn?.addEventListener('click', () => { this._togglePlayPause(); updatePlayState(); resetVisibility() })
    if (App.audioManager?.audio) { App.audioManager.audio.addEventListener('play', updatePlayState); App.audioManager.audio.addEventListener('pause', updatePlayState) }
    muteBtn?.addEventListener('click', () => { this._toggleMute(); updateMuteState(); resetVisibility() })
    if (micBtn) { micBtn.disabled = true; micBtn.title = 'Microphone input not available in this build'; micBtn.textContent = 'mic_off' }

    const updateLockState = () => { if (!lockBtn) return; lockBtn.textContent = isLocked ? 'lock' : 'lock_open_right'; lockBtn.title = isLocked ? 'Unlock controls (allow auto-hide)' : 'Lock controls visible' }
    lockBtn?.addEventListener('click', () => { isLocked = !isLocked; localStorage.setItem('playerControlsLocked', isLocked.toString()); updateLockState(); if (isLocked) { showControls(); clearTimers() } else scheduleIdle() })
    updateLockState()

    positionSlider?.addEventListener('mousedown', () => { isSeeking = true })
    positionSlider?.addEventListener('mouseup', () => { isSeeking = false })
    positionSlider?.addEventListener('input', (e) => { if (!App.audioManager?.audio) return; const dur = App.audioManager.audio.duration || 0; timeDisplay.textContent = `${formatTime((e.target.value / 100) * dur)} / ${formatTime(dur)}` })
    positionSlider?.addEventListener('change', (e) => { if (!App.audioManager?.audio) return; const dur = App.audioManager.audio.duration || 0; const t = (e.target.value / 100) * dur; App.audioManager.seek(t); this.savePlaybackPosition(t); isSeeking = false })

    updatePlayState(); updateMuteState(); updateTime()
    setInterval(updateTime, 1000)

    controls.addEventListener('mouseenter', () => { pointerInside = true; showControls(); clearTimers() })
    controls.addEventListener('mouseleave', () => { pointerInside = false; scheduleIdle() })
    if (rendererRoot) {
      rendererRoot.addEventListener('click', (e) => {
        if (controls.contains(e.target)) resetVisibility()
        else if (controls.style.display === 'none') resetVisibility()
        else if (!isLocked) { pointerInside = false; hideControls() }
      })
    }

    window.addEventListener('beforeunload', () => {
      if (!App.audioManager?.audio || App.audioManager.isUsingMicrophone) return
      this.savePlaybackPosition(App.audioManager.getCurrentTime())
    })
  }

  // -------------------------------------------------------------------
  // Init (THREE scene + URL params + quality)
  // -------------------------------------------------------------------

  init() {
    document.removeEventListener('click', this.onClickBinder)

    const getMergedUrlParams = () => {
      const merged = new URLSearchParams()
      const addFrom = (qs) => {
        if (!qs) return; let s = String(qs); if (s.startsWith('#')) { const i = s.indexOf('?'); if (i === -1) return; s = s.slice(i) }
        for (const [k, v] of new URLSearchParams(s).entries()) { if (!merged.has(k)) merged.set(k, v) }
      }
      try { addFrom(window.top?.location?.search); addFrom(window.top?.location?.hash) } catch {}
      try { if (document.referrer) { const r = new URL(document.referrer, window.location.href); addFrom(r.search); addFrom(r.hash) } } catch {}
      addFrom(window.location.search); addFrom(window.location.hash)
      return merged
    }

    const isTruthyParam = (p, n) => { if (!p?.has(n)) return false; const v = String(p.get(n) ?? '').trim().toLowerCase(); return !(v === '0' || v === 'false' || v === 'no' || v === 'off') }
    const getOptionalBool = (p, ...ns) => { for (const n of ns) { if (p.has(n)) return isTruthyParam(p, n) } return null }

    const urlParams = getMergedUrlParams()
    const globalDefaults = this.getStoredGlobalQualityDefaults()
    const noDefaults = isTruthyParam(urlParams, 'noDefaults') || isTruthyParam(urlParams, 'nodefaults') || String(urlParams.get('defaults') || '').trim() === '0'

    if (!noDefaults) {
      const injected = new Set()
      const defaults = { dpr: String(globalDefaults.pixelRatio ?? 2), aa: String((globalDefaults.antialias ?? false) ? '1' : '0'), aqDynamic: '1' }
      for (const [k, v] of Object.entries(defaults)) { if (!urlParams.has(k)) { urlParams.set(k, v); injected.add(k) } }
      this._injectedDefaultParams = injected
      if (!urlParams.has('visualizer') && !urlParams.has('viz') && !urlParams.has('v')) {
        const stored = this.getStoredVisualizerType()
        if (!stored) urlParams.set('visualizer', 'Shader: Skinpeeler')
      }
    }

    const wantsPerf = isTruthyParam(urlParams, 'perf') || isTruthyParam(urlParams, 'debugPerf') || isTruthyParam(urlParams, 'debugperf')
    this.perfEnabled = wantsPerf
    this.qualityLogsEnabled = wantsPerf

    this.debugSkipRender = isTruthyParam(urlParams, 'skipRender') || isTruthyParam(urlParams, 'skiprender') || urlParams.get('render') === '0'

    const dprRaw = urlParams.get('dpr') || urlParams.get('pixelRatio') || urlParams.get('pixelratio') || urlParams.get('pr')
    const dpr = dprRaw != null && dprRaw !== '' ? Number.parseFloat(dprRaw) : NaN
    this.debugPixelRatio = Number.isFinite(dpr) ? dpr : null

    const dprKey = urlParams.has('dpr') ? 'dpr' : (urlParams.has('pixelRatio') ? 'pixelRatio' : (urlParams.has('pixelratio') ? 'pixelratio' : (urlParams.has('pr') ? 'pr' : null)))
    const injectedDefaults = this._injectedDefaultParams

    const aaKey = urlParams.has('aa') ? 'aa' : (urlParams.has('antialias') ? 'antialias' : (urlParams.has('msaa') ? 'msaa' : null))
    const aaOverride = aaKey ? isTruthyParam(urlParams, aaKey) : null
    const hasAaOverride = aaOverride != null && !(aaKey === 'aa' && injectedDefaults?.has?.('aa'))
    this.debugAntialias = hasAaOverride ? !!aaOverride : !!(globalDefaults.antialias ?? false)

    const hasPixelRatioOverride = this.debugPixelRatio != null && !(dprKey === 'dpr' && injectedDefaults?.has?.('dpr'))
    this.pixelRatioOverridden = !!hasPixelRatioOverride
    this.antialiasOverridden = !!hasAaOverride

    const autoQualityOverride = getOptionalBool(urlParams, 'autoQuality', 'autoquality', 'aq')
    this.autoQualityEnabled = autoQualityOverride == null ? true : !!autoQualityOverride
    const autoQualityDynamicOverride = getOptionalBool(urlParams, 'autoQualityDynamic', 'autoqualitydynamic', 'aqDynamic', 'aqdynamic', 'aqdyn')
    this.autoQualityDynamicRequested = autoQualityDynamicOverride
    this.pixelRatioLocked = !!hasPixelRatioOverride && autoQualityDynamicOverride !== true

    if (this.autoQualityEnabled && !hasPixelRatioOverride) {
      const seeded = Number.isFinite(globalDefaults.pixelRatio) ? globalDefaults.pixelRatio : 2
      this.debugPixelRatio = this._snapPixelRatio(seeded, { min: 0.25, max: 2 })
    }

    if (autoQualityDynamicOverride === false) this.autoQualityDynamic = false
    else if (autoQualityDynamicOverride === true) this.autoQualityDynamic = !!this.autoQualityEnabled
    else this.autoQualityDynamic = this.autoQualityEnabled && !this.pixelRatioLocked

    this.quality = {
      targetFps: 60, refreshHz: null, minPixelRatio: 0.25,
      maxPixelRatio: Math.max(2, Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1),
      adjustEveryMs: 2000, lastAdjustAt: 0, lastStatusAt: 0, lastMetric: null,
      gpuEmaMs: null, rafEmaDtMs: null,
      goodGpuWindows: 0, stableWindows: 0, lastIncreaseAt: 0, increaseCooldownMs: 12000, settled: false, settledAt: 0,
    }

    if (this.autoQualityDynamic) this._probeRefreshRate()

    this.urlParams = urlParams

    if (!this._baseQualityState) {
      this._baseQualityState = {
        debugAntialias: this.debugAntialias, debugPixelRatio: this.debugPixelRatio,
        pixelRatioOverridden: this.pixelRatioOverridden, pixelRatioLocked: this.pixelRatioLocked,
        antialiasOverridden: this.antialiasOverridden, autoQualityDynamic: this.autoQualityDynamic,
      }
    }

    // Create THREE.js renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: this.debugAntialias, alpha: true, powerPreference: 'high-performance' })
    if (this.debugPixelRatio != null) {
      const clamped = Math.max(0.25, Math.min(4, this.debugPixelRatio))
      this.renderer.setPixelRatio(clamped)
      if (this.quality) this.quality.maxPixelRatio = Math.max(this.quality.maxPixelRatio, clamped)
    }
    App.renderer = this.renderer

    if (this.perfEnabled) {
      try { this.gpuTimer = new WebGLGpuTimer(this.renderer.getContext()) } catch { this.gpuTimer = null }
    }

    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setSize(window.innerWidth, window.innerHeight, false)
    this.renderer.autoClear = false

    const content = document.querySelector('.content')
    if (content) { this._applyMainCanvasStyle(this.renderer.domElement); content.appendChild(this.renderer.domElement) }

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

    this.createManagers()
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  // -------------------------------------------------------------------
  // Renderer helpers
  // -------------------------------------------------------------------

  _getContextAntialias() { try { return this.renderer?.getContext?.()?.getContextAttributes?.()?.antialias ?? null } catch { return null } }

  _applyMainCanvasStyle(canvas) {
    if (!canvas?.style) return
    Object.assign(canvas.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', display: 'block', zIndex: '0' })
  }

  _recreateRendererWithAntialias(antialias) {
    try {
      if (!this.renderer) return false
      const old = this.renderer; const oldCanvas = old.domElement; const parent = oldCanvas?.parentElement
      const cssText = oldCanvas?.style?.cssText || ''; const className = oldCanvas?.className || ''
      const oldPr = old.getPixelRatio?.() || 1
      let size = { x: window.innerWidth, y: window.innerHeight }
      try { const v = new THREE.Vector2(); old.getSize(v); if (v.x > 0 && v.y > 0) size = { x: v.x, y: v.y } } catch {}
      let cc = new THREE.Color(0x000000), ca = 0
      try { old.getClearColor(cc); ca = old.getClearAlpha?.() ?? 0 } catch {}
      try { old.dispose() } catch {}
      const next = new THREE.WebGLRenderer({ antialias: !!antialias, alpha: true, powerPreference: 'high-performance' })
      next.setPixelRatio(oldPr); next.setClearColor(cc, ca); next.autoClear = false; next.setSize(size.x, size.y, false)
      try { if (className) next.domElement.className = className; if (cssText) next.domElement.style.cssText = cssText } catch {}
      this._applyMainCanvasStyle(next.domElement)
      if (parent && oldCanvas) parent.replaceChild(next.domElement, oldCanvas)
      this.renderer = next; App.renderer = next
      if (this.perfEnabled) { try { this.gpuTimer = new WebGLGpuTimer(next.getContext()) } catch { this.gpuTimer = null } }
      try { this.resize() } catch {}
      try { const v = App.currentVisualizer; if (v && typeof v.onRendererRecreated === 'function') v.onRendererRecreated(next, old) } catch {}
      return true
    } catch { return false }
  }

  _probeRefreshRate() {
    try {
      const samples = []; let last = 0; const startAt = performance.now()
      const step = (t) => {
        const now = Number.isFinite(t) ? t : performance.now()
        if (last) { const dt = now - last; if (Number.isFinite(dt) && dt > 0 && dt < 100) samples.push(dt) }
        last = now
        if ((now - startAt) < 700 && samples.length < 90) { requestAnimationFrame(step); return }
        if (samples.length < 10) return
        const sorted = samples.slice().sort((a, b) => a - b)
        const mid = sorted[Math.floor(sorted.length / 2)]
        if (!Number.isFinite(mid) || mid <= 0) return
        const hz = 1000 / mid
        const candidates = [240, 165, 144, 120, 90, 75, 60]; let snapped = 60, bestErr = Infinity
        for (const c of candidates) { const err = Math.abs(hz - c); if (err < bestErr) { bestErr = err; snapped = c } }
        this.quality.refreshHz = snapped; this.quality.targetFps = snapped
      }
      requestAnimationFrame(step)
    } catch { /* */ }
  }

  // -------------------------------------------------------------------
  // Managers + visualizer bootstrap
  // -------------------------------------------------------------------

  async createManagers() {
    App.audioManager = new AudioManager()
    const loadingText = document.querySelector('.user_interaction')

    await App.audioManager.loadAudioBuffer((progress) => {
      if (loadingText) loadingText.innerHTML = `<div style="font-family: monospace; font-size: 24px; color: white;">Loading: ${Math.round(progress)}%</div>`
    })

    App.bpmManager = new BPMManager()
    App.bpmManager.addEventListener('beat', () => {
      if (App.currentVisualizer && typeof App.currentVisualizer.onBPMBeat === 'function') App.currentVisualizer.onBPMBeat()
    })
    App.bpmManager.setBPM(140)

    if (loadingText) loadingText.remove()

    this.initPlayerControls()

    // Determine initial visualizer
    const urlParams = this.urlParams || new URLSearchParams(window.location.search || '')
    const urlVisualizerRaw = urlParams.get('visualizer') || urlParams.get('viz') || urlParams.get('v')
    const resolveVisualizerName = (name) => {
      if (!name) return null; const trimmed = String(name).trim(); if (!trimmed) return null
      const all = App.visualizerList
      const exact = all.find((n) => n === trimmed); if (exact) return exact
      const lower = trimmed.toLowerCase()
      const ci = all.find((n) => String(n).toLowerCase() === lower); if (ci) return ci
      const sp = `Shader: ${trimmed}`; const se = all.find((n) => n === sp); if (se) return se
      return all.find((n) => String(n).toLowerCase() === sp.toLowerCase()) || null
    }
    const urlVisualizer = resolveVisualizerName(urlVisualizerRaw)
    const storedVisualizer = this.getStoredVisualizerType()
    const initialVisualizer = urlVisualizer || storedVisualizer || 'Reactive Particles'
    App.visualizerType = initialVisualizer

    this.switchVisualizer(initialVisualizer, { notify: false })
    this.restoreSessionOnPlay()
    App.audioManager.play()

    // Background BPM detection
    setTimeout(async () => {
      try {
        const buf = await App.audioManager.getAudioBufferForBPM(60, 30)
        await App.bpmManager.detectBPM(buf)
      } catch { /* */ }
    }, 30000)

    // Append MilkDrop names once they load
    if (!App._milkdropNamesAppended) {
      _milkdropReady.then((m) => {
        if (App._milkdropNamesAppended) return
        App._milkdropNamesAppended = true
        const names = m.MILKDROP_VISUALIZER_NAMES
        if (names?.length) {
          App.visualizerList.push(...names)
          this._notifyVisualizerListUpdate()
        }
      })
    }

    // Tell orchestrator we're ready (include initial visualizer details)
    this._notifyReady()
    // Send initial visualizer-changed so controls gets FV3/shader info
    this._notifyVisualizerChanged(initialVisualizer)
    this._notifyQualityState()

    this.update()
  }

  // -------------------------------------------------------------------
  // Resize
  // -------------------------------------------------------------------

  resize() {
    this.width = window.innerWidth; this.height = window.innerHeight
    this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.width, this.height, false)
    try { this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, this.width, this.height) } catch {}
  }

  // -------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------

  update(now) {
    requestAnimationFrame((t) => this.update(t))
    const frameNow = Number.isFinite(now) ? now : performance.now()
    const perfStart = this.perfEnabled ? performance.now() : 0

    // rAF cadence stats
    if (this.rafStats) {
      if (this.rafStats.lastAt) { const dt = frameNow - this.rafStats.lastAt; if (Number.isFinite(dt) && dt >= 0) { this.rafStats.frames++; this.rafStats.sumDt += dt; if (dt > this.rafStats.maxDt) this.rafStats.maxDt = dt; this.lastFrameDtMs = dt } }
      this.rafStats.lastAt = frameNow
    }

    // Short quality window
    if (this.qualityWindow && Number.isFinite(this.lastFrameDtMs)) {
      const dt = this.lastFrameDtMs
      if (dt >= 0 && dt < 1000) {
        if (!this.qualityWindow.startAt) this.qualityWindow.startAt = frameNow
        if ((frameNow - this.qualityWindow.startAt) > 1000 || this.qualityWindow.frames > 90) { this.qualityWindow.startAt = frameNow; this.qualityWindow.frames = 0; this.qualityWindow.sumDt = 0; this.qualityWindow.maxDt = 0 }
        this.qualityWindow.frames++; this.qualityWindow.sumDt += dt; if (dt > this.qualityWindow.maxDt) this.qualityWindow.maxDt = dt
      }
    }

    this.tickFpsCounter(frameNow)

    const audioData = App.audioManager ? {
      frequencies: { bass: App.audioManager.frequencyData.low, mid: App.audioManager.frequencyData.mid, high: App.audioManager.frequencyData.high },
      isBeat: App.bpmManager?.beatActive || false,
    } : null

    const activeVisualizer = App.currentVisualizer
    const t0 = this.perfEnabled ? performance.now() : 0
    activeVisualizer?.update(audioData)
    const t1 = this.perfEnabled ? performance.now() : 0
    App.audioManager?.update()
    const t2 = this.perfEnabled ? performance.now() : 0

    if (!activeVisualizer?.rendersSelf) {
      if (!this.debugSkipRender) {
        if (this.perfEnabled && this.gpuTimer?.supported) this.gpuTimer.begin()
        try { this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, this.width, this.height) } catch {}
        this.renderer.render(this.scene, this.camera)
        if (this.perfEnabled && this.gpuTimer?.supported) this.gpuTimer.end()
      }
    }

    if (this.perfEnabled && this.perfState) {
      this.perfState.visualizerUpdateMs = t1 - t0; this.perfState.audioUpdateMs = t2 - t1; this.perfState.totalMs = performance.now() - perfStart
      this.perfState.gpuRenderMs = this.gpuTimer?.supported ? this.gpuTimer.poll() : null
    }

    this.maybeAdjustQuality(frameNow)
  }

  // -------------------------------------------------------------------
  // Auto-quality (unchanged core logic from App.js)
  // -------------------------------------------------------------------

  maybeAdjustQuality(frameNow) {
    try {
      if (!this.autoQualityDynamic || !this.quality || !this.renderer) return
      if (this.pixelRatioLocked || this.debugSkipRender) return
      if (App.currentVisualizer?.rendersSelf) return

      const nowMs = Number.isFinite(frameNow) ? frameNow : performance.now()
      const targetFps = Math.max(10, Math.min(240, this.quality.targetFps || 60))
      const targetFrameMs = 1000 / targetFps

      const avgDt = this.qualityWindow?.frames > 0 ? this.qualityWindow.sumDt / this.qualityWindow.frames : null
      const dtSample = Number.isFinite(this.lastFrameDtMs) ? this.lastFrameDtMs : (avgDt != null && Number.isFinite(avgDt) && avgDt > 0 ? avgDt : null)

      if (dtSample != null && Number.isFinite(dtSample) && dtSample > 0 && dtSample < 1000) {
        const a = 0.25
        this.quality.rafEmaDtMs = this.quality.rafEmaDtMs == null ? dtSample : this.quality.rafEmaDtMs * (1 - a) + dtSample * a
      }

      const rafMetricForFps = Number.isFinite(this.quality.rafEmaDtMs) ? this.quality.rafEmaDtMs : dtSample
      const achievedFps = rafMetricForFps > 0 ? 1000 / rafMetricForFps : null
      if (achievedFps != null && achievedFps >= targetFps * 0.8) return

      const baseEvery = Number.isFinite(this.quality.adjustEveryMs) ? this.quality.adjustEveryMs : 2000
      const severe = achievedFps != null && achievedFps < targetFps * 0.5
      const effectiveEvery = severe ? Math.min(baseEvery, 800) : baseEvery
      if (this.quality.lastAdjustAt && (nowMs - this.quality.lastAdjustAt) < effectiveEvery) return

      const currentRatio = this.renderer.getPixelRatio?.() || 1
      const minRatio = this.quality.minPixelRatio
      const maxRatio = this.quality.maxPixelRatio
      const rafMetric = Number.isFinite(this.quality.rafEmaDtMs) ? this.quality.rafEmaDtMs : avgDt
      if (rafMetric == null || !Number.isFinite(rafMetric) || rafMetric <= 0) return
      const thresholdFrameMs = targetFrameMs / 0.8
      if (rafMetric <= thresholdFrameMs) { this.quality.lastAdjustAt = nowMs; return }

      // Step 1: disable AA first
      const curAa = this._getContextAntialias()
      if (curAa === true && !this.antialiasOverridden) {
        if (this._recreateRendererWithAntialias(false)) {
          this.debugAntialias = false; this._persistAutoQualityForCurrentVisualizer(); this._notifyQualityState()
          this.quality.lastAdjustAt = nowMs
          if (this.qualityWindow) { this.qualityWindow.startAt = nowMs; this.qualityWindow.frames = 0; this.qualityWindow.sumDt = 0; this.qualityWindow.maxDt = 0 }
          return
        }
      }

      // Step 2: reduce pixelRatio
      const desired = Math.sqrt((thresholdFrameMs * 0.95) / rafMetric)
      const factor = Math.max(0.60, Math.min(0.97, desired))
      const nextRaw = currentRatio * factor
      const clamped = Math.max(minRatio, Math.min(maxRatio, nextRaw))
      const nextRatio = this._snapPixelRatio(clamped, { min: minRatio, max: maxRatio })
      if (Math.abs(nextRatio - currentRatio) < Math.max(0.005, currentRatio * 0.02)) {
        if (this.qualityWindow) { this.qualityWindow.startAt = nowMs; this.qualityWindow.frames = 0; this.qualityWindow.sumDt = 0; this.qualityWindow.maxDt = 0 }
        this.quality.lastAdjustAt = nowMs; return
      }

      this.renderer.setPixelRatio(nextRatio)
      if (Number.isFinite(this.width) && Number.isFinite(this.height)) this.renderer.setSize(this.width, this.height, false)
      try { const v = App.currentVisualizer; if (v && typeof v.onPixelRatioChange === 'function') v.onPixelRatioChange(nextRatio, currentRatio) } catch {}
      try { if (typeof this.renderer.resetState === 'function') this.renderer.resetState(); this.renderer.setScissorTest(false); this.renderer.setViewport(0, 0, this.width, this.height) } catch {}

      if (this.qualityWindow) { this.qualityWindow.startAt = nowMs; this.qualityWindow.frames = 0; this.qualityWindow.sumDt = 0; this.qualityWindow.maxDt = 0 }
      this.quality.lastAdjustAt = nowMs
      this._persistAutoQualityForCurrentVisualizer()
      this._notifyQualityState()
    } catch { /* */ }
  }

  // -------------------------------------------------------------------
  // FPS counter
  // -------------------------------------------------------------------

  tickFpsCounter(now) {
    if (!this.fpsDisplay || !this.fpsState) return
    const state = this.fpsState
    if (!state.sampleStartAt) { state.sampleStartAt = now; state.prevFrameAt = now; state.frames = 0; return }
    state.frames++
    const dtMs = now - state.prevFrameAt; state.prevFrameAt = now
    if ((now - state.sampleStartAt) < 500) return
    const fps = (state.frames * 1000) / (now - state.sampleStartAt)
    state.fpsEma = state.fpsEma ? state.fpsEma * 0.8 + fps * 0.2 : fps
    state.frames = 0; state.sampleStartAt = now
    this.fpsDisplay.textContent = `FPS: ${Number.isFinite(state.fpsEma) ? state.fpsEma.toFixed(1) : '--'} (${Number.isFinite(dtMs) ? dtMs.toFixed(1) : '--'}ms)`
  }

  // -------------------------------------------------------------------
  // Visualizer switching
  // -------------------------------------------------------------------

  async switchVisualizer(type, { notify = true } = {}) {
    if (App.currentVisualizer) {
      if (typeof App.currentVisualizer.destroy === 'function') App.currentVisualizer.destroy()
      App.currentVisualizer = null
    }

    this.resetView()
    while (App.holder.children.length > 0) App.holder.remove(App.holder.children[0])

    this._applyPerVisualizerQualityOverrides(type)
    this.renderer.clear()

    const shaderViz = await createShaderVisualizerByName(type)
    const milkViz = !shaderViz ? (await _milkdropReady, _milkdropModule?.createMilkdropVisualizerByName(type) ?? null) : null
    App.currentVisualizer = shaderViz || milkViz || createEntityVisualizerByName(type)

    if (!App.currentVisualizer) {
      const fb = ENTITY_VISUALIZER_NAMES.includes('Reactive Particles') ? 'Reactive Particles' : ENTITY_VISUALIZER_NAMES[0]
      App.currentVisualizer = (fb ? createEntityVisualizerByName(fb) : null) || await createShaderVisualizerByName(SHADER_VISUALIZER_NAMES[0])
    }

    if (!App.currentVisualizer) { console.warn('No visualizers available'); return }
    App.currentVisualizer.init()

    App.visualizerType = type
    this.saveVisualizerType(type)
    this.updateVisualizerToast(type)

    console.log('Switched to visualizer:', type)

    // Notify orchestrator about the change
    if (notify) {
      this._notifyVisualizerChanged(type)
      this._notifyQualityState()
    }
  }

  cycleVisualizer(step) {
    const list = App.visualizerList
    if (!list || list.length === 0) return
    const cur = Math.max(0, list.indexOf(App.visualizerType))
    this.switchVisualizer(list[(cur + step + list.length) % list.length])
  }

  // -------------------------------------------------------------------
  // Toast
  // -------------------------------------------------------------------

  createVisualizerToast() {
    if (this.visualizerToast) return this.visualizerToast
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'fixed', bottom: '8px', right: '8px', padding: '2px 6px', height: '12px', lineHeight: '12px',
      fontSize: '11px', fontFamily: 'Inter, system-ui, -apple-system, sans-serif', color: '#fff', background: '#000',
      borderRadius: '3px', opacity: '0', transition: 'opacity 250ms ease', pointerEvents: 'none', zIndex: '1000',
    })
    document.body.appendChild(el)
    this.visualizerToast = el; return el
  }

  updateVisualizerToast(name) {
    const el = this.createVisualizerToast(); el.textContent = name || ''
    if (this.visualizerToastHideTimer) { clearTimeout(this.visualizerToastHideTimer); this.visualizerToastHideTimer = null }
    requestAnimationFrame(() => { el.style.opacity = '0.9'; this.visualizerToastHideTimer = setTimeout(() => { el.style.opacity = '0' }, 5000) })
  }

  // -------------------------------------------------------------------
  // Reset view
  // -------------------------------------------------------------------

  resetView() {
    if (this.camera) { this.camera.position.set(0, 0, 12); this.camera.up.set(0, 1, 0); this.camera.quaternion.identity(); this.camera.lookAt(0, 0, 0); this.camera.zoom = 1; this.camera.fov = 70; this.camera.updateProjectionMatrix() }
    if (App.holder) { App.holder.position.set(0, 0, 0); App.holder.rotation.set(0, 0, 0); App.holder.scale.set(1, 1, 1) }
    if (this.scene) this.scene.fog = null
  }
}
