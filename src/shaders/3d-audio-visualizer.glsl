/* "3D Audio Visualizer" by @kishimisu - 2022 (https://www.shadertoy.com/view/dtl3Dr)
    
    This work is licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en)

    Wait for the drop!

   The lights of this scene react live to the audio input.
   I'm trying to find interesting ways to extract audio
   features from the audio's FFT to animate my scenes.
   
   Each light is associated to a random frequency range,
   ranging from bass (distant lights) to high (close lights)   
   
   Really happy with this result!

   https://www.shadertoy.com/view/dtl3Dr
*/

#define st(t1, t2, v1, v2) mix(v1, v2, smoothstep(t1, t2, iTime))
#define light(d, att) 1. / (1.+pow(abs(d*att), 1.3))

/* Audio-related functions */
#define FFT_ROW 0.25

// In this project, iChannel0 is a 512x2 audio texture:
// - y ~= 0.25: FFT
// - y ~= 0.75: waveform
float getLevel(float x) {
    x = clamp(x, 0.0, 0.999);
    return texture(iChannel0, vec2(x, FFT_ROW)).r;
}
#define logX(x,a,c) (1./(exp(-a*(x-c))+1.))

float logisticAmp(float amp){
   float c = st(0., 10., .8, 1.), a = 20.;  
   return (logX(amp, a, c) - logX(0.0, a, c)) / (logX(1.0, a, c) - logX(0.0, a, c));
}
float getPitch(float freq, float octave){
   freq = pow(2., freq)   * 261.;
   freq = pow(2., octave) * freq / 12000.;
   return logisticAmp(getLevel(freq));
}
float getVol(float samples) {
    // Avoid dynamic float loops (GLSL ES 1.00 drivers can be picky) and also
    // make the response more stable by using a fixed number of bass bins.
    float avg = 0.0;
    const int N = 12;
    for (int i = 0; i < N; i++) {
        avg += getLevel(float(i) / float(N));
    }
    return avg / float(N);
}
/* ----------------------- */

float sdBox( vec3 p, vec3 b ) {
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}
float hash13(vec3 p3) {
	p3  = fract(p3 * .1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 uv   = (2.*fragCoord-iResolution.xy)/iResolution.y;
    vec3 col  = vec3(0.);
    float vol = getVol(8.);

    // Make the audio influence stronger/clearer.
    float bass = getLevel(0.02);
    float mid  = getLevel(0.10);
    float hi   = getLevel(0.35);
    // Keep in a sane range; we'll use it for subtle modulation.
    float energy = clamp(bass * 1.4 + mid * 0.8 + hi * 0.4, 0.0, 1.0);
    float volBoost = pow(clamp(vol * 2.2, 0.0, 1.0), 1.25);
    
    float hasSound = 1.; // Used only to avoid a black preview image
    if (iChannelTime[0] <= 0.) hasSound = .0;
 
    float t = 0.0;
    vec3 dir = normalize(vec3(uv, 1.0));
    const int STEPS = 28;
    const float MAX_T = 35.0;
    for (int i = 0; i < STEPS; i++) {
        if (t > MAX_T) break;

        vec3 p  = t * dir;
        
        vec3 id = floor(abs(p));
        vec3 q  = fract(p)-.5;
        
        float boxRep = sdBox(q, vec3(.3));
        float boxCtn = sdBox(p, vec3(7.5, 6.5, 16.5));

        float dst = max(boxRep, abs(boxCtn) - (volBoost * 0.8 + energy * 0.25));
        // Prevent negative/too-small steps which can cause the march to diverge.
        dst = max(dst, 0.03);
        float freq = smoothstep(16., 0., id.z)*3.*hasSound + hash13(id)*1.5;
       
           float pitch = getPitch(freq, 1.);

           float att = max(6.0, 14.0 - volBoost * 2.0);
           float l = light(dst, att);
           l = min(l, 0.65);

           vec3 stepCol = vec3(.8,.6,1)
               * (cos(id*.4 + vec3(0,1,2) + iTime * (1.0 + 0.20 * energy)) + 2.)
               * l
               * (0.20 + 1.20 * pitch)
               * (0.55 + 0.55 * energy);

           // Distance fade + global scale keeps the integral bounded.
           stepCol *= exp(-0.08 * t) * 0.07;
           col += stepCol;

           // Cap step size too (helps stability).
           t += clamp(dst, 0.03, 1.0);
    }
    
    // Simple tonemap + gamma so highlights don't instantly clamp to white.
    col = 1.0 - exp(-col * (0.9 + 0.35 * energy));
    col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
    fragColor = vec4(col,1.0);
}