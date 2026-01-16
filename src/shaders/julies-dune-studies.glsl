// # Common

const float ZUCCONI_OFFSET = 1.05;

// Spectral Colour Schemes
// By Alan Zucconi
// Website: www.alanzucconi.com
// Twitter: @AlanZucconi

// Example of different spectral colour schemes
// to convert visible wavelengths of light (400-700 nm) to RGB colours.

// The function "spectral_zucconi6" provides the best approximation
// without including any branching.
// Its faster version, "spectral_zucconi", is advised for mobile applications.


// Read "Improving the Rainbow" for more information
// http://www.alanzucconi.com/?p=6703



float saturate (in float x)
{
    return min(1.0, max(0.0,x));
}
vec3 saturate (in vec3 x)
{
    return min(vec3(1.,1.,1.), max(vec3(0.,0.,0.),x));
}

// --- Spectral Zucconi --------------------------------------------
// By Alan Zucconi
// Based on GPU Gems: https://developer.nvidia.com/sites/all/modules/custom/gpugems/books/GPUGems/gpugems_ch08.html
// But with values optimised to match as close as possible the visible spectrum
// Fits this: https://commons.wikimedia.org/wiki/File:Linear_visible_spectrum.svg
// With weighter MSE (RGB weights: 0.3, 0.59, 0.11)
vec3 bump3y (in vec3 x, in vec3 yoffset)
{
	vec3 y = vec3(1.,1.,1.) - x * x;
	y = saturate(y-yoffset);
	return y;
}
vec3 spectral_zucconi (in float w)
{
    // w: [400, 700]
	// x: [0,   1]
	float x = saturate((w - 400.0)/ 300.0);

	const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
	const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
	const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);

	return bump3y (	cs * (x - xs), ys);
}

// --- Spectral Zucconi 6 --------------------------------------------

// Based on GPU Gems
// Optimised by Alan Zucconi
vec3 spectral_zucconi6 (in float x)
{

	const vec3 c1 = vec3(3.54585104, 2.93225262, 2.41593945);
	const vec3 x1 = vec3(0.69549072, 0.49228336, 0.27699880);
	const vec3 y1 = vec3(0.02312639, 0.15225084, 0.52607955);

	const vec3 c2 = vec3(3.90307140, 3.21182957, 3.96587128);
	const vec3 x2 = vec3(0.11748627, 0.86755042, 0.66077860);
	const vec3 y2 = vec3(0.84897130, 0.88445281, 0.73949448);

	return
		bump3y(c1 * (x - x1), y1) +
		bump3y(c2 * (x - x2), y2) ;
}

mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}


// Optimized AshimaSimplexNoise by @makio64 https://www.shadertoy.com/view/Xd3GRf
// Original : https://github.com/ashima/webgl-noise/blob/master/src/noise3D.glsl
// 2D Version: https://www.shadertoy.com/view/4sdGD8
lowp vec4 permute(in lowp vec4 x){return mod(x*x*34.+x,289.);}
lowp float snoise(in mediump vec3 v){
  const lowp vec2 C = vec2(0.16666666666,0.33333333333);
  const lowp vec4 D = vec4(0,.5,1,2);
  lowp vec3 i  = floor(C.y*(v.x+v.y+v.z) + v);
  lowp vec3 x0 = C.x*(i.x+i.y+i.z) + (v - i);
  lowp vec3 g = step(x0.yzx, x0);
  lowp vec3 l = (1. - g).zxy;
  lowp vec3 i1 = min( g, l );
  lowp vec3 i2 = max( g, l );
  lowp vec3 x1 = x0 - i1 + C.x;
  lowp vec3 x2 = x0 - i2 + C.y;
  lowp vec3 x3 = x0 - D.yyy;
  i = mod(i,289.);
  lowp vec4 p = permute( permute( permute(
	  i.z + vec4(0., i1.z, i2.z, 1.))
	+ i.y + vec4(0., i1.y, i2.y, 1.))
	+ i.x + vec4(0., i1.x, i2.x, 1.));
  lowp vec3 ns = .142857142857 * D.wyz - D.xzx;
  lowp vec4 j = -49. * floor(p * ns.z * ns.z) + p;
  lowp vec4 x_ = floor(j * ns.z);
  lowp vec4 x = x_ * ns.x + ns.yyyy;
  lowp vec4 y = floor(j - 7. * x_ ) * ns.x + ns.yyyy;
  lowp vec4 h = 1. - abs(x) - abs(y);
  lowp vec4 b0 = vec4( x.xy, y.xy );
  lowp vec4 b1 = vec4( x.zw, y.zw );
  lowp vec4 sh = -step(h, vec4(0));
  lowp vec4 a0 = b0.xzyw + (floor(b0)*2.+ 1.).xzyw*sh.xxyy;
  lowp vec4 a1 = b1.xzyw + (floor(b1)*2.+ 1.).xzyw*sh.zzww;
  lowp vec3 p0 = vec3(a0.xy,h.x);
  lowp vec3 p1 = vec3(a0.zw,h.y);
  lowp vec3 p2 = vec3(a1.xy,h.z);
  lowp vec3 p3 = vec3(a1.zw,h.w);
  lowp vec4 norm = inversesqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  lowp vec4 m = max(.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.);
  return .5 + 12. * dot( m * m * m, vec4( dot(p0,x0), dot(p1,x1),dot(p2,x2), dot(p3,x3) ) );
}

// # Buffer A

