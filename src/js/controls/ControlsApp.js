/**
 * ControlsApp – lil-gui controls panel.
 *
 * This is the controls-side concern extracted from the monolithic App.js.
 * It owns the lil-gui instance, visualizer switcher, performance/quality
 * controls, FV3 preset controls, and shader customization controls.
 *
 * Communication with the orchestrator (parent window) is exclusively via
 * window.postMessage / addEventListener('message').
 */

import GUI from 'lil-gui'
import { loadSpectrumFilters } from '../spectrumFilters'

export default class ControlsApp {
  constructor() {
    this.gui = null
    this.visualizerList = []
    this.activeVisualizer = ''

    // Visualizer switcher state
    this.visualizerSwitcherConfig = null
    this.visualizerController = null

    // Performance + Quality state
    this.performanceQualityFolder = null
    this.performanceQualityConfig = null
    this.performanceQualityControllers = { antialias: null, pixelRatio: null }

    // FV3 controls state
    this.variant3Folder = null
    this.variant3Controllers = {}
    this.variant3Config = null
    this.variant3PresetState = null
    this.variant3LoadController = null
    this.variant3ScrollContainer = null
    this.variant3UploadInput = null
    this.variant3Overlay = null
    this.variant3PresetApplied = false
    this.variant3FolderObserver = null
    this.fv3FilePresets = {}
    this.fv3FilePresetsLoaded = false

    // Shader controls state
    this.shaderControlsFolder = null

    this.storageKeys = {
      fv3Presets: 'visualizer.fv3.presets',
      fv3SelectedPreset: 'visualizer.fv3.selectedPreset',
    }

    window.addEventListener('message', (e) => this.handleMessage(e))
    // Send ready and keep retrying until we receive 'init' back
    this._readyInterval = setInterval(() => this.sendToParent({ type: 'ready' }), 250)
    this.sendToParent({ type: 'ready' })
  }

  // -------------------------------------------------------------------
  // postMessage helpers
  // -------------------------------------------------------------------

  sendToParent(msg) {
    try {
      const t = window.parent && window.parent !== window ? window.parent : null
      if (t) t.postMessage({ source: 'controls', ...msg }, '*')
    } catch { /* */ }
  }

  handleMessage(event) {
    const msg = event?.data
    if (!msg || typeof msg !== 'object') return
    if (msg.source === 'controls') return // echo

    switch (msg.type) {
      case 'init':
        // Stop retrying ready
        if (this._readyInterval) { clearInterval(this._readyInterval); this._readyInterval = null }
        this.visualizerList = msg.visualizerList || []
        this.activeVisualizer = msg.activeVisualizer || ''
        this.initGui()
        break
      case 'visualizer-changed':
        this.activeVisualizer = msg.name || ''
        if (this.gui) {
          this.syncVisualizerDropdown(msg.name)
          this.teardownFrequencyViz3Controls()
          this.teardownShaderControls()
          if (msg.hasFV3 && msg.fv3Params) this.setupFrequencyViz3Controls(msg.fv3Params)
          if (msg.hasShaderConfig && msg.shaderConfig) this.setupShaderControls(msg.shaderConfig)
        } else {
          // GUI not ready yet — store for when initGui runs
          this._pendingVisualizerChanged = msg
        }
        break
      case 'quality-update':
        if (this.gui) {
          this.syncQualityControls(msg.antialias, msg.pixelRatio)
        } else {
          this._pendingQualityUpdate = msg
        }
        break
      case 'visualizer-list-update':
        this.visualizerList = msg.visualizerList || []
        this.rebuildVisualizerDropdown()
        break
      case 'fv3-params':
        this.syncFV3Controls(msg.params)
        break
      default:
        break
    }
  }

  // -------------------------------------------------------------------
  // Resize notification
  // -------------------------------------------------------------------

  _notifyResize() {
    try {
      const el = this.gui?.domElement
      // Allow a frame for layout to settle
      requestAnimationFrame(() => {
        // Measure all visible content in the page (GUI + any show-button etc)
        const w = document.documentElement.scrollWidth || 0
        const h = document.documentElement.scrollHeight || 0
        // Fallback: if GUI is visible, use its rect for more precise sizing
        let width = w, height = h
        if (el && el.style.display !== 'none') {
          const rect = el.getBoundingClientRect()
          width = Math.max(Math.ceil(rect.width), width)
          height = Math.max(Math.ceil(rect.height), height)
        }
        // Minimum size to accommodate the show-button (80×80 + 12px margin)
        width = Math.max(width, 100)
        height = Math.max(height, 100)
        this.sendToParent({
          type: 'resize',
          width,
          height,
        })
      })
    } catch { /* */ }
  }

