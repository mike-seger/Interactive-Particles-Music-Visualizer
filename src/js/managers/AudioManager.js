import * as THREE from 'three'

export default class AudioManager {
  constructor() {
    this.frequencyArray = []
    this.frequencyData = {
      low: 0,
      mid: 0,
      high: 0,
    }
    this.isPlaying = false
    this.lowFrequency = 10 //10Hz to 250Hz
    this.midFrequency = 150 //150Hz to 2000Hz
    this.highFrequency = 9000 //2000Hz to 20000Hz
    this.smoothedLowFrequency = 0
    this.audioContext = null
    this.startTime = 0
    this.pauseTime = 0
    this.offset = 0
    this.outputGain = null
    this.isMuted = false
    this.isUsingMicrophone = false
    this.microphoneStream = null
    this.microphoneSource = null

    this.song = {
 //     url: 'http://localhost:8080/backup/vid_TKWp_ND-B1U.mp4',
      url: 'http://localhost:8080/player/video/user__eoy_bonus_mix_2025/vid_TKWp_ND-B1U.mp4',
    }
  }

  async loadAudioBuffer(onProgress = null) {
    const promise = new Promise((resolve, reject) => {
      // Create HTML5 audio element for streaming
      const audioElement = document.createElement('audio')
      audioElement.src = this.song.url
      audioElement.crossOrigin = 'anonymous'
      audioElement.loop = true
      audioElement.volume = 1.0
      
      // Create Web Audio API context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      
      // Create source from the streaming audio element
      const source = this.audioContext.createMediaElementSource(audioElement)
      
      // Create analyser for visualization
      const analyser = this.audioContext.createAnalyser()
      analyser.fftSize = 2048
      // Match bridge behavior: no internal smoothing, fixed dB window
      analyser.smoothingTimeConstant = 0.0
      analyser.minDecibels = -90
      analyser.maxDecibels = -25

      // Gain node to control muting without pausing audio
      this.outputGain = this.audioContext.createGain()
      
      // If we are in CANVAS mode (and presuming Polaris Player is playing the audio),
      // we must force the local visualizer audio to be muted so we don't hear double audio.
      const isCanvasMode = typeof window !== 'undefined' && window.__visualizerMode === 'canvas'
      if (isCanvasMode) {
        this.isMuted = true
      }
      
      this.outputGain.gain.value = this.isMuted ? 0 : 1
      
      // Connect: source -> analyser -> destination (speakers)
      source.connect(analyser)
      analyser.connect(this.outputGain)
      this.outputGain.connect(this.audioContext.destination)
      
      // Store references
      this.audio = audioElement
      this.analyserNode = analyser
      this.bufferLength = analyser.frequencyBinCount
      
      // Wrap analyser to match THREE.AudioAnalyser interface
      this.audioAnalyser = {
        data: new Uint8Array(analyser.frequencyBinCount),
        getFrequencyData: function() {
          analyser.getByteFrequencyData(this.data)
          return this.data
        }
      }
      
      // Track loading progress
      audioElement.addEventListener('progress', () => {
        if (audioElement.buffered.length > 0 && audioElement.duration) {
          const buffered = audioElement.buffered.end(audioElement.buffered.length - 1)
          const percent = (buffered / audioElement.duration) * 100
          if (onProgress) onProgress(percent, false)
        }
      })
      
      // Resolve when enough data is buffered to start
      audioElement.addEventListener('canplay', () => {
        if (onProgress) onProgress(100, true)
        resolve()
      }, { once: true })
      
      audioElement.addEventListener('error', reject)
      
      // Start loading
      audioElement.load()
    })
    
    return promise
  }

