import * as THREE from 'three'
import App from '../../App'

export default class AudioFabric extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'Audio Fabric'
    
    this.points = []
    this.springs = []
    this.mesh = null
    this.dataArray = null
    this.dampening = 0.7
    this.stiffness = 0.55
    this.neighborWeight = 0.99
    this.freqPow = 1.7
  }

  init() {
    App.holder.add(this)
    this._createFabric()
  }

  _createFabric() {
    if (!App.audioManager?.analyserNode) return
    
    const analyser = App.audioManager.analyserNode
    this.dataArray = new Uint8Array(analyser.frequencyBinCount)
    
    const numPoints = 500
    const pointsData = []
    
    // Create random points in a circular distribution
    for (let i = 0; i < numPoints; i++) {
      const mag = Math.pow(Math.random(), 0.5) * 0.9
      const rads = Math.random() * Math.PI * 2
      const position = new THREE.Vector3(
        Math.cos(rads) * mag * 8,
        Math.sin(rads) * mag * 8,
        0
      )
      
      pointsData.push({
        position: position,
        id: i,
        neighbors: [],
        frequencyBin: Math.floor((i / numPoints) * this.dataArray.length),
        spring: this._createSpring(0),
        velocity: 0
      })
    }
    
    this.points = pointsData
    
    // Create Delaunay triangulation (simplified - just connect nearby points)
    this._connectPoints()
    
    // Create mesh geometry
    this._createMesh()
  }

  _createSpring(initialValue) {
    return {
      value: initialValue,
      target: initialValue,
      velocity: 0,
      update: function(dampening, stiffness) {
        const force = (this.target - this.value) * stiffness
        this.velocity += force
        this.velocity *= dampening
        this.value += this.velocity
        return this.value
      },
      updateTarget: function(newTarget) {
        this.target = newTarget
      }
    }
  }

  _connectPoints() {
    // Simple nearest neighbor connection
    this.points.forEach((pt, i) => {
      const distances = this.points
        .map((other, j) => ({
          index: j,
          distance: pt.position.distanceTo(other.position)
        }))
        .filter(d => d.index !== i)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4) // Connect to 4 nearest neighbors
      
      pt.neighbors = distances.map(d => d.index)
    })
  }

  _createMesh() {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(this.points.length * 3)
    const colors = new Float32Array(this.points.length * 3)
    const indices = []
    
    // Set initial positions
    this.points.forEach((pt, i) => {
      positions[i * 3] = pt.position.x
      positions[i * 3 + 1] = pt.position.y
      positions[i * 3 + 2] = pt.position.z
    })
    
    // Create triangles from neighbors
    const triangleSet = new Set()
    this.points.forEach((pt, i) => {
      for (let j = 0; j < pt.neighbors.length - 1; j++) {
        for (let k = j + 1; k < pt.neighbors.length; k++) {
          const n1 = pt.neighbors[j]
          const n2 = pt.neighbors[k]
          
          // Check if these three points are all connected
          if (this.points[n1].neighbors.includes(n2)) {
            const tri = [i, n1, n2].sort((a, b) => a - b).join(',')
            if (!triangleSet.has(tri)) {
              triangleSet.add(tri)
              indices.push(i, n1, n2)
            }
          }
        }
      }
    })
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    
    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false,
      shininess: 30,
      transparent: true,
      opacity: 0.85,
      wireframe: false
    })
    
    this.mesh = new THREE.Mesh(geometry, material)
    this.add(this.mesh)
    
    // Add lights
    const light1 = new THREE.DirectionalLight(0xffffff, 0.8)
    light1.position.set(1, 1, 1)
    this.add(light1)
    
    const light2 = new THREE.DirectionalLight(0x4466ff, 0.4)
    light2.position.set(-1, -1, -0.5)
    this.add(light2)
    
    const ambientLight = new THREE.AmbientLight(0x333333)
    this.add(ambientLight)
  }

  update() {
    if (!this.mesh || !this.points.length) return
    
    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio && App.audioManager.analyserNode) {
        const analyser = App.audioManager.analyserNode
        analyser.getByteFrequencyData(this.dataArray)
        
        // Update springs based on frequency data
        this.points.forEach(pt => {
          let value = 0
          if (pt.frequencyBin !== undefined) {
            value = Math.pow(this.dataArray[pt.frequencyBin] / 255, this.freqPow)
          }
          
          // Get neighbor average
          const neighborSum = pt.neighbors.reduce((total, neighborId) => {
            return total + this.points[neighborId].spring.value
          }, 0)
          const neighborAverage = pt.neighbors.length ? neighborSum / pt.neighbors.length : 0
          
          value = Math.max(value, neighborAverage * this.neighborWeight)
          
          pt.spring.updateTarget(value)
          pt.spring.update(this.dampening, this.stiffness)
        })
        
        // Update mesh positions and colors
        const positions = this.mesh.geometry.attributes.position.array
        const colors = this.mesh.geometry.attributes.color.array
        
        this.points.forEach((pt, i) => {
          const springValue = pt.spring.value
          positions[i * 3 + 2] = springValue * 3
          
          // Color based on intensity
          const intensity = springValue * 1.2
          const hue = (intensity * 0.6 + 0.5) % 1
          const color = new THREE.Color().setHSL(hue, 0.8, 0.5)
          
          colors[i * 3] = color.r
          colors[i * 3 + 1] = color.g
          colors[i * 3 + 2] = color.b
        })
        
        this.mesh.geometry.attributes.position.needsUpdate = true
        this.mesh.geometry.attributes.color.needsUpdate = true
        this.mesh.geometry.computeVertexNormals()
        
        // Gentle rotation
        this.rotation.y += 0.002
        this.rotation.x = Math.sin(Date.now() * 0.0003) * 0.2
      }
    }
  }

  destroy() {
    if (this.mesh) {
      this.mesh.geometry.dispose()
      this.mesh.material.dispose()
    }
    
    this.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    })
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // Pulse effect on beat
    if (this.mesh) {
      this.mesh.scale.setScalar(1.05)
      setTimeout(() => {
        this.mesh.scale.setScalar(1.0)
      }, 100)
    }
  }
}
