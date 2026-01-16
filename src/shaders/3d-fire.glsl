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
void mainImage(out vec4 O, vec2 I)
{
    // Time for animation
    float t = iTime;

    // Raymarched depth
    float z = 0.0;

    // Accumulated color
    O = vec4(0.0);

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
            p += cos((p.yzx - vec3(t * 10.0, t, freq)) * freq) / freq;
            freq /= 0.6;
        }

        // Sample approximate distance to hollow cone
        float d = 0.01 + abs(length(p.xz) + p.y * 0.3 - 0.5) / 7.0;
        z += d;

        // Add color and glow attenuation
        O += (sin(z / 3.0 + vec4(7.0, 2.0, 3.0, 0.0)) + 1.1) / max(d, 1e-3);
    }
    //Tanh tonemapping
    //https://www.shadertoy.com/view/ms3BD7
    O = tanh(O / 1e3);
}
