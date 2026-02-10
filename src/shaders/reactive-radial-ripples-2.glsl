// Converted from reactive-radial-ripples-2.shadertoy
// Adapted for single-pass audio reactivity
// Original used a history buffer to create ripples over time.
// This version maps frequency bands to radial rings.

// Palette Uniforms (simulated as constants)
// Using standard cosine palette parameters
#define uPaletteA vec3(0.5, 0.5, 0.5)
#define uPaletteB vec3(0.5, 0.5, 0.5)
#define uPaletteC vec3(1.0, 1.0, 1.0)
#define uPaletteD vec3(0.0, 0.33, 0.67)

float hash(in vec2 p) {
    float r = dot(p, vec2(12.1, 31.7)) + dot(p, vec2(299.5, 78.3));
    return fract(sin(r) * 4358.545);
}

vec3 pal(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d) {
    return a + b * cos(6.28318 * (c * t + d));
}

vec3 color(vec2 p) {
    return pal(
            0.55 + hash(p) * 0.2,
            uPaletteA,
            uPaletteB,
            uPaletteC,
            uPaletteD
            ) *
            1.5;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 resolution = iResolution.xy;
    vec2 v = (fragCoord - resolution * 0.5) / max(resolution.x, resolution.y) + vec2(0.2, 0.0);
    vec2 a = vec2(length(v), atan(v.y, v.x));

    const float pi = 3.1416;
    const float k = 14.0;
    const float w = 4.0;
    const float t = 1.0;

    float iVal = floor(a.x * k);
    
    // Adaptation: Map ring index 'iVal' to frequency spectrum
    // Inner rings (low iVal) = Low frequency
    // Outer rings (high iVal) = High frequency
    float freqIndex = clamp(iVal / 14.0, 0.0, 1.0);
    
    // Read audio data (FFT)
    // Using iChannel0, row 0
    float b = texture(iChannel0, vec2(freqIndex, 0.25)).r;
    
    // Signal shaping
    b = smoothstep(0.1, 0.8, b);

    // Calculate displaced polar coordinates
    // iVal acts as the 'time' or 'history' index in the original, here it is spatial frequency separation
    a = vec2(
        (iVal + 0.3 + b * 0.35) * (1.0 / k),
        (floor(a.y * (1.0 / pi) * (iVal * w + t)) + 0.5) * pi / (iVal * w + t)
    );

    vec3 c = color(vec2(iVal, a.y));

    // Convert back to cartesian for drawing
    a = vec2(cos(a.y), sin(a.y)) * a.x;

    // Draw segments
    c *= smoothstep(0.002, 0.0, length(v - a) - 0.02);
    
    // Center hole
    c *= step(0.07, length(v));
    
    // Center glow (reacting to sub-bass)
    float bass = texture(iChannel0, vec2(0.02, 0.25)).r;
    c += vec3(1.0, 1.0, 0.6) *
        smoothstep(0.002, 0.0, length(v) - 0.03 - bass * 0.03);

    fragColor = vec4(pow(c, vec3(0.5454)), 1.0);
}
