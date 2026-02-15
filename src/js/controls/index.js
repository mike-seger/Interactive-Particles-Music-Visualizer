/**
 * Controls popup entry point.
 *
 * Loaded by viz-controls.html when the user "pops out" the controls
 * into their own window.  Communicates with the main visualizer page
 * via BroadcastChannel.
 */
import '../../scss/controls.scss'
import ControlsApp from './ControlsApp'

new ControlsApp()
