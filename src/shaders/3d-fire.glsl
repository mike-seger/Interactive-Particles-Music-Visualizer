/*
    "3D Fire" by @XorDev
    
    I really wanted to see if my turbulence effect worked in 3D.
    I wrote a few 2D variants, but this is my new favorite.
    Read about the technique here:
    https://mini.gmshaders.com/p/turbulence


    See my other 2D examples here:
    https://www.shadertoy.com/view/wffXDr
    https://www.shadertoy.com/view/WXX3RH
    https://www.shadertoy.com/view/tf2SWc
    
    Thanks!
*/

// App convention: iChannel0 is a 512x2 audio texture; FFT row sampled at y≈0.25
float stAudio(float x)
{
    x = clamp(x, 0.0, 0.999);
    return texture(iChannel0, vec2(x, 0.25)).r;
}

void stAudioBands(out float vol, out float bass, out float mid, out float high)
{
    // Sample a few points (cheap, stable across tracks).
    bass = (stAudio(0.01) + stAudio(0.02) + stAudio(0.04) + stAudio(0.06)) * 0.25;
    mid  = (stAudio(0.10) + stAudio(0.14) + stAudio(0.18) + stAudio(0.24)) * 0.25;
    high = (stAudio(0.35) + stAudio(0.50) + stAudio(0.65) + stAudio(0.80)) * 0.25;

    // Gentle shaping so it's reactive but not jittery.
    bass = clamp(pow(max(bass, 0.0), 1.35), 0.0, 1.0);
    mid  = clamp(pow(max(mid, 0.0), 1.20), 0.0, 1.0);
    high = clamp(pow(max(high, 0.0), 1.10), 0.0, 1.0);

    vol = clamp(bass * 0.90 + mid * 0.35 + high * 0.15, 0.0, 1.0);
}

void mainImage(out vec4 O, vec2 I)
{
    float vol, bass, mid, high;
    stAudioBands(vol, bass, mid, high);

    // Time for animation (slightly sped up by volume)
    float t = iTime * (0.90 + 0.55 * vol);

    // Raymarched depth
    float z = 0.0;

    // Accumulated color
    O = vec4(0.0);

    // Audio-driven controls (kept subtle to preserve the original look)
    float turbAmp = 0.85 + 0.65 * bass;
    float turbSpeed = 1.00 + 0.40 * mid;
    float glow = 0.75 + 0.90 * vol;

    // Raymarching loop (WebGL1-friendly: explicit int iterator)
    for (int iter = 0; iter < 50; iter++)
    {
        // Compute raymarch sample point
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);

        // Shift back and animate
        p.z += 5.0 + cos(t);

        // Twist and rotate, expand upward
        p.xz *= mat2(cos(p.y * 0.5 + vec4(0.0, 33.0, 11.0, 0.0)))
            / max(p.y * 0.1 + 1.0, 0.1);

        // Turbulence loop (increasing frequency). Use int loop for GLSL ES 1.0 compatibility.
        float freq = 2.0;
        for (int k = 0; k < 8; k++)
        {
            if (freq >= 15.0) break;
            vec3 tp = vec3(t * 10.0, t, freq);
            tp.xy *= turbSpeed;
            p += turbAmp * cos((p.yzx - tp) * freq) / freq;
            freq /= 0.6;
        }

        // Sample approximate distance to hollow cone
        float d = 0.01 + abs(length(p.xz) + p.y * 0.3 - 0.5) / 7.0;
        z += d;

        // Add color and glow attenuation (highs add crispness)
        vec4 base = sin(z / 3.0 + vec4(7.0, 2.0, 3.0, 0.0)) + 1.1;
        base.rgb *= mix(vec3(1.0, 0.95, 0.90), vec3(1.15, 1.00, 0.85), high);
        O += glow * base / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(O / 1e3);
}
