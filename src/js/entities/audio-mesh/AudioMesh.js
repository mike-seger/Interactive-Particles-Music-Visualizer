import * as THREE from 'three'
import App from '../../App'

// Based on https://github.com/santosharron/audio-visualizer-three-js
// https://santosharron.github.io/audio-visualizer-three-js/

// Simple 3D noise function (smoother perlin-like noise)
class SimplexNoise {
  constructor() {
    this.perm = new Array(512)
    for (let i = 0; i < 256; i++) {
      this.perm[i] = this.perm[i + 256] = Math.floor(Math.random() * 256)
    }
  }

  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10)
  }

  lerp(t, a, b) {
    return a + t * (b - a)
  }

  grad(hash, x, y, z) {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  noise3D(x, y, z) {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255

    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)

    const u = this.fade(x)
    const v = this.fade(y)
    const w = this.fade(z)

    const A = this.perm[X] + Y
    const AA = this.perm[A] + Z
    const AB = this.perm[A + 1] + Z
    const B = this.perm[X + 1] + Y
    const BA = this.perm[B] + Z
    const BB = this.perm[B + 1] + Z

    return this.lerp(w,
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z)),
        this.lerp(u, this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z))
      ),
      this.lerp(v,
        this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
        this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1))
      )
    )
  }
}

const noise = new SimplexNoise()

