import { EventDispatcher } from 'three'
import { guess } from 'web-audio-beat-detector'

export default class BPMManager extends EventDispatcher {
  constructor() {
    super()
    // Initialization of beat management variables
    this.interval = 500 // Interval for beat events
    this.intervalId = null // Timer ID for beat interval
    this.bpmValue = 0 // BPM value
    this.beatActive = false // Flag indicating if we're currently on a beat
    this.beatDuration = 100 // How long the beat flag stays true (ms)
  }

  setBPM(bpm) {
    // Sets BPM and starts interval to emit beat events
    this.interval = 60000 / bpm
    clearInterval(this.intervalId)
    this.intervalId = setInterval(this.updateBPM.bind(this), this.interval)
  }

  updateBPM() {
    // Function called at each beat interval
    this.beatActive = true
    this.dispatchEvent({ type: 'beat' })
    
    // Reset beat flag after short duration
    setTimeout(() => {
      this.beatActive = false
    }, this.beatDuration)
  }

  async detectBPM(audioBuffer) {
    // Analyzes the audio buffer to detect and set BPM
    const { bpm } = await guess(audioBuffer)
    this.setBPM(bpm)
    console.log(`BPM detected: ${bpm}`)
  }

  getBPMDuration() {
    // Returns the duration of one beat
    return this.interval
  }
}
