import * as THREE from 'three'
import vertex from './glsl/vertex.glsl'
import fragment from './glsl/fragment.glsl'
import App from '../../App'

export default class Iris extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Iris'
    
    this.numBars = 128
    this.group = null
    this.dataArray = null
    this.visualArray = []
  }

  init() {
    App.holder.add(this)
    this._createIris()
  }

  _createIris() {
    this.group = new THREE.Object3D()
    
    if (!App.audioManager?.analyserNode) return
    
    const analyser = App.audioManager.analyserNode
    const bufferLength = analyser.frequencyBinCount
    this.dataArray = new Uint8Array(bufferLength)
    
    // Create radial planes forming an iris pattern
    for (let i = 0; i < this.numBars / 2; i++) {
      const uniforms = {
        uColor: { value: new THREE.Color('hsl(240, 100%, 50%)') }
      }
      
      const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertex,
        fragmentShader: fragment
      })
      
      // First plane (clockwise)
      let geometry = new THREE.PlaneGeometry(3, 500, 1, 1)
      geometry.rotateX(Math.PI / 1.8)
      geometry.translate(0, 60, 0)
      
      let plane = new THREE.Mesh(geometry, material)
      plane.rotation.z = i * (Math.PI * 2 / this.numBars) + (Math.PI / this.numBars)
      this.group.add(plane)
      
      // Second plane (counter-clockwise) - shares material
      geometry = new THREE.PlaneGeometry(3, 500, 1, 1)
      geometry.rotateX(Math.PI / 1.8)
      geometry.translate(0, 60, 0)
      
      plane = new THREE.Mesh(geometry, material)
      plane.rotation.z = -i * (Math.PI * 2 / this.numBars) - (Math.PI / this.numBars)
      this.group.add(plane)
    }
    
    this.add(this.group)
  }

  _getVisualBins(dataArray, numElements) {
    const SpectrumStart = 4
    const SpectrumEnd = 1300
    const SpectrumBarCount = numElements
    
    const SamplePoints = []
    const MaxSamplePoints = []
    const NewArray = []
    
    // Calculate sample points with exponential distribution
    let LastSpot = 0
    for (let i = 0; i < SpectrumBarCount; i++) {
      const ease = Math.pow(i / SpectrumBarCount, 2.55)
      let Bin = Math.round(ease * (SpectrumEnd - SpectrumStart) + SpectrumStart)
      if (Bin <= LastSpot) {
        Bin = LastSpot + 1
      }
      LastSpot = Bin
      SamplePoints[i] = Bin
    }
    
    // Find max values in each bin range
    for (let i = 0; i < SpectrumBarCount; i++) {
      const CurSpot = SamplePoints[i]
      const NextSpot = SamplePoints[i + 1] || SpectrumEnd
      
      let CurMax = dataArray[CurSpot]
      let MaxSpot = CurSpot
      const Dif = NextSpot - CurSpot
      
      for (let j = 1; j < Dif; j++) {
        const NewSpot = CurSpot + j
        if (dataArray[NewSpot] > CurMax) {
          CurMax = dataArray[NewSpot]
          MaxSpot = NewSpot
        }
      }
      MaxSamplePoints[i] = MaxSpot
    }
    
    // Average adjacent max points
    for (let i = 0; i < SpectrumBarCount; i++) {
      const CurSpot = SamplePoints[i]
      const NextMaxSpot = MaxSamplePoints[i]
      const LastMaxSpot = MaxSamplePoints[i - 1] || SpectrumStart
      const LastMax = dataArray[LastMaxSpot]
      const NextMax = dataArray[NextMaxSpot]
      
      NewArray[i] = (LastMax + NextMax) / 2
      if (isNaN(NewArray[i])) {
        NewArray[i] = 0
      }
    }
    
    return NewArray
  }

  _getLoudness(arr) {
    let sum = 0
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i]
    }
    return sum / arr.length
  }

  _modn(n, m) {
    return ((n % m) + m) % m
  }

  _setUniformColor(groupI, loudness) {
    if (!this.group || !this.group.children[groupI]) return
    
    const h = this._modn(250 - (loudness * 2.2), 360)
    this.group.children[groupI].material.uniforms.uColor.value = new THREE.Color(`hsl(${h}, 100%, 50%)`)
  }

  update() {
    if (!this.group) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio && App.audioManager.analyserNode) {
        const analyser = App.audioManager.analyserNode
        analyser.getByteFrequencyData(this.dataArray)
        
        const loudness = this._getLoudness(this.dataArray)
        this.visualArray = this._getVisualBins(this.dataArray, this.numBars)
        
        for (let i = 0; i < this.visualArray.length / 2; i++) {
          // Update color based on loudness
          this._setUniformColor(i * 2, loudness)
          
          // Update geometry for both planes
          const audioValue = this.visualArray[i] / 2 + (65 + loudness / 1.5)
          
          // First plane (clockwise)
          if (this.group.children[i * 2] && this.group.children[i * 2].geometry) {
            const positions = this.group.children[i * 2].geometry.attributes.position.array
            positions[7] = audioValue  // Y coordinate of vertex
            positions[10] = audioValue // Y coordinate of vertex
            this.group.children[i * 2].geometry.attributes.position.needsUpdate = true
          }
          
          // Second plane (counter-clockwise)
          if (this.group.children[i * 2 + 1] && this.group.children[i * 2 + 1].geometry) {
            const positions = this.group.children[i * 2 + 1].geometry.attributes.position.array
            positions[7] = audioValue
            positions[10] = audioValue
            this.group.children[i * 2 + 1].geometry.attributes.position.needsUpdate = true
          }
        }
      }
    }
  }

  destroy() {
    if (this.group) {
      this.group.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      
      this.remove(this.group)
      this.group = null
    }
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // Could add a pulse effect on beat
  }
}
