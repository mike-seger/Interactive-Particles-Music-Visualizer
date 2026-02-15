import '../../scss/player.scss'
import PlayerApp from './PlayerApp'

;(() => {
  // Ensure Material Symbols font loads reliably and avoid showing ligature names
  // (e.g. "volume_off") before the font is ready.
  try {
    document.documentElement.classList.remove('icons-ready')

    const markReady = () => document.documentElement.classList.add('icons-ready')

    const applyIconFallbacks = () => {
      try {
        const muteBtn = document.getElementById('mute-btn')
        const micBtn = document.getElementById('mic-btn')
        if (muteBtn) muteBtn.textContent = '🔊'
        if (micBtn) micBtn.textContent = '🎙️'
      } catch {
        // ignore
      }
    }

    if (document.fonts && typeof document.fonts.load === 'function') {
      try {
        void document.fonts.load("16px 'Material Symbols Rounded'")
        void document.fonts.load("16px 'Local Material Symbols Rounded'")
      } catch {
        /* ignore */
      }
    }

    const maxWaitMs = 5000
    const start = Date.now()
    const checkReady = () => {
      try {
        if (document.fonts && typeof document.fonts.check === 'function') {
          const googleReady = document.fonts.check("16px 'Material Symbols Rounded'")
          const localReady = document.fonts.check("16px 'Local Material Symbols Rounded'")
          if (googleReady || localReady) {
            markReady()
            return true
          }
        } else {
          markReady()
          return true
        }
      } catch {
        markReady()
        return true
      }

      if (Date.now() - start > maxWaitMs) {
        applyIconFallbacks()
        markReady()
        return true
      }
      return false
    }

    if (!checkReady()) {
      const interval = setInterval(() => {
        if (checkReady()) clearInterval(interval)
      }, 50)
    }
  } catch {
    document.documentElement.classList.add('icons-ready')
  }

  // Forward keyboard events to the orchestrator (parent window).
  // The orchestrator centralises all keyboard handling.
  window.addEventListener('keydown', (e) => {
    if (window.parent === window) return
    try {
      window.parent.postMessage({
        source: 'player',
        type: 'keydown',
        key: e.key,
        code: e.code,
        location: e.location,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      }, '*')
    } catch {
      // cross-origin — ignore
    }
  })

  new PlayerApp()
})()
