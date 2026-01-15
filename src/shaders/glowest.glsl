// https://www.shadertoy.com/view/33tcW

const float PI = acos(-1.);

// This project binds a 512x2 audio texture to iChannel0:
// - y ~= 0.25: FFT
// - y ~= 0.75: waveform
float fft01(float x) {
    x = clamp(x, 0.0, 1.0);
    return texture(iChannel0, vec2(x, 0.25)).x;
}

// Accepts either a normalized x in [0..1] OR a bin index in [0..511].
float FFT(float a) {
    float x = (a > 1.0) ? ((a + 0.5) / 512.0) : a;
    // Boost quieter bins without nuking everything to zero.
    float v = fft01(x);
    return pow(clamp(v, 0.0, 1.0), 2.2);
}


float get_freq(float hash) {
    // Map hash -> a frequency range (more interesting than always sampling bin 0/1).
    // Bias toward lows (more stable) but keep some highs.
    float x = mix(0.02, 0.70, pow(hash, 1.7));
    float v = FFT(x);
    return 0.25 + 1.75 * v;
    //float range = 255.;//hash * freqs.length();
    //return freqs[int(round(range))];
}

// https://www.shadertoy.com/view/4djSRW
vec3 hash33(vec3 p3)
{
	p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz+33.33);
    return fract((p3.xxy + p3.yxx)*p3.zyx);
}

