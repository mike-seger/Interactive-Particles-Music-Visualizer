/*
    "Angel" by @XorDev
    
    https://www.shadertoy.com/view/3XXSDB
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
    a = max(a, sampleFFT(0.015));
    a = max(a, sampleFFT(0.030));
    a = max(a, sampleFFT(0.060));
    a = max(a, sampleFFT(0.120));
    return a;
}

void mainImage(out vec4 O, vec2 I)
{
    // Time for animation
    float a = audioLevel();
    float ap = pow(a, 2.0);
    float t = iTime;

    // Raymarch depth
    float z = 0.0;

    // Accumulated color
    O = vec4(0.0);

    // Raymarch loop (100 iterations) - WebGL1 friendly
    for (int iter = 0; iter < 100; iter++)
    {
        // Raymarch sample position
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyy);

        // Shift camera back
        p.z += 6.0;

        // Twist shape
        float twist = p.y * (0.5 + 0.25*ap);
        p.xz *= mat2(cos(twist + vec4(0.0, 33.0, 11.0, 0.0)));

        // Distortion (turbulence) loop
        float dFreq = 1.0;
        for (int k = 0; k < 12; k++)
        {
            if (dFreq >= 9.0) break;
            p += cos((p.yzx - t * vec3(3.0, 1.0, 0.0)) * dFreq + ap * sin(p.zxy * 0.7)) / dFreq;
            dFreq /= 0.8;
        }

        // Compute distorted distance field of cylinder
        float r = 0.5 + 0.08*ap*sin(p.y*2.2 + t*0.7);
        float d = (0.1 + abs(length(p.xz) - r)) / 20.0;
        z += d;

        // Sample coloring and glow attenuation
        O += (sin(z + vec4(2.0, 3.0, 4.0, 0.0) + ap*1.2) + 1.1) / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(O/4e3);
}