  async getAudioBufferForBPM(offsetSeconds = 60, durationSeconds = 30) {
    // Record from the currently playing audio stream
    return new Promise((resolve, reject) => {
      if (!this.audio || !this.audioContext) {
        reject(new Error('Audio not loaded yet'))
        return
      }
      
      console.log('Recording audio for BPM detection...')
      
      // Create a destination to record the audio
      const destination = this.audioContext.createMediaStreamDestination()
      
      // Connect analyser to destination (for recording)
      this.analyserNode.connect(destination)
      
      // Create MediaRecorder to capture audio
      const mediaRecorder = new MediaRecorder(destination.stream)
      const chunks = []
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }
      
      mediaRecorder.onstop = async () => {
        // Disconnect to avoid keeping the connection
        this.analyserNode.disconnect(destination)
        
        // Convert recorded chunks to AudioBuffer
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        
        try {
          const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
          console.log(`Recorded ${audioBuffer.duration.toFixed(2)}s for BPM detection`)
          resolve(audioBuffer)
        } catch (error) {
          reject(error)
        }
      }
      
      mediaRecorder.onerror = reject
      
      // Start recording from current playback position
      mediaRecorder.start()
      
      // Stop after duration
      setTimeout(() => {
        mediaRecorder.stop()
      }, durationSeconds * 1000)
    })
  }

  play() {
    this.audio.play()
    this.isPlaying = true
  }

  pause() {
    this.audio.pause()
    this.isPlaying = false
  }

  seek(time) {
    if (this.audio && this.audio.currentTime !== undefined) {
      this.audio.currentTime = time
    }
  }

  getCurrentTime() {
    if (this.audio && this.audio.currentTime !== undefined) {
      return this.audio.currentTime
    }
    return 0
  }

  collectAudioData() {
    this.frequencyArray = this.audioAnalyser.getFrequencyData()
  }

  analyzeFrequency() {
    // Calculate the average frequency value for each range of frequencies
    const lowFreqRangeStart = Math.floor((this.lowFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const lowFreqRangeEnd = Math.floor((this.midFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const midFreqRangeStart = Math.floor((this.midFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const midFreqRangeEnd = Math.floor((this.highFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const highFreqRangeStart = Math.floor((this.highFrequency * this.bufferLength) / this.audioContext.sampleRate)
    const highFreqRangeEnd = this.bufferLength - 1

    const lowAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, lowFreqRangeStart, lowFreqRangeEnd))
    const midAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, midFreqRangeStart, midFreqRangeEnd))
    const highAvg = this.normalizeValue(this.calculateAverage(this.frequencyArray, highFreqRangeStart, highFreqRangeEnd))

    this.frequencyData = {
      low: lowAvg,
      mid: midAvg,
      high: highAvg,
    }
  }

  calculateAverage(array, start, end) {
    let sum = 0
    for (let i = start; i <= end; i++) {
      sum += array[i]
    }
    return sum / (end - start + 1)
  }

  normalizeValue(value) {
    // Assuming the frequency values are in the range 0-256 (for 8-bit data)
    return value / 256
  }

  update() {
    if (!this.isPlaying && !this.isUsingMicrophone) return

    this.collectAudioData()
    this.analyzeFrequency()
  }

  async switchToMicrophoneSource() {
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    
    // Pause and disconnect file source if playing
    if (this.audio) {
      this.audio.pause()
      this.isPlaying = false
    }
    
    // Create microphone source
    this.microphoneStream = stream
    this.microphoneSource = this.audioContext.createMediaStreamSource(stream)
    
    // Disconnect previous source and connect microphone
    this.microphoneSource.connect(this.analyserNode)
    this.analyserNode.disconnect()
    this.analyserNode.connect(this.outputGain)
    this.outputGain.connect(this.audioContext.destination)
    
    this.isUsingMicrophone = true
    console.log('Switched to microphone source')
  }

  async switchToFileSource() {
    // Stop microphone
    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach(track => track.stop())
      this.microphoneStream = null
    }
    
    if (this.microphoneSource) {
      this.microphoneSource.disconnect()
      this.microphoneSource = null
    }
    
    this.isUsingMicrophone = false
    
    // Resume file playback
    if (this.audio) {
      this.audio.play()
      this.isPlaying = true
    }
    
    console.log('Switched to file source')
  }

  setMuted(muted) {
    this.isMuted = !!muted
    if (this.outputGain) {
      this.outputGain.gain.value = this.isMuted ? 0 : 1
    }
    if (this.audio) {
      this.audio.muted = false
    }
  }
}
