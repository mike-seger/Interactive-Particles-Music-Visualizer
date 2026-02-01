// https://www.shadertoy.com/view/4ssGzn

// ray marched fireball
// sgreen
const int _VolumeSteps = 128;
const float _StepSize = 0.02; 
const float _Density = 0.2;

const float _SphereRadius = 1.0;
const float _NoiseFreq = 2.0;
const float _NoiseAmp = 1.0;
const vec3 _NoiseAnim = vec3(0, -1, 0);

// Audio (computed once per pixel; iChannel0 is the app's 512x2 audio texture).
float gVol = 0.0;
float gBass = 0.0;
float gMid = 0.0;
float gHigh = 0.0;
float gRadius = _SphereRadius;

float stAudio(float x)
{
    // App convention: FFT row at y≈0.25
    x = clamp(x, 0.0, 0.999);
    return texture(iChannel0, vec2(x, 0.25)).r;
}

void computeAudio()
{
    float bass = 0.0;
    bass += stAudio(0.01);
    bass += stAudio(0.02);
    bass += stAudio(0.04);
    bass += stAudio(0.06);
    bass *= 0.25;

    float mid = 0.0;
    mid += stAudio(0.10);
    mid += stAudio(0.14);
    mid += stAudio(0.18);
    mid += stAudio(0.24);
    mid *= 0.25;

    float high = 0.0;
    high += stAudio(0.35);
    high += stAudio(0.50);
    high += stAudio(0.65);
    high += stAudio(0.80);
    high *= 0.25;

    // Shape bands: responsive but not jittery.
    bass = clamp(pow(max(bass, 0.0), 1.35), 0.0, 1.0);
    mid  = clamp(pow(max(mid, 0.0), 1.20), 0.0, 1.0);
    high = clamp(pow(max(high, 0.0), 1.10), 0.0, 1.0);

    gBass = bass;
    gMid = mid;
    gHigh = high;
    gVol = clamp(bass * 1.00 + mid * 0.40 + high * 0.15, 0.0, 1.0);
}

// iq's nice integer-less noise function
float hash31(vec3 p)
{
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float noise( in vec3 x )
{
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f*f*(3.0-2.0*f);

    float n000 = hash31(p + vec3(0.0, 0.0, 0.0));
    float n100 = hash31(p + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(p + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(p + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(p + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(p + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(p + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(p + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    float nxyz = mix(nxy0, nxy1, f.z);

    return nxyz * 2.0 - 1.0;
}

float fbm( vec3 p )
{
    float f = 0.0;
    float amp = 0.5;
    for(int i=0; i<4; i++)
    {
        //f += abs(noise(p)) * amp;
        f += noise(p) * amp;
        p *= 2.03;
        amp *= 0.5;
	}
    return f;
}

vec2 rotate(vec2 v, float angle)
{
    return v * mat2(cos(angle),sin(angle),-sin(angle),cos(angle));
}

// returns signed distance to surface
float distanceFunc(vec3 p)
{	

	// distance to sphere
    float d = length(p) - gRadius;
	// offset distance with noise
    float t = iTime * (0.95 + 0.65 * gMid);
    float nAmp = _NoiseAmp * (0.85 + 1.15 * gBass + 0.35 * gHigh);
    float nFreq = _NoiseFreq * (0.90 + 0.60 * gMid);
    d += fbm(p*nFreq + _NoiseAnim*t) * nAmp;
	return d;
}

// shade a point based on distance
vec4 shade(float d)
{	
    if (d >= 0.0 && d < 0.2) return (mix(vec4(3, 3, 3, 1), vec4(1, 1, 0, 1), d / 0.2));
	if (d >= 0.2 && d < 0.4) return (mix(vec4(1, 1, 0, 1), vec4(1, 0, 0, 1), (d - 0.2) / 0.2));
	if (d >= 0.4 && d < 0.6) return (mix(vec4(1, 0, 0, 1), vec4(0, 0, 0, 0), (d - 0.4) / 0.2));    
    if (d >= 0.6 && d < 0.8) return (mix(vec4(0, 0, 0, 0), vec4(0, .5, 1, 0.2), (d - 0.6) / 0.2));
    if (d >= 0.8 && d < 1.0) return (mix(vec4(0, .5, 1, .2), vec4(0, 0, 0, 0), (d - 0.8) / 0.2));            
    return vec4(0.0, 0.0, 0.0, 0.0);
}

// procedural volume
// maps position to color
vec4 volumeFunc(vec3 p)
{
    //p.xz = rotate(p.xz, p.y*2.0 + iTime);	// firestorm
	float d = distanceFunc(p);
	return shade(d);
}

// ray march volume from front to back
// returns color
vec4 rayMarch(vec3 rayOrigin, vec3 rayStep, out vec3 pos)
{
	vec4 sum = vec4(0, 0, 0, 0);
	pos = rayOrigin;
	for(int i=0; i<_VolumeSteps; i++) {
		vec4 col = volumeFunc(pos);
        float dens = _Density * (0.85 + 1.75 * gBass + 0.35 * gVol);
        col.a *= dens;
		// pre-multiply alpha
		col.rgb *= col.a;
		sum = sum + col*(1.0 - sum.a);	
		pos += rayStep;
	}
	return sum;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    computeAudio();

    // Reuse the previously audio-driven rotation parameter as a *volume pulse*.
    // Keep the pulse bounded and compensate with zoom so it stays within frame.
    float orbitAudio = 0.20 + 0.25 * gVol;
    float pulse01 = clamp((orbitAudio - 0.20) / 0.25, 0.0, 1.0);
    gRadius = _SphereRadius * (0.92 + 0.16 * pulse01);

    vec2 p = (fragCoord.xy / iResolution.xy)*2.0-1.0;
    p.x *= iResolution.x/ iResolution.y;

    // No mouse reactivity: use a gentle orbit (time-based; audio no longer affects rotation).
    float rotx = 0.55 + 0.15 * sin(iTime * (0.35 + 0.35 * gMid));
    float roty = iTime * 0.22;

    float zoom = 4.0 + (gRadius - _SphereRadius) * 3.0;
    zoom = clamp(zoom, 3.7, 4.6);

    // camera
    vec3 ro = zoom*normalize(vec3(cos(roty), cos(rotx), sin(roty)));
    vec3 ww = normalize(vec3(0.0,0.0,0.0) - ro);
    vec3 uu = normalize(cross( vec3(0.0,1.0,0.0), ww ));
    vec3 vv = normalize(cross(ww,uu));
    vec3 rd = normalize( p.x*uu + p.y*vv + 1.5*ww );

    ro += rd*2.0;
	
    // volume render
    vec3 hitPos;
    vec4 col = rayMarch(ro, rd*_StepSize, hitPos);

    // Slightly emphasize cool edge when highs are strong.
    col.rgb = mix(col.rgb, col.rgb * vec3(0.90, 1.05, 1.20), 0.20 * gHigh);
    fragColor = col;
}
