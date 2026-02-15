/**
 * Shared static state singleton.
 *
 * Both the legacy monolithic AppMonolithic class and the refactored PlayerApp
 * populate these properties at runtime.  Entity visualizers import this module
 * (`import App from '../../App'`) and read `App.holder`, `App.camera`, etc.
 */

class App {}

// Runtime-populated by PlayerApp (or AppMonolithic in legacy mode)
App.holder = null
App.camera = null
App.scene = null
App.renderer = null
App.audioManager = null
App.bpmManager = null
App.gui = null
App.visualizerType = 'Reactive Particles'
App.visualizerList = []          // populated at import-time by PlayerApp
App.currentVisualizer = null
App._milkdropNamesAppended = false

export default App
