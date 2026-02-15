import '../../scss/controls.scss'
import ControlsApp from './ControlsApp'

;(() => {
  // Forward keyboard events to the orchestrator (parent window).
  window.addEventListener('keydown', (e) => {
    if (window.parent === window) return
    try {
      window.parent.postMessage({
        source: 'controls',
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

  new ControlsApp()
})()
