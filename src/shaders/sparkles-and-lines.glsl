// Credits: https://www.youtube.com/watch?v=KGJUl8Teipk
// Original code: https://www.shadertoy.com/view/lscczl

#define S(a, b, t) smoothstep(a, b, t)

float DistLine(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0);
    
    return length(pa - ba*t);
}

float N21(vec2 p) {
	p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    
    return fract(p.x * p.y);
}

vec2 N22(vec2 p) {
	float n = N21(p);
    
    return vec2(n, N21(p + n));
}

float speed = .4;

// Global audio intensity (set in mainImage, read by helpers)
float gAudio = 0.0;

vec2 GetPos(vec2 id, vec2 offs) {
    vec2 n = N22(id + offs);
    
    float sp = speed * (0.75 + 1.75 * gAudio);
    float amp = 0.30 + 0.45 * gAudio;
    return offs + sin(n * sp * iTime) * amp;
}

float Line(vec2 p, vec2 a, vec2 b) {
	float d = DistLine( p, a, b);
    float m = S(.03, .01, d);
    float d2 = length(a-b);
    m *= S(1., .0, d2) * .5 + S(.05, .03, abs(d2 - .75));
    
    return m;
}

float Layer(vec2 uv) {
    float m = .0;
    vec2 gv = fract(uv) - .5;
    vec2 id = floor(uv);

    vec2 p[9];
    int i = 0;
    for(float y=-1.; y<=1.; y++) {
        for(float x=-1.; x<=1.; x++, i++) {
            p[i] = GetPos(id, vec2(x, y));
        }
    }

    for(int i=0; i<9; i++) {
        m += Line(gv, p[4], p[i]);

        vec2 j = (p[i] - gv) * 20.;
        float sparkle = 1./dot(j, j);
        m += sparkle * ( sin(speed * iTime + fract(p[i].x) * 10.) * .4 + .4);
    }
    m += Line(gv, p[1], p[3]);
    m += Line(gv, p[1], p[5]);
    m += Line(gv, p[5], p[7]);
    m += Line(gv, p[7], p[3]);
    
    return m;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord - .5*iResolution.xy)/iResolution.y;

    // More audio reactivity (sample a few FFT bins).
    float bass = texelFetch(iChannel0, ivec2(4., 0.), 0).x;
    float mid  = texelFetch(iChannel0, ivec2(32., 0.), 0).x;
    float treb = texelFetch(iChannel0, ivec2(160., 0.), 0).x;
    gAudio = clamp(bass * 1.4 + mid * 0.8 + treb * 0.5, 0.0, 1.0);
    
    float gradient = uv.y - 0.15;
    
    float m = 0.0;
    float t = iTime * speed * (0.08 + 0.18 * gAudio);

    float s = sin(t);
    float c = cos(t);
    mat2 rot = mat2(c, -s, s, c); 
    uv *= rot;

    
    for(float i=0.; i<= 1.; i+= 1./4.) {
        float z = fract(i + t);
        float size = mix(10., .5, z) * mix(0.9, 1.35, gAudio);
        float fade = S(0., .5, z) * S(1.2, .8, z);
        // No mouse offset; drift is audio-driven via gAudio inside helpers.
        m += Layer(uv * size + i * (18. + 16. * gAudio)) * fade;
    }

    float fft = bass;
    
    vec3 base = sin((t * t + 100.) * vec3(.345, .456, .657) + gAudio * 2.5) * .4 + .6;

    vec3 col = base * m * (0.85 + 1.25 * gAudio);

    gradient *= fft;
    
    col -= gradient * base;
       
    fragColor = vec4(col, 1.0);
}