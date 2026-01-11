uniform float time;
uniform float lowFreq;
uniform float midFreq;
uniform float highFreq;
varying vec2 vUv;
varying vec3 vPosition;

// Enhanced noise function
float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Smooth noise
float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float a = noise(i);
  float b = noise(i + vec2(1.0, 0.0));
  float c = noise(i + vec2(0.0, 1.0));
  float d = noise(i + vec2(1.0, 1.0));
  
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion for organic patterns
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for(int i = 0; i < 5; i++) {
    value += amplitude * smoothNoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value;
}

// Convert frequency value to rainbow spectrum color
vec3 frequencyToRainbow(float t) {
  // Map 0-1 to rainbow: Red -> Orange -> Yellow -> Green -> Cyan -> Blue -> Violet
  vec3 color;
  
  if (t < 0.167) {
    // Red to Orange
    float local = t / 0.167;
    color = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.5, 0.0), local);
  } else if (t < 0.333) {
    // Orange to Yellow
    float local = (t - 0.167) / 0.167;
    color = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 0.0), local);
  } else if (t < 0.5) {
    // Yellow to Green
    float local = (t - 0.333) / 0.167;
    color = mix(vec3(1.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), local);
  } else if (t < 0.667) {
    // Green to Cyan
    float local = (t - 0.5) / 0.167;
    color = mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 1.0), local);
  } else if (t < 0.833) {
    // Cyan to Blue
    float local = (t - 0.667) / 0.167;
    color = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 0.0, 1.0), local);
  } else {
    // Blue to Violet
    float local = (t - 0.833) / 0.167;
    color = mix(vec3(0.0, 0.0, 1.0), vec3(0.5, 0.0, 1.0), local);
  }
  
  return color;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0; // Center UV

  // Slow liquid-like flow field (curl-ish) that bends sampling directions
  vec2 flowField = vec2(
    fbm(uv * 1.2 + vec2(time * 0.03, -time * 0.02)),
    fbm(uv * 1.2 + vec2(-time * 0.025, time * 0.018))
  ) - 0.5;
  flowField *= 0.15; // keep displacement gentle
  vec2 warpedUv = uv + flowField;
  
  // Create multiple flowing layers with different speeds and randomness
  float layer1 = fbm(warpedUv * 2.0 + vec2(time * 0.06, time * 0.04));
  float layer2 = fbm(warpedUv * 3.0 - vec2(time * 0.05, -time * 0.06));
  float layer3 = fbm(warpedUv * 4.0 + vec2(-time * 0.04, time * 0.05));
  
  // Combine layers for complex pattern
  float pattern = (layer1 + layer2 + layer3) / 3.0;
  
  // Add frequency-based modulation
  float freqInfluence = lowFreq * 0.4 + midFreq * 0.3 + highFreq * 0.3;
  
  // Create dynamic blob sizes that grow and shrink
  float blobSize = 0.3 + sin(time * 0.3) * 0.15 + cos(time * 0.4) * 0.1;
  float blobThreshold = 0.5 - blobSize + freqInfluence * 0.2;
  
  // Create non-contiguous blobs with soft edges
  float blobMask = smoothstep(blobThreshold - 0.2, blobThreshold + 0.2, pattern);
  
  // Add variation to blob edges
  float edgeNoise = fbm(uv * 5.0 + time * 0.1);
  blobMask *= smoothstep(0.3, 0.7, edgeNoise);
  
  // Create flowing movement influenced by audio
  float flowPattern = sin(pattern * 3.14159 * 2.0 + time * 0.5 + freqInfluence * 2.0) * 0.5 + 0.5;
  
  // Map frequencies to spectrum position (low=0/red, high=1/violet)
  float spectrumPos = lowFreq * 0.0 + midFreq * 0.5 + highFreq * 1.0;
  
  // Blend spectrum position with flowing pattern
  float colorIndex = mix(flowPattern, spectrumPos, 0.6);
  
  // Get rainbow color
  vec3 color = frequencyToRainbow(colorIndex);
  
  // Increased brightness based on amplitude and pattern
  float amplitude = freqInfluence;
  float brightness = (0.3 + pattern * 0.4 + amplitude * 0.5);
  
  // Apply brightness and blob mask
  color *= brightness * blobMask;
  
  // Add subtle glow on blob edges
  color += vec3(0.08) * amplitude * blobMask;
  
  gl_FragColor = vec4(color, 1.0);
}
