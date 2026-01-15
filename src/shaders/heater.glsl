// # Common

const float PI = 3.141592653589793238462643;
const float TAU = PI * 2.;

float rand(vec2 co){
  return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

mat2 rot(float a){
	return mat2(cos(a), -sin(a),
        		sin(a), cos(a));
}

// http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl
vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c)
{
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}


// # Buffer A

float saw(float v, float d){
    return mod(v, d) * (d - floor(mod(v, d * 2.0)) * (d * 2.0)) + floor(mod(v, d * 2.0)); 
}

vec2 vec2LockIn(vec2 v){
    return vec2(saw(v.x, 1.), saw(v.y, 1.));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    float t = iTime * 1.;
    float lev = smoothstep(.15, .325, texture(iChannel1, vec2(.809, 0.)).r);
    
    vec2 uv = fragCoord/iResolution.xy;
    uv -= .5;
    vec2 uvNorm = uv;
    uvNorm.x *= iResolution.x / iResolution.y;
    vec2 offset = vec2(.01 * cos(t * .5), .01 * sin(t * .8)) * .1;
    float sSin = sin(t * .15);
    float speed = .98 + .021 * sSin - lev * .1;    
    vec4 light = vec4(0);
    
    for (float i = 0.; i < 1.; i += 1. / 12.){ 
        vec2 off = 20. * vec2(.01 * cos(t * (1.5 + .25 * sSin) + i * TAU), .01 * sin(t * (1.8 + .25 * sSin) + i * TAU)) * (.5 + .25 * sSin);
        float intensity = 1. * min(1., inversesqrt(1.5 - 30. * length(uvNorm + off)));
        vec4 c = vec4(hsv2rgb(vec3(t * .025 + i * .5, .75, .4 + lev * .1)), 1.);
    	light += c * (max(0., inversesqrt(length(uvNorm + off) * 550.) - .3))  + (inversesqrt(length(uvNorm + off) * 100.) * c * smoothstep(.99 * intensity, .995 * intensity, rand(off + uvNorm + t)));
    }
    
    fragColor = vec4(.985 * (texture(iChannel0, vec2LockIn(rot(iTime * (cos(t * .003) * .0001) + length(uvNorm) * (.01 * sin(t * .2))) * uv * speed + .5 + offset)) + light).rgb, lev);
}

// # Buffer B

vec4 dither(vec4 col, vec2 frag, int depth){    
    float cols = float(depth);
    float val = texture(iChannel1, mod(frag / 8., 1.)).r;
	return vec4((floor((col.rgb + val * (1. / cols)) * cols) / cols), 1.0);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/iResolution.xy;  
    uv -= .5;
    fragColor = dither(texture(iChannel0, uv + .5), fragCoord, 255);
}

// # Image

/*
	Heater.
	Code and music by @blokatt.
	19/02/19
*/

vec4 ditherHSV(vec3 col, vec2 frag, float depth){    
    float cols = float(depth);
    float val = texture(iChannel1, mod(frag / 8., 1.)).r;
    col = rgb2hsv(col);
	return mix(vec4(hsv2rgb(vec3((floor((col.rgb + val * (1. / cols)) * cols) / cols))), 1.),
               vec4(hsv2rgb(vec3((((col.rgb + val * (1. / cols)) * cols) / cols))), 1.), .5);
}

vec4 dither(vec3 col, vec2 frag, int depth){    
    float cols = float(depth);
    float val = texture(iChannel1, mod(frag / 8., 1.)).r;
	return vec4((floor((col.rgb + val * (1. / cols)) * cols) / cols), 1.0);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{   
    vec2 uv = fragCoord/iResolution.xy - .5;    
	vec4 col = texture(iChannel0, uv + .5); 
    vec4 d = ditherHSV(col.rgb, fragCoord, 2. - length(uv)) * 1.;      
    vec4 border = (vec4(1.) + vec4(4.) * smoothstep(7.84, 8.75, dot(vec2(1.), 12. * abs((uv) * rot(0.78539816339)))));
    vec4 dt = (d * d) / border;
    //vec4 dt = mix(dither(texture(iChannel0, uv + .5).rgb, fragCoord, 255), d * d, 1.) / border;
    fragColor = dt * mix(dither(col.rgb, fragCoord, 255), dither(col.rgb, fragCoord, 255) * dither(col.rgb, fragCoord, 8), .75) / border;                 
    fragColor *= 1. + col.a;
}
