import * as THREE from 'three';
import App from '../../App';

export default class CircularSpectrum extends THREE.Object3D {
    constructor() {
        super();
        this.name = 'CircularSpectrum';
        this.bars = [];
        this.numBars = 128;
        this.innerRadius = 3;
        this.maxBarLength = 8;
        this.rotationAngle = 0;
    }

    init() {
        App.holder.add(this);
        
        // Create circular spectrum bars
        const angleStep = (Math.PI * 2) / this.numBars;
        
        for (let i = 0; i < this.numBars; i++) {
            // Create bar geometry (thin rectangle)
            const geometry = new THREE.BoxGeometry(0.15, 1, 0.15);
            
            // Create material with white color (will change based on frequency)
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.95
            });
            
            const bar = new THREE.Mesh(geometry, material);
            
            // Position at inner radius
            const angle = i * angleStep;
            bar.userData.angle = angle;
            bar.userData.baseX = Math.cos(angle) * this.innerRadius;
            bar.userData.baseZ = Math.sin(angle) * this.innerRadius;
            
            bar.position.x = bar.userData.baseX;
            bar.position.z = bar.userData.baseZ;
            bar.position.y = 0;
            
            this.bars.push(bar);
            this.add(bar);
        }
        
        // Position camera for top-down view with slight angle
        App.camera.position.set(0, 12, 8);
        App.camera.lookAt(0, 0, 0);
    }

    update(deltaTime) {
        const audioManager = App.audioManager;
        
        if (!audioManager.isPlaying && !audioManager.isUsingMicrophone) {
            return;
        }
        
        // Get frequency data
        const bufferLength = audioManager.analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        audioManager.analyserNode.getByteFrequencyData(dataArray);
        
        // Get bass for center pulse effect
        const bass = Math.max(dataArray[0], dataArray[1], dataArray[2]) / 255;
        const radiusPulse = bass * 1.5;
        
        // Rotate the entire spectrum slowly
        this.rotationAngle += 0.002;
        this.rotation.y = this.rotationAngle;
        
        // Update each bar
        for (let i = 0; i < this.numBars; i++) {
            const bar = this.bars[i];
            
            // Sample frequency data
            const dataIndex = Math.floor((i / this.numBars) * bufferLength);
            const value = Math.max(dataArray[dataIndex], 0) / 255;
            
            // Scale bar height
            const barHeight = value * this.maxBarLength;
            bar.scale.y = Math.max(0.1, barHeight);
            
            // Position bar outward from center based on its height
            const currentRadius = this.innerRadius + radiusPulse;
            const angle = bar.userData.angle;
            
            bar.position.x = Math.cos(angle) * currentRadius;
            bar.position.z = Math.sin(angle) * currentRadius;
            bar.position.y = barHeight / 2;
            
            // Color gradient: blue -> red -> yellow
            let r, g, b;
            if (value < 0.33) {
                // Blue to Red transition
                const t = value / 0.33;
                r = t;
                g = 0;
                b = 1 - t;
            } else if (value < 0.66) {
                // Red to Yellow transition
                const t = (value - 0.33) / 0.33;
                r = 1;
                g = t;
                b = 0;
            } else {
                // Yellow
                r = 1;
                g = 1;
                b = 0;
            }
            
            bar.material.color.setRGB(r, g, b);
        }
    }

    onBPMBeat(bpm, beat) {
        // Rotation boost on beat
        this.rotationAngle += 0.05;
    }

    destroy() {
        // Clean up
        this.bars.forEach(bar => {
            bar.geometry.dispose();
            bar.material.dispose();
            this.remove(bar);
        });
        
        App.holder.remove(this);
        this.bars = [];
    }
}
