// Magic Forest (single-pass)

/* The lighting is only obtained using glow: mushrooms and fireflies colors
 * are accumulated along the ray, with intensity depending on the distance
 * of the ray point to the closest mushroom and firefly.
 * There is no light source, no diffuse or specular lighting, no normal calculation.
 *
 * This simple glow effect still allows tree barks to be visible. The barks are
 * obtained as often by adding some noise to the sdf. The usual way I know of 
 * adding a 2d noise to the surface of a 3d object, or applying a 2d texture
 * to the surface of a 3d object, is to use triplanar or box mapping (see iq:
 * https://www.shadertoy.com/view/MtsGWH). However, here I naively apply a 2d noise
 * depending on the xy coordinates. It results in a constant noise along a z line,
 * producing interesting wood knots.
 *
 * The branches are obtained by thickening the intersection of two gyroidish surfaces.
 */

// https://www.shadertoy.com/view/dtX3zl

const float pi = 3.114159;

//#define AA

#define STEPS 1000
#define FAR 50.0

const float fov = 35.0;

const int FLOOR = 0;
const int TREES = 1;
const int LEAVES = 2;
const int MUSHROOMS = 3;
const int FLIES = 4;

float time;
float gAudio;
float gBeat;

float sampleFFT(float x)
{
    return texture(iChannel0, vec2(clamp(x, 0.0, 1.0), 0.25)).r;
}

float audioLevel()
{
    float a = 0.0;
    a += sampleFFT(0.02);
    a += sampleFFT(0.06);
    a += sampleFFT(0.12);
    a += sampleFFT(0.25);
    return a * 0.25;
}

float audioBeat()
{
    // Emphasize bass/low-mids for stronger synchronized pulsing.
    float b = 0.0;
    b = max(b, sampleFFT(0.015));
    b = max(b, sampleFFT(0.030));
    b = max(b, sampleFFT(0.060));
    b = max(b, sampleFFT(0.120));
    return b;
}

// Forward declarations (some GLSL ES 1.00 compilers are single-pass).
float hash12(vec2 p);
vec2 hash22(vec2 p);
vec3 hash32(vec2 p);
float noise12(vec2 p);
float noise12(vec2 p, float t);

// Per-mushroom pulse factor (asynchronous) driven by per-id FFT bins.
float mushroomPulseAt(vec3 worldP)
{
    vec3 c = worldP;
    float shift = c.x > 0. ? 1.5 : -1.5;
    c.x = c.x > 0. ? max(c.x-shift,0.) : min(c.x-shift,0.);
    vec2 cell = 2.0*round(.5*c.xz);
    float h = hash12(cell + vec2(19.3, 71.7));

    // Choose a stable FFT bin per mushroom.
    float bin = fract(h*0.83 + 0.11);
    float a = pow(sampleFFT(bin), 1.6);

    // Add a little per-mushroom phase so they don't pulse in unison.
    float phase = 6.2831853*h;
    float wob = 0.4 + 0.6*(0.5 + 0.5*sin(2.2*iTime + phase));

    // Scale factor for SDF scaling.
    return 1.0 + 0.30*a*wob;
}

// Per-firefly pulse driven by low-frequency bins. Keeps motion smooth (position uses time),
// but makes brightness react individually to bass.
float fireflyPulseAt(vec3 worldP)
{
    const mat2 m = mat2(.8,.6,-.6,.8);

    vec2 shift0 = .3*mix(vec2(.5,-1.8),vec2(-.3,-.4),0.)*time;
    vec2 id0 = floor(m*(worldP.xz-shift0));
    vec3 c0;
    c0.xz = mat2(.8,-.6,.6,.8)*(id0+.5)+shift0;
    c0.y = .5+hash12(id0+123.4)+.2*noise12(id0,time);
    float d0 = length(worldP-c0);

    vec2 shift1 = .3*mix(vec2(.5,-1.8),vec2(-.3,-.4),1.)*time;
    vec2 id1 = floor(m*(worldP.xz-shift1));
    vec3 c1;
    c1.xz = mat2(.8,-.6,.6,.8)*(id1+.5)+shift1;
    c1.y = .5+hash12(id1+123.4)+.2*noise12(id1,time);
    float d1 = length(worldP-c1);

    vec2 fid = (d0 < d1) ? id0 : id1;
    float h = hash12(fid + vec2(11.7, 43.9));

    // Bias bins toward bass: ~[0.01..0.10]
    float bin = mix(0.01, 0.10, fract(h*0.91 + 0.07));
    float bass = sampleFFT(bin);
    bass = pow(bass, 2.6);

    // Add a tiny per-firefly tremble so equal bins still don't look identical.
    float phase = 6.2831853*h;
    float trem = 0.85 + 0.15*sin(6.0*time + phase);

    return bass * trem;
}