float hash12(vec2 p)
{
	vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

mat2 rotate(float r) {
    return mat2(cos(r), -sin(r), sin(r), cos(r));
}

// https://iquilezles.org/articles/distfunctions/
// (a lot sdf functions are from him below)
float smin( float a, float b, float k )
{
    k *= 16.0/3.0;
    float h = max( k-abs(a-b), 0.0 )/k;
    return min(a,b) - h*h*h*(4.0-h)*k*(1.0/16.0);
}

float sdCappedCylinder( vec3 p, float r, float h )
{
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

float sdRoundCone( vec3 p, float r1, float r2, float h )
{
  float b = (r1-r2)/h;
  float a = sqrt(1.0-b*b);

  vec2 q = vec2( length(p.xz), p.y );
  float k = dot(q,vec2(-b,a));
  if( k<0.0 ) return length(q) - r1;
  if( k>a*h ) return length(q-vec2(0.0,h)) - r2;
  return dot(q, vec2(a,b) ) - r1;
}

float sdHexPrism( vec3 p, vec2 h )
{
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0*min(dot(k.xy, p.xy), 0.0)*k.xy;
  vec2 d = vec2(
       length(p.xy-vec2(clamp(p.x,-k.z*h.x,k.z*h.x), h.x))*sign(p.y-h.x),
       p.z-h.y );
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}


float sdVerticalCapsule( vec3 p, float h, float r )
{
  p.y -= clamp( p.y, 0.0, h );
  return length( p ) - r;
}

float sdTreeBranches(vec3 p) {
    float t = iTime;
    float s = cos(PI*.25);
    float d = 100.;

    for (int i = 0; i < 2; ++i) {
         for (int id = -1; id < 2; ++id) {
            float y = p.y - s*float(id);
            vec3 r = vec3(p.x, y, p.z);

            float dir = id == 0 ? 1. : -1.;
            r.xy *= rotate(dir * PI*.25);

            r.x += sin(r.y*3.+t)*.05;

            d = min(d, sdVerticalCapsule(r, 1.5, .02));
        }

        p.xz *= rotate(PI*.6);
        p.y += .2;
    }
    
    return d;
}

float sdTreeLeaves(vec3 p, vec2 fid) {
    float t = iTime;

    float h1 = hash12(fid);
    float body;
    if (h1 < .25) {
        body = length(p) - 1.5;
    } else if (h1 < .5) {
        body = sdRoundCone(p, 1., .2, 3.);
    } else if (h1 < .75) {
        body = sdHexPrism(p, vec2(1., 1.));
    } else {
        body = sdCappedCylinder(p, 1., 2.);
    }
    
    p.xz *= rotate(sin(p.y*1.+t*.1));
    vec3 s = vec3(.2);
    vec3 id = round(p/s);

    vec3 pt = p - s*id;

    vec3 h = hash33(id);
    pt += sin(h*100. + t)*.05;

    
    float freq = get_freq(h.x);
    return max(length(pt)*(1. - freq*.8) - .001, body);
    return max(length(pt) - .001, body);
}

float sdSnow(vec3 p) {
    float t = iTime;

    float fade_out = smoothstep(0., -30., p.y);
    
    p.y += t;

    vec3 s = vec3(2.);
    vec3 id = round(p/s);
    vec3 h = hash33(id);

    float freq = get_freq(h.x);

    vec3 pt = p - s*id;
    pt += sin(h*100.+t)*.2;

    return length(pt)*(1. - freq*.5) + fade_out;
    return length(pt) + fade_out;
}

float sdTree(vec3 p, vec2 id) {
    float t = iTime;
    p.xz += sin(p.y + t)*.05;

    float stem = sdVerticalCapsule(p, 3., .03);
    float branches = sdTreeBranches(p - vec3(0., 2.25, .0));
    float leaves = sdTreeLeaves(p - vec3(0., 2.75, 0.), id);
    float snow = sdSnow(p - vec3(0., 3., 0.));

    return smin(stem, smin(branches, min(snow, leaves), .02), .02);
}

float map(vec3 p) {
    float t = iTime;
    float d = 100.;

    // Global audio energy to drive larger-scale motion.
    float bass = FFT(0.03);
    float mid  = FFT(0.12);
    float hi   = FFT(0.55);
    float energy = clamp(bass * 1.2 + mid * 0.8 + hi * 0.35, 0.0, 2.0);

    p.y += sin(p.x + t*.5) * (.20 + .35 * bass);
    p.y += sin(p.z + t*.5) * (.20 + .35 * bass);
    p.xz *= rotate(0.05 * energy * sin(t*0.7));
    
    /*
    p.y += sin(p.x + t*.5)*.2*(FFT(1) + 1.);
    p.y += sin(p.z + t*.5)*.2*(FFT(25) + 1.);
    */
    p.y += sin(p.x + t*.5)*.2;
    p.y += sin(p.z + t*.5)*.2;


    {
        vec3 p = p;
        vec2 s = vec2(5.);
        vec2 id = round(p.xz / s);
        p.xz -= s*id;
        p.xz *= rotate(id.x*id.y);

        d = min(d, sdTree(p, id));
    }

    {
        vec3 p = p;
        vec2 s = vec2(.2);
        ivec2 id = ivec2(round(p.xz / s));

        p.xz -= s*vec2(id);

        // GLSL ES 1.00 (WebGL1) doesn't support integer '%' in many drivers.
        float dir = (mod(float(id.x), 2.0) < 0.5 && mod(float(id.y), 2.0) < 0.5) ? -1. : 1.;
        p.xz *= rotate(float(id.x) + dir * t);
        p.xy *= rotate(float(id.y) + dir * t);
        p.yz *= rotate(float(id.x)+float(id.y) + dir * t);

        vec3 h = hash33(vec3(id.xyx));

        float freq = get_freq(h.x);
        d = min(d, sdHexPrism(p, vec2((sin(h.x*100.+t)*.5+.5)*.05*freq)));
    }

    return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float t = iTime;
    vec3 col = vec3(0.);
    vec2 uv = (2. * gl_FragCoord.xy - iResolution.xy) / iResolution.y;

    float bass = FFT(0.03);
    float mid  = FFT(0.12);
    float hi   = FFT(0.55);
    float energy = clamp(bass * 1.2 + mid * 0.8 + hi * 0.35, 0.0, 2.0);
    
    vec3 ro = vec3(sin(t)*.3+2., .75, -t*.8);
    vec3 rd = normalize(vec3(uv, -1.));

    ro.y -= sin(ro.x + t*.5)*.2;
    ro.y -= sin(ro.z + t*.5)*.2;

    rd.yz *= rotate(PI*.1 + sin(t*.5)*PI*.05);

    float d = 0.;
    for (int i = 0; i < 30; ++i) {
        vec3 p = ro + d * rd;

        float dt = map(p);
        dt = abs(dt);

           col += (sin(vec3(1., 2., 3.) + p.x*.1+p.z*.01 +t*.1*(1.0 + 0.25*energy))*.2+.2)
               * (0.9 + 0.9 * energy)
               / (dt+.01);
        d += dt*.8;
    }

    col = tanh(col * .01);

    fragColor = vec4(col, 1.);
}
