/**
 * DeepParticles
 * GPU-accelerated particle system from br-g/Deep-Audio-Visualization
 * Original by Charlie Hoey - http://charliehoey.com
 */

import * as THREE from 'three'
import App from '../../App'

class GPUParticleSystem extends THREE.Object3D {
  constructor(options) {
    super()
    
    options = options || {}
    this.PARTICLE_COUNT = options.maxParticles || 250000
    this.PARTICLE_CONTAINERS = options.containerCount || 1
    this.PARTICLES_PER_CONTAINER = Math.ceil(this.PARTICLE_COUNT / this.PARTICLE_CONTAINERS)
    this.PARTICLE_CURSOR = 0
    this.time = 0
    this.particleContainers = []
    this.rand = []
    
    // Preload random numbers
    for (let i = 100000; i > 0; i--) {
      this.rand.push(Math.random() - 0.5)
    }
    
    let randIdx = 0
    this.random = () => {
      return ++randIdx >= this.rand.length ? this.rand[randIdx = 1] : this.rand[randIdx]
    }
    
    const textureLoader = new THREE.TextureLoader()
    
    // Create particle textures procedurally instead of loading
    const noiseCanvas = document.createElement('canvas')
    noiseCanvas.width = noiseCanvas.height = 512
    const noiseCtx = noiseCanvas.getContext('2d')
    const noiseData = noiseCtx.createImageData(512, 512)
    for (let i = 0; i < noiseData.data.length; i += 4) {
      const v = Math.random() * 255
      noiseData.data[i] = noiseData.data[i + 1] = noiseData.data[i + 2] = v
      noiseData.data[i + 3] = 255
    }
    noiseCtx.putImageData(noiseData, 0, 0)
    this.particleNoiseTex = new THREE.CanvasTexture(noiseCanvas)
    this.particleNoiseTex.wrapS = this.particleNoiseTex.wrapT = THREE.RepeatWrapping
    
    // Create particle sprite texture
    const spriteCanvas = document.createElement('canvas')
    spriteCanvas.width = spriteCanvas.height = 64
    const spriteCtx = spriteCanvas.getContext('2d')
    const gradient = spriteCtx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    spriteCtx.fillStyle = gradient
    spriteCtx.fillRect(0, 0, 64, 64)
    this.particleSpriteTex = new THREE.CanvasTexture(spriteCanvas)
    this.particleSpriteTex.wrapS = this.particleSpriteTex.wrapT = THREE.RepeatWrapping
    
    // Shader material
    this.particleShaderMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0.0 },
        uScale: { value: 1.0 },
        tNoise: { value: this.particleNoiseTex },
        tSprite: { value: this.particleSpriteTex }
      },
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        uniform float uScale;
        uniform sampler2D tNoise;
        
        attribute vec3 positionStart;
        attribute float startTime;
        attribute vec3 velocity;
        attribute float turbulence;
        attribute vec3 color;
        attribute float size;
        attribute float lifeTime;
        
        varying vec4 vColor;
        varying float lifeLeft;
        
        void main() {
          vColor = vec4(color, 1.0);
          vec3 newPosition;
          vec3 v;
          
          float timeElapsed = uTime - startTime;
          lifeLeft = 1.0 - (timeElapsed / lifeTime);
          gl_PointSize = (uScale * size) * lifeLeft;
          
          v.x = (velocity.x - 0.5) * 3.0;
          v.y = (velocity.y - 0.5) * 3.0;
          v.z = (velocity.z - 0.5) * 3.0;
          
          newPosition = positionStart + (v * 10.0) * (uTime - startTime);
          
          vec3 noise = texture2D(tNoise, vec2(newPosition.x * 0.015 + (uTime * 0.05), newPosition.y * 0.02 + (uTime * 0.015))).rgb;
          vec3 noiseVel = (noise.rgb - 0.5) * 30.0;
          
          newPosition = mix(newPosition, newPosition + vec3(noiseVel * (turbulence * 5.0)), (timeElapsed / lifeTime));
          
          if (v.y > 0. && v.y < .05) {
            lifeLeft = 0.0;
          }
          
          if (v.x < -1.45) {
            lifeLeft = 0.0;
          }
          
          if (timeElapsed > 0.0) {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
          } else {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            lifeLeft = 0.0;
            gl_PointSize = 0.;
          }
        }
      `,
      fragmentShader: `
        varying vec4 vColor;
        varying float lifeLeft;
        uniform sampler2D tSprite;
        
        void main() {
          float alpha = 0.;
          
          if (lifeLeft > 0.995) {
            alpha = mix(0.0, 1.0, (lifeLeft - 0.995) / 0.005);
          } else {
            alpha = lifeLeft * 0.75;
          }
          
          vec4 tex = texture2D(tSprite, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb * tex.a, alpha * tex.a);
        }
      `
    })
    
    this.init()
  }
  
  init() {
    for (let i = 0; i < this.PARTICLE_CONTAINERS; i++) {
      const c = new GPUParticleContainer(this.PARTICLES_PER_CONTAINER, this)
      this.particleContainers.push(c)
      this.add(c)
    }
  }
  
  spawnParticle(options) {
    this.PARTICLE_CURSOR++
    if (this.PARTICLE_CURSOR >= this.PARTICLE_COUNT) {
      this.PARTICLE_CURSOR = 1
    }
    
    const currentContainer = this.particleContainers[Math.floor(this.PARTICLE_CURSOR / this.PARTICLES_PER_CONTAINER)]
    currentContainer.spawnParticle(options)
  }
  
  update(time) {
    for (let i = 0; i < this.PARTICLE_CONTAINERS; i++) {
      this.particleContainers[i].update(time)
    }
  }
  
  dispose() {
    this.particleShaderMat.dispose()
    this.particleNoiseTex.dispose()
    this.particleSpriteTex.dispose()
    
    for (let i = 0; i < this.PARTICLE_CONTAINERS; i++) {
      this.particleContainers[i].dispose()
    }
  }
}

class GPUParticleContainer extends THREE.Object3D {
  constructor(maxParticles, particleSystem) {
    super()
    
    this.PARTICLE_COUNT = maxParticles || 100000
    this.PARTICLE_CURSOR = 0
    this.time = 0
    this.offset = 0
    this.count = 0
    this.DPR = window.devicePixelRatio
    this.GPUParticleSystem = particleSystem
    this.particleUpdate = false
    
    // Geometry
    this.particleShaderGeo = new THREE.BufferGeometry()
    this.particleShaderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT * 3), 3))
    this.particleShaderGeo.setAttribute('positionStart', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT * 3), 3))
    this.particleShaderGeo.setAttribute('startTime', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT), 1))
    this.particleShaderGeo.setAttribute('velocity', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT * 3), 3))
    this.particleShaderGeo.setAttribute('turbulence', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT), 1))
    this.particleShaderGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT * 3), 3))
    this.particleShaderGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT), 1))
    this.particleShaderGeo.setAttribute('lifeTime', new THREE.BufferAttribute(new Float32Array(this.PARTICLE_COUNT), 1))
    
    this.particleShaderMat = this.GPUParticleSystem.particleShaderMat
    
    this.init()
  }
  
  spawnParticle(options) {
    options = options || {}
    
    const position = new THREE.Vector3()
    const velocity = new THREE.Vector3()
    const color = new THREE.Color()
    
    position.copy(options.position !== undefined ? options.position : new THREE.Vector3(0, 0, 0))
    velocity.copy(options.velocity !== undefined ? options.velocity : new THREE.Vector3(0, 0, 0))
    color.set(options.color !== undefined ? options.color : 0xffffff)
    
    const positionRandomness = options.positionRandomness !== undefined ? options.positionRandomness : 0
    const velocityRandomness = options.velocityRandomness !== undefined ? options.velocityRandomness : 0
    const colorRandomness = options.colorRandomness !== undefined ? options.colorRandomness : 1
    const turbulence = options.turbulence !== undefined ? options.turbulence : 1
    const lifetime = options.lifetime !== undefined ? options.lifetime : 5
    let size = options.size !== undefined ? options.size : 10
    const sizeRandomness = options.sizeRandomness !== undefined ? options.sizeRandomness : 0
    
    if (this.DPR !== undefined) size *= this.DPR
    
    const particleSystem = this.GPUParticleSystem
    const i = this.PARTICLE_CURSOR
    
    // Position
    const posAttr = this.particleShaderGeo.getAttribute('positionStart')
    posAttr.array[i * 3 + 0] = position.x + (particleSystem.random() * positionRandomness)
    posAttr.array[i * 3 + 1] = position.y + (particleSystem.random() * positionRandomness)
    posAttr.array[i * 3 + 2] = position.z + (particleSystem.random() * positionRandomness)
    
    // Velocity
    const maxVel = 2
    let velX = THREE.MathUtils.clamp((velocity.x + particleSystem.random() * velocityRandomness - (-maxVel)) / (maxVel - (-maxVel)), 0, 1)
    let velY = THREE.MathUtils.clamp((velocity.y + particleSystem.random() * velocityRandomness - (-maxVel)) / (maxVel - (-maxVel)), 0, 1)
    let velZ = THREE.MathUtils.clamp((velocity.z + particleSystem.random() * velocityRandomness - (-maxVel)) / (maxVel - (-maxVel)), 0, 1)
    
    const velAttr = this.particleShaderGeo.getAttribute('velocity')
    velAttr.array[i * 3 + 0] = velX
    velAttr.array[i * 3 + 1] = velY
    velAttr.array[i * 3 + 2] = velZ
    
    // Color
    color.r = THREE.MathUtils.clamp(color.r + particleSystem.random() * colorRandomness, 0, 1)
    color.g = THREE.MathUtils.clamp(color.g + particleSystem.random() * colorRandomness, 0, 1)
    color.b = THREE.MathUtils.clamp(color.b + particleSystem.random() * colorRandomness, 0, 1)
    
    const colorAttr = this.particleShaderGeo.getAttribute('color')
    colorAttr.array[i * 3 + 0] = color.r
    colorAttr.array[i * 3 + 1] = color.g
    colorAttr.array[i * 3 + 2] = color.b
    
    // Other attributes
    this.particleShaderGeo.getAttribute('turbulence').array[i] = turbulence
    this.particleShaderGeo.getAttribute('size').array[i] = size + particleSystem.random() * sizeRandomness
    this.particleShaderGeo.getAttribute('lifeTime').array[i] = lifetime
    this.particleShaderGeo.getAttribute('startTime').array[i] = this.time + particleSystem.random() * 2e-2
    
    if (this.offset === 0) {
      this.offset = this.PARTICLE_CURSOR
    }
    
    this.count++
    this.PARTICLE_CURSOR++
    
    if (this.PARTICLE_CURSOR >= this.PARTICLE_COUNT) {
      this.PARTICLE_CURSOR = 0
    }
    
    this.particleUpdate = true
  }
  
  init() {
    this.particleSystem = new THREE.Points(this.particleShaderGeo, this.particleShaderMat)
    this.particleSystem.frustumCulled = false
    this.add(this.particleSystem)
  }
  
  update(time) {
    this.time = time
    this.particleShaderMat.uniforms.uTime.value = time
    this.geometryUpdate()
  }
  
  geometryUpdate() {
    if (this.particleUpdate === true) {
      this.particleUpdate = false
      
      const attrs = ['positionStart', 'startTime', 'velocity', 'turbulence', 'color', 'size', 'lifeTime']
      
      attrs.forEach(attrName => {
        const attr = this.particleShaderGeo.getAttribute(attrName)
        if (this.offset + this.count < this.PARTICLE_COUNT) {
          attr.updateRange.offset = this.offset * attr.itemSize
          attr.updateRange.count = this.count * attr.itemSize
        } else {
          attr.updateRange.offset = 0
          attr.updateRange.count = -1
        }
        attr.needsUpdate = true
      })
      
      this.offset = 0
      this.count = 0
    }
  }
  
  dispose() {
    this.particleShaderGeo.dispose()
  }
}

export default class DeepParticles {
  constructor() {
    this.group = new THREE.Group()
    this.particleSystem = null
    this.tick = 0
    this.options = {
      horizontalSpeed: 0.8,
      verticalSpeed: 0.4
    }
  }

  init() {
    if (App.camera) {
      App.camera.position.set(0, 0, 34)
      App.camera.lookAt(0, 0, 0)
    }
    
    this.particleSystem = new GPUParticleSystem({
      maxParticles: 250000
    })
    
    this.group.add(this.particleSystem)
    App.holder.add(this.group)
  }

  update() {
    if (!App.audioManager || !App.bpmManager) return
    
    const bass = App.audioManager.frequencyData.low
    const mid = App.audioManager.frequencyData.mid
    const high = App.audioManager.frequencyData.high
    const intensity = (bass + mid + high) / 3
    
    this.tick += 0.02 * (1 + intensity)
    
    const spawnRate = 10000 + bass * 5000
    const hue = 180 + mid * 120
    const saturation = 50 + high * 50
    const lightness = 40 + bass * 30
    
    const position = new THREE.Vector3()
    position.x = Math.sin(this.tick * this.options.horizontalSpeed) * 20
    position.y = Math.sin(this.tick * this.options.verticalSpeed) * 10
    position.z = Math.sin(this.tick * this.options.horizontalSpeed + this.options.verticalSpeed) * 5
    
    const colorHSL = `hsl(${hue}, ${saturation}%, ${lightness}%)`
    
    const particleOptions = {
      position: position,
      color: colorHSL,
      sizeRandomness: 1.0,
      colorRandomness: 0.2,
      spawnRate: spawnRate,
      lifetime: 3 + mid * 2,
      size: 4 + bass * 2
    }
    
    const timeDelta = 0.016 // ~60fps
    for (let x = 0; x < particleOptions.spawnRate * timeDelta; x++) {
      this.particleSystem.spawnParticle(particleOptions)
    }
    
    this.particleSystem.update(this.tick)
  }

  destroy() {
    if (this.particleSystem) {
      this.particleSystem.dispose()
    }
    if (this.group) {
      this.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) obj.material.dispose()
      })
    }
  }
}
