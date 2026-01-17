// https://www.shadertoy.com/view/t3XXWj

/*
    "Ether" by @XorDev
    
    Experimenting with more 3D turbulence
*/
void mainImage(out vec4 O, vec2 I)
{
    float t = iTime;
    float z = 0.0;
    vec4 col = vec4(0.0);

    // Raymarching loop (WebGL1/GLSL ES 1.00 friendly)
    for (int iter = 0; iter < 80; iter++)
    {
        // Compute raymarch sample point
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xxy);
        p.z -= 5.0 * t;

        // Turbulence loop (increase frequency)
        float freq = 1.0;
        for (int k = 0; k < 32; k++)
        {
            if (freq >= 15.0) break;
            p += 0.6 * cos(p.yzx * freq - vec3(t * 0.6, 0.0, t)) / freq;
            freq /= 0.6;
        }

        // Sample gyroid distance (step size)
        float d = 0.01 + abs(p.y * 0.3 + dot(cos(p), sin(p.yzx * 0.6)) + 2.0) / 3.0;
        z += d;

        // Add color and glow attenuation
        col += max(sin(z * 0.4 + t + vec4(6.0, 2.0, 4.0, 0.0)) + 0.7, vec4(0.2)) / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(col / 2e3);
}
