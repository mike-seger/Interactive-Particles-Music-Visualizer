uniform float time;
uniform float radius;
uniform float ringIndex;
uniform float pointSize;
uniform float amplitude;

varying vec3 vPosition;
varying float vAmplitude;

void main() {
  vPosition = position;
  
  // Calculate angle around the circle
  float angle = atan(position.y, position.x);
  
  // Create traveling wave effect around the ring
  float wave = sin(angle * 3.0 + time * 2.0) * 0.5 + 0.5;
  
  // Calculate base position on the ring
  vec3 pos = position;
  
  // Apply amplitude with circular wave effect
  float radialAmplitude = amplitude * wave;
  
  // Make the entire ring pulsate with amplitude
  float basePulse = 1.0 + amplitude * 0.4;
  
  // Combine base pulse with circular wave effect
  float effectiveRadius = radius * basePulse * (1.0 + radialAmplitude * 0.2);
  
  // Scale based on ring index to create concentric circles
  pos.xy *= effectiveRadius;
  
  // Variable point size based on wave position
  float wavePointSize = pointSize * (0.8 + wave * 0.4);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = wavePointSize;
  
  vAmplitude = radialAmplitude;
}
