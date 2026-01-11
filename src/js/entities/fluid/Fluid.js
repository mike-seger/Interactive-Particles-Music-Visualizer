import * as THREE from 'three';

/**
 * WebGL Fluid Simulation
 * Adapted from Pavel Dobryakov's WebGL Fluid Simulation
 * https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 */

export default class Fluid extends THREE.Object3D {
    constructor() {
        super();
        this.name = 'Fluid';
        
        // Create canvas for fluid simulation
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.zIndex = '1';
        
        // Add canvas to document
        document.body.appendChild(this.canvas);
        
        // Configuration
        this.config = {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 0.98,
            VELOCITY_DISSIPATION: 0.99,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 30,
            SPLAT_RADIUS: 0.25,
            SPLAT_FORCE: 6000,
            SHADING: false,
            BLOOM: false,
            SUNRAYS: false
        };
        
        // Auto-splat configuration
        this.autoSplatTimer = 0;
        this.autoSplatInterval = 0.15; // Generate splat every 0.15 seconds
        this.lastBeat = false;
        
        this.initialized = false;
    }
    
    init() {
        if (this.initialized) return;
        this.initialized = true;
        
        this.initWebGL();
        this.initPrograms();
        this.initFramebuffers();
        
        // Generate initial splats
        this.multipleSplats(5);
        
        // Animation loop
        this.lastUpdateTime = Date.now();
        
        console.log('Fluid visualizer initialized');
    }
    
    initWebGL() {
        const params = { 
            alpha: true, 
            depth: false, 
            stencil: false, 
            antialias: false, 
            preserveDrawingBuffer: false 
        };
        
        this.gl = this.canvas.getContext('webgl2', params);
        
        if (!this.gl) {
            this.gl = this.canvas.getContext('webgl', params);
        }
        
        // Get extensions
        const isWebGL2 = !!(this.canvas.getContext('webgl2', params));
        
        if (isWebGL2) {
            this.gl.getExtension('EXT_color_buffer_float');
            this.ext = {
                supportLinearFiltering: this.gl.getExtension('OES_texture_float_linear')
            };
        } else {
            const halfFloat = this.gl.getExtension('OES_texture_half_float');
            this.ext = {
                supportLinearFiltering: this.gl.getExtension('OES_texture_half_float_linear'),
                halfFloat: halfFloat
            };
        }
        
        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        
        // Set formats
        this.halfFloatTexType = isWebGL2 ? this.gl.HALF_FLOAT : this.ext.halfFloat.HALF_FLOAT_OES;
        
        if (isWebGL2) {
            this.formatRGBA = { internalFormat: this.gl.RGBA16F, format: this.gl.RGBA };
            this.formatRG = { internalFormat: this.gl.RG16F, format: this.gl.RG };
            this.formatR = { internalFormat: this.gl.R16F, format: this.gl.RED };
        } else {
            this.formatRGBA = { internalFormat: this.gl.RGBA, format: this.gl.RGBA };
            this.formatRG = { internalFormat: this.gl.RGBA, format: this.gl.RGBA };
            this.formatR = { internalFormat: this.gl.RGBA, format: this.gl.RGBA };
        }
        
        this.resizeCanvas();
    }
    
    initPrograms() {
        const gl = this.gl;
        
        // Simple vertex shader used by all programs
        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform vec2 texelSize;
            
            void main () {
                vUv = aPosition * 0.5 + 0.5;
                vL = vUv - vec2(texelSize.x, 0.0);
                vR = vUv + vec2(texelSize.x, 0.0);
                vT = vUv + vec2(0.0, texelSize.y);
                vB = vUv - vec2(0.0, texelSize.y);
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `);
        
        // Display shader
        const displayShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            
            void main () {
                vec3 c = texture2D(uTexture, vUv).rgb;
                gl_FragColor = vec4(c, 1.0);
            }
        `);
        
        // Splat shader
        const splatShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTarget;
            uniform float aspectRatio;
            uniform vec3 color;
            uniform vec2 point;
            uniform float radius;
            
            void main () {
                vec2 p = vUv - point.xy;
                p.x *= aspectRatio;
                vec3 splat = exp(-dot(p, p) / radius) * color;
                vec3 base = texture2D(uTarget, vUv).xyz;
                gl_FragColor = vec4(base + splat, 1.0);
            }
        `);
        
        // Advection shader
        const advectionShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uVelocity;
            uniform sampler2D uSource;
            uniform vec2 texelSize;
            uniform float dt;
            uniform float dissipation;
            
            void main () {
                vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                gl_FragColor = dissipation * texture2D(uSource, coord);
            }
        `);
        
