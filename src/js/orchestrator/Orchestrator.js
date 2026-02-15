/**
 * Orchestrator – the top-level coordinator.
 *
 * Loaded by index.html, which contains two iframes:
 *   #viz-player   → viz-player.html  (full-viewport renderer + player bar)
 *   #viz-controls  → viz-controls.html (lil-gui controls panel)
 *
 * Responsibilities:
 *   • Route postMessages between the player and controls iframes
 *   • Handle keyboard events (own document + forwarded from children)
 *   • Bridge messaging to parent window (Polaris Player integration)
 */

export default class Orchestrator {
  constructor() {
    /** @type {HTMLIFrameElement|null} */ this.playerFrame = null
    /** @type {HTMLIFrameElement|null} */ this.controlsFrame = null

    // Readiness
    this.playerReady = false
    this.controlsReady = false
    this.controlsInitialised = false     // true after 'init' sent AND controls has built GUI
    this.playerInitData = null           // cached data from player 'ready' message
    this.pendingForControls = []         // buffer player msgs until controls is initialised

    // Cached state for bridge
    this.visualizerList = []
    this.activeVisualizer = ''

    // Bridge (parent window, if we are embedded)
    this.bridgeTarget = window.parent && window.parent !== window ? window.parent : null
  }

  // -------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------

  init() {
    this.playerFrame = document.getElementById('viz-player')
    this.controlsFrame = document.getElementById('viz-controls')

    // Message listener
    window.addEventListener('message', (e) => this._onMessage(e))

    // Keyboard listener (top-level page)
    document.addEventListener('keydown', (e) => this._onKeyDown(e), { capture: true })

    // Controls iframe resizing
    this._setupControlsResizer()
  }

  // -------------------------------------------------------------------
  // Helpers – send to child iframes
  // -------------------------------------------------------------------

  _postToPlayer(msg) {
    try { this.playerFrame?.contentWindow?.postMessage(msg, '*') } catch { /* */ }
  }

  _postToControls(msg) {
    try { this.controlsFrame?.contentWindow?.postMessage(msg, '*') } catch { /* */ }
  }

  _postToBridge(msg) {
    try { if (this.bridgeTarget) this.bridgeTarget.postMessage(msg, '*') } catch { /* */ }
  }

  // -------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------

  _onMessage(event) {
    const msg = event?.data
    if (!msg || typeof msg !== 'object') return
    // Ignore non-app messages (e.g. Vite HMR)
    if (!msg.source && !msg.type) return

    const src = msg.source

    // ── Messages from PLAYER ──
    if (src === 'player') {
      switch (msg.type) {
        case 'ready':
          this.playerReady = true
          this.playerInitData = msg
          this.visualizerList = msg.visualizerList || []
          this.activeVisualizer = msg.activeVisualizer || ''
          // If controls is also ready, send init
          this._maybeInitControls()
          // Bridge: notify parent of module list
          this._bridgePostModuleList()
          break

        case 'visualizer-changed':
          this.activeVisualizer = msg.name || ''
          this._forwardToControls(msg)
          // Bridge: notify parent
          this._bridgePostModuleSet(true)
          break

        case 'quality-update':
        case 'visualizer-list-update':
        case 'fv3-params':
          if (msg.type === 'visualizer-list-update') this.visualizerList = msg.visualizerList || []
          this._forwardToControls(msg)
          break

        case 'keyboard': // forwarded keydown from player iframe
          this._onKeyDown(msg, true)
          break

        default:
          break
      }
      return
    }

    // ── Messages from CONTROLS ──
    if (src === 'controls') {
      switch (msg.type) {
        case 'ready':
          this.controlsReady = true
          this._maybeInitControls()
          break


        case 'select-visualizer':
          this._postToPlayer({ type: 'switch-visualizer', name: msg.name })
          break

        case 'set-quality':
          this._postToPlayer({ type: 'set-quality', antialias: msg.antialias, pixelRatio: msg.pixelRatio })
          break

        case 'save-quality-defaults':
          this._postToPlayer({ type: 'save-quality-defaults' })
          break

        case 'clear-quality-overrides':
          this._postToPlayer({ type: 'clear-quality-overrides' })
          break

        case 'set-fv3-param':
          this._postToPlayer({ type: 'set-fv3-param', key: msg.key, value: msg.value })
          break

        case 'apply-fv3-params':
          this._postToPlayer({ type: 'apply-fv3-params', params: msg.params })
          break

        case 'set-shader-uniform':
          this._postToPlayer({ type: 'set-shader-uniform', uniform: msg.uniform, value: msg.value })
          break

        case 'resize':
          this._resizeControlsFrame(msg.width, msg.height)
          break

        case 'keyboard': // forwarded keydown from controls iframe
          this._onKeyDown(msg, true)
          break

        default:
          break
      }
      return
    }

    // ── Bridge messages from PARENT ──
    if (msg.type === 'LIST_MODULES') {
      this._bridgePostModuleList(event.source || this.bridgeTarget)
      return
    }

    if (msg.type === 'SET_MODULE') {
      const moduleName = typeof msg.module === 'string' ? msg.module : null
      const isValid = moduleName && this.visualizerList.includes(moduleName)
      if (isValid) {
        this._postToPlayer({ type: 'switch-visualizer', name: moduleName })
        // The player will send 'visualizer-changed' back, which triggers _bridgePostModuleSet
      } else {
        this._bridgePostModuleSet(false, event.source || this.bridgeTarget)
      }
    }
  }

