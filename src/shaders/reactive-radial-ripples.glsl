// Converted from "Reactive Radial Ripples" by genis sole 2016
// License Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International.
// Adapted for single-pass audio reactivity by mapping frequency bands to radial rings.

// Original used a history buffer to show bass ripples moving outwards.
// This adaptation maps frequency spectrum to the rings (Center=Bass, Outer=Treble).

float hash(in vec2 p) {
    float r = dot(p,vec2(12.1,31.7)) + dot(p,vec2(299.5,78.3));
    return fract(sin(r)*4358.545);
}

//From https://iquilezles.org/articles/palettes
vec3 pal(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d )
{
    return a + b*cos( 6.28318*(c*t+d) );
}

vec3 color(vec2 p) {
    return pal(0.55+hash(p)*0.2, 
               vec3(0.5), vec3(0.5), vec3(1.0), 
               vec3(0.0, 0.1, 0.2)) * 1.5;
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
    // i is roughly 0 (center) to 7-10 (edge) depending on screen aspect
    float freq = i / 14.0; // Normalize
    freq = clamp(freq, 0.0, 1.0);
    
    // Read audio data (FFT)
    // Using iChannel0, row 0 (y=0.25 is safe for center of row)
    float b = texture(iChannel0, vec2(freq, 0.25)).x; 
    
    // Optional: Boost the signal a bit as it falls off in high freq
    b = smoothstep(0.1, 0.8, b);

    // Apply the displacement logic from original
    // This shifts the ring position based on intensity 'b'
    a = vec2((i + 0.3 + b*0.35)*(1.0/k), 
             (floor(a.y*(1.0/pi)*(i*w+t)) + 0.5 ) * pi/(i*w+t));
   
    vec3 c = color(vec2(i,a.y));
    
    // Polar to Cartesian for shape drawing
    a = vec2(cos(a.y), sin(a.y)) * a.x;
	
    // Draw the segments
    c *= smoothstep(0.002, 0.0, length(v-a) - 0.02);
    
    // Center hole
    c *= step(0.07, length(v));
    
    // Central glow/orb reacting to bass (freq approx 0)
    float bass = texture(iChannel0, vec2(0.05, 0.25)).x;
    c += vec3(1.0, 1.0, 0.6) * smoothstep(0.002, 0.0, length(v) - 0.03 - bass*0.03);
    
    fragColor = vec4(pow(c, vec3(0.5454)), 1.0);
}