        // Divergence shader
        const divergenceShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uVelocity, vL).x;
                float R = texture2D(uVelocity, vR).x;
                float T = texture2D(uVelocity, vT).y;
                float B = texture2D(uVelocity, vB).y;
                float div = 0.5 * (R - L + T - B);
                gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
            }
        `);
        
        // Curl shader
        const curlShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uVelocity, vL).y;
                float R = texture2D(uVelocity, vR).y;
                float T = texture2D(uVelocity, vT).x;
                float B = texture2D(uVelocity, vB).x;
                float vorticity = R - L - T + B;
                gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
            }
        `);
        
        // Vorticity shader
        const vorticityShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uVelocity;
            uniform sampler2D uCurl;
            uniform float curl;
            uniform float dt;
            
            void main () {
                float L = texture2D(uCurl, vL).x;
                float R = texture2D(uCurl, vR).x;
                float T = texture2D(uCurl, vT).x;
                float B = texture2D(uCurl, vB).x;
                float C = texture2D(uCurl, vUv).x;
                
                vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                force /= length(force) + 0.0001;
                force *= curl * C;
                force.y *= -1.0;
                
                vec2 velocity = texture2D(uVelocity, vUv).xy;
                velocity += force * dt;
                velocity = min(max(velocity, -1000.0), 1000.0);
                gl_FragColor = vec4(velocity, 0.0, 1.0);
            }
        `);
        
        // Pressure shader
        const pressureShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uDivergence;
            
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                float C = texture2D(uPressure, vUv).x;
                float divergence = texture2D(uDivergence, vUv).x;
                float pressure = (L + R + B + T - divergence) * 0.25;
                gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
            }
        `);
        
        // Gradient subtract shader
        const gradientSubtractShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uVelocity;
            
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                vec2 velocity = texture2D(uVelocity, vUv).xy;
                velocity.xy -= vec2(R - L, T - B);
                gl_FragColor = vec4(velocity, 0.0, 1.0);
            }
        `);
        
        // Clear shader
        const clearShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            uniform sampler2D uTexture;
            uniform float value;
            
            void main () {
                gl_FragColor = value * texture2D(uTexture, vUv);
            }
        `);
        
        // Create programs
        this.displayProgram = this.createProgram(baseVertexShader, displayShader);
        this.splatProgram = this.createProgram(baseVertexShader, splatShader);
        this.advectionProgram = this.createProgram(baseVertexShader, advectionShader);
        this.divergenceProgram = this.createProgram(baseVertexShader, divergenceShader);
        this.curlProgram = this.createProgram(baseVertexShader, curlShader);
        this.vorticityProgram = this.createProgram(baseVertexShader, vorticityShader);
        this.pressureProgram = this.createProgram(baseVertexShader, pressureShader);
        this.gradientSubtractProgram = this.createProgram(baseVertexShader, gradientSubtractShader);
        this.clearProgram = this.createProgram(baseVertexShader, clearShader);
        
        // Create blit quad
        this.createBlitQuad();
    }
    
    createBlitQuad() {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    }
    
    blit(target) {
        const gl = this.gl;
        if (target == null) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    
    compileShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error(this.gl.getShaderInfoLog(shader));
        }
        
        return shader;
    }
    
    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error(this.gl.getProgramInfoLog(program));
        }
        
        const uniforms = {};
        const uniformCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = this.gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = this.gl.getUniformLocation(program, uniformName);
        }
        
        return { program, uniforms };
    }
    
    createFBO(w, h, internalFormat, format, type, param) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        return {
            texture,
            fbo,
            width: w,
            height: h,
            texelSizeX: 1.0 / w,
            texelSizeY: 1.0 / h,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }
    
    createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);
        
        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            get read() { return fbo1; },
            set read(value) { fbo1 = value; },
            get write() { return fbo2; },
            set write(value) { fbo2 = value; },
            swap() {
                let temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }
    
    initFramebuffers() {
        const simRes = this.getResolution(this.config.SIM_RESOLUTION);
        const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);
        
        const texType = this.halfFloatTexType;
        const rgba = this.formatRGBA;
        const rg = this.formatRG;
        const r = this.formatR;
        const filtering = this.ext.supportLinearFiltering ? this.gl.LINEAR : this.gl.NEAREST;
        
        this.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        this.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        this.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, this.gl.NEAREST);
        this.curl = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, this.gl.NEAREST);
        this.pressure = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, this.gl.NEAREST);
    }
    
    getResolution(resolution) {
        let aspectRatio = this.gl.drawingBufferWidth / this.gl.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
        
        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);
        
        if (this.gl.drawingBufferWidth > this.gl.drawingBufferHeight) {
            return { width: max, height: min };
        } else {
            return { width: min, height: max };
        }
    }
    
    resizeCanvas() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            return true;
        }
        return false;
    }
    
    update(audioData) {
        if (!this.initialized) return;
        
        const now = Date.now();
        let dt = (now - this.lastUpdateTime) / 1000;
        dt = Math.min(dt, 0.016666);
        this.lastUpdateTime = now;
        
        if (this.resizeCanvas()) {
            this.initFramebuffers();
        }
        
        // Auto-splat generation
        this.autoSplatTimer += dt;
        
        // Add audio-reactive splats
        if (audioData) {
            const { bass, mid, high } = audioData.frequencies;
            const isBeat = audioData.isBeat;
            
            // Beat-synced splat
            if (isBeat && !this.lastBeat) {
                this.generateRandomSplat(bass);
            }
            this.lastBeat = isBeat;
            
            // Time-based splat with audio influence
            if (this.autoSplatTimer >= this.autoSplatInterval) {
                this.autoSplatTimer = 0;
                const intensity = (bass + mid + high) / 3;
                if (intensity > 0.3) {
                    this.generateRandomSplat(intensity);
                }
            }
            
            // High energy = more splats
            if (bass > 0.7) {
                this.generateRandomSplat(bass);
            }
        } else {
            // No audio - just time-based splats
            if (this.autoSplatTimer >= this.autoSplatInterval * 2) {
                this.autoSplatTimer = 0;
                this.generateRandomSplat(0.5);
            }
        }
        
        this.step(dt);
        this.render();
    }
    
    step(dt) {
        const gl = this.gl;
        
        gl.disable(gl.BLEND);
        
        // Curl
        gl.useProgram(this.curlProgram.program);
        gl.uniform2f(this.curlProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.curlProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.curl);
        
        // Vorticity
        gl.useProgram(this.vorticityProgram.program);
        gl.uniform2f(this.vorticityProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.vorticityProgram.uniforms.uCurl, this.curl.attach(1));
        gl.uniform1f(this.vorticityProgram.uniforms.curl, this.config.CURL);
        gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
        this.blit(this.velocity.write);
        this.velocity.swap();
        
        // Divergence
        gl.useProgram(this.divergenceProgram.program);
        gl.uniform2f(this.divergenceProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.divergence);
        
        // Clear pressure
        gl.useProgram(this.clearProgram.program);
        gl.uniform1i(this.clearProgram.uniforms.uTexture, this.pressure.read.attach(0));
        gl.uniform1f(this.clearProgram.uniforms.value, this.config.PRESSURE);
        this.blit(this.pressure.write);
        this.pressure.swap();
        
        // Pressure solve
        gl.useProgram(this.pressureProgram.program);
        gl.uniform2f(this.pressureProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.pressureProgram.uniforms.uDivergence, this.divergence.attach(0));
        
        for (let i = 0; i < this.config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(this.pressureProgram.uniforms.uPressure, this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }
        
        // Gradient subtract
        gl.useProgram(this.gradientSubtractProgram.program);
        gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, this.pressure.read.attach(0));
        gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, this.velocity.read.attach(1));
        this.blit(this.velocity.write);
        this.velocity.swap();
        
        // Advection
        gl.useProgram(this.advectionProgram.program);
        gl.uniform2f(this.advectionProgram.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        
        const velocityId = this.velocity.read.attach(0);
        gl.uniform1i(this.advectionProgram.uniforms.uVelocity, velocityId);
        gl.uniform1i(this.advectionProgram.uniforms.uSource, velocityId);
        gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
        gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.VELOCITY_DISSIPATION);
        this.blit(this.velocity.write);
        this.velocity.swap();
        
        gl.uniform1i(this.advectionProgram.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.advectionProgram.uniforms.uSource, this.dye.read.attach(1));
        gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.DENSITY_DISSIPATION);
        this.blit(this.dye.write);
        this.dye.swap();
    }
    
    render() {
        const gl = this.gl;
        
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        
        gl.useProgram(this.displayProgram.program);
        gl.uniform1i(this.displayProgram.uniforms.uTexture, this.dye.read.attach(0));
        this.blit(null);
    }
    
    splat(x, y, dx, dy, color) {
        const gl = this.gl;
        
        gl.useProgram(this.splatProgram.program);
        gl.uniform1i(this.splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
        gl.uniform1f(this.splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform2f(this.splatProgram.uniforms.point, x, y);
        gl.uniform3f(this.splatProgram.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(this.splatProgram.uniforms.radius, this.correctRadius(this.config.SPLAT_RADIUS / 100.0));
        this.blit(this.velocity.write);
        this.velocity.swap();
        
        gl.uniform1i(this.splatProgram.uniforms.uTarget, this.dye.read.attach(0));
        gl.uniform3f(this.splatProgram.uniforms.color, color.r, color.g, color.b);
        this.blit(this.dye.write);
        this.dye.swap();
    }
    
    correctRadius(radius) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) {
            radius *= aspectRatio;
        }
        return radius;
    }
    
    generateRandomSplat(intensity = 0.5) {
        const color = this.generateColor(intensity);
        const x = Math.random();
        const y = Math.random();
        const dx = 1000 * (Math.random() - 0.5) * intensity;
        const dy = 1000 * (Math.random() - 0.5) * intensity;
        this.splat(x, y, dx, dy, color);
    }
    
    multipleSplats(amount) {
        for (let i = 0; i < amount; i++) {
            this.generateRandomSplat(Math.random());
        }
    }
    
    generateColor(intensity = 1.0) {
        const c = this.HSVtoRGB(Math.random(), 1.0, 1.0);
        c.r *= 0.15 * (1 + intensity);
        c.g *= 0.15 * (1 + intensity);
        c.b *= 0.15 * (1 + intensity);
        return c;
    }
    
    HSVtoRGB(h, s, v) {
        let r, g, b, i, f, p, q, t;
        i = Math.floor(h * 6);
        f = h * 6 - i;
        p = v * (1 - s);
        q = v * (1 - f * s);
        t = v * (1 - (1 - f) * s);
        
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        
        return { r, g, b };
    }
    
    destroy() {
        this.cleanup();
    }
    
    animate() {
        // This will be called from App.js render loop
        // No requestAnimationFrame here since Three.js handles the loop
    }
    
    onBPMBeat() {
        // Generate extra splat on beat
        this.generateRandomSplat(1.0);
    }
    
    cleanup() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