export default class AudioMesh extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'AudioMesh'
    this.group = new THREE.Group()
  }

  init() {
    App.holder.add(this)
    
    // Create grid floor
    const planeGeometry = new THREE.PlaneGeometry(800, 800, 20, 20)
    const planeMaterial = new THREE.MeshBasicMaterial({
      color: 0x8844ff,
      side: THREE.DoubleSide,
      wireframe: true,
      transparent: true,
      opacity: 1.0
    })

    
    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.rotation.x = -0.5 * Math.PI
    plane.position.set(0, -30, 0)
    this.group.add(plane)
    this.plane = plane
    
    const plane2 = new THREE.Mesh(planeGeometry.clone(), planeMaterial.clone())
    plane2.rotation.x = -0.5 * Math.PI
    plane2.position.set(0, 30, 0)
    this.group.add(plane2)
    this.plane2 = plane2
    
    // Create icosahedron (main visualizer ball)
    const ballRadius = 2
    const icosahedronGeometry = new THREE.IcosahedronGeometry(ballRadius, 14)
    const lambertMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true
    })
    
    this.ball = new THREE.Mesh(icosahedronGeometry, lambertMaterial)
    this.ball.position.set(0, 0, 0)
    this.group.add(this.ball)
    this.ballRadius = ballRadius
    
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xaaaaaa)
    this.group.add(ambientLight)
    
    // Spot light
    const spotLight = new THREE.SpotLight(0xffffff)
    spotLight.intensity = 1.5
    spotLight.position.set(-30, 140, 20)
    spotLight.lookAt(this.ball)
    spotLight.castShadow = true;
    this.group.add(spotLight)
    
    this.add(this.group)
    
    // Store original positions for BufferGeometry
    this.originalPlanePositions = this.plane.geometry.attributes.position.array.slice()
    this.originalPlane2Positions = this.plane2.geometry.attributes.position.array.slice()
    this.originalBallPositions = this.ball.geometry.attributes.position.array.slice()
    
    App.camera.position.set(0, 0, 200)
    App.camera.lookAt(0, 0, 0)
  }

  update(deltaTime) {
    const audioManager = App.audioManager
    
    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) {
      return
    }
    
    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(dataArray)
    
    // Split frequency data into lower and upper half
    const lowerHalfArray = dataArray.slice(0, Math.floor(dataArray.length / 2))
    const upperHalfArray = dataArray.slice(Math.floor(dataArray.length / 2))
    
    const lowerMax = Math.max(...lowerHalfArray)
    const upperAvg = upperHalfArray.reduce((a, b) => a + b, 0) / upperHalfArray.length
    
    const lowerMaxFr = lowerMax / 255
    const upperAvgFr = upperAvg / 255
    
    // Modulate values for ground distortion
    const groundDistortion = this.modulate(upperAvgFr, 0, 1, 0.5, 4)
    const ground2Distortion = this.modulate(lowerMaxFr, 0, 1, 0.5, 4)
    
    // Distort ground planes
    this.makeRoughGround(this.plane, this.originalPlanePositions, groundDistortion)
    this.makeRoughGround(this.plane2, this.originalPlane2Positions, ground2Distortion)
    
    // Distort ball
    const bassFr = this.modulate(Math.pow(lowerMaxFr, 0.8), 0, 1, 0, this.ballRadius * 0.8)
    const treFr = this.modulate(upperAvgFr, 0, 1, 0, 4)
    this.makeRoughBall(this.ball, this.originalBallPositions, bassFr, treFr)
    
    // Rotate group
    this.group.rotation.y += 0.005
  }

    // makeRoughBall(mesh, originalPositions, bassFr, treFr) {
    //     mesh.geometry.vertices.forEach(function (vertex, i) {
    //         var offset = mesh.geometry.parameters.radius;
    //         var amp = 7;
    //         var time = window.performance.now();
    //         vertex.normalize();
    //         var rf = 0.00001;
    //         var distance = (offset + bassFr ) + noise.noise3D(vertex.x + time *rf*7, vertex.y +  time*rf*8, vertex.z + time*rf*9) * amp * treFr;
    //         vertex.multiplyScalar(distance);
    //     });
    //     mesh.geometry.verticesNeedUpdate = true;
    //     mesh.geometry.normalsNeedUpdate = true;
    //     mesh.geometry.computeVertexNormals();
    //     mesh.geometry.computeFaceNormals();
    // }

  makeRoughBall(mesh, originalPositions, bassFr, treFr) {
    const time = window.performance.now()
    const positions = mesh.geometry.attributes.position.array
    const offset = mesh.geometry.parameters.radius
    const amp = offset * 0.7  // Scale amplitude with ball size
    const rf = 0.00001
    
    for (let i = 0; i < positions.length; i += 3) {
      // Get original position
      let x = originalPositions[i]
      let y = originalPositions[i + 1]
      let z = originalPositions[i + 2]
      
      // Normalize (same as vertex.normalize())
      const length = Math.sqrt(x * x + y * y + z * z)
      x = x / length
      y = y / length
      z = z / length
      
      // Apply 3D noise-based distortion (same as original)
      const distance = (offset + bassFr) + noise.noise3D(
        x + time * rf * 7,
        y + time * rf * 8,
        z + time * rf * 9
      ) * amp * treFr
      
      // Multiply scalar (same as vertex.multiplyScalar(distance))
      positions[i] = x * distance
      positions[i + 1] = y * distance
      positions[i + 2] = z * distance
    }
    
    mesh.geometry.attributes.position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }

  makeRoughGround(mesh, originalPositions, distortionFr) {
    const time = Date.now()
    const positions = mesh.geometry.attributes.position.array
    const amp = 2
    
    for (let i = 0; i < positions.length; i += 3) {
      // Reset to original position
      const x = originalPositions[i]
      const y = originalPositions[i + 1]
      
      positions[i] = x
      positions[i + 1] = y
      
      // Apply noise-based distortion
      const distance = (Math.sin(x * 0.01 + time * 0.0003) * Math.cos(y * 0.01 + time * 0.0001)) * distortionFr * amp
      positions[i + 2] = distance
    }
    
    mesh.geometry.attributes.position.needsUpdate = true
    mesh.geometry.computeVertexNormals()
  }

  modulate(val, minVal, maxVal, outMin, outMax) {
    const fr = (val - minVal) / (maxVal - minVal)
    const delta = outMax - outMin
    return outMin + (fr * delta)
  }

  onBPMBeat(bpm, beat) {
    // Optional: add beat response
  }

  destroy() {
    if (this.ball) {
      this.ball.geometry.dispose()
      this.ball.material.dispose()
    }
    
    if (this.plane) {
      this.plane.geometry.dispose()
      this.plane.material.dispose()
    }
    
    if (this.plane2) {
      this.plane2.geometry.dispose()
      this.plane2.material.dispose()
    }
    
    App.holder.remove(this)
  }
}
