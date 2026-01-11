import * as THREE from 'three';
import App from '../../App';

export default class Water {
    constructor() {
        this.container = new THREE.Object3D();
        this.container.name = 'Water';
        
        // Water simulation parameters
        this.width = 256;
        this.height = 256;
        this.waterLevel = 0.5;
        
        // Audio reactivity
        this.lastBeat = false;
        this.rippleTimer = 0;
        this.autoRippleInterval = 2.0; // seconds
        
        // Create render targets for height map double buffering
        const options = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        };
        
        this.target1 = new THREE.WebGLRenderTarget(this.width, this.height, options);
        this.target2 = new THREE.WebGLRenderTarget(this.width, this.height, options);
        
        // Create scenes for computation
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }
    
    init() {
        App.holder.add(this.container);
        // Create the water plane mesh
        const geometry = new THREE.PlaneGeometry(20, 20, 200, 200);
        
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uHeightMap: { value: this.target1.texture },
                uTime: { value: 0 },
                uWaterColor: { value: new THREE.Color(0x0066aa) },
                uFresnelColor: { value: new THREE.Color(0x88ccff) },
                uBassIntensity: { value: 0 },
                uMidIntensity: { value: 0 },
                uHighIntensity: { value: 0 }
            },
            vertexShader: this.getVertexShader(),
            fragmentShader: this.getFragmentShader(),
            side: THREE.DoubleSide
        });
        
        this.waterMesh = new THREE.Mesh(geometry, material);
        this.waterMesh.rotation.x = -Math.PI / 3;
        this.container.add(this.waterMesh);
        
        // Create update material for height map simulation
        this.updateMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: null },
                uDelta: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
                uDamping: { value: 0.99 }
            },
            vertexShader: this.getUpdateVertexShader(),
            fragmentShader: this.getUpdateFragmentShader()
        });
        
        // Create drop material for adding ripples
        this.dropMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: null },
                uCenter: { value: new THREE.Vector2(0.5, 0.5) },
                uRadius: { value: 0.03 },
                uStrength: { value: 0.5 }
            },
            vertexShader: this.getUpdateVertexShader(),
            fragmentShader: this.getDropFragmentShader()
        });
        
        // Create a plane for computation
        const planeGeom = new THREE.PlaneGeometry(2, 2);
        this.computePlane = new THREE.Mesh(planeGeom, this.updateMaterial);
        this.scene.add(this.computePlane);
    }
    
    getVertexShader() {
        return `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            uniform sampler2D uHeightMap;
            
            void main() {
                vUv = uv;
                
                // Sample height map
                vec4 heightData = texture2D(uHeightMap, uv);
                float height = heightData.r;
                
                // Calculate normals from height map
                float texelSize = 1.0 / 256.0;
                float heightL = texture2D(uHeightMap, uv + vec2(-texelSize, 0.0)).r;
                float heightR = texture2D(uHeightMap, uv + vec2(texelSize, 0.0)).r;
                float heightU = texture2D(uHeightMap, uv + vec2(0.0, texelSize)).r;
                float heightD = texture2D(uHeightMap, uv + vec2(0.0, -texelSize)).r;
                
                vec3 norm = normalize(vec3(heightL - heightR, 2.0 * texelSize, heightD - heightU));
                vNormal = normalMatrix * norm;
                
                // Displace vertex
                vec3 pos = position;
                pos.z += height * 2.0;
                
                vPosition = (modelViewMatrix * vec4(pos, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `;
    }
    
    getFragmentShader() {
        return `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            uniform vec3 uWaterColor;
            uniform vec3 uFresnelColor;
            uniform float uBassIntensity;
            uniform float uMidIntensity;
            uniform float uHighIntensity;
            
            void main() {
                // Fresnel effect
                vec3 viewDir = normalize(-vPosition);
                float fresnel = pow(1.0 - dot(viewDir, vNormal), 3.0);
                
                // Audio reactive color mixing
                vec3 bassColor = vec3(0.0, 0.3, 0.8) * uBassIntensity;
                vec3 midColor = vec3(0.0, 0.8, 0.8) * uMidIntensity;
                vec3 highColor = vec3(0.5, 1.0, 1.0) * uHighIntensity;
                
                vec3 audioColor = bassColor + midColor + highColor;
                vec3 finalWaterColor = mix(uWaterColor, uWaterColor + audioColor, 0.5);
                
                // Mix water color with fresnel
                vec3 color = mix(finalWaterColor, uFresnelColor, fresnel);
                
                // Add some ambient lighting
                float diffuse = max(dot(vNormal, normalize(vec3(1.0, 1.0, 1.0))), 0.0);
                color = color * (0.3 + 0.7 * diffuse);
                
                // Add specular highlights
                vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
                vec3 reflectDir = reflect(-lightDir, vNormal);
                float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
                color += vec3(1.0) * spec * 0.5;
                
                gl_FragColor = vec4(color, 1.0);
            }
        `;
    }
    
    getUpdateVertexShader() {
        return `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `;
    }
    
    getUpdateFragmentShader() {
        return `
            uniform sampler2D uTexture;
            uniform vec2 uDelta;
            uniform float uDamping;
            varying vec2 vUv;
            
            void main() {
                // Get current height and velocity
                vec4 data = texture2D(uTexture, vUv);
                float height = data.r;
                float velocity = data.g;
                
                // Sample neighbors
                float heightL = texture2D(uTexture, vUv + vec2(-uDelta.x, 0.0)).r;
                float heightR = texture2D(uTexture, vUv + vec2(uDelta.x, 0.0)).r;
                float heightU = texture2D(uTexture, vUv + vec2(0.0, uDelta.y)).r;
                float heightD = texture2D(uTexture, vUv + vec2(0.0, -uDelta.y)).r;
                
                // Wave equation: acceleration = (average of neighbors) - current height
                float acceleration = (heightL + heightR + heightU + heightD) * 0.25 - height;
                
                // Update velocity and height
                velocity += acceleration;
                velocity *= uDamping;
                height += velocity;
                
                gl_FragColor = vec4(height, velocity, 0.0, 1.0);
            }
        `;
    }
    
    getDropFragmentShader() {
        return `
            uniform sampler2D uTexture;
            uniform vec2 uCenter;
            uniform float uRadius;
            uniform float uStrength;
            varying vec2 vUv;
            
            void main() {
                vec4 data = texture2D(uTexture, vUv);
                
                float dist = distance(vUv, uCenter);
                float drop = max(0.0, 1.0 - dist / uRadius);
                drop = 0.5 - cos(drop * 3.14159) * 0.5;
                
                data.r += drop * uStrength;
                
                gl_FragColor = data;
            }
        `;
    }
    
    addDrop(x, y, radius, strength) {
        // Swap targets
        const temp = this.target1;
        this.target1 = this.target2;
        this.target2 = temp;
        
        // Update uniforms
        this.dropMaterial.uniforms.uTexture.value = this.target2.texture;
        this.dropMaterial.uniforms.uCenter.value.set(x, y);
        this.dropMaterial.uniforms.uRadius.value = radius;
        this.dropMaterial.uniforms.uStrength.value = strength;
        
        // Render
        this.computePlane.material = this.dropMaterial;
        const renderer = this.renderer; // Will be set from update
        if (renderer) {
            const currentTarget = renderer.getRenderTarget();
            renderer.setRenderTarget(this.target1);
            renderer.render(this.scene, this.camera);
            renderer.setRenderTarget(currentTarget);
        }
    }
    
    updateWater(delta) {
        if (!this.renderer) return;
        
        // Swap targets
        const temp = this.target1;
        this.target1 = this.target2;
        this.target2 = temp;
        
        // Update simulation
        this.updateMaterial.uniforms.uTexture.value = this.target2.texture;
        this.computePlane.material = this.updateMaterial;
        
        const currentTarget = this.renderer.getRenderTarget();
        this.renderer.setRenderTarget(this.target1);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(currentTarget);
        
        // Update water mesh texture
        this.waterMesh.material.uniforms.uHeightMap.value = this.target1.texture;
    }
    
    update(audioData) {
        if (!audioData) return;
        
        const { frequencies, isBeat } = audioData;
        const bass = frequencies.bass || 0;
        const mid = frequencies.mid || 0;
        const high = frequencies.high || 0;
        
        // Update audio uniforms
        this.waterMesh.material.uniforms.uBassIntensity.value = bass;
        this.waterMesh.material.uniforms.uMidIntensity.value = mid;
        this.waterMesh.material.uniforms.uHighIntensity.value = high;
        this.waterMesh.material.uniforms.uTime.value += 0.016;
        
        // Update water simulation
        this.updateWater(0.016);
        
        // Beat-triggered ripples
        if (isBeat && !this.lastBeat) {
            const x = Math.random();
            const y = Math.random();
            const strength = 0.1 + bass * 0.2;
            this.addDrop(x, y, 0.05, strength);
        }
        this.lastBeat = isBeat;
        
        // Auto-generate ripples based on bass
        this.rippleTimer += 0.016;
        const interval = this.autoRippleInterval * (1.0 - bass * 0.5);
        
        if (this.rippleTimer > interval) {
            this.rippleTimer = 0;
            const x = 0.3 + Math.random() * 0.4;
            const y = 0.3 + Math.random() * 0.4;
            const strength = 0.05 + bass * 0.1;
            this.addDrop(x, y, 0.03 + bass * 0.05, strength);
        }
        
        // Rotate slowly
        this.container.rotation.z += 0.001;
    }
    
    onBPMBeat() {
        // Extra ripple on BPM beat
        const x = 0.5;
        const y = 0.5;
        this.addDrop(x, y, 0.1, 0.15);
    }
    
    // Called from App.js to pass renderer reference
    setRenderer(renderer) {
        this.renderer = renderer;
    }
    
    destroy() {
        App.holder.remove(this.container);
        this.target1.dispose();
        this.target2.dispose();
        this.waterMesh.geometry.dispose();
        this.waterMesh.material.dispose();
        this.updateMaterial.dispose();
        this.dropMaterial.dispose();
        this.computePlane.geometry.dispose();
    }
}
