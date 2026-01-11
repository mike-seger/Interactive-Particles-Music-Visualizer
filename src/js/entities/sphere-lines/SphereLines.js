import * as THREE from 'three';
import App from '../../App';

export default class SphereLines extends THREE.Object3D {
    constructor() {
        super();
        this.name = 'SphereLines';
        this.lines = [];
        this.numLines = 1024;
        this.innerRadius = 3;
        this.maxLength = 10;
        this.intensity = 5;
        this.opacity = 0.85;
    }

    init() {
        App.holder.add(this);
        
        // Create radial lines extending from center
        for (let i = 0; i < this.numLines; i++) {
            const geometry = new THREE.BufferGeometry();
            
            // Create random direction for line
            const direction = new THREE.Vector3(
                Math.random() * 2 - 1,
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
            );
            direction.normalize();
            
            // Inner vertex (close to center)
            const innerVertex = direction.clone().multiplyScalar(this.innerRadius);
            
            // Outer vertex (will be animated)
            const outerVertex = direction.clone().multiplyScalar(this.innerRadius * 1.25);
            
            const positions = new Float32Array([
                innerVertex.x, innerVertex.y, innerVertex.z,
                outerVertex.x, outerVertex.y, outerVertex.z
            ]);
            
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const material = new THREE.LineBasicMaterial({
                color: 0x000000,
                opacity: this.opacity,
                transparent: true
            });
            
            const line = new THREE.Line(geometry, material);
            line.userData.direction = direction;
            line.userData.innerVertex = innerVertex;
            
            this.lines.push(line);
            this.add(line);
        }
        
        // Position camera
        App.camera.position.set(0, 0, 25);
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
        
        // Update each line
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const frequencyValue = dataArray[i] || 0;
            
            // Calculate outer vertex position based on frequency
            const scaledValue = (frequencyValue * this.intensity + 50) / 255;
            const outerLength = this.innerRadius + scaledValue * this.maxLength;
            
            const direction = line.userData.direction;
            const innerVertex = line.userData.innerVertex;
            const outerVertex = direction.clone().multiplyScalar(outerLength);
            
            // Update geometry
            const positions = line.geometry.attributes.position.array;
            positions[0] = innerVertex.x;
            positions[1] = innerVertex.y;
            positions[2] = innerVertex.z;
            positions[3] = outerVertex.x;
            positions[4] = outerVertex.y;
            positions[5] = outerVertex.z;
            
            line.geometry.attributes.position.needsUpdate = true;
            
            // Color based on length
            const normalizedLength = scaledValue / this.maxLength;
            
            if (normalizedLength < 0.3) {
                // Inner - yellow
                line.material.color.setHex(0xFFF000);
            } else if (normalizedLength < 0.6) {
                // Middle - red
                line.material.color.setHex(0xFF0000);
            } else {
                // Outer - pink
                line.material.color.setHex(0xFF0080);
            }
        }
        
        // Gentle rotation
        this.rotation.y += 0.002;
        this.rotation.x += 0.001;
    }

    onBPMBeat(bpm, beat) {
        // Pulse intensity on beat
        this.intensity = 8;
        
        setTimeout(() => {
            this.intensity = 5;
        }, 100);
    }

    destroy() {
        // Clean up
        this.lines.forEach(line => {
            line.geometry.dispose();
            line.material.dispose();
            this.remove(line);
        });
        
        App.holder.remove(this);
        this.lines = [];
    }
}
