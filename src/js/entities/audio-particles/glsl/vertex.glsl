// Simplex 2D noise from Ian McEwan, Ashima Arts
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

uniform float uTime;
uniform float uAmplitude;
uniform float uFrequency;
uniform float uMaxDistance;
uniform float uInterpolation;
uniform float uTimeX;
uniform float uTimeY;
uniform float uTimeZ;

varying vec3 vPosition;

vec3 curl(vec3 pos) {
  float x = pos.x;
  float y = pos.y;
  float z = pos.z;

  float eps = 1.0;
  float eps2 = 2.0 * eps;
  float n1, n2, a, b;

  x += uTime * 0.05;
  y += uTime * 0.05;
  z += uTime * 0.05;

  vec3 curlVec = vec3(0.0);

  n1 = snoise(vec2(x, y + eps));
  n2 = snoise(vec2(x, y - eps));
  a = (n1 - n2) / eps2;

  n1 = snoise(vec2(x, z + eps));
  n2 = snoise(vec2(x, z - eps));
  b = (n1 - n2) / eps2;

  curlVec.x = a - b;

  n1 = snoise(vec2(y, z + eps));
  n2 = snoise(vec2(y, z - eps));
  a = (n1 - n2) / eps2;

  n1 = snoise(vec2(x + eps, z));
  n2 = snoise(vec2(x - eps, z));
  b = (n1 - n2) / eps2;

  curlVec.y = a - b;

  n1 = snoise(vec2(x + eps, y));
  n2 = snoise(vec2(x - eps, y));
  a = (n1 - n2) / eps2;

  n1 = snoise(vec2(y + eps, z));
  n2 = snoise(vec2(y - eps, z));
  b = (n1 - n2) / eps2;

  curlVec.z = a - b;

  return curlVec;
}

void main() {
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
  
  vec3 newpos = position;
  
  // Audio-reactive amplitude and frequency
  float amp = uAmplitude;
  amp = mix(amp, amp * uTimeX * 0.001, 0.75) + uTimeX;
  
  float freq = uFrequency;
  
  float freqPosX = freq * newpos.x;
  freqPosX = mix(freqPosX, freqPosX * uTimeX, uInterpolation);
  
  float freqPosY = freq * newpos.y;
  freqPosY = mix(freqPosY, freqPosY * uTimeY, uInterpolation);
  
  float freqPosZ = freq * newpos.z;
  freqPosZ = mix(freqPosZ, freqPosZ * uTimeZ, uInterpolation);
  
  vec3 target = newpos + curl(vec3(freqPosX, freqPosY, freqPosZ)) * amp;
  
  float d = length(position - target) / uMaxDistance;
  
  newpos = mix(position, target, pow(d, 3.0));
  
  mvPosition = modelViewMatrix * vec4(newpos, 1.0);
  
  gl_Position = projectionMatrix * mvPosition;
  
  gl_PointSize = 30.0 * (1.0 / -mvPosition.z);
  
  vPosition = newpos;
}