float spatializeAudio(in float dist) {
    float fftDomain = pow(dist, 2.0);
    float fft = texture(iChannel1, vec2(fftDomain * .09, .25)).r;
    fft = pow(fft, 4.0);
    return fft;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 st =
        (2. * fragCoord - iResolution.xy)
        / min(iResolution.x, iResolution.y);
    float dist = length(st);
    
    float audioSignal = spatializeAudio(dist);
    float zucconiDomain = ZUCCONI_OFFSET - dist;    
    vec3 color = spectral_zucconi6(zucconiDomain) * audioSignal * .2;
    //float rotationDomain = (color.r + color.g + color.b) * 1.0;
    //vec2 stShift = vec2(color.r - .005, color.g - .005) * vec2(sin(rotationDomain), cos(rotationDomain));
    //stShift *= st * .5;
    
    vec3 mixedColor = texture(iChannel0, fragCoord / iResolution.xy - st * 0.09
                             * iResolution.y / iResolution.xy
                              //,.99
                             ).rgb;
    float angle = atan(st.x, st.y);

    float noiseScale = 1.0;

    vec2 offset = uv //+ vec2((mixedColor.g - .5) * 0.01, (mixedColor.r - .5) * 0.01) 
    
    + (vec2(
        snoise(vec3(st * noiseScale, iTime * .3)),
        snoise(vec3(st * noiseScale+ vec2(1000.0), iTime * .3))
     ) - .5) * .04;
    //* vec2(sin(angle * 1.0 + iTime * .5), cos(angle * 1.0 + iTime * .7));

    //vec3 prevColor = texture(iChannel0, uv - stShift).rgb;
    vec3 prevColor = texture(iChannel0, offset).rgb;
    color += prevColor * 0.95;
    //vec3 color = prevColor * 0. + spectral_zucconi6(dist * 1.3 - .3) * audioSignal * 2.0;

    fragColor = vec4(color, audioSignal);
}

// # Image

// Fork of "Julie's Dunes study" by morisil. https://shadertoy.com/view/dllSWj
// 2023-03-21 23:14:02

// NOTE: audio on shadertoy works only if you interact ith the
// webpage while AudioContext is being created and then SoundCloud
// track is autoplayed. This visual does not exist without sound,
// pleese keep it in mind if you see a black screen. In such a case
// you can reload the page while interacting with it.

// Copyright Kazimierz Pogoda, 2023 - https://xemantic.com/
// I am the sole copyright owner of this Work.
// You cannot host, display, distribute or share this Work in any form,
// including physical and digital. You cannot use this Work in any
// commercial or non-commercial product, website or project. You cannot
// sell this Work and you cannot mint an NFTs of it.
// I share this Work for educational purposes, and you can link to it,
// through an URL, proper attribution and unmodified screenshot, as part
// of your educational material. If these conditions are too restrictive
// please contact me and we'll definitely work it out.

// copyright statement borrowed from Inigo Quilez

// Music by Julie Amouzegar Kim:
// https://soundcloud.com/julie-amouzegar/dunes-piano-version

// The music was composed by Julie, my dearest collaborator and
// cerebral sibling. This sequence of progressions appeared in
// Julie’s dream, and I was there as well. So even though I heard
// it already in her dream conceptually, I had to wait until she
// expressed it so I could perceive it. And I like it a lot,
// especially while listening to it on loop, while working on
// visuals driven by this music.

// See also Dunes - piano, study:
// https://www.shadertoy.com/view/cllSWM

// See also Generative Art Deco 4:
// https://www.shadertoy.com/view/mds3DX

const float SHAPE_SIZE = .618;
const float CHROMATIC_ABBERATION = .02;
const float ITERATIONS = 7.;
const float INITIAL_LUMA = .6;


float getColorComponent(in vec2 st, in float modScale, in float blur) {
    vec2 modSt = mod(st, 1. / modScale) * modScale * 2. - 1.;
    float dist = length(modSt);
    float angle = atan(modSt.x, modSt.y) + sin(iTime * .08) * 9.0;
    float shapeMap = smoothstep(SHAPE_SIZE + blur, SHAPE_SIZE - blur, sin(dist * 3.0) * .5 + .5);
    return shapeMap;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 feedback = texture(iChannel0, uv);
    float blur = .4 + sin(iTime * .52) * .2;

    vec2 st =
        (2.* fragCoord - iResolution.xy)
        / min(iResolution.x, iResolution.y);
    vec2 origSt = st;

    st -= (feedback.r + feedback.g + feedback.b) * st * .3;

    st *= rotate2d(sin(iTime * .14) * .3);
    st *= (sin(iTime * .15) + 2.) * .3;
    
    st *= log(length(st * .428)) * 1.3;


    float modScale = 1.;

    vec3 color = vec3(0);
    float luma = INITIAL_LUMA;
    for (float i = 0.; i < ITERATIONS; i++) {
        vec2 center = st + vec2(sin(iTime * .12), cos(iTime * .13)) * 1.5;
        float fft = texture(iChannel0, vec2(length(center), .25)).r;
        
        vec3 shapeColor = vec3(
            getColorComponent(center - st * CHROMATIC_ABBERATION, modScale, blur),
            getColorComponent(center, modScale, blur),
            getColorComponent(center + st * CHROMATIC_ABBERATION, modScale, blur)        
        ) * luma;
        st *= 1.1 + getColorComponent(center, modScale, .04) * 1.2;
        st *= rotate2d(sin(iTime  * .05) * 1.33);
        color += shapeColor;
        color = clamp(color, 0., 1.);
        luma *= .6;
        blur *= .63;
    }

    float origDist = length(origSt);
    float zucconiDomain = ZUCCONI_OFFSET - origDist;
    vec3 audioColor = spectral_zucconi6(zucconiDomain) * feedback.a * .4;
    color *= feedback.rgb;
    color += audioColor;
    fragColor = vec4(color, 1.0);
}
