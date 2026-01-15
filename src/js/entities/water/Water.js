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
        // Slightly more frequent ripples so multiple small wavefronts overlap.
        this.autoRippleInterval = 1.2; // seconds

        // Bass-kick detector (drops should only fall on audible bass drum kicks)
        this.bassFast = 0;
        this.bassSlow = 0;
        this.prevKick = false;
        this.kickCooldown = 0;
        this.kickCooldownSeconds = 0.10;

        // Global sensitivity for kick detection (higher => more drops)
        this.kickSensitivity = 1.35;

        // BPM assist window: briefly relax kick thresholds right after a beat.
        this.beatAssist = 0;

        this._lastUpdateAt = performance.now();

        // Cached FFT array for kick detection
        this._fftData = null;

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

    _estimateBassFromSpectrum() {
        // Match FrequencyBars: each "bar" is a raw FFT bin.
        // User reported the 5th bar correlates well with kicks => bin index 4.
        const analyser = App.audioManager?.analyserNode;
        if (!analyser) return 0;

        const bins = analyser.frequencyBinCount;
        if (!this._fftData || this._fftData.length !== bins) {
            this._fftData = new Uint8Array(bins);
        }

        analyser.getByteFrequencyData(this._fftData);

        const target = 4;
        const start = Math.max(0, target - 2);
        const end = Math.min(bins - 1, target + 2);

        let maxV = 0;
        let sum = 0;
        let count = 0;
        for (let i = start; i <= end; i++) {
            const v = this._fftData[i] || 0;
            if (v > maxV) maxV = v;
            sum += v;
            count++;
        }

        // Blend peak + average so we react to sharp kicks and rounder booms.
        const blended = maxV * 0.65 + (sum / Math.max(1, count)) * 0.35;
        return blended / 255;
    }
    
    init() {
        // Camera framing: top-down so the plane fills the viewport.
        if (App.camera) {
            // Looking down the -Y axis: set up-vector to avoid colinearity with view direction.
            App.camera.up.set(0, 0, -1);
            // Much higher Y => show a large surface area (see many ripple centers at once).
            App.camera.position.set(0, 320, 0);
            App.camera.lookAt(0, 0, 0);

            // Slightly narrower FOV so we see more of the plane at once.
            if (typeof App.camera.fov === 'number') {
                App.camera.fov = 60;
            }
            App.camera.updateProjectionMatrix();
        }

        App.holder.add(this.container);
        // Create the water plane mesh
        // Make the plane large enough to behave like an infinite horizon
        // (push side edges out of the camera frustum so no trapezoid outline shows).
        const geometry = new THREE.PlaneGeometry(800, 800, 200, 200);
        
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
        // Keep the plane horizontal (XZ plane)
        this.waterMesh.rotation.set(-Math.PI / 2, 0, 0);
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
                // Smaller default ripples (individual drops set these too)
                uRadius: { value: 0.01 },
                uStrength: { value: 0.25 }
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
                // Smaller wave height so multiple drops are readable.
                pos.z += height * 1.0;
                
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

        const now = performance.now();
        const dt = Math.min(0.05, (now - this._lastUpdateAt) / 1000);
        this._lastUpdateAt = now;
        
        const { frequencies, isBeat } = audioData;
        const bassFromBands = frequencies.bass || 0;
        const bassFromSpectrum = this._estimateBassFromSpectrum();
        const bass = Math.max(bassFromBands, bassFromSpectrum);
        const mid = frequencies.mid || 0;
        const high = frequencies.high || 0;
        
        // Update audio uniforms
        this.waterMesh.material.uniforms.uBassIntensity.value = bass;
        this.waterMesh.material.uniforms.uMidIntensity.value = mid;
        this.waterMesh.material.uniforms.uHighIntensity.value = high;
        this.waterMesh.material.uniforms.uTime.value += 0.016;
        
        // Update water simulation
        this.updateWater(0.016);

        // BPM assist window (useful when onset detection misses some kicks)
        const beatEdge = !!(isBeat && !this.lastBeat);
        if (beatEdge) {
            // Slightly longer window to account for latency/swing.
            this.beatAssist = 0.28;
        } else {
            this.beatAssist = Math.max(0, this.beatAssist - dt);
        }

        // Bass-kick driven drops
        // Use an onset detector (fast vs slow envelope) and trigger only on rising edge.
        this.kickCooldown = Math.max(0, this.kickCooldown - dt);

        const fastK = 1.0 - Math.pow(0.001, dt);
        const slowK = 1.0 - Math.pow(0.06, dt);
        this.bassFast += (bass - this.bassFast) * fastK;
        this.bassSlow += (bass - this.bassSlow) * slowK;

        const assist = this.beatAssist > 0 ? (1.0 + this.beatAssist * 1.2) : 1.0;
        const onset = Math.max(0, (this.bassFast - this.bassSlow) * this.kickSensitivity * assist);

        // Default thresholds (off-beat)
        let bassMin = 0.012;
        let onsetThresh = 0.0060;

        // In a short window after BPM beat, relax thresholds to catch quieter kicks.
        if (this.beatAssist > 0) {
            bassMin = 0.008;
            onsetThresh = 0.0032;
        }

        const kick = (this.bassFast > bassMin) && (onset > onsetThresh);

        if (kick && !this.prevKick && this.kickCooldown === 0) {
            // Keep centers in the central area so they're all visible with the top-down camera.
            const x = 0.3 + Math.random() * 0.4;
            const y = 0.3 + Math.random() * 0.4;

            const radius = 0.008 + bass * 0.01;
            const strength = 0.04 + bass * 0.22 + onset * 0.55;
            this.addDrop(x, y, radius, strength);

            this.kickCooldown = this.kickCooldownSeconds;
        }

        this.prevKick = kick;

        this.lastBeat = isBeat;
        
        // Keep the water surface horizontal (no container rotation)
    }
    
    onBPMBeat() {
        // Drops are driven by bass kick detection in update().
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