// ---- Hash / noise helpers (missing in original port) ----
float hash12(vec2 p)
{
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p)
{
    float n = sin(dot(p, vec2(127.1, 311.7)));
    return fract(vec2(43758.5453123, 22578.1459123) * n);
}

vec3 hash32(vec2 p)
{
    float n1 = sin(dot(p, vec2(127.1, 311.7)));
    float n2 = sin(dot(p, vec2(269.5, 183.3)));
    float n3 = sin(dot(p, vec2(419.2, 371.9)));
    return fract(vec3(43758.5453123, 22578.1459123, 19642.3490423) * vec3(n1, n2, n3));
}

float noise12(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float noise12(vec2 p, float t)
{
    // Time-animated 2D noise (keeps fireflies alive without needing a 3D noise).
    return noise12(p + vec2(0.37, 1.17) * t);
}
/*** TREES ***/
// Closest tree coordinates in .xy channels, radius in .z channel
vec3 closestTree(vec2 p) {
    p.x = p.x > 0. ? max(p.x,2.5) : min(p.x,-2.5);
    p = 2.*round(.5*p);
    // Radius
    float r = .1+.3*hash12(p);
    p += hash22(p)-.5;
    return vec3(p,r);
}
// Branches
// Intersection of two gyroidish surfaces, thickened
float sdBranches(vec3 p) {
    p.y += .3;
    float d = length(vec2(
        abs(.1*dot(sin(4.*p),cos(4.*p.yzx))),
        abs(.1*dot(sin(4.8*p),cos(4.*p)))));
    d += .05*(2.-p.y)-.012;
    return d;
}

// Trunks
float sdTrees(vec3 p) {
    vec3 c = closestTree(p.xz);
    float r = c.z;
    r += .01*(sin(5.*p.y+c.x)+cos(7.8*p.y+c.y));
    r += .02*p.y*p.y*p.y;
    c.xy += .05*(sin(3.*p.y+c.y)+cos(4.7*p.y-c.x));
    float t = .5*min(length(p.xz-c.xy)-r+.03*noise12(vec2(60,20)*p.xy),.7);
    return t;
    float b = sdBranches(p);

    return min(t,b);
}

/*** FIREFLIES ***/
// Grid of fireflies, rotated, translated and randomly perturbed
// j can take values 0 or 1, yielding two different grids
float sdFlies(vec3 p, float j) {
    vec3 c;
    const mat2 m = mat2(.8,.6,-.6,.8);
    vec2 shift = .3*mix(vec2(.5,-1.8),vec2(-.3,-.4),j)*time;
    vec2 id = floor(m*(p.xz-shift)); 
    c.xz = mat2(.8,-.6,.6,.8)*(id+.5)+shift;
    c.y = .5+hash12(id+123.4)+.2*noise12(id,time);
    return length(p-c)-.01;
}
float sdFlies(vec3 p) {
    // Two grids of fireflies moving in different directions
    return min(sdFlies(.5*p,0.),sdFlies(.45*p,1.));
}
// The same functions, also providing the closst firefly's color
float sdFlies(vec3 p, float j, out vec3 color) {
    vec3 c;
    const mat2 m = mat2(.8,.6,-.6,.8);
    vec2 shift = .3*mix(vec2(.5,-1.8),vec2(-.3,-.4),j)*time;
    vec2 id = floor(m*(p.xz-shift)); 
    color = vec3(1,.5,.2)+.4*hash32(id)-.2;
    c.xz = mat2(.8,-.6,.6,.8)*(id+.5)+shift;
    c.y = .5+hash12(id+123.4)+.2*noise12(id,time);
    return length(p-c)-.01;
}
float sdFlies(vec3 p, out vec3 color) {
    vec3 c1,c2;
    float d1 = sdFlies(.5*p,0.,c1);
    float d2 = sdFlies(.45*p,1.,c2);
    color = d1<d2 ? c1 : c2;
    return min(d1,d2);
}

/*** FLOOR ***/
float floorHeight(vec2 p) {
    vec3 c = closestTree(p);
    p -= c.xy;
    // Elevation at tree positions
    return .3*exp(-.1*dot(p,p)/(c.z*c.z));
}
float sdFloor(vec3 p) {
    return p.y-floorHeight(p.xz);
}


/*** MUSHROOMS ***/
vec3 closestMushroom(vec3 p) {
    vec3 c = p;
    float shift = c.x > 0. ? 1.5 : -1.5;
    c.x = c.x > 0. ? max(c.x-shift,0.) : min(c.x-shift,0.);
    c.xz = 2.*round(.5*c.xz);
    c.x += shift;
    c.xz += hash22(c.xz)-.5;
    c.y = floorHeight(p.xz);
    return c;
}
float sdMushrooms(vec3 p) {
    vec3 wp = p;
    float k = mushroomPulseAt(wp);
    p -= closestMushroom(p);
    vec3 ps = p / k;
    p.y *= .5;

    float head = max(length(ps)-.2,.1-ps.y);
    float r = .02+.02*sin(20.*ps.y);
    float foot = max(length(ps.xz)-r,ps.y-.11);
    return min(foot,head) * k;
}

// The same functions, also providing the closest mushroom's color
vec3 closestMushroom(vec3 p, out vec3 color) {
    vec3 c = p;
    float shift = c.x > 0. ? 1.5 : -1.5;
    c.x = c.x > 0. ? max(c.x-shift,0.) : min(c.x-shift,0.);
    c.xz = 2.*round(.5*c.xz);
    c.x += shift;
    // Less bright/white; keep some subtle variation.
    color = vec3(0.38, 0.26, 0.16) + vec3(0.08, 0.10, 0.05) * (2.0*hash32(c.xz)-1.0);
    c.xz += hash22(c.xz)-.5;
    c.y = floorHeight(p.xz);
    return c;
}
float sdMushrooms(vec3 p, out vec3 color) {
    vec3 wp = p;
    float k = mushroomPulseAt(wp);
    p -= closestMushroom(p, color);
    vec3 ps = p / k;
    p.y *= .5;

    float head = max(length(ps)-.2,.1-ps.y);
    float r = .02+.02*sin(20.*ps.y);
    float foot = max(length(ps.xz)-r,ps.y-.11);
    return min(foot,head) * k;
}



float sd(vec3 p, out int id) {
    float d, minD = 1e6;
    vec2 pos, dir;
    
    // Floor
    d = sdFloor(p);
    if(d<minD) {
        id = FLOOR;
        minD = d;
    }

    d = sdTrees(p);
    if(d<minD) {
        id = TREES;
        minD = d;
    }

    d = sdBranches(p);
    if(d<minD) {
        id = LEAVES;
        minD = d;
    }
    d = sdMushrooms(p);
    if(d<minD) {
        id = MUSHROOMS;
        minD = d;
    }
    d = sdFlies(p);
    if(d<minD) {
        id = FLIES;
        minD = d;
    }
    return minD;
}

float march(vec3 start, vec3 dir, out int id, out vec3 glow) {
	float total = 0., d;
    float epsilon = 0.2/iResolution.y;
    bool reachedMax = true;
    glow = vec3(0);
    vec3 color;
    for(int i = 0; i < STEPS; i++) {
        vec3 p = start + total*dir; 
        d = sd(p,id);
        if(d<epsilon*total || total>FAR) { reachedMax = false; break; }
        float dm = sdMushrooms(p,color);
        // Individual mushroom pulsing (mostly geometry); add a mild per-mushroom emissive pulse.
        float k = mushroomPulseAt(p);
        float mGlow = 0.8 + 1.2*(k - 1.0)/0.30;
        float beatBoostM = 0.35 + 3.2*gBeat;
        glow += color*(mGlow*beatBoostM)*exp(-10.*dm);//1./(1.+500.*dm*dm);
        dm = sdFlies(p,color);
        // Yellow lights: keep motion smooth (position uses time), but pulse individually to bass.
        float fly = fireflyPulseAt(p);
        // Lower baseline brightness, stronger pulse.
        float flyBoost = 0.08 + 1.35*fly;
        glow += color*flyBoost*exp(-18.*dm);
        total += d;
    }
    if(total>FAR || reachedMax) id = -100;
    return total;
}

vec3 rayColor(vec3 start, vec3 dir) {
    int id;
    vec3 glow;
    
    float d = march(start, dir, id, glow);
    vec3 color = .1*glow;
    
    vec3 p = start + d * dir;
    vec3 c;
    
    if(id==MUSHROOMS) {
        closestMushroom(p,c);
        // Slightly dimmer mushroom albedo contribution.
        color += 0.65*c;
    } else if(id==FLIES) {
        sdFlies(p,c);
       color += c;
    }
    return mix(vec3(.01,.1,.3),color,exp(-.05*d));
}

mat3 setupCamera(vec3 forward, vec3 up) {
 	vec3 w = -normalize(forward);
    vec3 u = normalize(cross(up, w));
    vec3 v = cross(w, u);
    
    return mat3(u,v,w);
}
void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    float a = audioLevel();
    gAudio = pow(a, 1.5);
    gBeat = pow(audioBeat(), 2.2);
    time = iTime;

    vec3 forward = vec3(0,0,-1);
    vec3 cam = vec3(0,1,-.5*time);
    cam.y += .02*pow(abs(cos(4.*time)),3.);

    if(iMouse.z>0.0) {
        float a = pi*(2.*iMouse.x/iResolution.x-1.);
        float b = .5*pi*(-.2+1.2*iMouse.y/iResolution.y);
        forward = vec3(sin(a)*cos(b),sin(b),-cos(a)*cos(b));
    }
    
    mat3 m = setupCamera(forward, vec3(0,1,0));
    
    vec3 color = vec3(0.0);

    vec2 uv;
    #ifdef AA
    for(int ai = 0; ai < 2; ai++) {
        float i = -0.25 + float(ai) * 0.5;
        for(int aj = 0; aj < 2; aj++) {
            float j = -0.25 + float(aj) * 0.5;
            uv = 2.0*(fragCoord + vec2(i, j) - 0.5 * iResolution.xy)/iResolution.y;
            vec3 pix = vec3(tan(0.5*fov*0.01745)*uv,-1.0);
    
            vec3 dir = normalize(m*pix);
            // To avoid banding artifacts
            cam += .5*hash12(fragCoord)*dir;
    
            color += rayColor(cam, dir);
        }
    }
    color /= 4.0;
    #else
    uv = 2.0*(fragCoord - 0.5 * iResolution.xy)/iResolution.y;
    vec3 pix = vec3(tan(0.5*fov*0.01745)*uv,-1.0);
    vec3 dir = normalize(m*pix);

    // To avoid banding artifacts
    cam += .5*hash12(fragCoord)*dir;
    
    color = rayColor(cam, dir);
    #endif
     
    // Gamma
    color = sqrt(color);

    // Subtle global beat-linked bloom (keeps things feeling synced).
    color *= 0.85 + 0.85*gBeat;
    
    // Vignette
    uv = fragCoord.xy / iResolution.xy;
    uv *=  1. - uv.yx;
    color *= pow(uv.x*uv.y * 15.0, 0.25);
        
    fragColor = vec4(color,1.0);
}
