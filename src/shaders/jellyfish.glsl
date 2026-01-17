// https://www.shadertoy.com/view/3sKGzw

// Audio reactivity: in this app iChannel0 is a 512x2 audio texture.
// We sample the FFT row at y ~= 0.25.
float gAudio = 0.0;

float sampleFFT(float x) {
    return texture(iChannel0, vec2(clamp(x, 0.0, 1.0), 0.25)).r;
}

float audioLevel() {
    // A few taps across the spectrum (biased slightly toward low-mid).
    float a = 0.0;
    a += 0.30 * sampleFFT(0.04);
    a += 0.25 * sampleFFT(0.10);
    a += 0.20 * sampleFFT(0.22);
    a += 0.15 * sampleFFT(0.40);
    a += 0.10 * sampleFFT(0.70);
    // Shape: reduce noise floor, keep it subtle.
    a = clamp(a * 1.6, 0.0, 1.0);
    return clamp(pow(a, 1.15), 0.0, 1.0);
}


vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
vec3 fade(vec3 t) {return t*t*t*(t*(t*6.0-15.0)+10.0);}

float noise(vec3 P){
  vec3 Pi0 = floor(P); // Integer part for indexing
  vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P); // Fractional part for interpolation
  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); 
  return ((2.2 * n_xyz)+1.)/2.;
}

vec3 opRep( in vec3 p, in vec3 c)
{
    return mod(p+0.5*c,c)-0.5*c;
}

float bump(vec3 pos)
{
    vec3 npos = abs(sin(pos.xyz))*8. + iTime*.5;
    float n = noise(npos);
    return sin(n*10.);
}

void contrast( inout vec3 color, in float c) {
    float t = 0.5 - c * 0.5; 
    color.rgb = color.rgb * c + t;
}

vec3 hueShift( vec3 color, float hueAdjust ){

    const vec3  kRGBToYPrime = vec3 (0.299, 0.587, 0.114);
    const vec3  kRGBToI      = vec3 (0.596, -0.275, -0.321);
    const vec3  kRGBToQ      = vec3 (0.212, -0.523, 0.311);

    const vec3  kYIQToR     = vec3 (1.0, 0.956, 0.621);
    const vec3  kYIQToG     = vec3 (1.0, -0.272, -0.647);
    const vec3  kYIQToB     = vec3 (1.0, -1.107, 1.704);

    float   YPrime  = dot (color, kRGBToYPrime);
    float   I       = dot (color, kRGBToI);
    float   Q       = dot (color, kRGBToQ);
    float   hue     = atan (Q, I);
    float   chroma  = sqrt (I * I + Q * Q);

    hue += hueAdjust;

    Q = chroma * sin (hue);
    I = chroma * cos (hue);

    vec3    yIQ   = vec3 (YPrime, I, Q);

    return vec3( dot (yIQ, kYIQToR), dot (yIQ, kYIQToG), dot (yIQ, kYIQToB) );

}

float rand(float n){return fract(sin(n) * 43758.5453123);}

float opSmoothUnion( float d1, float d2, float k ) {
    float h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
    return mix( d2, d1, h ) - k*h*(1.0-h); 
}

float noise(float p){
	float fl = floor(p);
  float fc = fract(p);
	return mix(rand(fl), rand(fl + 1.0), fc);
}


float capsule( vec3 p, vec3 a, vec3 b, float r , float nmod)
{
    // Keep tentacles visually stable: no audio-driven offsets or bulges.
    p.x += sin(p.y*2. + iTime*3.)*.2;
    p.z += cos(p.y*2. + iTime*3.)*.2;

    float shaping = .05*abs(sin(iTime*3. + p.x + p.z + p.y*4. + p.z))*nmod;
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r + shaping;
}

float sphere(vec3 p)
{
    //p.y *= 1.25;
    // Keep the body rounder: reduce shaping and increase base radius.
    float shaping = .04 * abs(sin(3.36 + p.x + p.z + p.y * 4.0));
    return length(p + bump(p) * 0.006) - 0.78 + shaping; // 0.6 * 1.3 = 0.78
}

float torus( vec3 p, vec2 t )
{
   	p.y *= .4;
  	vec2 q = vec2(length(p.xz)-t.x,p.y);
  	return length(q)-t.y;
}

