varying float vAlpha;
varying vec3 vColor;

attribute vec3 aDirection;
attribute float aRandom;

uniform float uTime;
uniform float uInfluence;

// Simplex 3D Noise by Ian McEwan, Ashima Arts
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Color palette function
vec3 palette(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
  return a + b*cos(6.28318*(c*t+d));
}

void main() {
  float progress = fract(uTime * 0.5 * aRandom);

  float alpha = smoothstep(0.0, 0.2, progress);
  alpha *= smoothstep(1.0, 0.6, progress);
  // Increase overall alpha for brightness
  alpha *= 1.5;

  float n = snoise(position + uTime * 0.3);

  vec3 pos = position + aDirection * progress + aDirection * uInfluence * 0.3;

  vec4 mvPosition = vec4(pos, 1.0);
  mvPosition = instanceMatrix * mvPosition;

  vec4 modelViewPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * modelViewPosition;
  
  // Dynamic point size 1-4x base size, varying with time and influence
  float sizeVariation = 1.0 + sin(uTime * aRandom * 3.0 + aRandom * 10.0) * 0.5; // 0.5 to 1.5
  sizeVariation += uInfluence * 2.0; // Add audio influence
  sizeVariation = clamp(sizeVariation, 1.0, 4.0);
  gl_PointSize = 2.0 * sizeVariation;

  vAlpha = alpha;
  
  // Blue-focused color palette
  vec3 colorA = vec3(0.3, 0.5, 0.8);  // Blue base
  vec3 colorB = vec3(0.4, 0.6, 0.9);  // Lighter blue
  vec3 colorC = vec3(0.8, 1.0, 1.2);  // Bright cyan-blue
  vec3 colorD = vec3(0.10, 0.30, 0.60); // Deep blue
  
  vColor = palette(distance(vec3(0), pos) * 2.0 + uTime * 0.15, colorA, colorB, colorC, colorD);
  // Boost color brightness
  vColor *= 1.8;
}
