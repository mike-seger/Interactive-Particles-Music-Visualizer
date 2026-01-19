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
  
  //Visualizer management
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

    // Toast showing the current visualizer name
    this.visualizerToast = null
    this.visualizerToastHideTimer = null

    this.storageKeys = {
      playbackPosition: 'visualizer.playbackPosition',
      visualizerType: 'visualizer.lastType'
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

  initPlayerControls() {
    const controls = document.getElementById('player-controls')
    const playPauseBtn = document.getElementById('play-pause-btn')
    const muteBtn = document.getElementById('mute-btn')
    const micBtn = document.getElementById('mic-btn')
    const positionSlider = document.getElementById('position-slider')
    const timeDisplay = document.getElementById('time-display')
    let hideTimer = null
    let isVisible = false
    let isSeeking = false
    
    // Update time display and slider position
    const updateTime = () => {
      if (App.audioManager && App.audioManager.audio && !isSeeking) {
        const current = App.audioManager.getCurrentTime()
        const duration = App.audioManager.audio.duration || 0
        const currentMins = Math.floor(current / 60)
        const currentSecs = Math.floor(current % 60)
        const durationMins = Math.floor(duration / 60)
        const durationSecs = Math.floor(duration % 60)
        timeDisplay.textContent = `${currentMins}:${currentSecs.toString().padStart(2, '0')} / ${durationMins}:${durationSecs.toString().padStart(2, '0')}`
        
        // Update slider position
        const percentage = (current / duration) * 100
        positionSlider.value = percentage

        if (duration > 0) {
          this.savePlaybackPosition(current)
        }
      }
    }
    
    // Show controls
    const showControls = () => {
      if (!isVisible) {
        controls.style.opacity = '1'
        controls.style.pointerEvents = 'auto'
        isVisible = true
      }
      clearTimeout(hideTimer)
    }
    
    // Hide controls after delay
    const scheduleHide = () => {
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        controls.style.opacity = '0'
        controls.style.pointerEvents = 'none'
        isVisible = false
      }, 5000)
    }
    
    // Mouse enter trigger area (bottom right 200x80)
    const checkMousePosition = (e) => {
      const triggerX = window.innerWidth - 220
      const triggerY = window.innerHeight - 100
      
      if (e.clientX >= triggerX && e.clientY >= triggerY) {
        showControls()
        scheduleHide()
      }
    }
    
    // Controls hover - keep visible
    controls.addEventListener('mouseenter', () => {
      showControls()
      clearTimeout(hideTimer)
    })
    
    controls.addEventListener('mouseleave', () => {
      scheduleHide()
    })
    
    // Play/Pause button
    playPauseBtn.addEventListener('click', () => {
      if (App.audioManager.isPlaying) {
        App.audioManager.pause()
        playPauseBtn.textContent = '▶'
      } else {
        this.restoreSessionOnPlay()
        App.audioManager.play()
        playPauseBtn.textContent = '❚❚'
      }
    })
    
    // Mute button
    muteBtn.addEventListener('click', () => {
      if (App.audioManager.audio) {
        App.audioManager.audio.muted = !App.audioManager.audio.muted
        if (App.audioManager.audio.muted) {
          muteBtn.classList.add('active')
        } else {
          muteBtn.classList.remove('active')
        }
      }
    })
    
    // Microphone button
    micBtn.addEventListener('click', async () => {
      const wasUsingMic = App.audioManager.isUsingMicrophone
      
      if (wasUsingMic) {
        // Switch back to file source
        await App.audioManager.switchToFileSource()
        micBtn.classList.remove('active')
      } else {
        // Switch to microphone
        try {
          await App.audioManager.switchToMicrophoneSource()
          micBtn.classList.add('active')
        } catch (error) {
          console.error('Failed to access microphone:', error)
          let errorMessage = 'Failed to access microphone. '
          
          if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += 'Please allow microphone access in your browser settings.'
          } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage += 'No microphone found on your device.'
          } else if (error.name === 'NotSupportedError') {
            errorMessage += 'Microphone access is not supported (try using HTTPS).'
          } else {
            errorMessage += error.message || 'Unknown error.'
          }
          
          alert(errorMessage)
        }
      }
    })
    
    // Position slider - seeking
    positionSlider.addEventListener('mousedown', () => {
      isSeeking = true
    })
    
    positionSlider.addEventListener('mouseup', () => {
      isSeeking = false
    })
    
    positionSlider.addEventListener('input', (e) => {
      if (App.audioManager && App.audioManager.audio) {
        const duration = App.audioManager.audio.duration || 0
        const seekTime = (e.target.value / 100) * duration
        
        // Update time display immediately
        const seekMins = Math.floor(seekTime / 60)
        const seekSecs = Math.floor(seekTime % 60)
        const durationMins = Math.floor(duration / 60)
        const durationSecs = Math.floor(duration % 60)
        timeDisplay.textContent = `${seekMins}:${seekSecs.toString().padStart(2, '0')} / ${durationMins}:${durationSecs.toString().padStart(2, '0')}`
      }
    })
    
    positionSlider.addEventListener('change', (e) => {
      if (App.audioManager && App.audioManager.audio) {
        const duration = App.audioManager.audio.duration || 0
        const seekTime = (e.target.value / 100) * duration
        
        // Seek to the new position
        App.audioManager.seek(seekTime)
        this.savePlaybackPosition(seekTime)
      }
      isSeeking = false
    })
    
    // Track mouse movement
    document.addEventListener('mousemove', checkMousePosition)
    
    // Update time every second
    setInterval(updateTime, 1000)

    // Best-effort save on reload/navigation as well.
    window.addEventListener('beforeunload', () => {
      if (!App.audioManager || !App.audioManager.audio || App.audioManager.isUsingMicrophone) return
      this.savePlaybackPosition(App.audioManager.getCurrentTime())
    })
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

  ensureVariant3GuiStyles() {
    if (document.getElementById('fv3-gui-style')) return
    const style = document.createElement('style')
    style.id = 'fv3-gui-style'
    style.textContent = `
      .dg.main { width: 445px !important; }
      .dg .fv3-controls { width: 100%; max-width: 100%; box-sizing: border-box; }
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
  }

  setupFrequencyViz3Controls(visualizer) {
    this.teardownFrequencyViz3Controls()
    if (!visualizer || typeof visualizer.getControlParams !== 'function' || typeof visualizer.setControlParams !== 'function' || !App.gui) return

    this.ensureVariant3GuiStyles()

    this.variant3Config = { ...visualizer.getControlParams() }
    const folderName = 'Frequency Viz 3 Controls'
    const folder = App.gui.addFolder(folderName)
    folder.open()

    folder.domElement.classList.add('fv3-controls')
    const parent = folder.domElement?.parentElement
    if (parent) parent.classList.add('fv3-controls')

    this.variant3Folder = folder
    this.variant3Controllers = {}

    const formatValue = (value, step) => {
      if (!Number.isFinite(value)) return ''
      const s = Number.isFinite(step) ? step : 0.01
      const mag = Math.abs(s)
      const decimals = mag >= 1 ? 0 : mag >= 0.1 ? 1 : mag >= 0.01 ? 2 : 3
      return value.toFixed(decimals)
    }

    const updateSliderValueLabel = (controller, value) => {
      const slider = controller?.__slider
      const input = controller?.__input
      const display = formatValue(value, controller.__impliedStep || controller.__step || 0.01)
      if (input) input.value = display
      if (controller?.updateDisplay) controller.updateDisplay()
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
      // Initialize displayed value (async to allow DOM paint)
      requestAnimationFrame(() => updateSliderValueLabel(ctrl, this.variant3Config[prop]))
      return ctrl
    }

    addSlider('bassFreqHz', 'Bass boost freq (Hz)', 20, 140, 1)
    addSlider('bassWidthHz', 'Boost width (Hz)', 1, 50, 1)
    addSlider('bassGainDb', 'Boost gain (dB)', -6, 30, 0.5)
    addSlider('hiRolloffDb', 'High rolloff (dB)', -24, 0, 0.5)

    Object.values(this.variant3Controllers).forEach((ctrl) => {
      if (ctrl?.updateDisplay) ctrl.updateDisplay()
      requestAnimationFrame(() => updateSliderValueLabel(ctrl, this.variant3Config[ctrl.property]))
    })
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
