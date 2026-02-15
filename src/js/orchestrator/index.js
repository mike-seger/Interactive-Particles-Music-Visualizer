/**
 * Orchestrator entry-point.
 * Loaded by index.html (the top-level page with two iframes).
 */

import '../../scss/orchestrator.scss'
import Orchestrator from './Orchestrator'

const orch = new Orchestrator()
orch.init()
