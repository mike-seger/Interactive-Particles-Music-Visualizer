// https://www.shadertoy.com/view/wctXWN

/*
    "Vortex" by @XorDev
    
    https://x.com/XorDev/status/1930594981963505793

    An experiment based on my "3D Fire":
    https://www.shadertoy.com/view/3XXSWS
*/

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

void mainImage(out vec4 O, vec2 I)
{
    float a = audioLevel();
    float ap = pow(a, 1.5);
    float t = iTime * (1.0 + 0.35*ap);

    // Raymarch depth
    float z = fract(dot(I, sin(I)));

    // Accumulated color
    O = vec4(0.0);

    // Raymarch loop (100 iterations) - WebGL1 friendly
    for (int iter = 0; iter < 100; iter++)
    {
        // Raymarch sample position
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);

        // Shift camera back
        p.z += 6.0;

        // Distortion (turbulence) loop
        float dFreq = 1.0;
        for (int k = 0; k < 12; k++)
        {
            if (dFreq >= 9.0) break;
            p += cos(p.yzx * dFreq - t) / dFreq;
            dFreq /= 0.8;
        }

        // Compute distorted distance field of hollow sphere
        float d = 0.002 + abs(length(p) - 0.5) / 40.0;
        z += d;

        // Sample coloring and glow attenuation
        O += (sin(z + vec4(6.0, 2.0, 4.0, 0.0)) + (1.5 + 1.2*ap)) / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(O/7e3);
}
