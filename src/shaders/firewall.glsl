/*
    "Firewall" by @XorDev
    https://www.shadertoy.com/view/33tGzN
    A different perspective on Accretion.
*/


void mainImage(out vec4 O, vec2 I)
{
    float t = iTime;
    float z = 0.0;
    O = vec4(0.0);

    // Raymarch loop (WebGL1-friendly)
    for (int iter = 0; iter < 20; iter++)
    {
        float fi = float(iter);

        // Sample point (from ray direction)
        vec3 p = z * normalize(vec3(I + I, 0.0) - iResolution.xyx) + 0.1;

        // Polar coordinates and additional transformations
        p.z += 9.0;
        p = vec3(atan(p.z, p.x + 0.1) * 2.0, 0.6 * p.y + t + t, length(p.xz) - 3.0);

        // Apply turbulence and refraction effect
        for (int k = 1; k <= 7; k++)
        {
            float d = float(k);
            p += sin(p.yzx * d + t + 0.5 * fi) / d;
        }

        // Distance to cylinder and waves with refraction
        float dStep = 0.4 * length(vec4(0.3 * cos(p) - 0.3, p.z));
        z += dStep;

        // Coloring and brightness
        O += (1.0 + cos(p.y + fi * 0.4 + vec4(6.0, 1.0, 2.0, 0.0))) / max(dStep, 1e-3);
    }
    //Tanh tonemap
    O = tanh(O*O/6e3);
}