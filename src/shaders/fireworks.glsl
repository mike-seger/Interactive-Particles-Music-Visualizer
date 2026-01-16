// https://www.shadertoy.com/view/ssySz1

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
    float v = fft01(x);
    return pow(clamp(v, 0.0, 1.0), 2.2);
}

#define NUM_EXPLOSIONS 5.
#define NUM_PARTICLES 75.

vec2 Hash12(float t){

float x = fract(sin(t*674.3)*453.2);
float y = fract(sin((t+x)*714.3)*263.2);

return vec2(x, y);
}

vec2 Hash12_Polar(float t){

float p_Angle = fract(sin(t*674.3)*453.2)*6.2832;
float p_Dist = fract(sin((t+p_Angle)*714.3)*263.2);

return vec2(sin(p_Angle), cos(p_Angle))*p_Dist;
}

float Explosion(vec2 uv, float t, float energy, float bass, float hi){
 
 float sparks = 0.;

    // Hard gate: when there's effectively no audio energy, draw nothing.
    if (energy <= 0.0001) return 0.0;
 
    for(float i = 0.; i<NUM_PARTICLES; i++){
    
        // Spread reacts more to highs; overall radius responds to energy.
        vec2 dir = Hash12_Polar(i+1.) * (0.45 + 0.35 * energy) * (0.85 + 0.35 * hi);

        float dist = length(uv - dir * t);
        // No baseline brightness: silence -> no sparks.
        // Brighter + slightly larger cores on beats.
        float core = mix(0.0, 0.00125, clamp(energy, 0.0, 1.0));
        core *= mix(1.0, 1.6, smoothstep(0.15, 0.75, bass));
        float brightness = core;
        
        brightness *= sin(t * (18.0 + 10.0 * hi) + i) * .5 + .5;
        brightness*= smoothstep(1., .6, t);
        // Prevent overly-hot singularities.
        dist = max(dist, 0.0025);
        sparks += brightness/dist;
    }
    return sparks;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord -.5*iResolution.xy)/iResolution.y;

    float bass = FFT(0.03);
    float mid  = FFT(0.12);
    float hi   = FFT(0.55);

    float energyRaw = clamp(0.65 * bass + 0.25 * mid + 0.20 * hi, 0.0, 1.0);
    // Gate near-silence but keep audible sound brighter.
    float gate = smoothstep(0.012, 0.07, energyRaw);
    float energy = pow(energyRaw, 1.05) * gate;

    vec3 col = vec3(0);
    
    for(float i = 0.; i<NUM_EXPLOSIONS; i++){
    float t =iTime+i/NUM_EXPLOSIONS;
    float ft = floor(t);
        vec3 color = sin(4.*vec3(.34,.54,.43)*ft)*.25+.75;

        // Shift color temperature with highs; brighten with overall energy.
        color *= mix(vec3(1.0), vec3(1.10, 0.95, 1.25), hi);
        color *= (0.35 + 2.35 * energy);

       
        vec2 offset = Hash12(i+1.+ft)-.5;
        offset*=vec2(1.77, 1.);
        //col+=.0004/length(uv-offset);

        float et = fract(t);
        // Make expansion feel snappier on bass.
        et = pow(et, 1.0 - 0.35 * bass);

                 col += Explosion(uv-offset, et, energy, bass, hi) * color;
       }
   
    // Global brightness follows energy strongly.
    col *= 6.5 * energy;
     fragColor = vec4(col, 1.0);
}