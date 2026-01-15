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

// Forked from "Draw with mouse [antialiased]"
// https://www.shadertoy.com/view/wlKfDm
// Customizations by Ruud Helderman

const float blur = 16.0;
const float glow = 10.0;
const float fade = 0.95;
const vec2 rise = vec2(0, 4);

#define S(d,r,pix) smoothstep(blur, -blur, (d)/(pix)-(r))
float line(vec2 p, vec2 a,vec2 b) {
    p -= a, b -= a;
    float h = clamp(dot(p, b) / dot(b, b), 0., 1.);
    return length(p - b * h);
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 ouv = (fragCoord.xy)/iResolution.y;
       
    vec2 pos1 = iMouse.xy/iResolution.y;
    vec4 prevMouse = texture(iChannel1, ouv).rgba;
    vec2 pos2 = prevMouse.rg;
       
    vec3 backCol = fade * texture(iChannel0, (fragCoord - rise)/iResolution.xy).rgb;
                
    float d = 0.;
    if(prevMouse.w > 0.){
        // d = clamp(drawLine(pos2, pos1, ouv, 3., 1.), 0., 1.);
        d = S( line( ouv,pos2, pos1), 3., glow/iResolution.x);
    }  
    
    d += max(0.0, 0.8 * texture(iChannel2, fragCoord/iResolution.xy).r - 0.3);
    
    // vec3 col = backCol + vec3(d);
    
    vec3 col = max(backCol, vec3(d));
    
    fragColor = vec4(col, 1.);    
}

// # Buffer B

// Forked from "Draw with mouse [antialiased]"
// https://www.shadertoy.com/view/wlKfDm

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    fragColor = vec4(iMouse.xy/iResolution.y,1.0,iMouse.z);    
}

// # Buffer B

// Forked from "Draw with mouse [antialiased]"
// https://www.shadertoy.com/view/wlKfDm

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    fragColor = vec4(iMouse.xy/iResolution.y,1.0,iMouse.z);    
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
const vec4 color = vec4(-1, -2, -3, 0);

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 pos = grain * fragCoord / iResolution.y - iTime * rise;
    float octave1 = 0.2 * (snoise(pos + iTime * slide) + snoise(pos - iTime * slide));
    float octave2 = 0.9 * snoise(pos * 0.45);
    float obstacles = 7.0 * texture(iChannel0, uv).r;
    fragColor = octave1 + length(vec2(oven * (1.0 - uv.y) + octave2, obstacles)) + color;
}