  /** Install a ResizeObserver to auto-resize the iframe when GUI content changes */
  _installResizeObserver() {
    if (this._resizeObserver || !this.gui?.domElement) return
    this._resizeObserver = new ResizeObserver(() => this._notifyResize())
    this._resizeObserver.observe(this.gui.domElement)
  }

  // -------------------------------------------------------------------
  // GUI initialisation
  // -------------------------------------------------------------------

  initGui() {
    if (this.gui) return // already created

    this.gui = new GUI({ title: 'VISUALIZER' })
    this.gui.open()

    this.setupGuiCloseButton()
    this.addVisualizerSwitcher()
    this.addPerformanceQualityControls()

    // Replay any visualizer-changed message that arrived before GUI was ready
    if (this._pendingVisualizerChanged) {
      const msg = this._pendingVisualizerChanged
      this._pendingVisualizerChanged = null
      this.syncVisualizerDropdown(msg.name)
      if (msg.hasFV3 && msg.fv3Params) this.setupFrequencyViz3Controls(msg.fv3Params)
      if (msg.hasShaderConfig && msg.shaderConfig) this.setupShaderControls(msg.shaderConfig)
    }

    // Replay any quality-update that arrived before GUI was ready
    if (this._pendingQualityUpdate) {
      const q = this._pendingQualityUpdate
      this._pendingQualityUpdate = null
      this.syncQualityControls(q.antialias, q.pixelRatio)
    }

    this._notifyResize()
    this._installResizeObserver()
  }

  // -------------------------------------------------------------------
  // GUI close / collapse button (from App.js)
  // -------------------------------------------------------------------

