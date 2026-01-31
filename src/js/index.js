import App from './App'
;(() => {
  // Ensure Material Symbols font loads reliably and avoid showing ligature names
  // (e.g. "volume_off") before the font is ready.
  try {
    document.documentElement.classList.remove('icons-ready')
    // NOTE: Material Symbols Rounded is loaded via <link> in index.html.
    // We also ship a local fallback font ("Local Material Symbols Rounded").

    const markReady = () => document.documentElement.classList.add('icons-ready')

    const applyIconFallbacks = () => {
      try {
        // Never show the ligature names as visible text if the font fails to load.
        const muteBtn = document.getElementById('mute-btn')
        const micBtn = document.getElementById('mic-btn')
        if (muteBtn) muteBtn.textContent = '🔊'
        if (micBtn) micBtn.textContent = '🎙️'
      } catch {
        // ignore
      }
    }

    // Trigger a load, but gate UI by an actual check.
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
          // No Font Loading API: show immediately.
          markReady()
          return true
        }
      } catch {
        // If check fails for any reason, don't block forever.
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

    // Try immediately, then poll briefly.
    if (!checkReady()) {
      const interval = setInterval(() => {
        if (checkReady()) clearInterval(interval)
      }, 50)
    }
  } catch {
    document.documentElement.classList.add('icons-ready')
  }

  new App()
})()
