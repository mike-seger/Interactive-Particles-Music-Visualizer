import * as THREE from 'three'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler'
import gsap from 'gsap'
import vertex from './glsl/vertex.glsl'
import fragment from './glsl/fragment.glsl'
import App from '../../App'

// https://threejs-audio-reactive-visual.netlify.app/

// Simple InstancedMesh wrapper
class InstancedParticles extends THREE.InstancedMesh {
  constructor(geometry, material, count) {
    super(geometry, material, count)
  }
}

export default class ParticleSphere extends THREE.Object3D {
  constructor() {
    super()
    this.name = 'ParticleSphere'
    this.config = {
      particlesCount: 2000,
      particlesSpeed: 0.55
    }
    this.tick = 0
  }

  init() {
    App.holder.add(this)
    
    this.mainGroup = new THREE.Group()
    this.add(this.mainGroup)
    
    // Create invisible sphere for particle sampling
    this._createSphere()
    this._createSampler()
    
    // Create background sphere
    this._createBigSphere()
    
    // Create center icosahedron
    this._createIcosahedron()
    
    // Create particles
    this._createParticles()
  }

  _createSphere() {
    const geom = new THREE.SphereGeometry(2, 32, 16)
    const mat = new THREE.MeshBasicMaterial({ visible: false })
    this.sphere = new THREE.Mesh(geom, mat)
  }

  _createSampler() {
    this.sampler = new MeshSurfaceSampler(this.sphere).build()
  }

  _createBigSphere() {
    const backgroundVertex = `
      uniform float uTime;
      varying float vColorMix;
      varying vec3 vColor;

      vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
      vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

      float snoise(vec3 v){
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + 1.0 * C.xxx;
        vec3 x2 = x0 - i2 + 2.0 * C.xxx;
        vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
        i = mod(i, 289.0);
        vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 1.0/7.0;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      vec3 palette(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
        return a + b*cos(6.28318*(c*t+d));
      }

      void main() {
        float n = snoise(position*0.2 + uTime*0.1);
        n = n*0.5 + 0.5;
        vec3 pos = position;
        vec3 dir = normalize(pos - vec3(0.0));
        pos -= dir*n*2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        vColorMix = n;
        vec3 colorA = vec3(0.5, 0.5, 0.5);
        vec3 colorB = vec3(0.5, 0.5, 0.5);
        vec3 colorC = vec3(1.0, 1.0, 1.0);
        vec3 colorD = vec3(0.00, 0.10, 0.20);
        vColor = palette(pos.x*0.1 + uTime*0.1, colorA, colorB, colorC, colorD);
      }
    `
    
    const backgroundFragment = `
      varying float vColorMix;
      varying vec3 vColor;

      void main() {
        vec3 color = vec3(0.0);
        float alpha = smoothstep(0.3, 0.8, vColorMix);
        color = mix(vec3(0.0), vColor, alpha);
        gl_FragColor = vec4(color, 1.0)*alpha;
      }
    `

    const material = new THREE.ShaderMaterial({
      fragmentShader: backgroundFragment,
      vertexShader: backgroundVertex,
      side: THREE.BackSide,
      wireframe: true,
      transparent: true,
      opacity: 0.1,
      uniforms: {
        uTime: { value: 0 }
      }
    })

    const geom = new THREE.SphereGeometry(6.5, 120, 60)
    this.bigSphere = new THREE.Mesh(geom, material)
    this.add(this.bigSphere)
  }

