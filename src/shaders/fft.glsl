// # Common

// https://www.shadertoy.com/view/msl3W8

#define R iResolution.xy
#define ss(a,b,t) smoothstep(a,b,t)
#define N normalize
// Buffer A expects iChannel0 to be its previous frame (self-feedback).
// Audio is sampled from iChannel3 (our runner provides audio as a fallback there).
#define T(uv) texture(iChannel0, uv).r

// Boost the input FFT amplitude so the effect is more visible.
// Adjust this if your audio source is quiet.
#define FFT_GAIN 5.0

// Dave Hoskins https://www.shadertoy.com/view/4djSRW
float hash11(float p)
{
    p = fract(p * .1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}
float hash13(vec3 p3)
{
	p3  = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}
vec2 hash23(vec3 p3)
{
	p3 = fract(p3 * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

// Martijn Steinrucken youtube.com/watch?v=b0AayhCO7s8
float gyroid (vec3 seed)
{
    return dot(sin(seed),cos(seed.yzx));
}

// # Buffer A



/////////// spicy noise
float fbm (vec3 seed)
{
    // thebookofshaders.com/13
    float result = 0.;
    float a = .5;
    for (int i = 0; i < 4; ++i)
    {
        // distort
        seed += result / 2.;
        
        // animate
        seed.y -= .1*iTime/a;
        
        // accumulate
        result += gyroid(seed/a)*a;
        
        // granule
        a /= 3.;
    }
    return result;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{

    /////////// coordinates
    vec2 uv = fragCoord/iResolution.xy;
    vec2 p = (2.*fragCoord-R)/R.y;
    
    // salt
    float rng = hash13(vec3(fragCoord, iFrame));
    
    // music
    // Read FFT from the audio texture (row 0 is centered around y ~= 0.25)
    float fft = texture(iChannel3, vec2(abs(uv.x-.5)*2., 0.25)).r;
    fft = min(.7, fft * (2.0 * FFT_GAIN));
    fft += .1;
    
    // noise
    vec3 seed = vec3(p, length(p) + iTime) * 2.;
    float noise = fbm(seed);
    float a = noise * 3.14;
    
    // normal
    vec3 unit = vec3(vec2(rng*.005), 0.);
    vec3 normal = normalize(vec3(T(uv-unit.xz)-T(uv+unit.xz),
                                 T(uv-unit.zy)-T(uv+unit.zy),
                                 unit.y));
                                 
    // mask
    vec2 mask = vec2(1.-abs(uv.x-.5), uv.y);
    
    // mouse
    vec2 mouse = iMouse.xy/R;
    float clic = step(0., iMouse.z);
    
    
    ////////// shape
    float shape = 1.;
    
    // bottom line
    shape *= ss(.01,.0,abs(uv.y));
    
    // salt
    shape *= rng;
    
    // frequency
    shape *= fft;
    
    
    ////////// forces field
    vec2 offset = vec2(0);
            
    // turbulence                     
    offset -= vec2(cos(a),sin(a)) * fbm(seed+.195) * (1.-mask.y);

    // slope
    offset -= normal.xy * mask.y;
    
    // mouse
    vec2 velocity = vec2(0);
    p -= (2.*iMouse.xy-R)/R.y;
    float mouseArea = ss(.3,.0,length(p)-.1);
    offset -= clic * normalize(p) * mouseArea * 0.2;
    velocity += (texture(iChannel0, vec2(0)).yz - mouse);
    if (length(velocity) > .001) velocity = clic * normalize(velocity) * mouseArea;
    
    // inertia
    velocity = clamp(texture(iChannel0, uv+velocity*.05).yz * .99 + velocity * .5,-1.,1.);
    
    // gravity
    offset -= vec2(0,1) * (1.-mask.y);
    
    // inertia
    offset += velocity;
    
    // apply
    uv += .05 * offset * fft;
    
    
    
    ////////// frame buffer
    vec4 frame = texture(iChannel0, uv);
    
    // fade out
    float fade = iTimeDelta*(1.-fft)*.5;
    shape = max(shape, frame.r - fade);
    
    // result
    shape = clamp(shape, 0., 1.);
    fragColor = vec4(shape, velocity, 1);
    
    // previous mouse
    if (fragCoord.x < 1. && fragCoord.y < 1.) fragColor = vec4(0,mouse,1);
}

// # Image


// FFT (Fire For Techno)
// audio reactive fluid simulacre
//
// variation of "Fire Fighter Fever" https://shadertoy.com/view/msf3WH
//
// inspired by recent fft simulation by Etienne Jacob
// https://twitter.com/etiennejcb/status/1581307953511964672

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/iResolution.xy;
                                 
    // grayscale
    vec4 data = texture(iChannel0, uv);
    
    // Inigo Quilez iquilezles.org/www/articles/palettes/palettes.htm
    vec3 color = .5+.5*cos(vec3(1,2,3)*5.5 + data.r*5.-4.*uv.y);
    
    // normal
    float rng = hash13(vec3(fragCoord, iFrame));
    vec3 unit = vec3(vec2(.05*rng), 0.);
    vec3 normal = normalize(vec3(T(uv-unit.xz)-T(uv+unit.xz),
                                 T(uv-unit.zy)-T(uv+unit.zy),
                                 unit.y));
    
    // light
    float light = dot(normal, N(vec3(0,4,1)))*.5+.5;
    color += light;
    
    // shadow
    color *= data.r;

    fragColor = vec4(color, 1);
    
    // debug art
    if (iMouse.z > 0. && iMouse.x/R.x < .2)
    {
        if (uv.x > .66) fragColor = vec4(normal*.5+.5, 1);
        else if (uv.x > .33) fragColor = vec4(vec3(sin(data.r*6.28*2.)*.5+.5), 1);
        else fragColor = vec4(data.yz*.5+.5,.5, 1);
    }
}
