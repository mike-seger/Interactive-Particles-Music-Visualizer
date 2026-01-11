import App from '../../App';

export default class AudioOscilloscope {
    constructor() {
        this.name = 'AudioOscilloscope';
        
        // Canvas for oscilloscope visualization
        this.canvas = null;
        this.ctx = null;
        
        // Analyser
        this.analyser = null;
        this.timeDomain = null;
        
        // Visual properties
        this.lineWidth = 3;
        this.strokeColor = '#00ff88';
        this.glowIntensity = 8;
    }
    
    init() {
        // Create overlay canvas
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
        
        // Get analyser from AudioManager
        if (App.audioManager && App.audioManager.analyserNode) {
            this.analyser = App.audioManager.analyserNode;
            this.timeDomain = new Uint8Array(this.analyser.fftSize);
        }
        
        // Setup drawing style
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.strokeStyle = this.strokeColor;
        this.ctx.shadowBlur = this.glowIntensity;
        this.ctx.shadowColor = this.strokeColor;
    }
    
    update(audioData) {
        if (!this.ctx || !this.canvas || !this.analyser) return;
        
        // Audio reactive glow
        if (audioData) {
            const { frequencies } = audioData;
            const intensity = (frequencies.bass + frequencies.mid + frequencies.high) / 3;
            this.ctx.shadowBlur = this.glowIntensity + intensity * 12;
            
            // Audio reactive color shift
            const hue = 120 + frequencies.mid * 120; // Green to cyan/blue
            this.ctx.strokeStyle = `hsl(${hue}, 100%, 50%)`;
            this.ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
        }
        
        this.draw();
    }
    
    draw() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);
        
        // Get time domain data
        this.analyser.getByteTimeDomainData(this.timeDomain);
        
        const step = width / this.timeDomain.length;
        
        this.ctx.beginPath();
        
        // Draw waveform
        for (let i = 0; i < this.timeDomain.length; i += 2) {
            const percent = this.timeDomain[i] / 256;
            const x = i * step;
            const y = height * percent;
            this.ctx.lineTo(x, y);
        }
        
        this.ctx.stroke();
    }
    
    onBPMBeat() {
        // Flash effect on beat
        if (this.ctx) {
            this.ctx.shadowBlur = 20;
        }
    }
    
    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
