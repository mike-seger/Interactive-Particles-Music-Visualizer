import App from '../../App';

export default class FrequencyBars {
    constructor() {
        this.name = 'FrequencyBars';
        
        // Canvas for bar visualization
        this.canvas = null;
        this.ctx = null;
        
        // Audio reactivity
        this.bassReactivity = 0;
        this.midReactivity = 0;
        this.highReactivity = 0;
    }
    
    init() {
        // Create overlay canvas for frequency bars
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
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
        }
    }
    
    update(audioData) {
        if (!this.ctx || !this.canvas || !this.analyser) return;
        
        if (audioData) {
            const { frequencies } = audioData;
            this.bassReactivity = frequencies.bass || 0;
            this.midReactivity = frequencies.mid || 0;
            this.highReactivity = frequencies.high || 0;
        }
        
        this.render();
    }
    
    render() {
        const WIDTH = this.canvas.width;
        const HEIGHT = this.canvas.height;
        
        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Clear canvas with fade effect
        this.ctx.fillStyle = "rgba(0,0,0,0.2)";
        this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
        
        const bars = this.dataArray.length;
        const barWidth = (WIDTH / this.bufferLength) * 13;
        let x = 0;
        
        for (let i = 0; i < bars; i++) {
            const barHeight = this.dataArray[i] * 2.5;
            
            // Color based on frequency intensity
            let r, g, b;
            if (this.dataArray[i] > 210) { // pink
                r = 250;
                g = 0;
                b = 255;
            } else if (this.dataArray[i] > 200) { // yellow
                r = 250;
                g = 255;
                b = 0;
            } else if (this.dataArray[i] > 190) { // yellow/green
                r = 204;
                g = 255;
                b = 0;
            } else if (this.dataArray[i] > 180) { // blue/green
                r = 0;
                g = 219;
                b = 131;
            } else { // light blue
                r = 0;
                g = 199;
                b = 255;
            }
            
            this.ctx.fillStyle = `rgb(${r},${g},${b})`;
            this.ctx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);
            
            x += barWidth + 10; // 10px space between bars
        }
    }
    
    onBPMBeat() {
        // Could add flash effect on beat if desired
    }
    
    destroy() {
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
    }
}
