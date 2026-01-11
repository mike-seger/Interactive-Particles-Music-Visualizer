uniform float time;
uniform float lowFreq;
uniform float midFreq;
uniform float highFreq;
varying vec2 vUv;
varying vec3 vPosition;

// Simple noise function
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vUv = uv;
  vPosition = position;
  
  vec3 pos = position;
  
  // Create flowing, organic movement with multiple layers
  float flowX = sin(pos.x * 0.5 + time * 0.3) * cos(pos.y * 0.3 + time * 0.2);
  float flowY = cos(pos.x * 0.3 + time * 0.25) * sin(pos.y * 0.5 + time * 0.35);
  
  // Add pseudo-random variation based on position
  float randomOffset = noise(pos.xy + time * 0.1);
  
  // Low frequency creates large wave motion
  float bassWave = sin(pos.x * 0.8 + time * 0.4 + randomOffset) * cos(pos.y * 0.8 + time * 0.3);
  pos.z += bassWave * lowFreq * 2.5;
  
  // Mid and high frequencies add detail
  pos.z += flowX * midFreq * 1.5;
  pos.z += flowY * highFreq * 1.0;
  
  // Additional random turbulence
  pos.z += sin(pos.x * 2.0 + pos.y * 1.5 + time * 0.5 + randomOffset * 10.0) * 0.5;
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
