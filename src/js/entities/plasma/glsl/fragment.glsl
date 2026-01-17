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

  // Localized audio influence (so regions expand/contract locally, not globally)
  float bass = pow(clamp(lowFreq, 0.0, 1.0), 1.6);
  vec2 cell = floor((warpedUv + 1.0) * 3.0);
  float cellA = noise(cell + vec2(17.0, 11.0));
  float cellB = noise(cell + vec2(31.0, 59.0));
  float cellC = noise(cell + vec2(73.0, 7.0));
  float localBass = bass * mix(0.35, 1.35, cellA);
  float localMid = midFreq * mix(0.25, 1.25, cellB);
  float localHigh = highFreq * mix(0.25, 1.25, cellC);
  float localEnergy = clamp(localBass * 0.8 + localMid * 0.15 + localHigh * 0.05, 0.0, 1.0);

  // Boundary motion: audio pushes local warp, moving region boundaries
  vec2 boundaryWarp = vec2(
    fbm(warpedUv * 5.0 + cell * 0.15 + vec2(time * 0.06, -time * 0.05)),
    fbm(warpedUv * 5.0 + cell * 0.15 + vec2(-time * 0.05, time * 0.06))
  ) - 0.5;
  warpedUv += boundaryWarp * (0.18 * localEnergy);
  
  // Create multiple flowing layers with different speeds and randomness
  float layer1 = fbm(warpedUv * 2.0 + vec2(time * 0.06, time * 0.04));
  float layer2 = fbm(warpedUv * 3.0 - vec2(time * 0.05, -time * 0.06));
  float layer3 = fbm(warpedUv * 4.0 + vec2(-time * 0.04, time * 0.05));
  
  // Combine layers for complex pattern
  float pattern = (layer1 + layer2 + layer3) / 3.0;
  
  // Add frequency-based modulation
  float freqInfluence = lowFreq * 0.55 + midFreq * 0.25 + highFreq * 0.20;
  // (Global bass is computed above; boundary/edge behavior uses localEnergy)
  
  // Blob boundaries: keep global size stable, drive boundary threshold locally
  float blobSize = 0.26 + sin(time * 0.3) * 0.12 + cos(time * 0.4) * 0.08;
  float blobThreshold = 0.58 - blobSize + freqInfluence * 0.25 + (localEnergy - 0.35) * 0.35;
  
  // Create non-contiguous blobs with audio-reactive edge width (boundaries move a lot)
  float edgeW = mix(0.22, 0.07, localEnergy);
  float blobMask = smoothstep(blobThreshold - edgeW, blobThreshold + edgeW, pattern);
  
  // Add variation to blob edges
  float edgeNoise = fbm(warpedUv * (5.0 + 7.0*localEnergy) + time * (0.1 + 0.25*localEnergy));
  blobMask *= smoothstep(0.28 - 0.10*localEnergy, 0.72 + 0.10*localEnergy, edgeNoise);
  
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
  float brightness = (0.25 + pattern * 0.35 + amplitude * 0.55);
  brightness *= 0.85 + 0.55*localEnergy;
  
  // Apply brightness and blob mask
  color *= brightness * blobMask;
  
  // Add subtle glow on blob edges
  color += vec3(0.08) * amplitude * blobMask;
  
  gl_FragColor = vec4(color, 1.0);
}
