// Simplex Noise, designed by Ken Perlin
// Code from "webgl-noise"
// https://github.com/ashima/webgl-noise/blob/master/src/noise2D.glsl

//
// Description : Array and textureless GLSL 2D simplex noise function.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : stegu
//     Lastmod : 20110822 (ijm)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License. See LICENSE file.
//               https://github.com/ashima/webgl-noise
//               https://github.com/stegu/webgl-noise
// 

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x*34.0)+10.0)*x);
}

float snoise(vec2 v)
  {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
// First corner
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);

// Other corners
  vec2 i1;
  //i1.x = step( x0.y, x0.x ); // x0.x > x0.y ? 1.0 : 0.0
  //i1.y = 1.0 - i1.x;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  // x0 = x0 - 0.0 + 0.0 * C.xx ;
  // x1 = x0 - i1 + 1.0 * C.xx ;
  // x2 = x0 - 1.0 + 2.0 * C.xx ;
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

// Permutations
  i = mod289(i); // Avoid truncation effects in permutation
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
		+ i.x + vec3(0.0, i1.x, 1.0 ));

  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;

// Gradients: 41 points uniformly over a line, mapped onto a diamond.
// The ring size 17*17 = 289 is close to a multiple of 41 (41*7 = 287)

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

// Normalise gradients implicitly by scaling m
// Approximation of: m *= inversesqrt( a0*a0 + h*h );
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );

// Compute final noise value at P
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// # Buffer A

// Feedback buffer that seeds the fire from audio (no mouse input).
// Uses iChannel0 for feedback (previous frame buffer) and iChannel3 for audio.

const float fade = 0.96;
const vec2 rise = vec2(0.0, 6.0);

float audioFFT(float x)
{
  // App convention: iChannel3 is bound to the 512x2 audio texture.
  x = clamp(x, 0.0, 0.999);
  return texture(iChannel3, vec2(x, 0.25)).r;
}

float audioVol()
{
  float a = 0.0;
  const int N = 16;
  for (int i = 0; i < N; i++) a += audioFFT(float(i) / float(N));
  return a / float(N);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
  vec2 uv = fragCoord / iResolution.xy;

  float vol = audioVol();
  float bass = pow(audioFFT(0.03), 2.0);
  float mid  = pow(audioFFT(0.12), 2.0);
  float energy = clamp(bass * 1.8 + mid * 1.2 + vol * 0.8, 0.0, 1.0);

  // Freeze the feedback advection + noise animation when silent.
  float motion = smoothstep(0.02, 0.10, energy);
  float fadeAmt = mix(0.995, fade, motion);
  vec3 backCol = fadeAmt * texture(iChannel0, (fragCoord - rise * motion) / iResolution.xy).rgb;

  // Seed near the bottom, driven by audio.
  float seedMask = smoothstep(0.16, 0.0, uv.y);
  float n = snoise(uv * vec2(iResolution.x / iResolution.y, 1.0) * 7.0 + vec2(0.0, iTime * 1.3 * motion));
  float spark = smoothstep(0.15, 1.0, n * 0.5 + 0.5);
  float d = seedMask * (0.08 + 0.9 * spark) * (0.3 + 1.7 * energy);

  vec3 col = max(backCol, vec3(d));
  fragColor = vec4(col, 1.0);
}

// # Image

// Simple but effective 2D fire effect:
// sum two noise patterns moving at different speeds, then do color mapping.
// Copyright 2022 Ruud Helderman
// MIT License

const vec2 grain = vec2(9, 6);
const float oven = 3.2;
const vec2 rise = vec2(0, 8);
const vec2 slide = vec2(0.5);

vec3 firePalette(float heat)
{
  heat = clamp(heat, 0.0, 1.0);
  vec3 c1 = vec3(0.02, 0.0, 0.0);
  vec3 c2 = vec3(0.85, 0.08, 0.02);
  vec3 c3 = vec3(1.00, 0.55, 0.08);
  // Keep the hottest range warm (yellow/orange) instead of blowing out to white.
  vec3 c4 = vec3(1.00, 0.80, 0.25);

  vec3 col = mix(c1, c2, smoothstep(0.00, 0.35, heat));
  col = mix(col, c3, smoothstep(0.35, 0.75, heat));
  // Delay the final blend so only extreme peaks reach c4.
  col = mix(col, c4, smoothstep(0.86, 1.00, heat));
  return col;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
  float vol = texture(iChannel3, vec2(0.05, 0.25)).r;
  float motion = smoothstep(0.02, 0.10, vol);

  vec2 pos = grain * fragCoord / iResolution.y - (iTime * motion) * rise;
  float octave1 = 0.2 * (snoise(pos + (iTime * motion) * slide) + snoise(pos - (iTime * motion) * slide));
    float octave2 = 0.9 * snoise(pos * 0.45);
  float obstacles = texture(iChannel0, uv).r;

  // Audio boosts intensity but keep it bounded to avoid white blowout.
  float audioBoost = 0.6 + 2.2 * smoothstep(0.02, 0.18, vol);
  float intensity = octave1 + length(vec2(oven * (1.0 - uv.y) + octave2, (4.0 + 6.0 * audioBoost) * obstacles));

  // Convert to a "heat" value for palette mapping.
  float heat = 0.0;
  heat += obstacles * (0.9 + 0.9 * audioBoost);
  heat += 0.12 * (octave1 + octave2);
  heat += 0.10 * (1.0 - uv.y);
  heat += 0.06 * smoothstep(1.5, 3.2, intensity);
  heat = clamp(heat, 0.0, 1.0);

  vec3 rgb = firePalette(heat);
  // Mild exposure for punch, but keep hue.
  rgb = 1.0 - exp(-rgb * (1.1 + 1.2 * heat));
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