  _createIcosahedron() {
    const geom = new THREE.IcosahedronGeometry(1.2, 0)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    })

    this.icosahedron = new THREE.Mesh(geom, mat)
    this.mainGroup.add(this.icosahedron)
  }

  _createParticles() {
    const geom = new THREE.SphereGeometry(0.01, 16, 16)

    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 1 },
        uInfluence: { value: 0 }
      }
    })

    this.particles = new InstancedParticles(geom, material, this.config.particlesCount)

    const tempPosition = new THREE.Vector3()
    const tempObject = new THREE.Object3D()
    const center = new THREE.Vector3()
    
    // Arrays for attributes
    const directions = []
    const randoms = []

    for (let i = 0; i < this.config.particlesCount; i++) {
      this.sampler.sample(tempPosition)
      tempObject.position.copy(tempPosition)
      tempObject.scale.setScalar(0.5 + Math.random() * 0.5)
      tempObject.updateMatrix()
      this.particles.setMatrixAt(i, tempObject.matrix)

      // Set direction of the particle
      const dir = new THREE.Vector3()
      dir.subVectors(tempPosition, center).normalize()
      
      // Store in arrays for attributes
      directions.push(dir.x, dir.y, dir.z)
      randoms.push(Math.random())
    }
    
    // Add attributes to geometry
    geom.setAttribute('aDirection', new THREE.InstancedBufferAttribute(new Float32Array(directions), 3))
    geom.setAttribute('aRandom', new THREE.InstancedBufferAttribute(new Float32Array(randoms), 1))

    this.mainGroup.add(this.particles)
  }

  update() {
    if (!App.audioManager) return

    const hasSignal = App.audioManager?.isPlaying || App.audioManager?.isUsingMicrophone
    
    if (hasSignal) {
      const hasAudio = App.audioManager.frequencyData.low > 0 || 
                      App.audioManager.frequencyData.mid > 0 || 
                      App.audioManager.frequencyData.high > 0
      
      if (hasAudio) {
        // Get frequency data
        const low = App.audioManager.frequencyData.low
        const mid = App.audioManager.frequencyData.mid
        const high = App.audioManager.frequencyData.high
        
        // Overall amplitude
        const amplitude = (low + mid + high) / 3
        
        // Audio-reactive rotation - faster with more sound
        this.mainGroup.rotation.y += 0.002 * (1 + amplitude * 2)
        this.mainGroup.rotation.z += 0.0012 * (1 + amplitude * 1.5)
        this.icosahedron.rotation.x += 0.009 * (1 + amplitude * 3)
        this.bigSphere.rotation.z -= 0.003 * (1 + amplitude)
        this.bigSphere.rotation.y -= 0.001 * (1 + amplitude)

        // Update time uniform - speed varies with audio
        this.particles.material.uniforms.uTime.value += 0.05 * this.config.particlesSpeed * (1 + amplitude * 2)
        this.bigSphere.material.uniforms.uTime.value += 0.01 * (1 + amplitude * 1.5)

        // Strong particle influence from audio - makes them explode outward
        this.particles.material.uniforms.uInfluence.value = amplitude * 2.5
        
        // Icosahedron scales with bass frequencies
        const bassScale = 1 + low * 0.4
        this.icosahedron.scale.setScalar(bassScale)
        
        // Background sphere reacts to high frequencies
        this.bigSphere.material.opacity = 0.1 + high * 0.3

        // Camera orbit effect increases with mids
        this.tick += 0.01 * (1 + mid * 2)
      } else {
        // Static gentle rotation
        this.mainGroup.rotation.y += 0.001
        this.icosahedron.rotation.x += 0.004
        this.particles.material.uniforms.uTime.value += 0.02
        this.bigSphere.material.uniforms.uTime.value += 0.005
        this.particles.material.uniforms.uInfluence.value = 0
      }
    } else {
      // Audio stopped
      this.mainGroup.rotation.y += 0.001
      this.icosahedron.rotation.x += 0.004
      this.particles.material.uniforms.uTime.value += 0.02
      this.bigSphere.material.uniforms.uTime.value += 0.005
      this.particles.material.uniforms.uInfluence.value = 0
    }
  }

  destroy() {
    this.particles?.geometry?.dispose()
    this.particles?.material?.dispose()
    this.bigSphere?.geometry?.dispose()
    this.bigSphere?.material?.dispose()
    this.icosahedron?.geometry?.dispose()
    this.icosahedron?.material?.dispose()
    this.sphere?.geometry?.dispose()
    this.sphere?.material?.dispose()
    
    if (this.parent) {
      this.parent.remove(this)
    }
  }
  
  onBPMBeat() {
    // Pulse icosahedron on beat
    gsap.to(this.icosahedron.scale, {
      x: 1.3,
      y: 1.3,
      z: 1.3,
      duration: 0.1,
      ease: 'power2.out',
      onComplete: () => {
        gsap.to(this.icosahedron.scale, {
          x: 1.0,
          y: 1.0,
          z: 1.0,
          duration: 0.3,
          ease: 'power2.in'
        })
      }
    })
  }
}