  // -------------------------------------------------------------------
  // Controls init handshake
  // -------------------------------------------------------------------

  _maybeInitControls() {
    if (!this.controlsReady || !this.playerReady || !this.playerInitData) return

    // (Re-)send init to controls — controls will ignore duplicates via its
    // own `if (this.gui) return` guard inside initGui().
    this._postToControls({
      type: 'init',
      visualizerList: this.playerInitData.visualizerList || [],
      activeVisualizer: this.playerInitData.activeVisualizer || '',
    })

    if (!this.controlsInitialised) {
      this.controlsInitialised = true
      // Flush any buffered messages that arrived before controls was ready
      if (this.pendingForControls.length) {
        const pending = this.pendingForControls.splice(0)
        for (const m of pending) this._postToControls(m)
      }
    }
  }

  /** Forward a player message to controls, buffering if controls isn't ready yet. */
  _forwardToControls(msg) {
    if (this.controlsInitialised) {
      this._postToControls(msg)
    } else {
      this.pendingForControls.push(msg)
    }
  }

  // -------------------------------------------------------------------
  // Controls iframe resizing
  // -------------------------------------------------------------------

  _setupControlsResizer() {
    // Nothing to do here — the controls iframe is resized dynamically
    // in response to 'resize' messages from the controls page.
  }

  _resizeControlsFrame(w, h) {
    if (!this.controlsFrame) return
    // Size the iframe to exactly match the lil-gui panel content.
    // This way clicks outside the iframe pass through to the player.
    if (Number.isFinite(w) && w > 0) this.controlsFrame.style.width = w + 'px'
    if (Number.isFinite(h) && h > 0) this.controlsFrame.style.height = h + 'px'
  }

  // -------------------------------------------------------------------
  // Keyboard handling
  // -------------------------------------------------------------------

  _onKeyDown(event, isForwarded = false) {
    // Support both native KeyboardEvent and forwarded message objects
    const code = event.code || ''
    const key = event.key || ''
    const location = event.location || 0
    const target = event.target
    const isFormElement = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    const isNumpadPlusMinus = code === 'NumpadAdd' || code === 'NumpadSubtract' || ((key === '+' || key === '-') && location === 3)

    if (isFormElement && !isNumpadPlusMinus && !isForwarded) return

    // Space → play/pause
    if (code === 'Space' || key === ' ') {
      if (!isForwarded) event.preventDefault?.()
      this._postToPlayer({ type: 'play-pause' })
      return
    }

    // Arrows → seek
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      if (!isForwarded) event.preventDefault?.()
      const delta = code === 'ArrowLeft' ? -10 : 10
      this._postToPlayer({ type: 'seek-relative', delta })
      return
    }

    // 1 / Numpad1 → previous visualizer
    if (code === 'Digit1' || code === 'Numpad1' || key === '1') {
      if (!isForwarded) event.preventDefault?.()
      this._postToPlayer({ type: 'cycle-visualizer', step: -1 })
      return
    }

    // 2 / Numpad2 → next visualizer
    if (code === 'Digit2' || code === 'Numpad2' || key === '2') {
      if (!isForwarded) event.preventDefault?.()
      this._postToPlayer({ type: 'cycle-visualizer', step: 1 })
      return
    }

    // Numpad +/- → cycle visualizer
    if (code === 'NumpadAdd' || key === '+') {
      if (!isForwarded) event.preventDefault?.()
      this._postToPlayer({ type: 'cycle-visualizer', step: 1 })
    } else if (code === 'NumpadSubtract' || key === '-') {
      if (!isForwarded) event.preventDefault?.()
      this._postToPlayer({ type: 'cycle-visualizer', step: -1 })
    }
  }

  // -------------------------------------------------------------------
  // Bridge messaging (Polaris Player integration)
  // -------------------------------------------------------------------

  _bridgePostModuleList(target) {
    const t = target || this.bridgeTarget
    if (!t) return
    try {
      t.postMessage({
        type: 'MODULE_LIST',
        modules: [...this.visualizerList],
        active: this.activeVisualizer,
      }, '*')
    } catch { /* */ }
  }

  _bridgePostModuleSet(ok, target) {
    const t = target || this.bridgeTarget
    if (!t) return
    try {
      t.postMessage({
        type: 'MODULE_SET',
        ok: ok === true,
        active: this.activeVisualizer,
        modules: [...this.visualizerList],
      }, '*')
    } catch { /* */ }
  }
}
