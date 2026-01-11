import * as THREE from 'three'
import App from '../../App'

// Synthwave-inspired audio visualizer with grid floor and reactive meshes

export default class SynthWave extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'SynthWave'
  }

  init() {
    App.holder.add(this)

    // Camera setup - lower angle for retro perspective
    if (App.camera) {
      App.camera.position.set(0, 8, 15)
      App.camera.lookAt(0, 0, -20)
    }

    // Create grid floor (synthwave aesthetic)
    this.createGridFloor()

    // Create outer mesh (wireframe icosahedron)
    this.createOuterMesh()

    // Create inner mesh (smaller solid sphere)
    this.createInnerMesh()

    // Create sun/moon backdrop
    this.createSun()

    // Fog for depth
    App.scene.fog = new THREE.Fog(0x000000, 20, 100)

    this.time = 0
  }

  createGridFloor() {
    const gridSize = 100
    const gridDivisions = 50

    // Main grid
    const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0xff00ff, 0x00ffff)
    gridHelper.position.y = -10
    gridHelper.position.z = -20
    this.add(gridHelper)

    // Animated plane underneath for glow effect
    const planeGeometry = new THREE.PlaneGeometry(gridSize, gridSize, 50, 50)
    const planeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        audioLow: { value: 0 },
        audioMid: { value: 0 },
        audioHigh: { value: 0 }
      },
      vertexShader: `
        uniform float time;
        uniform float audioLow;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          vUv = uv;
          vec3 pos = position;
          
          // Wave effect moving backward
          float wave = sin(pos.x * 0.5 + time) * cos(pos.y * 0.5 - time * 2.0) * audioLow;
          pos.z += wave * 2.0;
          
          vElevation = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float audioMid;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          vec3 color1 = vec3(1.0, 0.0, 1.0); // Magenta
          vec3 color2 = vec3(0.0, 1.0, 1.0); // Cyan
          vec3 color = mix(color1, color2, vUv.y);
          
          float alpha = (1.0 - vUv.y) * 0.3 + vElevation * 0.5;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      wireframe: false
    })

    this.gridPlane = new THREE.Mesh(planeGeometry, planeMaterial)
    this.gridPlane.rotation.x = -Math.PI / 2
    this.gridPlane.position.y = -10.1
    this.gridPlane.position.z = -20
    this.add(this.gridPlane)
  }

  createOuterMesh() {
    const geometry = new THREE.IcosahedronGeometry(3, 2)
    const material = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true
    })

    this.outerMesh = new THREE.Mesh(geometry, material)
    this.outerMesh.position.y = 2
    this.add(this.outerMesh)

    // Store original positions for animation
    this.outerMeshOriginalPositions = geometry.attributes.position.array.slice()
  }

  createInnerMesh() {
    const geometry = new THREE.IcosahedronGeometry(2, 3)
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: false,
      transparent: true,
      opacity: 0.6
    })

    this.innerMesh = new THREE.Mesh(geometry, material)
    this.innerMesh.position.y = 2
    this.add(this.innerMesh)

    // Store original positions
    this.innerMeshOriginalPositions = geometry.attributes.position.array.slice()
  }

  createSun() {
    // Create gradient sun/moon in background
    const sunGeometry = new THREE.CircleGeometry(8, 32)
    const sunMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color1: { value: new THREE.Color(0xff00ff) },
        color2: { value: new THREE.Color(0xff6600) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color1;
        uniform vec3 color2;
        varying vec2 vUv;

        void main() {
          vec2 center = vec2(0.5, 0.5);
          float dist = distance(vUv, center);
          vec3 color = mix(color1, color2, dist * 2.0);
          float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
          gl_FragColor = vec4(color, alpha * 0.8);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    })

    this.sun = new THREE.Mesh(sunGeometry, sunMaterial)
    this.sun.position.set(0, 5, -50)
    this.add(this.sun)
  }

  update(deltaTime) {
    const audioManager = App.audioManager

    this.time += deltaTime

    if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) {
      // Animate without audio
      this.animateWithoutAudio()
      return
    }

    // Get frequency data
    const bufferLength = audioManager.analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    audioManager.analyserNode.getByteFrequencyData(dataArray)

    // Analyze frequency bands
    const lowEnd = Math.floor(bufferLength * 0.2)
    const midEnd = Math.floor(bufferLength * 0.6)

    const lowFreq = dataArray.slice(0, lowEnd).reduce((a, b) => a + b, 0) / lowEnd / 255
    const midFreq = dataArray.slice(lowEnd, midEnd).reduce((a, b) => a + b, 0) / (midEnd - lowEnd) / 255
    const highFreq = dataArray.slice(midEnd).reduce((a, b) => a + b, 0) / (bufferLength - midEnd) / 255
    const avgFreq = dataArray.reduce((a, b) => a + b, 0) / bufferLength / 255

    // Update grid plane
    if (this.gridPlane.material.uniforms) {
      this.gridPlane.material.uniforms.time.value = this.time
      this.gridPlane.material.uniforms.audioLow.value = lowFreq * 3
      this.gridPlane.material.uniforms.audioMid.value = midFreq
      this.gridPlane.material.uniforms.audioHigh.value = highFreq
    }

    // Animate outer mesh with audio
    this.animateOuterMesh(lowFreq, midFreq, highFreq, avgFreq)

    // Animate inner mesh
    this.animateInnerMesh(lowFreq, midFreq, highFreq, avgFreq)

    // Rotate meshes
    this.outerMesh.rotation.y += 0.002 + highFreq * 0.02
    this.outerMesh.rotation.x += 0.001 + midFreq * 0.01
    this.innerMesh.rotation.y -= 0.003 + lowFreq * 0.03
    this.innerMesh.rotation.x -= 0.002
  }

  animateOuterMesh(low, mid, high, avg) {
    const positions = this.outerMesh.geometry.attributes.position.array
    const originalPositions = this.outerMeshOriginalPositions

    for (let i = 0; i < positions.length; i += 3) {
      const x = originalPositions[i]
      const y = originalPositions[i + 1]
      const z = originalPositions[i + 2]

      // Normalize to get direction
      const length = Math.sqrt(x * x + y * y + z * z)
      const nx = x / length
      const ny = y / length
      const nz = z / length

      // Displace along normal based on audio
      const displacement = (1.0 + low * 2.0 + mid * 1.5) * length
      
      positions[i] = nx * displacement
      positions[i + 1] = ny * displacement
      positions[i + 2] = nz * displacement
    }

    this.outerMesh.geometry.attributes.position.needsUpdate = true
  }

  animateInnerMesh(low, mid, high, avg) {
    const positions = this.innerMesh.geometry.attributes.position.array
    const originalPositions = this.innerMeshOriginalPositions

    for (let i = 0; i < positions.length; i += 3) {
      const x = originalPositions[i]
      const y = originalPositions[i + 1]
      const z = originalPositions[i + 2]

      const length = Math.sqrt(x * x + y * y + z * z)
      const nx = x / length
      const ny = y / length
      const nz = z / length

      // Different displacement pattern
      const displacement = (1.0 + mid * 1.5 + high * 2.0) * length
      
      positions[i] = nx * displacement
      positions[i + 1] = ny * displacement
      positions[i + 2] = nz * displacement
    }

    this.innerMesh.geometry.attributes.position.needsUpdate = true

    // Adjust opacity based on audio
    this.innerMesh.material.opacity = 0.4 + avg * 0.4
  }

  animateWithoutAudio() {
    // Gentle animation when no audio playing
    if (this.gridPlane.material.uniforms) {
      this.gridPlane.material.uniforms.time.value = this.time
      this.gridPlane.material.uniforms.audioLow.value = 0.5
      this.gridPlane.material.uniforms.audioMid.value = 0.3
    }

    this.outerMesh.rotation.y += 0.003
    this.outerMesh.rotation.x += 0.001
    this.innerMesh.rotation.y -= 0.004
    this.innerMesh.rotation.x -= 0.002
  }

  onBPMBeat(bpm, beat) {
    // Pulse effect on beat
    if (this.outerMesh) {
      const scale = 1.15
      this.outerMesh.scale.set(scale, scale, scale)
      
      // Animate back to normal
      setTimeout(() => {
        const normalScale = 1.0
        this.outerMesh.scale.set(normalScale, normalScale, normalScale)
      }, 100)
    }
  }

  destroy() {
    // Clear fog
    if (App.scene.fog) {
      App.scene.fog = null
    }

    // Dispose geometries and materials
    if (this.outerMesh) {
      this.outerMesh.geometry.dispose()
      this.outerMesh.material.dispose()
    }
    if (this.innerMesh) {
      this.innerMesh.geometry.dispose()
      this.innerMesh.material.dispose()
    }
    if (this.gridPlane) {
      this.gridPlane.geometry.dispose()
      this.gridPlane.material.dispose()
    }
    if (this.sun) {
      this.sun.geometry.dispose()
      this.sun.material.dispose()
    }

    App.holder.remove(this)
  }
}
