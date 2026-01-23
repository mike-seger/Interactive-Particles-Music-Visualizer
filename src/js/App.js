import * as THREE from 'three'
import ReativeParticles from './entities/reactive-particles/ReactiveParticles'
import FrequencyRings from './entities/frequency-rings/FrequencyRings'
import PlasmaField from './entities/plasma/PlasmaField'
import AudioParticles from './entities/audio-particles/AudioParticles'
import Iris from './entities/iris/Iris'
import CircularWave from './entities/circular-wave/CircularWave'
import CircularAudioWave from './entities/circular-audio-wave/CircularAudioWave'
import AudioFabric from './entities/audio-fabric/AudioFabric'
import CircularSpectrum from './entities/circular-spectrum/CircularSpectrum'
import SphereLines from './entities/sphere-lines/SphereLines'
import AudibleSpiral from './entities/audible-spiral/AudibleSpiral'
import Audible3dSpiral from './entities/audible-3d-spiral/Audible3dSpiral'
import Audible3dSpiralLines from './entities/audible-3d-spiral-lines/Audible3dSpiralLines'
import AudioMesh from './entities/audio-mesh/AudioMesh'
import WaveformVisualizer from './entities/waveform-visualizer/WaveformVisualizer'
import AnimatedBlob from './entities/animated-blob/AnimatedBlob'
import WebGLBlob from './entities/webgl-blob/WebGLBlob'
import Fluid from './entities/fluid/Fluid'
import Water from './entities/water/Water'
import KevsPlasma from './entities/kevs-plasma/KevsPlasma'
import FrequencyBars from './entities/frequency-bars/FrequencyBars'
import AudioOscilloscope from './entities/oscilloscope/Oscilloscope'
import DeepParticles from './entities/deep-particles/DeepParticles'
import DeepLights from './entities/deep-lights/DeepLights'
import AudioSphere from './entities/audio-sphere/AudioSphere'
import SimplePlasma from './entities/simple-plasma/SimplePlasma'
import SparklingBoxes from './entities/sparkling-boxes/SparklingBoxes'
import TubesCursor from './entities/tubes-cursor/TubesCursor'
import RandomFlowers from './entities/random-flowers/RandomFlowers'
import Fireworks from './entities/fireworks/Fireworks'
import FireworksNight from './entities/fireworks-night/FireworksNight'
import FireworksShader from './entities/fireworks-shader/FireworksShader'
import ThreeDAudioVisualizer from './entities/3d-audio-visualizer/ThreeDAudioVisualizer'
import FrequencyVisualization from './entities/frequency-visualization/FrequencyVisualization'
import FrequencyVisualization2 from './entities/frequency-visualization2/FrequencyVisualization'
import FrequencyVisualization3 from './entities/frequency-visualization3/FrequencyVisualization'
import PulseWaves from './entities/pulse-waves/PulseWaves'
import { SHADER_VISUALIZER_NAMES, createShaderVisualizerByName } from './visualizers/shaderRegistry'
import { loadSpectrumFilters } from './spectrumFilters'
import * as dat from 'dat.gui'
import BPMManager from './managers/BPMManager'
import AudioManager from './managers/AudioManager'

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
  static visualizerList = [
    'Animated Blob',
    '3D Audio Visualizer',
    'Audible Spiral',
    'Audible 3d Spiral',
    'Audible 3d Spiral Lines',
    'Audio Fabric',
    'Audio Mesh',
    'Audio Particles',
    'Audio Sphere',
    'Circular Audio Wave',
    'Circular Spectrum',
    'Circular Wave',
    'Deep Lights',
    'Deep Particles',
    'Fireworks',
    'Fireworks Night',
    'Fireworks Shader',
    'Fluid',
    'Frequency Bars',
    'Frequency Visualization',
    'Frequency Visualization 2',
    'Frequency Visualization 3',
    'Frequency Rings',
    'Iris',
    'Sparkling Boxes',
    'Tubes Cursor',
    'Kevs Plasma',
    'Oscilloscope',
    'Plasma Field',
    'Pulse Waves',
    'Reactive Particles',
    'Random Flowers',
    'Simple Plasma',
    'Sphere Lines',
    'Water',
    'Waveform Visualizer',
    'WebGL Blob',
    ...SHADER_VISUALIZER_NAMES,
  ]

  constructor() {
    this.onClickBinder = () => this.init()
    document.addEventListener('click', this.onClickBinder)

    // Bind hotkey handler
    this.onKeyDown = (e) => this.handleKeyDown(e)

    // Bridge messaging (iframe -> parent)
    this.bridgeTarget = window.parent && window.parent !== window ? window.parent : null
    this.handleBridgeMessage = (event) => this.onBridgeMessage(event)
    window.addEventListener('message', this.handleBridgeMessage)

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

    // Toast showing the current visualizer name
    this.visualizerToast = null
    this.visualizerToastHideTimer = null

    this.storageKeys = {
      playbackPosition: 'visualizer.playbackPosition',
      visualizerType: 'visualizer.lastType',
      fv3Presets: 'visualizer.fv3.presets',
      fv3SelectedPreset: 'visualizer.fv3.selectedPreset'
    }
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
    const positionSlider = document.getElementById('position-slider')
    const timeDisplay = document.getElementById('time-display')

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
      idleTimer = setTimeout(() => {
        if (!pointerInside) hideControls()
      }, idleDelayMs)
    }

    const resetVisibility = () => {
      showControls()
      clearTimers()
      scheduleIdle()
    }

    // Make the overlay visible and interactive initially
    resetVisibility()

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
        } else {
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

    // Hotkeys: numpad + / - to cycle visualizers
    window.addEventListener('keydown', this.onKeyDown)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })

    // Expose renderer for visualizers needing post-processing
    App.renderer = this.renderer

    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.autoClear = false
    document.querySelector('.content').appendChild(this.renderer.domElement)

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

    App.gui = new dat.GUI()

    // Keep the controls visible above any full-screen overlay canvases.
    // (Some visualizers render into their own 2D canvas and may clear to black.)
    if (App.gui?.domElement) {
      const guiRoot = App.gui.domElement
      // dat.GUI autoPlace uses a wrapper (usually `.dg.ac`) for positioning.
      const guiContainer = guiRoot.parentElement || guiRoot

      guiContainer.style.position = 'fixed'
      guiContainer.style.zIndex = '2500'
      guiContainer.style.pointerEvents = 'auto'
      guiContainer.style.display = 'block'
      guiContainer.style.right = '12px'
      guiContainer.style.left = 'auto'
      guiContainer.style.top = '12px'
      guiContainer.style.maxWidth = 'calc(100vw - 24px)'
      guiContainer.style.boxSizing = 'border-box'

      // Also set on the root in case autoPlace behavior differs.
      guiRoot.style.position = 'relative'
      guiRoot.style.zIndex = '2500'
    }

    this.createManagers()

    this.resize()
    window.addEventListener('resize', () => this.resize())
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
    this.switchVisualizer(storedVisualizer || 'Reactive Particles', { notify: false })
    
    // Add visualizer switcher to GUI
    this.addVisualizerSwitcher()

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
  }

  resize() {
    this.width = window.innerWidth
    this.height = window.innerHeight

    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.width, this.height)
  }

  update() {
    requestAnimationFrame(() => this.update())

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
    activeVisualizer?.update(audioData)
    App.audioManager.update()

    // Some visualizers render into their own canvas/renderer.
    if (!activeVisualizer?.rendersSelf) {
      this.renderer.render(this.scene, this.camera)
    }
  }
  
  switchVisualizer(type, { notify = true } = {}) {
    // Normalize legacy/slugs to display names.
    if (type === 'sparkling-boxes') type = 'Sparkling Boxes'
    if (type === 'tubes-cursor') type = 'Tubes Cursor'

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
    this.renderer.clear()
    
    // Create new visualizer
    const shaderVisualizer = createShaderVisualizerByName(type)
    if (shaderVisualizer) {
      App.currentVisualizer = shaderVisualizer
    } else {
      switch (type) {
      case 'Reactive Particles':
        App.currentVisualizer = new ReativeParticles()
        break
      case 'Audible Spiral':
        App.currentVisualizer = new AudibleSpiral()
        break
      case 'Audible 3d Spiral':
        App.currentVisualizer = new Audible3dSpiral()
        break
      case 'Audible 3d Spiral Lines':
        App.currentVisualizer = new Audible3dSpiralLines()
        break
      case 'Frequency Rings':
        App.currentVisualizer = new FrequencyRings()
        break
      case 'Plasma Field':
        App.currentVisualizer = new PlasmaField()
        break
      case 'Audio Particles':
        App.currentVisualizer = new AudioParticles()
        break
      case 'Iris':
        App.currentVisualizer = new Iris()
        break
      case 'Circular Wave':
        App.currentVisualizer = new CircularWave()
        break
      case 'Circular Audio Wave':
        App.currentVisualizer = new CircularAudioWave()
        break
      case 'Audio Fabric':
        App.currentVisualizer = new AudioFabric()
        break
      case 'Random Flowers':
        App.currentVisualizer = new RandomFlowers()
        break
      case 'Circular Spectrum':
        App.currentVisualizer = new CircularSpectrum()
        break
      case 'Sphere Lines':
        App.currentVisualizer = new SphereLines()
        break
      case 'Audio Mesh':
        App.currentVisualizer = new AudioMesh()
        break
      case 'Waveform Visualizer':
        App.currentVisualizer = new WaveformVisualizer()
        break
      case 'Animated Blob':
        App.currentVisualizer = new AnimatedBlob()
        break
      case '3D Audio Visualizer':
        App.currentVisualizer = new ThreeDAudioVisualizer()
        break
      case 'WebGL Blob':
        App.currentVisualizer = new WebGLBlob()
        break
      case 'Fluid':
        App.currentVisualizer = new Fluid()
        break
      case 'Water':
        App.currentVisualizer = new Water()
        if (typeof App.currentVisualizer.setRenderer === 'function') {
          App.currentVisualizer.setRenderer(this.renderer)
        }
        break
      case 'Kevs Plasma':
        App.currentVisualizer = new KevsPlasma()
        break
      case 'Frequency Bars':
        App.currentVisualizer = new FrequencyBars()
        break
      case 'Frequency Visualization':
        App.currentVisualizer = new FrequencyVisualization()
        break
      case 'Frequency Visualization 2':
        App.currentVisualizer = new FrequencyVisualization2()
        break
      case 'Frequency Visualization 3':
        App.currentVisualizer = new FrequencyVisualization3()
        break
      case 'Oscilloscope':
        App.currentVisualizer = new AudioOscilloscope()
        break
      case 'Deep Particles':
        App.currentVisualizer = new DeepParticles()
        break
      case 'Fireworks':
        App.currentVisualizer = new Fireworks()
        break
      case 'Fireworks Night':
        App.currentVisualizer = new FireworksNight()
        break
      case 'Fireworks Shader':
        App.currentVisualizer = new FireworksShader()
        break
      case 'Deep Lights':
        App.currentVisualizer = new DeepLights()
        break
      case 'Audio Sphere':
        App.currentVisualizer = new AudioSphere()
        break
      case 'Sparkling Boxes':
        App.currentVisualizer = new SparklingBoxes()
        break
      case 'Tubes Cursor':
        App.currentVisualizer = new TubesCursor()
        break
      case 'Simple Plasma':
        App.currentVisualizer = new SimplePlasma()
        break
      case 'Pulse Waves':
        App.currentVisualizer = new PulseWaves()
        break
      default:
        App.currentVisualizer = new ReativeParticles()
      }
    }
    
    App.currentVisualizer.init()

    if (type === 'Frequency Visualization 3') {
      this.setupFrequencyViz3Controls(App.currentVisualizer)
    } else {
      this.teardownFrequencyViz3Controls()
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
    }

    console.log('Switched to visualizer:', type)

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
    // Ignore if focused on form inputs
    const target = event.target
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

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
    // Prefer updating the GUI controller so UI stays in sync and uses onChange
    if (this.visualizerController) {
      this.visualizerController.setValue(next)
    } else {
      this.switchVisualizer(next)
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

  ensureVariant3GuiStyles() {
    if (document.getElementById('fv3-gui-style')) return
    const style = document.createElement('style')
    style.id = 'fv3-gui-style'
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0,0');

      .dg.main {
        width: 445px !important;
        position: relative;
        overflow: visible;
        max-height: none !important;
      }
      .dg.main > ul {
        max-height: none !important;
        height: auto !important;
        overflow: visible !important;
      }
      .dg .folder > ul {
        max-height: none !important;
        height: auto !important;
        overflow: visible !important;
      }
      .dg .fv3-controls {
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
        max-height: 70vh;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .dg .fv3-controls .fv3-scroll {
        max-height: 60vh;
        overflow-y: auto;
        overflow-x: hidden;
        margin: 0;
        padding: 0;
      }
      .dg .fv3-controls ul {
        max-height: none;
        overflow: visible;
      }
      .dg .fv3-controls,
      .dg .fv3-controls ul {
        scrollbar-color: #2f3545 #0f1219;
      }
      .dg .fv3-controls::-webkit-scrollbar {
        width: 10px;
      }
      .dg .fv3-controls::-webkit-scrollbar-track {
        background: #0f1219;
      }
      .dg .fv3-controls::-webkit-scrollbar-thumb {
        background: #2f3545;
        border-radius: 8px;
      }
      .dg .fv3-controls::-webkit-scrollbar-thumb:hover {
        background: #3c4458;
      }
      .dg .fv3-controls ul::-webkit-scrollbar {
        width: 10px;
      }
      .dg .fv3-controls ul::-webkit-scrollbar-track {
        background: #0f1219;
      }
      .dg .fv3-controls ul::-webkit-scrollbar-thumb {
        background: #2f3545;
        border-radius: 8px;
      }
      .dg .fv3-controls ul::-webkit-scrollbar-thumb:hover {
        background: #3c4458;
      }

      /* Dark mode form controls for the top rows */
      .dg .fv3-controls select,
      .dg .fv3-controls input[type="text"],
      .dg .fv3-controls input[type="number"],
      .dg .fv3-controls input[type="checkbox"] {
        background: #161921;
        color: #e6e9f0;
        border: 1px solid #3a3f4d;
      }
      .dg .fv3-controls select:focus,
      .dg .fv3-controls input[type="text"]:focus,
      .dg .fv3-controls input[type="number"]:focus,
      .dg .fv3-controls input[type="checkbox"]:focus {
        outline: 1px solid #6ea8ff;
        border-color: #6ea8ff;
        box-shadow: 0 0 0 1px rgba(110, 168, 255, 0.25);
      }
      .dg .fv3-controls ul.closed li:not(.title) { display: none; }
      .dg .fv3-controls .cr.number { padding: 4px 4px 6px; }
      .dg .fv3-controls .cr.number .property-name { width: 40%; text-align: left; font-weight: 600; }
      .dg .fv3-controls .cr.number .c {
        width: 60%;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dg .fv3-controls .cr.number .c .slider,
      .dg .fv3-controls .cr.number .c input[type="text"] {
        float: none !important;
        box-sizing: border-box;
      }
      .dg .fv3-controls .cr.number .c .slider {
        order: 1;
        flex: 1 1 auto;
        min-width: 140px;
        height: 16px;
        position: relative;
        overflow: hidden;
      }
      .dg .fv3-controls .cr.number .c input[type="text"] {
        order: 2;
        flex: 0 0 60px;
        min-width: 60px;
        max-width: 60px;
        width: 60px !important;
        padding: 2px 4px;
        border: 1px solid #444;
        opacity: 1;
        text-align: right;
      }
      .dg .fv3-controls .slider-fg { position: relative; height: 100%; }

      .dg .fv3-controls .cr.fv3-preset-line {
        display: flex;
        align-items: center;
        padding: 4px 4px 6px;
        border-top: 1px solid #2b2f3a;
        border-bottom: 1px solid #2b2f3a;
        box-sizing: border-box;
      }
      .dg .fv3-controls .cr.fv3-load-row {
        display: flex;
        align-items: center;
        padding: 4px 4px 6px;
        border-top: 1px solid #2b2f3a;
        border-bottom: 1px solid #2b2f3a;
        box-sizing: border-box;
      }
      .dg .fv3-controls .cr.fv3-load-row .property-name {
        width: 40%;
        font-weight: 600;
        text-transform: none;
        padding-right: 6px;
      }
      .dg .fv3-controls .cr.fv3-load-row .c {
        width: 60%;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dg .fv3-controls .cr.fv3-load-row select {
        flex: 1 1 auto;
        min-width: 140px;
        background: #161921;
        color: #e6e9f0;
        border: 1px solid #444;
        border-radius: 4px;
        padding: 4px 6px;
        height: 26px;
        font-size: 12px;
      }
      .dg .fv3-controls .cr.fv3-load-row button {
        height: 26px;
        width: 36px;
        min-width: 36px;
        background: #1f2531;
        color: #e6e9f0;
        border: 1px solid #444;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
      }
      .dg .fv3-controls .cr.fv3-load-row button:hover {
        border-color: #6ea8ff;
        color: #fff;
        background: rgba(110, 168, 255, 0.08);
      }
      .dg .fv3-controls .cr.fv3-preset-line .property-name {
        width: 40%;
        font-weight: 600;
        text-transform: none;
        padding-right: 6px;
      }
      .dg .fv3-controls .cr.fv3-preset-line .c {
        width: 60%;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dg .fv3-controls .cr.fv3-preset-line select {
        flex: 1 1 auto;
        min-width: 120px;
        background: #161921;
        color: #e6e9f0;
        border: 1px solid #444;
        padding: 4px 6px;
        height: 26px;
        font-size: 12px;
      }
      .dg .fv3-controls .cr.fv3-preset-line button {
        height: 26px;
        width: 32px;
        min-width: 32px;
        background: transparent;
        color: #e6e9f0;
        border: 1px solid #444;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
      }
      .dg .fv3-controls .cr.fv3-preset-line button:hover {
        border-color: #6ea8ff;
        color: #fff;
        background: rgba(110, 168, 255, 0.08);
      }
      .dg .fv3-controls .cr.fv3-preset-line .fv3-icon {
        font-family: 'Material Symbols Rounded';
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        font-size: 18px;
        line-height: 1;
        display: inline-block;
      }

      /* Edit Presets row */
      .dg .fv3-controls .cr.fv3-edit-row {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        box-sizing: border-box;
      }
      .dg .fv3-controls .cr.fv3-edit-row .property-name {
        width: 40%;
        font-weight: 600;
        text-transform: none;
        padding-right: 6px;
      }
      .dg .fv3-controls .cr.fv3-edit-row .c {
        width: 60%;
      }
      .dg .fv3-controls .cr.fv3-edit-row button {
        width: 100%;
        height: 28px;
        border-radius: 4px;
        border: 1px solid #444;
        background: linear-gradient(90deg, #1f2531, #1b212c);
        color: #e6e9f0;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
      }
      .dg .fv3-controls .cr.fv3-edit-row button:hover {
        border-color: #6ea8ff;
        box-shadow: 0 0 0 1px rgba(110, 168, 255, 0.35);
        background: linear-gradient(90deg, #263043, #1e2535);
      }
      /* Edit Presets trigger row */
      .dg .fv3-controls .cr.fv3-edit-row {
        padding: 6px 8px;
        box-sizing: border-box;
      }
      .dg .fv3-controls .cr.fv3-edit-row button {
        width: 100%;
        height: 28px;
        border-radius: 4px;
        border: 1px solid #444;
        background: linear-gradient(90deg, #1f2531, #1b212c);
        color: #e6e9f0;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
      }
      .dg .fv3-controls .cr.fv3-edit-row button:hover {
        border-color: #6ea8ff;
        box-shadow: 0 0 0 1px rgba(110, 168, 255, 0.35);
        background: linear-gradient(90deg, #263043, #1e2535);
      }

      /* Preset overlay */
      .fv3-overlay {
        position: fixed;
        inset: 0;
        background: rgba(8, 10, 16, 0.94);
        display: none;
        align-items: flex-start;
        justify-content: center;
        z-index: 50;
        padding: 16px;
        box-sizing: border-box;
      }
      .fv3-overlay .fv3-modal {
        width: 100%;
        max-width: 460px;
        background: #0f1219;
        border: 1px solid #2b2f3a;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        color: #e6e9f0;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        padding: 10px 10px 8px;
        box-sizing: border-box;
        overflow: auto;
        max-height: 86vh;
      }
      .fv3-overlay header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .fv3-overlay h3 {
        margin: 0;
        font-size: 17px;
        letter-spacing: 0.01em;
      }
      .fv3-overlay .close-btn {
        background: transparent;
        border: 1px solid #3a3f4d;
        border-radius: 999px;
        color: #e6e9f0;
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .fv3-overlay .close-btn:hover {
        border-color: #6ea8ff;
        background: rgba(110, 168, 255, 0.08);
      }
      .fv3-overlay .row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        border-top: 1px solid #1c202a;
      }
      .fv3-overlay .row:first-of-type {
        border-top: none;
      }
      .fv3-overlay .label {
        width: 40%;
        font-weight: 600;
        font-size: 12px;
      }
      .fv3-overlay .field {
        width: 60%;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fv3-overlay input[type="text"],
      .fv3-overlay select {
        flex: 1 1 auto;
        min-width: 140px;
        background: #11141c;
        border: 1px solid #3a3f4d;
        color: #e6e9f0;
        padding: 6px 8px;
        font-size: 12px;
        border-radius: 4px;
      }
      .fv3-overlay .actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .fv3-overlay .icon-btn {
        height: 30px;
        width: 34px;
        min-width: 34px;
        background: transparent;
        color: #e6e9f0;
        border: 1px solid #3a3f4d;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
      }
      .fv3-overlay .icon-btn:hover {
        border-color: #6ea8ff;
        color: #fff;
        background: rgba(110, 168, 255, 0.08);
      }
      .fv3-overlay .fv3-icon {
        font-family: 'Material Symbols Rounded';
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        font-size: 20px;
        line-height: 1;
        display: inline-block;
      }
    `
    document.head.appendChild(style)
  }

  teardownFrequencyViz3Controls() {
    if (!this.variant3Folder) return
    const folder = this.variant3Folder
    const parent = folder.domElement?.parentElement
    if (parent && folder.domElement) {
      parent.removeChild(folder.domElement)
    }
    if (App.gui?.__folders && folder.name && App.gui.__folders[folder.name]) {
      delete App.gui.__folders[folder.name]
    }
    if (typeof App.gui?.onResize === 'function') {
      App.gui.onResize()
    }
    this.variant3Folder = null
    this.variant3Controllers = {}
    this.variant3Config = null
    this.variant3PresetState = null
    this.variant3LoadSelect = null
    this.variant3PresetRow = null
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

  setupFrequencyViz3Controls(visualizer) {
    this.teardownFrequencyViz3Controls()
    if (!visualizer || typeof visualizer.getControlParams !== 'function' || typeof visualizer.setControlParams !== 'function' || !App.gui) return

    this.ensureVariant3GuiStyles()

    this.variant3Config = { ...visualizer.getControlParams() }
    this.variant3PresetApplied = false
    const folderName = 'Frequency Viz 3 Controls'
    const folder = App.gui.addFolder(folderName)
    folder.open()

    folder.domElement.classList.add('fv3-controls')
    folder.domElement.style.position = 'relative'
    folder.domElement.style.overflowY = 'auto'
    folder.domElement.style.overflowX = 'hidden'
    folder.domElement.style.maxHeight = '70vh'
    folder.domElement.style.height = 'auto'
    const parent = folder.domElement?.parentElement
    if (parent) parent.classList.add('fv3-controls')

    if (this.variant3FolderObserver) {
      this.variant3FolderObserver.disconnect()
      this.variant3FolderObserver = null
    }
    if (folder.domElement) {
      this.variant3FolderObserver = new MutationObserver(() => {
        if (folder.domElement.classList.contains('closed')) {
          if (this.variant3Overlay) this.variant3Overlay.style.display = 'none'
          folder.domElement.style.overflow = 'hidden'
        } else {
          folder.domElement.style.overflowY = 'auto'
          folder.domElement.style.overflowX = 'hidden'
          folder.domElement.style.maxHeight = '70vh'
          folder.domElement.style.height = 'auto'
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
      return rounded
    }

    const updateSliderValueLabel = (controller, value) => {
      const slider = controller?.__slider
      const input = controller?.__input
      const display = formatValue(value, controller.__impliedStep || controller.__step || 0.01)
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
      const elems = [root, root.querySelector('ul'), ...root.querySelectorAll('ul')]
      elems.forEach((el) => {
        if (!el) return
        const isFv3 = el.classList?.contains('fv3-controls') || el.closest?.('.fv3-controls')
        if (isFv3) {
          el.style.maxHeight = '70vh'
          el.style.height = 'auto'
          el.style.overflowY = 'auto'
          el.style.overflowX = 'hidden'
        } else {
          el.style.maxHeight = 'none'
          el.style.height = 'auto'
          el.style.overflow = 'visible'
        }
      })
    }

    let isSyncingPreset = false

    const syncLoadDropdowns = (value) => {
      if (this.variant3LoadSelect) this.variant3LoadSelect.value = value || ''
      const selectEl = this.variant3LoadController?.__select
      if (selectEl) selectEl.value = value || ''
      if (this.variant3LoadController?.updateDisplay) this.variant3LoadController.updateDisplay()
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

      const updateSelect = (select) => {
        if (!select) return
        select.innerHTML = ''
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = names.length ? 'Select…' : 'No presets'
        select.appendChild(placeholder)
        names.forEach((name) => {
          const opt = document.createElement('option')
          opt.value = name
          opt.textContent = name
          select.appendChild(opt)
        })
        if (names.includes(this.variant3PresetState?.loadPreset)) {
          select.value = this.variant3PresetState.loadPreset
        } else {
          select.value = ''
        }
      }

      const updateLoadController = () => {
        const ctrl = this.variant3LoadController
        const select = ctrl?.__select
        if (!ctrl || !select) return
        select.innerHTML = ''
        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = names.length ? 'Select…' : 'No presets'
        select.appendChild(placeholder)
        names.forEach((name) => {
          const opt = document.createElement('option')
          opt.value = name
          opt.textContent = name
          select.appendChild(opt)
        })
        if (names.includes(this.variant3PresetState?.loadPreset)) {
          select.value = this.variant3PresetState.loadPreset
        } else {
          select.value = ''
        }
        if (ctrl.updateDisplay) ctrl.updateDisplay()
      }

      updateSelect(this.variant3LoadSelect)
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
        refreshLoadOptions()
      }).catch((err) => {
        console.warn('Failed to load spectrum filters', err)
      })
    }

    // Preset save/load/upload/download controls

    let overlayNameInput = null

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
          controls: roundParamsForStorage(visualizer.getControlParams()),
          visualizer: 'Frequency Visualization 3'
        }
        const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset'
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
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
      deletePreset: () => {
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
        if (!window.confirm(`Delete preset "${name}"?`)) return
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
    }

    const buildOverlay = () => {
      if (this.variant3Overlay?.parentElement) return this.variant3Overlay

      const overlay = document.createElement('div')
      overlay.className = 'fv3-overlay'
      const modal = document.createElement('div')
      modal.className = 'fv3-modal'

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
      const container = folder.__ul || folder.domElement?.querySelector('ul') || folder.domElement || App.gui?.domElement || document.body
      if (container && !container.style.position) {
        container.style.position = 'relative'
      }
      container.appendChild(overlay)
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
        }
        relaxGuiHeights()
      }
    }

    const ensureScrollContainer = () => {
      if (this.variant3ScrollContainer) return this.variant3ScrollContainer
      const listEl = folder.__ul || folder.domElement?.querySelector('ul') || folder.domElement
      if (!listEl) return null
      const scroller = document.createElement('div')
      scroller.className = 'fv3-scroll'
      listEl.appendChild(scroller)
      this.variant3ScrollContainer = scroller
      return scroller
    }

    const moveToScroller = (ctrl) => {
      const li = ctrl?.__li
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

    // Load preset dropdown (moved from overlay)
    const addLoadRow = () => {
      const li = document.createElement('li')
      li.className = 'cr fv3-load-row'
      const label = document.createElement('span')
      label.className = 'property-name'
      label.textContent = 'Load preset'

      const c = document.createElement('div')
      c.className = 'c'

      const select = document.createElement('select')
      select.addEventListener('change', (e) => {
        if (isSyncingPreset) return
        onPresetSelect(e.target.value)
      })
      this.variant3LoadSelect = select

      const editBtn = document.createElement('button')
      editBtn.type = 'button'
      editBtn.title = 'Edit presets'
      editBtn.textContent = 'Edit'
      editBtn.addEventListener('click', () => openOverlay())

      c.appendChild(select)
      c.appendChild(editBtn)

      li.appendChild(label)
      li.appendChild(c)

      const listEl = folder.__ul || folder.domElement?.querySelector('ul') || folder.domElement
      const titleLi = listEl?.querySelector('li.title')
      if (titleLi?.parentElement === listEl) {
        titleLi.insertAdjacentElement('afterend', li)
      } else if (listEl) {
        listEl.insertBefore(li, listEl.firstChild)
      }

      refreshLoadOptions()
      return li
    }

    addLoadRow()

    // Weighting / mode
    addDropdown('weightingMode', 'Weighting mode', ['ae', 'fv2'])
    addDropdown('spatialKernel', 'Smoothing kernel', ['wide', 'narrow'])
    addToggle('useBinFloor', 'Use per-bin floor')
    addDropdown('beatBoostEnabled', 'Beat accent enabled', [1, 0])
    addSlider('analyserSmoothing', 'Analyser smoothing', 0.0, 1.0, 0.01)

    // Kick / tilt (FV2 style)
    addSlider('kickHz', 'Kick center Hz', 20, 200, 1)
    addSlider('kickWidthOct', 'Kick width (oct)', 0.1, 2.0, 0.01)
    addSlider('kickBoostDb', 'Kick boost (dB)', -12, 24, 0.25)
    addSlider('subShelfDb', 'Sub shelf (dB)', -12, 24, 0.25)
    addSlider('tiltLo', 'Tilt low mult', 0.1, 3.0, 0.01)
    addSlider('tiltHi', 'Tilt high mult', 0.1, 2.5, 0.01)

    // Per-bin floor controls
    addSlider('floorAtkLow', 'Floor atk low', 0.0, 1.0, 0.01)
    addSlider('floorRelLow', 'Floor rel low', 0.0, 1.0, 0.01)
    addSlider('floorAtkHi', 'Floor atk high', 0.0, 1.0, 0.01)
    addSlider('floorRelHi', 'Floor rel high', 0.0, 1.0, 0.01)
    addSlider('floorStrengthLow', 'Floor strength low', 0.0, 1.5, 0.01)
    addSlider('floorStrengthHi', 'Floor strength high', 0.0, 1.5, 0.01)

    // Shelf / tone
    addSlider('bassFreqHz', 'Bass boost freq (Hz)', 20, 140, 1)
    addSlider('bassWidthHz', 'Boost width (Hz)', 1, 50, 1)
    addSlider('bassGainDb', 'Boost gain (dB)', -6, 30, 0.5)
    addSlider('hiRolloffDb', 'High rolloff (dB)', -24, 0, 0.5)

    // Beat accent
    addSlider('beatBoost', 'Beat boost', 0.0, 2.0, 0.05)

    // Temporal envelope
    addSlider('attack', 'Attack', 0.01, 1.0, 0.01)
    addSlider('release', 'Release', 0.01, 1.0, 0.01)
    addSlider('noiseFloor', 'Noise floor', 0.0, 0.2, 0.001)
    addSlider('peakCurve', 'Peak curve', 0.5, 4.0, 0.05)

    // dB window
    addSlider('minDb', 'Min dB', -120, -10, 1)
    addSlider('maxDb', 'Max dB', -60, 0, 1)

    // Baseline & threshold
    addSlider('baselinePercentile', 'Baseline percentile', 0.01, 0.5, 0.005)
    addSlider('baselineStrength', 'Baseline strength', 0.0, 1.0, 0.01)
    addSlider('displayThreshold', 'Display threshold', 0.0, 0.05, 0.0005)

    // AGC
    addSlider('targetPeak', 'Target peak', 0.1, 1.5, 0.01)
    addSlider('minGain', 'Min gain', 0.05, 3.0, 0.01)
    addSlider('maxGain', 'Max gain', 0.1, 5.0, 0.01)
    addSlider('agcAttack', 'AGC attack', 0.0, 1.0, 0.01)
    addSlider('agcRelease', 'AGC release', 0.0, 1.0, 0.01)

    Object.values(this.variant3Controllers).forEach((ctrl) => {
      if (ctrl?.updateDisplay) ctrl.updateDisplay()
      requestAnimationFrame(() => updateSliderValueLabel(ctrl, this.variant3Config[ctrl.property]))
    })

    // Ensure heights are unlocked after the controls are built
    requestAnimationFrame(relaxGuiHeights)
  }
  
  addVisualizerSwitcher() {
    const visualizerFolder = App.gui.addFolder('VISUALIZER TYPE')
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
  }
}
