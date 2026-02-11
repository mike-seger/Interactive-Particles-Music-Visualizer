// Converted from "Reactive Radial Ripples" by genis sole 2016
// License Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
// Adapted for single-pass audio reactivity by mapping frequency bands to radial rings.

// Original used a history buffer to show bass ripples moving outwards.
// This adaptation maps frequency spectrum to the rings (Center=Bass, Outer=Treble).

// Palette Definition
/*

// blueish
#define PALETTE_A vec3(0.5, 0.5, 0.5)
#define PALETTE_B vec3(0.5, 0.5, 0.5)
#define PALETTE_C vec3(1.0, 1.0, 1.0)
#define PALETTE_D vec3(0.0, 0.1, 0.2)
#define GLOW_COLOR vec3(1.0, 1.0, 0.6)

// orange -> blue
#define PALETTE_A vec3(0.5, 0.3, 0.1)
#define PALETTE_B vec3(0.6, 0.5, 0.3) 
#define PALETTE_C vec3(1.0, 1.0, 1.0)
#define PALETTE_D vec3(0.0, 0.08, 0.2)
#define GLOW_COLOR vec3(1.0, 0.4, 0.0)

// all orange
#define PALETTE_A vec3(0.8, 0.4, 0.1)
#define PALETTE_B vec3(0.2, 0.2, 0.1) 
#define PALETTE_C vec3(1.0, 1.0, 1.0)
#define PALETTE_D vec3(0.0, 0.0, 0.0) 
#define GLOW_COLOR vec3(1.0, 0.5, 0.0)

vec3 pal(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d )
{
    return a + b*cos( 6.28318*(c*t+d) );
}

vec3 color(vec2 p) {
    return pal(0.55+hash(p)*0.2, 
               PALETTE_A, PALETTE_B, PALETTE_C, 
               PALETTE_D) * 1.5;
}

*/
// Palette index - controlled by shader config UI
// The uniform will be injected by the shader customization system
// Default value is set in shaders-config/reactive-radial-ripples.js
#ifndef PALETTE_INDEX
#define PALETTE_INDEX 0
#endif

float hash(in vec2 p) {
    float r = dot(p,vec2(12.1,31.7)) + dot(p,vec2(299.5,78.3));
    return fract(sin(r)*4358.545);
}

// Get glow color by palette index
vec3 getGlowColor(int paletteIdx) {
    if (paletteIdx == 0) return vec3(1.0, 1.0, 0.6);  // Yellow-white (blueish palette)
    if (paletteIdx == 1) return vec3(1.0, 0.4, 0.0);  // Orange (orange->blue palette)
    if (paletteIdx == 2) return vec3(1.0, 0.2, 1.0);  // Magenta (purple palette)
    return vec3(0.8784, 0.1412, 0.102);                        // Cyan (green palette)
}

// Get palette color by index
vec3 getPaletteColor(int paletteIdx, float t) {
    // Palette 0: Blueish
    if (paletteIdx == 0) {
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = vec3(0.5, 0.5, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.0, 0.1, 0.2);
        return a + b * cos(6.28318 * (c * t + d));
    }
    // Palette 1: Orange -> Blue
    if (paletteIdx == 1) {
        vec3 a = vec3(0.5, 0.3, 0.1);
        vec3 b = vec3(0.6, 0.5, 0.3);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.0, 0.08, 0.2);
        return a + b * cos(6.28318 * (c * t + d));
    }
    // Palette 2: Purple/Magenta
    if (paletteIdx == 2) {
        vec3 a = vec3(0.5, 0.3, 0.5);
        vec3 b = vec3(0.5, 0.4, 0.5);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.3, 0.2, 0.5);
        return a + b * cos(6.28318 * (c * t + d));
    }
    // Palette 3: blue / red
    vec3 a = vec3(0.051, 0.0235, 0.5569);
    vec3 b = vec3(0.1725, 0.3176, 0.1451);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.0235, 0.2627, 0.7412);
    return a + b * cos(6.28318 * (c * t + d));
}

vec3 color(vec2 p) {
    float t = 0.55 + hash(p) * 0.2;
    return getPaletteColor(PALETTE_INDEX, t) * 1.5;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord)
{
       vec2 v = iResolution.xy;
    v = (fragCoord.xy  - v*0.5) / max(v.x, v.y) + vec2(0.2, 0.0);
    vec2 a = vec2(length(v), atan(v.y, v.x));
   
    const float pi = 3.1416;
    const float k = 14.0;
    const float w = 4.0;
    const float t = 1.0;
    
    float i = floor(a.x*k);
    
    // Adaptation: Map ring index 'i' to frequency spectrum
    float freq = i / 14.0;
    freq = clamp(freq, 0.0, 1.0);
    
    // Read audio data (FFT)
    float b = texture(iChannel0, vec2(freq, 0.25)).x; 
    b = smoothstep(0.1, 0.8, b);

    // Apply the displacement logic
    a = vec2((i + 0.3 + b*0.35)*(1.0/k), 
             (floor(a.y*(1.0/pi)*(i*w+t)) + 0.5 ) * pi/(i*w+t));
   
    vec3 c = color(vec2(i,a.y));
    
    // Polar to Cartesian for shape drawing
    a = vec2(cos(a.y), sin(a.y)) * a.x;
    
    // Draw the segments
    c *= smoothstep(0.002, 0.0, length(v-a) - 0.02);
    
    // Center hole
    c *= step(0.07, length(v));
    
    // Central glow/orb reacting to bass - now uses palette-specific glow color
    float bass = texture(iChannel0, vec2(0.05, 0.25)).x;
    c += getGlowColor(PALETTE_INDEX) * smoothstep(0.002, 0.0, length(v) - 0.03 - bass*0.03);
    
    fragColor = vec4(pow(c, vec3(0.5454)), 1.0);
}
