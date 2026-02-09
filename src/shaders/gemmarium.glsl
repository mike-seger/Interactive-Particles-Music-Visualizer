/*================================
=           Gemmarium            =
=         Author: Jaenam         =
================================*/
// Date:    2025-11-28
// License: Creative Commons (CC BY-NC-SA 4.0)
// Converted for Interactive Particles Music Visualizer

// Twigl (golfed) version --> https://x.com/Jaenam97/status/1994387530024718563?s=20

// ============================================================
// Beat Detection (adapted from Buffer A)
// ============================================================

#define FFT_BINS 512
#define BASS_START  3
#define BASS_END    15
#define BASS_GAIN          0.9
#define THRESHOLD_DECAY    5.0
#define THRESHOLD_MIN      0.20
#define REFRACTORY_JUMP    0.70
#define MIN_BEAT_INTERVAL  0.14
#define TOOSOON_RAISE      0.95
#define SMOOTH_HZ_BASS     12.0
#define FLASH_GAIN         1.2
#define FLASH_DECAY        8.0

float alphaHz(float hz, float dt)
{
    return 1.0 - exp(-hz * dt);
}

float musicFFT(int i)
{
    return texture(iChannel0, vec2(float(i) / 512.0, 0.25)).x;
}

float bandAvgMusic(int startBin, int width)
{
    float s = 0.0;
    for (int k = 0; k < 64; k++)
    {
        if (k >= width) break;
        s += musicFFT(startBin + k);
    }
    return s / float(width);
}

// Persistent state simulation using time-based smoothing
float getFlash(float time)
{
    int wB = BASS_END - BASS_START;
    int sB = BASS_START;
    
    float eB = bandAvgMusic(sB, wB);
    
    // Simple beat detection based on energy
    float beatStrength = smoothstep(THRESHOLD_MIN, THRESHOLD_MIN + 0.3, eB);
    
    // Add some time-based pulsing
    float pulse = sin(time * 3.0) * 0.5 + 0.5;
    float flash = beatStrength * (0.7 + pulse * 0.3);
    
    return flash;
}

// ============================================================
// Main Rendering
// ============================================================

void mainImage( out vec4 O, vec2 I )
{   
    //Raymarch iterator
    float i = 0.0,
    //Depth
    d = 0.0,
    //Raymarch step distance
    s = 0.0,
    // SDF
    sd = 0.0,
    // Time
    t = iTime,
    // Brightness
    m = 1.,
    //Orb
    l = 0.0;

    // Get flash/beat intensity
    float flash = getFlash(t);

    // 3D sample point
    vec3 p,
    k, r = iResolution;

    // Rotation matrix by pi/4
    mat2 R = mat2(cos(sin(t/2.)*.785 +vec4(0,33,11,0)));

    // Raymarch loop. Clear fragColor and raymarch 100 steps
    O = vec4(0.0);
    for(; i++<1e2;){

        //Raymarch sample point --> scaled uvs + camera depth
        p = vec3((I+I-r.xy)/r.y, d-10.0);    
        
        //Orb
        l = length(p.xy-vec2(0.1+sin(t)/4.0,0.4+sin(t+t)/7.0));
        
        p.xy*=d;
        
        //Improving performance
        if(abs(p.x)>6.) break;

        //Rotate about y-axis
        p.xz *= R;

        //Mirrored floor hack
        if(p.y < -6.3) {
            //Flip about y and shift
            p.y = -p.y-9.;
            //Use half the brightness
            m = .5;
        }

        //Save sample point
        k=p;
        //Scale
        p*=.5;
        //Turbulence loop (3D noise)
        float n = .01;
        for(int turbIdx = 0; turbIdx < 10; turbIdx++){
            if(n >= 1.) break;
            //Accumulate noise on p.y 
            p.y += 0.9+abs(dot(sin(p.x + 2.0*t+p/n),  0.2+p-p )) * n;
            n += n;
        }
        
        // Audio-reactive texture modulation
        vec4 j = texture(iChannel0, vec2((i+100.0) / 512.0, 0.25));
        
        //SDF mix
        sd = mix(
                 //Bottom half texture with audio reactivity
                 sin(length(ceil(k*10.0).x+k + floor(j.x * 5.0) * 6.5)),
                 //Upper half water/clouds noise + orb
                 mix(sin(length(p)- 0.1),l,(0.3+flash)-l*1.8),
                 //Blend
                 smoothstep(5.5, 5.8, p.y));

        //Step distance to object
        d += s =0.012+0.08*abs(max(sd,length(k)-5.0)-i/150.0);
        
        // Uncomment section for ocean variant
        //vec4 ir = sin(vec4(1,2,3,1)+i*.5)*1.5/s + vec4(1,2,3,1)*.04/l; //iridescence + orb
        //vec4 c = vec4(1,2,3,1) * .12/s; //water 
        //O += max(mix(ir,mix(c, ir, smoothstep(7.5, 8.5, p.y)),smoothstep(5.2, 6.5, p.y)), -length(k*k));
        
        //Color accumulation, using i iterator for iridescence. Attenuating with distance s and shading.
        //Fix: Clamp l to avoid singularity and reduce glare (make reflection more transparent)
        O += max(sin(vec4(1,2,3,1)+i*.5)*1.5/s+vec4(1,2,3,1)*(.04+flash*0.55)/max(l, 0.4),-length(k*k));

    }
    //Tanh tonemap and brightness multiplier
    O = tanh(O*O/8e5)*m;  
}
