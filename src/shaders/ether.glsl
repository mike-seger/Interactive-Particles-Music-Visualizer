// https://www.shadertoy.com/view/t3XXWj

/*
    "Ether" by @XorDev
    
    Experimenting with more 3D turbulence
*/

float sampleFFT(float x)
{
    return texture(iChannel0, vec2(clamp(x, 0.0, 1.0), 0.25)).r;
}

float audioLevel()
{
    float a = 0.0;
    a = max(a, sampleFFT(0.015));
    a = max(a, sampleFFT(0.030));
    a = max(a, sampleFFT(0.060));
    a = max(a, sampleFFT(0.120));
    a = max(a, sampleFFT(0.250));
    return a;
}

void mainImage(out vec4 O, vec2 I)
{
    float a = audioLevel();
    float ap = pow(a, 1.8);
    float t = iTime;
    float z = 0.0;
    vec4 col = vec4(0.0);

    // Raymarching loop (WebGL1/GLSL ES 1.00 friendly)
    for (int iter = 0; iter < 80; iter++)
    {
        // Compute raymarch sample point
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xxy);
        p.z -= 5.0 * t;

        // Audio shapes the fragments locally (not global speed)
        p += 0.22 * ap * sin(p.zxy * 0.55 + vec3(0.0, 1.7, 3.1));

        // Turbulence loop (increase frequency)
        float freq = 1.0;
        for (int k = 0; k < 32; k++)
        {
            if (freq >= 15.0) break;
            p += 0.6 * cos(p.yzx * freq - vec3(t * 0.6, 0.0, t) + ap * sin(p.zxy * 0.25)) / freq;
            freq /= 0.6;
        }

        // Sample gyroid distance (step size)
        float gy = dot(cos(p + ap * 0.6), sin(p.yzx * (0.6 + 0.25*ap)));
        float d = 0.01 + abs(p.y * 0.3 + gy + 2.0 + 0.6*ap*sin(p.x + p.y*0.7)) / 3.0;
        z += d;

        // Add color and glow attenuation
        col += max(sin(z * 0.4 + t + vec4(6.0, 2.0, 4.0, 0.0) + ap*1.2) + 0.7, vec4(0.2)) / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(col / 2e3);
}
