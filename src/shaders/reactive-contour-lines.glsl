// Created by genis sole - 2016
// License Creative Commons Attribution 4.0 International License.
// https://www.shadertoy.com/view/lsK3zV

vec2 hash(in vec2 p) 
{
    p = vec2( dot(p,vec2(127.1,311.7)),
			  dot(p,vec2(299.5,783.3)) );

	return -1.0 + 2.0*fract(sin(p)*43758.545);
}

float noise(in vec2 p) 
{
    vec2 p00 = floor(p);
    vec2 p10 = p00 + vec2(1.0, 0.0);
    vec2 p01 = p00 + vec2(0.0, 1.0);
    vec2 p11 = p00 + vec2(1.0, 1.0);
    
    vec2 s = p - p00;
    
    float a = dot(hash(p00), s);
	float b = dot(hash(p10), p - p10);
	float c = dot(hash(p01), p - p01);
	float d = dot(hash(p11), p - p11);

    vec2 q = s*s*s*(s*(s*6.0 - 15.0) + 10.0);

    float c1 = b - a;
    float c2 = c - a;
    float c3 = d - c - b + a;

   	return a + q.x*c1 + q.y*c2 + q.x*q.y*c3;
}


float fbm(vec2 p) 
{
    // Shadertoy version uses an audio texture bound to iChannel1.
    // In this app, audio FFT is bound to iChannel0 (y ~ 0.25).
    float a0 = texture(iChannel0, vec2(0.01, 0.25)).r;
    float a1 = texture(iChannel0, vec2(0.25, 0.25)).r;
    float a2 = texture(iChannel0, vec2(0.50, 0.25)).r;
    float a3 = texture(iChannel0, vec2(0.75, 0.25)).r;

    // Add a small base so the pattern doesn't vanish when quiet.
    float w0 = 0.20 + 1.20 * a0;
    float w1 = 0.15 + 1.10 * a1;
    float w2 = 0.10 + 1.00 * a2;
    float w3 = 0.08 + 0.90 * a3;

    float h = noise(p) * w0;
    h += noise(p * 2.0) * w1 * 0.5;
    h += noise(p * 4.0) * w2 * 0.25;
    h += noise(p * 8.0) * w3 * 0.125;
    
    return h;
}

// Taken from https://iquilezles.org/articles/palettes
vec3 ColorPalette(in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d )
{
    return a + b*cos( 6.28318*(c*t+d) );
}

vec3 ContourLines(vec2 p) 
{
    // Modulate contour density with audio so the lines actually shift.
    float bass = texture(iChannel0, vec2(0.05, 0.25)).r;
    float mid  = texture(iChannel0, vec2(0.20, 0.25)).r;
    float hi   = texture(iChannel0, vec2(0.65, 0.25)).r;
    float audio = clamp(bass * 0.60 + mid * 0.35 + hi * 0.20, 0.0, 1.0);

    float contourScale = mix(7.0, 18.0, audio);
    float h = fbm(p * 1.5) * contourScale;
    float t = fract(h);
    float b = 1.0 - fract(h + 1.0);
    return ColorPalette(h*0.1,
                        vec3(1.0), vec3(0.7), vec3(1.0), vec3(0.0, 0.333, 0.666)) * 
               (pow(t, 16.0) + pow(b, 4.0));
        
}

vec2 Position() 
{
	return vec2(noise(vec2(iTime*0.14)), noise(vec2(iTime*0.12))) +
           vec2(0.0, iTime * 0.25);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = Position() + (fragCoord / max(iResolution.x, iResolution.y));
	fragColor = vec4(pow(ContourLines(p), vec3(0.55)), 1.0);
}