float model(vec3 p)
{
    //p = opRep(p, vec3(10.));
    // Audio-reactive size (subtle): bigger with louder audio.
    p *= 0.45 * (1.0 + gAudio * 0.22);
    p.y -= 1.25;
    
    // Global wobble used for motion; we'll keep the BODY rounder by applying
    // a smaller wobble to the head SDF than to the tentacles.
    float wob = 1.0 + gAudio * 0.85;
    p.y += sin(iTime * 3.0 + p.y * 3.0) * (0.075 * wob);
    p.x += sin(iTime * 3.0 + p.y * 3.0) * (0.050 * wob);
    p.z += sin(iTime * 3.0 + p.y * 3.0) * (0.050 * wob);

    vec3 pBody = p;
    float wobBody = 1.0 + gAudio * 0.25;
    pBody.y += sin(iTime * 3.0 + pBody.y * 3.0) * (0.020 * wobBody);
    pBody.x += sin(iTime * 3.0 + pBody.y * 3.0) * (0.012 * wobBody);
    pBody.z += sin(iTime * 3.0 + pBody.y * 3.0) * (0.012 * wobBody);
    
    // head
    float head = sphere(pBody);
    float torus = torus(pBody + vec3(0., 0.12 + sin(iTime * 3.0) * 0.04, 0.), vec2(0.85, 0.06));
    
    head = opSmoothUnion(head, torus, .2);
    
    // tentacles
    vec3 cp = p + vec3(0., -.0, 0.);
    
    float tent = capsule(cp + vec3(-.2, .15, .2), vec3(0.), vec3(0., -3., 0.), .2, 2.);
    tent = min(tent, capsule(cp + vec3(.2, .15, .2), vec3(0.), vec3(0., -3., 0.), .2, 2.));
    tent = min(tent, capsule(cp + vec3(.2, .15, -.2), vec3(0.), vec3(0., -3., 0.), .2, 2.));
    
    for(float i = 0.; i < 15.; i++)
    {
	    tent = min(tent, capsule(cp, vec3(0.), vec3(sin(i + rand(i*10.)), -2., cos(i + rand(i))), .075, 1.));
    }
    
    return opSmoothUnion(tent*.9, head, .15);
}

float raymarch(in vec3 ro, in vec3 rd)
{
    float dist = 0.;
    for(int i = 0; i < 90; i++)
    {
		float m = model(ro+rd*dist);
        dist += m;
        
        if(m < .01) return dist;
        else if(dist > 20.) break;
    }
    return -1.;
}

vec3 normal(vec3 pos)
{
    vec3 eps = vec3(.01, -.01, 0.);
    
    return normalize(vec3(
        model(pos + eps.xzz) - model(pos + eps.yzz),
        model(pos + eps.zxz) - model(pos + eps.zyz),
        model(pos + eps.zzx) - model(pos + eps.zzy)));
}

float shadow(in vec3 pos, in vec3 ld)
{
    float spread = 3.;
    float res = 1.0;
	float t = 0.2;
    // WebGL1 / GLSL ES 1.00 compilers can reject a `for(...;...;)` with an empty increment.
    // Use a bounded loop instead.
    for (int i = 0; i < 32; i++) {
        if (t >= 0.4) break;
        float dist = model(pos + ld * t);
        if (dist < 0.001) return 0.0;
        res = min(res, spread * dist / t);
        t += dist;
    }
    return res;
}

vec3 background()
{
    return vec3(.15, .05, .3);
}

vec3 shade(vec3 pos, vec3 nor, vec3 rd, float dist, vec3 ro)
{
    if(dist < 0.) return background();
    
    //vec3 ld = .6 * vec3(sin(iTime*.5 + .75), 1., cos(iTime*.5 + .75));
    vec3 ld = normalize(ro + vec3(1.));
    
    float dif = max(dot(nor,ld), 0.)*.6;
    float sha = 0.;
    if(dif > .01) sha = shadow(pos, ld);
    vec3 lin = vec3(dif*sha);
    
    // add color
    vec3 col1 = vec3(.2, .9, .8);
    vec3 col2 = vec3(.0, 0.3, .6);
    vec3 col = mix(col1, col2, lin)*.75;
    
    // bump & shift
    //float bump = bump(pos);
    //col = hueShift(col, bump*.25 + .75);
    //col.bg *= 2. + pow(1., 2.0)*.2;
    
    //col = hueShift(col, 4.25);
    //col = min(col*1.5, vec3(1.));
    //col *= pow(exp(-.02*dist*dist), .2);
    //col = pow(col, vec3(1.5));
    //col.rgb = mix(background(), col, exp(-.003*dist*dist)*1.0).rgb;
    
    //col *= 1.2;
    
    contrast(col, 1.5);

    // Subtle audio brightness lift.
    col *= 1.5 * (1.0 + gAudio * 0.60);
    
    //col.rb *= .9;
    
    
    return col;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    gAudio = audioLevel();

    vec2 p = (fragCoord - .5*iResolution.xy)/iResolution.y;
    // Audio adds a bit more shimmer/warp.
    p += noise(vec3(p.x*5., p.y*5., iTime)) * (0.05 + gAudio * 0.12);
    
    //vec3 ro = vec3(sin(iTime*.5), 1., cos(iTime*.5))*7.;
    //vec3 ro = vec3(6.);
    vec3 ta = vec3(0., 0., 0.);
    
    // Audio-reactive camera distance (very subtle).
    float camR = 7.0 * (1.0 + gAudio * 0.25);
    vec3 ro = vec3(cos(iTime/2.), 1., sin(iTime/2.)) * camR;
    
    vec3 w = normalize (ta-ro);
    vec3 u = normalize (cross (w, vec3(0., 1., 0.)));
    vec3 v = normalize (cross (u, w));
    mat3 mat = mat3(u, v, w);
    vec3 rd = normalize (mat*vec3(p.xy,1.));
    
    float dist = raymarch(ro, rd);
    vec3 pos = ro+rd*dist;
    vec3 nor = normal(pos);
    
    vec3 col = shade(pos, nor, rd, dist, ro);
    col = vec3(dot(col.rgb, vec3(0.299, 0.587, 0.114)));
    
    // Output to screen
    fragColor = vec4(col,1.0);
}
