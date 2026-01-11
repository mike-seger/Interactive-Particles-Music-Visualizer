uniform vec3 color;
uniform float opacity;

varying float vAmplitude;

void main() {
  // Create circular points with soft blur
  vec2 center = gl_PointCoord - vec2(0.5);
  float dist = length(center);
  
  if (dist > 0.5) {
    discard;
  }
  
  // Soft blur falloff
  float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
  alpha = pow(alpha, 0.8); // Softer falloff
  
  // Modulate brightness based on wave amplitude
  float brightness = 0.8 + vAmplitude * 0.4;
  
  gl_FragColor = vec4(color * brightness, opacity * alpha);
}
