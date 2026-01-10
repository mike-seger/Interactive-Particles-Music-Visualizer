import * as THREE from 'three'
import ReativeParticles from './entities/ReactiveParticles'
import * as dat from 'dat.gui'
import BPMManager from './managers/BPMManager'
import AudioManager from './managers/AudioManager'

export default class App {
  //THREE objects
  static holder = null
  static gui = null

  //Managers
  static audioManager = null
  static bpmManager = null

  constructor() {
    this.onClickBinder = () => this.init()
    document.addEventListener('click', this.onClickBinder)
  }

  init() {
    document.removeEventListener('click', this.onClickBinder)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    })

    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.autoClear = false
    document.querySelector('.content').appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 10000)
    this.camera.position.z = 12
    this.camera.frustumCulled = false

    this.scene = new THREE.Scene()
    this.scene.add(this.camera)

    App.holder = new THREE.Object3D()
    App.holder.name = 'holder'
    this.scene.add(App.holder)
    App.holder.sortObjects = false

    App.gui = new dat.GUI()

    this.createManagers()

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  initPlayerControls() {
    const controls = document.getElementById('player-controls')
    const playPauseBtn = document.getElementById('play-pause-btn')
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
        App.audioManager.play()
        playPauseBtn.textContent = '❚❚'
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
      }
      isSeeking = false
    })
    
    // Track mouse movement
    document.addEventListener('mousemove', checkMousePosition)
    
    // Update time every second
    setInterval(updateTime, 1000)
  }

  async createManagers() {
    App.audioManager = new AudioManager()
    
    // Show loading progress
    const loadingText = document.querySelector('.user_interaction')
    const originalHTML = loadingText.innerHTML
    
    await App.audioManager.loadAudioBuffer((progress, isComplete) => {
      loadingText.innerHTML = `<div style="font-family: monospace; font-size: 24px; color: white;">Loading: ${Math.round(progress)}%</div>`
    })

    loadingText.innerHTML = '<div style="font-family: monospace; font-size: 24px; color: white;">Analyzing BPM...</div>'

    App.bpmManager = new BPMManager()
    App.bpmManager.addEventListener('beat', () => {
      this.particles.onBPMBeat()
    })
    
    // Detect BPM from 30 seconds of audio starting at 60 seconds
    try {
      const bpmBuffer = await App.audioManager.getAudioBufferForBPM(60, 30)
      await App.bpmManager.detectBPM(bpmBuffer)
    } catch (e) {
      console.warn('BPM detection failed, using default:', e)
      App.bpmManager.setBPM(128) // Fallback BPM
    }

    loadingText.remove()

    App.audioManager.play()
    
    // Initialize player controls
    this.initPlayerControls()

    this.particles = new ReativeParticles()
    this.particles.init()

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

    this.particles?.update()
    App.audioManager.update()

    this.renderer.render(this.scene, this.camera)
  }
}
