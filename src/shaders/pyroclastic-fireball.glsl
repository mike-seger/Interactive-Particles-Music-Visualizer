// port from http://glslsandbox.com/e#8625.0 by Duke 
// Fireball
// Awd
// @AlexWDunn

#define saturate(oo) clamp(oo, 0.0, 1.0)

float gAudio;
float gBass;
float gRadius;

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

float audioBass()
{
	float b = 0.0;
	b = max(b, sampleFFT(0.015));
	b = max(b, sampleFFT(0.030));
	b = max(b, sampleFFT(0.060));
	return b;
}

// Quality Settings
#define MarchSteps 8
// Scene Settings
#define ExpPosition vec3(0.0)
#define BaseRadius 2.0
#define Background vec4(0.1, 0.0, 0.0, 1.0)
// Noise Settings
#define NoiseSteps 1
#define NoiseAmplitude 0.06
#define NoiseFrequency 4.0
#define Animation vec3(0.0, -3.0, 0.5)
// Colour Gradient
#define Color1 vec4(1.0, 1.0, 1.0, 1.0)
#define Color2 vec4(1.0, 0.8, 0.2, 1.0)
#define Color3 vec4(1.0, 0.03, 0.0, 1.0)
#define Color4 vec4(0.05, 0.02, 0.02, 1.0)

// Description : Array and textureless GLSL 2D/3D/4D simplex
//               noise functions.
//      Author : Ian McEwan, Ashima Arts.
//  Maintainer : ijm
//     Lastmod : 20110822 (ijm)
//     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//               Distributed under the MIT License. See LICENSE file.
//               https://github.com/ashima/webgl-noise
//

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v)
{
	const vec2  C = vec2(1.0/6.0, 1.0/3.0);
	const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
	// First corner
	vec3 i  = floor(v + dot(v, C.yyy));
	vec3 x0 = v - i + dot(i, C.xxx);
	// Other corners
	vec3 g = step(x0.yzx, x0.xyz);
	vec3 l = 1.0 - g;
	vec3 i1 = min(g.xyz, l.zxy);
	vec3 i2 = max(g.xyz, l.zxy);
	vec3 x1 = x0 - i1 + C.xxx;
	vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
	vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y
	// Permutations
	i = mod289(i);
	vec4 p = permute( permute( permute( i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
	// Gradients: 7x7 points over a square, mapped onto an octahedron.
	// The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
	float n_ = 0.142857142857; // 1.0/7.0
	vec3  ns = n_ * D.wyz - D.xzx;
	vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)
	vec4 x_ = floor(j * ns.z);
	vec4 y_ = floor(j - 7.0 * x_);    // mod(j,N)
	vec4 x = x_ *ns.x + ns.yyyy;
	vec4 y = y_ *ns.x + ns.yyyy;
	vec4 h = 1.0 - abs(x) - abs(y);
	vec4 b0 = vec4(x.xy, y.xy);
	vec4 b1 = vec4(x.zw, y.zw);
	vec4 s0 = floor(b0) * 2.0 + 1.0;
	vec4 s1 = floor(b1) * 2.0 + 1.0;
	vec4 sh = -step(h, vec4(0.0));
	vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
	vec3 p0 = vec3(a0.xy, h.x);
	vec3 p1 = vec3(a0.zw, h.y);
	vec3 p2 = vec3(a1.xy, h.z);
	vec3 p3 = vec3(a1.zw, h.w);
	//Normalise gradients
	vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
	p0 *= norm.x;
	p1 *= norm.y;
	p2 *= norm.z;
	p3 *= norm.w;
	// Mix final noise value
	vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
	m = m * m;
	return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float Turbulence(vec3 position, float minFreq, float maxFreq, float qWidth)
{
	float value = 0.0;
	float cutoff = clamp(0.5/qWidth, 0.0, maxFreq);
	float fade;
	float fOut = minFreq;
	for(int i=NoiseSteps ; i>=0 ; i--)
	{
		if(fOut >= 0.5 * cutoff) break;
		fOut *= 2.0;
		value += abs(snoise(position * fOut))/fOut;
	}
	fade = clamp(2.0 * (cutoff-fOut)/cutoff, 0.0, 1.0);
	value += fade * abs(snoise(position * fOut))/fOut;
	return 1.0-value;
}

float SphereDist(vec3 position)
{
	return length(position - ExpPosition) - gRadius;
}

vec4 Shade(float distance)
{
	float c1 = saturate(distance*5.0 + 0.5);
	float c2 = saturate(distance*5.0);
	float c3 = saturate(distance*3.4 - 0.5);
	vec4 a = mix(Color1,Color2, c1);
	vec4 b = mix(a,     Color3, c2);
	return 	 mix(b,     Color4, c3);
}

// Draws the scene
float RenderScene(vec3 position, out float distance)
{
	float evoT = iTime * (1.0 + 1.25*gAudio);
	float evoF = NoiseFrequency * (1.0 + 0.25*gAudio);
	float amp = NoiseAmplitude * (1.0 + 2.0*gAudio);
	float noise = Turbulence(position * evoF + Animation*evoT, 0.1, 1.5 + 0.35*gAudio, 0.03) * amp;
	noise = saturate(abs(noise));
	distance = SphereDist(position) - noise;
	return noise;
}

// Basic ray marching method.
vec4 March(vec3 rayOrigin, vec3 rayStep)
{
	vec3 position = rayOrigin;
	float distance;
	float displacement;
	for(int step = MarchSteps; step >=0  ; --step)
	{
		displacement = RenderScene(position, distance);
		if(distance < 0.05) break;
		position += rayStep * distance;
	}
	return mix(Shade(displacement), Background, float(distance >= 0.5));
}

bool IntersectSphere(vec3 ro, vec3 rd, vec3 pos, float radius, out vec3 intersectPoint)
{
	vec3 relDistance = (ro - pos);
	float b = dot(relDistance, rd);
	float c = dot(relDistance, relDistance) - radius*radius;
	float d = b*b - c;
	intersectPoint = ro + rd*(-b - sqrt(d));
	return d >= 0.0;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	float a = audioLevel();
	gAudio = pow(a, 1.5);
	gBass = pow(audioBass(), 2.2);

	// Bass-driven diameter (via radius) but keep it in-frame.
	float rScale = 0.85 + 0.35*gBass;
	gRadius = BaseRadius * rScale;

	vec2 p = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
	p.x *= iResolution.x/iResolution.y;
	// No mouse. Keep a gentle auto-rotate (not audio-driven).
	float rotx = 0.25*sin(iTime*0.22);
	float roty = iTime * 0.25;
	float zoom = 5.0;
	// camera
	vec3 ro = zoom * normalize(vec3(cos(roty), cos(rotx), sin(roty)));
	vec3 ww = normalize(vec3(0.0, 0.0, 0.0) - ro);
	vec3 uu = normalize(cross( vec3(0.0, 1.0, 0.0), ww));
	vec3 vv = normalize(cross(ww, uu));
	vec3 rd = normalize(p.x*uu + p.y*vv + 1.5*ww);
	vec4 col = Background;
	vec3 origin;
	float amp = NoiseAmplitude * (1.0 + 2.0*gAudio);
	if(IntersectSphere(ro, rd, ExpPosition, gRadius + amp*6.0, origin))
	{
		col = March(origin, rd);
	}
	col.rgb *= 0.85 + 1.15*gAudio;
	fragColor = col;
}
