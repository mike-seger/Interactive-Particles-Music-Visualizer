// https://www.shadertoy.com/view/lltfD7

float quintic(float x) {
 	return x*x*x*(6.*x*x-15.*x+10.);
}

float fft(float p) {
    return texture(iChannel0, vec2(p, 0.25)).x;
}

const float fac = 43758.5453123;

float hash(float p) {
    return fract(fac*sin(p));
}

float noise(in vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    
    float fac = 43758.5453123;
    const float upper = 100.;
    vec3 m = vec3(1., 10., 100.);
    vec2 o = vec2(1., 0.);
    
    float n000 = hash(dot((i + o.yyy), m));
    float n001 = hash(dot((i + o.xyy), m));
    float n010 = hash(dot((i + o.yxy), m));
    float n011 = hash(dot((i + o.xxy), m));
    float n100 = hash(dot((i + o.yyx), m));
    float n101 = hash(dot((i + o.xyx), m));
    float n110 = hash(dot((i + o.yxx), m));
    float n111 = hash(dot((i + o.xxx), m));
    
    float fx = quintic(f.x);
    float fy = quintic(f.y);
    float fz = quintic(f.z);
    
    float px00 = mix(n000, n001, fx);
    float px01 = mix(n010, n011, fx);
    
    float px10 = mix(n100, n101, fx);
    float px11 = mix(n110, n111, fx);
    
    float py0 = mix(px00, px01, fy);
    float py1 = mix(px10, px11, fy);
    
    return mix(py0, py1, fz);
}


float noise(in vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    
    vec2 m = vec2(100., 1.);
    vec2 o = vec2(1., 0.);
    
    float n00 = hash(dot((i + o.yy), m));
    float n01 = hash(dot((i + o.xy), m));
    float n10 = hash(dot((i + o.yx), m));
    float n11 = hash(dot((i + o.xx), m));
    
    float fx = quintic(f.x);
    float px0 = mix(n00, n01, fx);
    float px1 = mix(n10, n11, fx);
    
    return mix(px0, px1, quintic(f.y));
}

float ocean(vec2 p) {
    float f = fft(abs(1.-p.x))*0.2 + fft(abs(p.x))*0.52;
    
    float speed = .8;
    vec2 v01 = vec2( 1.,  0.) * iTime*speed;
    vec2 v02 = vec2( 0.,  1.) * iTime*speed;
    vec2 v03 = vec2( 1.,  1.) * iTime*speed;
    vec2 v04 = vec2(-1.,  0.) * iTime*speed;
    vec2 v05 = vec2(-1.,  0.) * iTime*speed;
    vec2 v06 = vec2(-1., -1.) * iTime*speed;
    
    f += 0.50000*noise(p*1.0  + v01); //*fft(p.x);
    f += 0.25000*noise(p*2.1  + v02);
    f += 0.12500*noise(p*3.9  + v03);
    f += 0.06250*noise(p*8.1  + v04);
    f += 0.03215*noise(p*15.8 + v05);
    f += 0.01608*noise(p*32.3 + v06);
    
    f = (3.-2.*f)*f*f;
    
    return f;
    
}

float map(in vec3 p) {   
    float o = ocean(p.xz * 0.08) * 3.;
    return p.y + 0.5 + o;
}

float calcShadow(in vec3 ro, in vec3 rd, float tmax) {
    float r = 1.;
    float t = 0.;
    for(int i = 0; i < 128; i++) {
        float h = map(ro + t * rd);
        r = min(r, tmax*h/t);
        if (r < 0.01) break;
        if (t > tmax) break;
        t += h;
    }
    return clamp(r, 0., 1.);
}

vec3 calcNormal(in vec3 p) {
    vec2 e = vec2(0.01, 0.);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
    
}


const vec3 SUN_DIR = normalize(vec3(-0.2, 0.15, -0.8));
const vec3 SUN_COL = vec3(0.95, 0.8, 0.85);

vec3 sky(in vec3 rd, float fac) {
    vec3 stars = pow(vec3(noise(rd.xy*iResolution.x)), vec3(90.));
    rd.y = max(0., rd.y);
    
    vec3 blue = 0.6* vec3(0.02, 0.09, 0.2) -rd.y*0.12;
    vec3 sunset = blue * (cos(fac * 6.28)*.7 + 1.); 
    return sunset + stars;
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = (2.*fragCoord - iResolution.xy)/iResolution.y;
    
    vec3 ro = vec3(0., 0., 0.);
    vec3 ta = vec3(0., 0., 1000.);
    float an = 1.2;
    vec3 up = normalize(vec3(cos(an), 1., sin(an)));
    vec3 ww = normalize(ta-ro);
    vec3 uu = normalize(cross(ww, up));
    vec3 vv = normalize(cross(uu, ww));
    
    vec3 rd = normalize(vec3(p.x*uu + p.y*vv - 2.*ww));
    
    float m = -1.;
    float t = 0.;
    float tmax = 300.;
    for(int i = 0; i<512; i++) {
        float h  = map(ro + rd * t);
        if ( h<0.01 ) { m = 1.; break; };
        if ( t>tmax ) break;
        t += h;
    }
    
    float sunsetFac = mod(iTime*0.12 + fft(0.1), 1.);
    vec3 skyCol = sky(rd, sunsetFac);
    vec3 col = skyCol;

    
    vec3 vol = vec3(0.);
    float den = 0.;
    float h = noise(fragCoord+p);
    float dh = 0.1*tmax / 32.0;
    rd.y  = -rd.y;
    rd.xz = rd.xz*mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 32; i++) {
        vec3 pos = ro + h*rd;
        vec3 dir = SUN_DIR - pos;
        vec3 l = (vec3(0.1, 0.99, 0.1)*calcShadow(pos, normalize(dir), length(dir)));
        float d = noise(pos + 2.*vec3(iTime, -iTime, -iTime));
            
        d *= exp(-0.85*pos.y);
       
        den += d*0.001;
        vol += l*den;
        
        if(den > 1.) break;
        
        h += dh;
    }
    col += pow(vec3(vol), vec3(1.5));
    
    col = pow(col, vec3(0.4545));
    
    fragColor = vec4(col,1.0);
}