  setupGuiCloseButton() {
    if (!this.gui?.domElement) return
    const guiRoot = this.gui.domElement
    const titleButton = guiRoot.querySelector('.lil-title')
    if (!titleButton) return

    titleButton.disabled = true
    titleButton.style.cursor = 'default'
    titleButton.style.pointerEvents = 'none'
    titleButton.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return false }, true)

    const titleCloseBtn = document.createElement('button')
    titleCloseBtn.className = 'gui-title-close-btn'
    titleCloseBtn.innerHTML = 'X'
    titleCloseBtn.title = 'Close controls'
    titleButton.parentNode.insertBefore(titleCloseBtn, titleButton.nextSibling)

    titleCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault()
      const ch = guiRoot.querySelector('.lil-children')
      if (ch) {
        const hidden = ch.style.display === 'none'
        ch.style.display = hidden ? '' : 'none'
        titleCloseBtn.innerHTML = hidden ? 'X' : 'O'
        guiRoot.classList.toggle('gui-collapsed', !hidden)
      }
      this._notifyResize()
    })

    guiRoot.addEventListener('click', () => {
      const ch = guiRoot.querySelector('.lil-children')
      if (ch && ch.style.display === 'none') { ch.style.display = ''; titleCloseBtn.innerHTML = 'X'; guiRoot.classList.remove('gui-collapsed'); this._notifyResize() }
    })

    const titleEl = guiRoot.querySelector('.title')
    if (titleEl) {
      const closeBtn = document.createElement('button')
      closeBtn.className = 'gui-close-btn'; closeBtn.innerHTML = '×'; closeBtn.title = 'Hide controls'; closeBtn.style.pointerEvents = 'auto'
      titleEl.appendChild(closeBtn)

      const showBtn = document.createElement('button')
      showBtn.className = 'gui-show-btn'; showBtn.title = 'Show controls'; showBtn.style.display = 'none'
      document.body.appendChild(showBtn)

      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); guiRoot.style.display = 'none'; showBtn.style.display = 'block'; this._notifyResize() })
      showBtn.addEventListener('click', () => { guiRoot.style.display = 'block'; showBtn.style.display = 'none'; this._notifyResize() })
    }
  }

  // -------------------------------------------------------------------
  // Visualizer switcher
  // -------------------------------------------------------------------

  addVisualizerSwitcher() {
    const folder = this.gui.addFolder('TYPE')
    folder.open()

    this.visualizerSwitcherConfig = { visualizer: this.activeVisualizer }

    this.visualizerController = folder
      .add(this.visualizerSwitcherConfig, 'visualizer', this.visualizerList)
      .name('Select Visualizer')
      .listen()
      .onChange((value) => {
        this.sendToParent({ type: 'select-visualizer', name: value })
      })

    this._notifyResize()
  }

  syncVisualizerDropdown(name) {
    if (!this.visualizerSwitcherConfig || !this.visualizerController) return
    this.visualizerSwitcherConfig.visualizer = name
    this.visualizerController.updateDisplay()
    const sel = this.visualizerController.domElement?.querySelector('select')
    if (sel && sel.value !== name) { try { sel.value = name } catch { /* */ } }
  }

  rebuildVisualizerDropdown() {
    if (!this.visualizerController) return
    this.visualizerController.options(this.visualizerList)
    this.visualizerController.setValue(this.activeVisualizer)
    this._notifyResize()
  }

  // -------------------------------------------------------------------
  // Performance + Quality controls
  // -------------------------------------------------------------------

  addPerformanceQualityControls() {
    if (this.performanceQualityFolder) return
    const folder = this.gui.addFolder('PERFORMANCE + QUALITY')
    folder.open()
    this.performanceQualityFolder = folder

    const prOptions = { '0.25': 0.25, '0.5': 0.5, '1 ': 1, '2 ': 2 }

    this.performanceQualityConfig = {
      antialias: false,
      pixelRatio: 1,
      saveAsDefaults: () => this.sendToParent({ type: 'save-quality-defaults' }),
      clearUserValues: () => this.sendToParent({ type: 'clear-quality-overrides' }),
    }

    this.performanceQualityControllers.antialias = folder
      .add(this.performanceQualityConfig, 'antialias')
      .name('Antialiasing')
      .onChange((v) => this.sendToParent({ type: 'set-quality', antialias: !!v }))

    this.performanceQualityControllers.pixelRatio = folder
      .add(this.performanceQualityConfig, 'pixelRatio', prOptions)
      .name('PixelRatio')
      .onChange((v) => {
        const pr = typeof v === 'string' ? Number.parseFloat(v) : v
        this.sendToParent({ type: 'set-quality', pixelRatio: pr })
      })

    folder.add(this.performanceQualityConfig, 'saveAsDefaults').name('Save As Global PQ Defaults')
    folder.add(this.performanceQualityConfig, 'clearUserValues').name('Clear Stored Local PQ Values')
  }

  syncQualityControls(antialias, pixelRatio) {
    if (!this.performanceQualityConfig) return
    if (typeof antialias === 'boolean') this.performanceQualityConfig.antialias = antialias
    if (Number.isFinite(pixelRatio)) this.performanceQualityConfig.pixelRatio = pixelRatio
    this.performanceQualityControllers.antialias?.updateDisplay()
    this.performanceQualityControllers.pixelRatio?.updateDisplay()
  }

  // -------------------------------------------------------------------
  // FV3 controls (full preset management)
  // -------------------------------------------------------------------

  getFV3Presets() { try { const r = window.localStorage.getItem(this.storageKeys.fv3Presets); if (!r) return {}; const p = JSON.parse(r); return p && typeof p === 'object' && !Array.isArray(p) ? p : {} } catch { return {} } }
  saveFV3Presets(p) { try { window.localStorage.setItem(this.storageKeys.fv3Presets, JSON.stringify(p || {})) } catch { /* */ } }
  getStoredFV3PresetName() { try { return window.localStorage.getItem(this.storageKeys.fv3SelectedPreset) || '' } catch { return '' } }
  saveFV3PresetName(n) { try { if (n) window.localStorage.setItem(this.storageKeys.fv3SelectedPreset, n); else window.localStorage.removeItem(this.storageKeys.fv3SelectedPreset) } catch { /* */ } }

  teardownFrequencyViz3Controls() {
    if (!this.variant3Folder) return
    try { this.variant3Folder.destroy() } catch { const p = this.variant3Folder.domElement?.parentElement; if (p) p.removeChild(this.variant3Folder.domElement) }
    this.variant3Folder = null; this.variant3Controllers = {}; this.variant3Config = null
    this.variant3PresetState = null; this.variant3LoadController = null; this.variant3ScrollContainer = null
    if (this.variant3FolderObserver) { this.variant3FolderObserver.disconnect(); this.variant3FolderObserver = null }
    if (this.variant3Overlay?.parentElement) this.variant3Overlay.parentElement.removeChild(this.variant3Overlay)
    this.variant3Overlay = null
    this._notifyResize()
  }

  setupFrequencyViz3Controls(initialParams) {
    this.teardownFrequencyViz3Controls()
    if (!initialParams || !this.gui) return

    this.variant3Config = { ...initialParams }
    this.variant3PresetApplied = false
    const folder = this.gui.addFolder('FREQUENCY VIZ 3 CONTROLS')
    folder.open()
    folder.domElement.classList.add('fv3-controls')
    folder.domElement.style.position = 'relative'
    this.variant3Folder = folder
    this.variant3Controllers = {}

    const presets = this.getFV3Presets()
    const mergedPresets = () => ({ ...(this.fv3FilePresets || {}), ...presets })

    this.variant3PresetState = { presetName: '', loadPreset: this.getStoredFV3PresetName() || Object.keys(mergedPresets())[0] || '' }
    if (this.variant3PresetState.loadPreset) this.saveFV3PresetName(this.variant3PresetState.loadPreset)

    const roundParams = (p) => { if (!p) return p; const r = {}; Object.entries(p).forEach(([k, v]) => { r[k] = Number.isFinite(v) ? parseFloat(v.toFixed(6)) : v }); return r }

    let isSyncing = false

    const applyParams = (params) => {
      if (!params) return
      this.variant3Config = { ...params }
      Object.entries(this.variant3Controllers).forEach(([prop, ctrl]) => { if (ctrl?.setValue) ctrl.setValue(params[prop]); else ctrl?.updateDisplay() })
      this.sendToParent({ type: 'apply-fv3-params', params })
    }

    const refreshLoadOptions = () => {
      const names = Object.keys(mergedPresets())
      const ctrl = this.variant3LoadController
      if (!ctrl) return
      const opts = {}; names.forEach((n) => { opts[n] = n })
      ctrl.options(opts)
      if (!names.includes(this.variant3PresetState?.loadPreset)) {
        this.variant3PresetState.loadPreset = names[0] || ''
        this.saveFV3PresetName(this.variant3PresetState.loadPreset)
      }
      ctrl.updateDisplay()

      // Re-inject Edit button
      const widget = ctrl.domElement.querySelector('.lil-widget')
      if (widget && !widget.querySelector('.fv3-edit-btn')) {
        const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.textContent = 'Edit'; editBtn.className = 'fv3-edit-btn'
        editBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openOverlay() })
        widget.appendChild(editBtn)
      }

      if (!this.variant3PresetApplied && this.variant3PresetState.loadPreset && names.includes(this.variant3PresetState.loadPreset)) {
        onPresetSelect(this.variant3PresetState.loadPreset)
        this.variant3PresetApplied = true
      }
    }

    const onPresetSelect = (value) => {
      if (!value || isSyncing) return
      const preset = mergedPresets()[value]
      if (!preset) return
      isSyncing = true
      applyParams(preset)
      this.variant3PresetState.loadPreset = value
      this.saveFV3PresetName(value)
      this.variant3LoadController?.updateDisplay()
      isSyncing = false
      this.variant3PresetState.presetName = value
    }

    // Load spectrum filter presets
    if (!this.fv3FilePresetsLoaded) {
      this.fv3FilePresetsLoaded = true
      loadSpectrumFilters().then((loaded) => { this.fv3FilePresets = loaded || {}; this.variant3PresetApplied = false; refreshLoadOptions() }).catch(() => {})
    }

    // Preset actions
    const presetActions = {
      savePreset: () => {
        const name = (this.variant3PresetState.presetName || '').trim()
        if (!name) { alert('Enter a preset name first.'); return }
        presets[name] = roundParams(this.variant3Config)
        this.saveFV3Presets(presets)
        this.variant3PresetState.loadPreset = name; this.saveFV3PresetName(name); refreshLoadOptions()
      },
      downloadPreset: () => {
        const data = { name: (this.variant3PresetState.presetName || '').trim() || 'preset', visualizer: 'Frequency Visualization 3', controls: roundParams(this.variant3Config) }
        const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset'
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `fv3-preset-${slug}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      },
      uploadPreset: () => {
        if (!this.variant3UploadInput) { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json'; inp.style.display = 'none'; document.body.appendChild(inp); this.variant3UploadInput = inp }
        this.variant3UploadInput.onchange = (e) => {
          const file = e.target?.files?.[0]; if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            try { const parsed = JSON.parse(reader.result); const controls = parsed?.controls || parsed; const name = parsed?.name || file.name.replace(/\.json$/i, '') || 'Imported'
              presets[name] = roundParams(controls); this.saveFV3Presets(presets); this.variant3PresetState.presetName = name; this.variant3PresetState.loadPreset = name; this.saveFV3PresetName(name)
              applyParams(roundParams(controls)); refreshLoadOptions()
            } catch (err) { alert('Failed to load preset: ' + (err?.message || err)) } finally { this.variant3UploadInput.value = '' }
          }
          reader.readAsText(file)
        }
        this.variant3UploadInput.click()
      },
      deletePreset: () => {
        const name = this.variant3PresetState.loadPreset || ''
        if (!name) return
        if (this.fv3FilePresets?.[name]) { alert('Built-in presets cannot be deleted.'); return }
        if (!presets[name]) { alert('Preset not found.'); return }
        if (!confirm(`Delete preset "${name}"?`)) return
        delete presets[name]; this.saveFV3Presets(presets)
        if (this.variant3PresetState.loadPreset === name) { this.variant3PresetState.loadPreset = Object.keys(presets)[0] || ''; this.saveFV3PresetName(this.variant3PresetState.loadPreset) }
        refreshLoadOptions()
      },
    }

    // Overlay (simplified from App.js)
    let overlayNameInput = null
    const hideOverlay = () => { if (this.variant3Overlay) this.variant3Overlay.style.display = 'none'; folder.domElement?.classList.remove('blur-active') }
    const makeIconButton = (lig, title, handler) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn'; b.title = title; const i = document.createElement('span'); i.className = 'fv3-icon'; i.textContent = lig; b.appendChild(i); b.addEventListener('click', handler); return b }

    const buildOverlay = () => {
      if (this.variant3Overlay?.parentElement) return this.variant3Overlay
      const overlay = document.createElement('div'); overlay.className = 'fv3-overlay'
      const modal = document.createElement('div'); modal.className = 'fv3-modal'
      const header = document.createElement('header')
      const title = document.createElement('h3'); title.textContent = 'Edit FV3 Presets'
      const closeBtn = document.createElement('button'); closeBtn.className = 'close-btn'; closeBtn.title = 'Close'; closeBtn.textContent = '×'; closeBtn.addEventListener('click', hideOverlay)
      header.appendChild(title); header.appendChild(closeBtn); modal.appendChild(header)

      const makeRow = (label, el) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('div'); l.className = 'label'; l.textContent = label; const f = document.createElement('div'); f.className = 'field'; f.appendChild(el); r.appendChild(l); r.appendChild(f); return r }
      const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.placeholder = 'Preset name'; nameInput.value = this.variant3PresetState.presetName
      nameInput.addEventListener('input', (e) => { this.variant3PresetState.presetName = e.target.value })
      overlayNameInput = nameInput; modal.appendChild(makeRow('Save as', nameInput))

      const actions = document.createElement('div'); actions.className = 'actions'
      actions.appendChild(makeIconButton('save', 'Save preset', presetActions.savePreset))
      actions.appendChild(makeIconButton('file_download', 'Download', presetActions.downloadPreset))
      actions.appendChild(makeIconButton('upload_file', 'Upload', presetActions.uploadPreset))
      actions.appendChild(makeIconButton('delete', 'Delete', presetActions.deletePreset))
      const ar = document.createElement('div'); ar.className = 'row'; const al = document.createElement('div'); al.className = 'label'; al.textContent = 'Actions'
      const af = document.createElement('div'); af.className = 'field'; af.appendChild(actions); ar.appendChild(al); ar.appendChild(af); modal.appendChild(ar)

      overlay.appendChild(modal)
      folder.domElement.appendChild(overlay); this.variant3Overlay = overlay; refreshLoadOptions()
      return overlay
    }

    const openOverlay = () => { const o = buildOverlay(); if (o) { refreshLoadOptions(); o.style.display = 'flex'; folder.domElement?.classList.add('blur-active') } }

    // Scroller
    const ensureScrollContainer = () => {
      if (this.variant3ScrollContainer?.isConnected) return this.variant3ScrollContainer
      const parent = folder.$children || folder.domElement?.querySelector('ul') || folder.domElement
      if (!parent) return null
      const s = document.createElement('div'); s.className = 'fv3-scroll'; parent.appendChild(s); this.variant3ScrollContainer = s; return s
    }
    const moveToScroller = (ctrl) => { const li = ctrl?.domElement; const s = ensureScrollContainer(); if (li && s && li.parentElement !== s) s.appendChild(li) }

    // Load preset dropdown
    const addLoadRow = () => {
      const ctrl = folder.add(this.variant3PresetState, 'loadPreset', {}).name('Load preset')
      ctrl.onChange((v) => { if (!isSyncing) onPresetSelect(v) })
      this.variant3LoadController = ctrl
      const widget = ctrl.domElement.querySelector('.lil-widget')
      if (widget) {
        const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.textContent = 'Edit'; editBtn.className = 'fv3-edit-btn'
        editBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openOverlay() })
        widget.appendChild(editBtn)
      }
      ctrl.domElement.classList.add('fv3-load-preset')
      refreshLoadOptions()
    }

    addLoadRow()

    // Add sliders/dropdowns/toggles
    const addSlider = (prop, label, min, max, step = 1) => {
      const ctrl = folder.add(this.variant3Config, prop, min, max).step(step).name(label).listen()
      ctrl.onChange((v) => { if (Number.isFinite(v)) this.sendToParent({ type: 'set-fv3-param', key: prop, value: v }) })
      this.variant3Controllers[prop] = ctrl; moveToScroller(ctrl); return ctrl
    }
    const addToggle = (prop, label) => {
      const ctrl = folder.add(this.variant3Config, prop).name(label).listen()
      ctrl.onChange((v) => this.sendToParent({ type: 'set-fv3-param', key: prop, value: !!v }))
      this.variant3Controllers[prop] = ctrl; moveToScroller(ctrl); return ctrl
    }
    const addDropdown = (prop, label, options) => {
      const ctrl = folder.add(this.variant3Config, prop, options).name(label).listen()
      ctrl.onChange((v) => this.sendToParent({ type: 'set-fv3-param', key: prop, value: v }))
      this.variant3Controllers[prop] = ctrl; moveToScroller(ctrl); return ctrl
    }

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
      { type: 'slider', prop: 'agcRelease', label: 'AGC release', min: 0.0, max: 1.0, step: 0.01 },
    ]

    controlsToAdd.sort((a, b) => a.label.localeCompare(b.label)).forEach((cfg) => {
      if (cfg.type === 'slider') addSlider(cfg.prop, cfg.label, cfg.min, cfg.max, cfg.step)
      else if (cfg.type === 'dropdown') addDropdown(cfg.prop, cfg.label, cfg.options)
      else if (cfg.type === 'toggle') addToggle(cfg.prop, cfg.label)
    })

    this._notifyResize()
  }

  syncFV3Controls(params) {
    if (!params || !this.variant3Config) return
    Object.assign(this.variant3Config, params)
    Object.entries(this.variant3Controllers).forEach(([, ctrl]) => ctrl?.updateDisplay?.())
  }

  // -------------------------------------------------------------------
  // Shader controls
  // -------------------------------------------------------------------

  teardownShaderControls() {
    if (!this.shaderControlsFolder) return
    try { this.shaderControlsFolder.destroy() } catch { const p = this.shaderControlsFolder.domElement?.parentElement; if (p) p.removeChild(this.shaderControlsFolder.domElement) }
    this.shaderControlsFolder = null
    this._notifyResize()
  }

  setupShaderControls(config) {
    this.teardownShaderControls()
    if (!config?.controls?.length || !this.gui) return

    const folder = this.gui.addFolder(config.name || 'Shader Settings')
    const params = {}
    const storagePrefix = `shaderConfig:${config.name}:`

    for (const control of config.controls) {
      if (control.type === 'select') {
        const options = {}; control.options.forEach((o) => { options[o.label] = o.value })
        const saved = localStorage.getItem(storagePrefix + control.uniform)
        params[control.name] = saved !== null ? parseInt(saved, 10) : control.default
        folder.add(params, control.name, options).name(control.name).onChange((v) => {
          localStorage.setItem(storagePrefix + control.uniform, String(v))
          this.sendToParent({ type: 'set-shader-uniform', uniform: control.uniform, value: v })
        })
        // Send initial value
        this.sendToParent({ type: 'set-shader-uniform', uniform: control.uniform, value: params[control.name] })
      } else if (control.type === 'slider') {
        const saved = localStorage.getItem(storagePrefix + control.uniform)
        params[control.name] = saved !== null ? parseFloat(saved) : control.default
        folder.add(params, control.name, control.min, control.max).name(control.name).onChange((v) => {
          localStorage.setItem(storagePrefix + control.uniform, String(v))
          this.sendToParent({ type: 'set-shader-uniform', uniform: control.uniform, value: v })
        })
        this.sendToParent({ type: 'set-shader-uniform', uniform: control.uniform, value: params[control.name] })
      }
    }

    folder.open()
    this.shaderControlsFolder = folder
    this._notifyResize()
  }
}
