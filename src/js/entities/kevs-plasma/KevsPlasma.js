import * as THREE from 'three';
import App from '../../App';

export default class KevsPlasma {
    constructor() {
        this.name = 'KevsPlasma';
        
        // Canvas overlay for 2D plasma rendering
        this.canvas = null;
        this.ctx = null;
        
        // Plasma parameters
        this.plasmaDensity = 128; // Doubled for half the pixel size
        this.cycleSpeed = 1;
        this.plasmaFunction = 1; // Function 1 for smooth gradients
        this.timeFunction = 512;
        this.jitter = 0; // No jitter for smooth movement
        this.alpha = 0.5;
        this.paletteIndex = 2; // Fixed to neon colors palette
        this.paletteOffset = 0;
        
        // Audio reactivity
        this.bassReactivity = 0;
        this.midReactivity = 0;
        this.highReactivity = 0;
        this.animationMomentum = 1.0; // Gradually decreases when no audio
        
        this.palettes = [];
        this.generatePalettes();
    }
    
    init() {
        // Create overlay canvas for 2D plasma effect
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        document.querySelector('.content').appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }
    
    generatePalettes() {
        // Grayscale palette
        let palette = [];
        for (let i = 0; i < 256; i++) {
            palette.push(this.rgb(i, i, i));
        }
        this.palettes.push(palette);
        
        // Grayscale fade palette
        palette = [];
        for (let i = 0; i < 128; i++) {
            palette.push(this.rgb(i * 2, i * 2, i * 2));
        }
        for (let i = 0; i < 128; i++) {
            palette.push(this.rgb(255 - (i * 2), 255 - (i * 2), 255 - (i * 2)));
        }
        this.palettes.push(palette);
        
        // Color palette 1
        palette = new Array(256);
        for (let i = 0; i < 64; i++) {
            palette[i] = this.rgb(i << 2, 255 - ((i << 2) + 1), 64);
            palette[i + 64] = this.rgb(255, (i << 2) + 1, 128);
            palette[i + 128] = this.rgb(255 - ((i << 2) + 1), 255 - ((i << 2) + 1), 192);
            palette[i + 192] = this.rgb(0, (i << 2) + 1, 255);
        }
        this.palettes.push(palette);
        
        // Color palette 2 (sine waves)
        palette = [];
        for (let i = 0; i < 256; i++) {
            const r = Math.floor(128 + 128 * Math.sin(Math.PI * i / 32));
            const g = Math.floor(128 + 128 * Math.sin(Math.PI * i / 64));
            const b = Math.floor(128 + 128 * Math.sin(Math.PI * i / 128));
            palette.push(this.rgb(r, g, b));
        }
        this.palettes.push(palette);
        
        // Color palette 3 (smooth gradient)
        palette = [];
        for (let i = 0; i < 256; i++) {
            const r = Math.floor(Math.sin(0.3 * i) * 64 + 190);
            const g = Math.floor(Math.sin(0.3 * i + 2) * 64 + 190);
            const b = Math.floor(Math.sin(0.3 * i + 4) * 64 + 190);
            palette.push(this.rgb(r, g, b));
        }
        this.palettes.push(palette);
    }
    
    rgb(r, g, b) {
        return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
    }
    
    update(audioData) {
        if (!this.ctx || !this.canvas) return;
        
        if (audioData) {
            const { frequencies, isBeat } = audioData;
            this.bassReactivity = frequencies.bass || 0;
            this.midReactivity = frequencies.mid || 0;
            this.highReactivity = frequencies.high || 0;
            
            // Calculate overall audio intensity
            const audioIntensity = (this.bassReactivity + this.midReactivity + this.highReactivity) / 3;
            
            // Gradually adjust momentum based on audio presence
            if (audioIntensity > 0.05) {
                // Audio present - increase momentum
                this.animationMomentum = Math.min(1.0, this.animationMomentum + 0.05);
            } else {
                // No audio - gradually slow down
                this.animationMomentum = Math.max(0.0, this.animationMomentum - 0.01);
            }
            
            // Audio-reactive parameters
            // Mid affects cycle speed (very slow color cycling)
            this.cycleSpeed = (0.01 + this.midReactivity * 0.05) * this.animationMomentum;
            
            // Time function fixed (no audio reactivity)
            this.timeFunction = 66.67 / Math.max(0.1, this.animationMomentum);
        } else {
            // No audio data - slow down
            this.animationMomentum = Math.max(0.0, this.animationMomentum - 0.01);
            this.cycleSpeed = 0.01 * this.animationMomentum;
            this.timeFunction = 66.67 / Math.max(0.1, this.animationMomentum);
        }
        
        this.render();
    }
    
    render() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const pw = this.plasmaDensity;
        const ph = Math.floor(pw * (h / w));
        
        // Bass affects blob size (up to 3% scaling)
        const sizeScale = 1.0 + (this.bassReactivity * 0.03);
        const vpx = (w / pw) * sizeScale;  // virtual pixel width
        const vpy = (h / ph) * sizeScale;  // virtual pixel height
        
        const palette = this.palettes[this.paletteIndex];
        this.paletteOffset += this.cycleSpeed;
        
        const time = Date.now() / this.timeFunction;
        
        // Add random variation for shape and color diversity
        const randomOffset1 = Math.sin(time * 0.3) * 50;
        const randomOffset2 = Math.cos(time * 0.4) * 30;
        const randomOffset3 = Math.sin(time * 0.5) * 40;
        const colorNoise = Math.sin(time * 2.1) * 20;
        
        const dist = (a, b, c, d) => {
            return Math.sqrt((a - c) * (a - c) + (b - d) * (b - d));
        };
        
        const colour = (x, y) => {
            switch (this.plasmaFunction) {
                case 0:
                    return Math.floor(
                        (Math.sin(dist(x + time, y, 128.0, 128.0) / 8.0) +
                         Math.sin(dist(x, y + time / 7, 192.0, 64) / 7.0) +
                         Math.sin(dist(x, y, 192.0, 100.0) / 8.0)) + 4
                    ) * 32;
                case 1:
                    return (
                        128 + 128 * Math.sin(x * 0.0625 + randomOffset1 * 0.01) +
                        128 + 128 * Math.sin(y * 0.03125 + randomOffset2 * 0.01) +
                        128 + 128 * Math.sin(dist(x + time + randomOffset3, y - time, w, h) * 0.125) +
                        128 + 128 * Math.sin(Math.sqrt(x * x + y * y) * 0.125 + time * 0.2)
                    ) * 0.25 + colorNoise;
                default:
                    return 0;
            }
        };
        
        this.ctx.save();
        this.ctx.globalAlpha = this.alpha;
        
        const jitter = this.jitter ? (-this.jitter + Math.random() * this.jitter * 2) : 0;
        
        for (let y = 0; y < ph; y++) {
            for (let x = 0; x < pw; x++) {
                const colorIndex = (Math.floor(colour(x, y)) + Math.floor(this.paletteOffset)) % 256;
                this.ctx.fillStyle = palette[colorIndex];
                this.ctx.fillRect(
                    x * vpx + jitter,
                    y * vpy + jitter,
                    vpx,
                    vpy
                );
            }
        }
        
        this.ctx.restore();
    }
    
    onBPMBeat() {
        // BPM beat handler (disabled - keeping consistent visual style)
    }
    
    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
