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

    this.song = {
      //url: 'http://michaels-macmini-2023:8080/video/user__eoy_bonus_mix_2025/aud_TKWp_ND-B1U.mp3',
      url: 'http://michaels-macmini-2023:8080/video/user__eoy_bonus_mix_2025/vid_TKWp_ND-B1U.mp4',
    }
  }

  async loadAudioBuffer(onProgress = null) {
    const promise = new Promise((resolve, reject) => {
      // Create HTML5 audio element for streaming
      const audioElement = document.createElement('audio')
      audioElement.src = this.song.url
      audioElement.crossOrigin = 'anonymous'
      audioElement.loop = true
      audioElement.volume = 0.5
      
      // Create Web Audio API context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      
      // Create source from the streaming audio element
      const source = this.audioContext.createMediaElementSource(audioElement)
      
      // Create analyser for visualization
      const analyser = this.audioContext.createAnalyser()
      analyser.fftSize = 2048
      
      // Connect: source -> analyser -> destination (speakers)
      source.connect(analyser)
      analyser.connect(this.audioContext.destination)
      
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
    // Fetch a small portion of the audio file for BPM analysis
    // Estimate bytes: assume 128kbps MP3 = 16000 bytes/second
    const bytesPerSecond = 16000
    const startByte = offsetSeconds * bytesPerSecond
    const endByte = (offsetSeconds + durationSeconds) * bytesPerSecond
    
    try {
      const response = await fetch(this.song.url, {
        headers: {
          'Range': `bytes=${startByte}-${endByte}`
        }
      })
      
      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
      return audioBuffer
    } catch (error) {
      console.warn('Failed to fetch audio sample for BPM detection:', error)
      throw error
    }
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
    if (!this.isPlaying) return

    this.collectAudioData()
    this.analyzeFrequency()
  }
}
