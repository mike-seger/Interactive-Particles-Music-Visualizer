// https://www.shadertoy.com/view/w3SSWd

/*
    Inspired by Xor's recent raymarchers with comments!
    https://www.shadertoy.com/view/tXlXDX
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

void mainImage(out vec4 o, vec2 u) {
    float a = audioLevel();
    float ap = pow(a, 1.9);
    float t = iTime;
    float d = 0.0;
    vec4 col = vec4(0.0);

    for (int i = 0; i < 100; i++) {
        vec3 p = d * normalize(vec3(u + u, 0.0) - iResolution.xyy);
        p.z -= t;

        float s = 0.1;
        for (int k = 0; k < 16; k++) {
            if (s >= 2.0) break;
            // Audio affects the wave field locally (not the global speed)
            p -= dot(cos(t + p * s * 16.0 + ap * sin(p.zxy * 1.2)), vec3(0.01)) / s;
            p += sin(p.yzx * 0.9) * 0.3;
            s *= 1.42;
        }

        float ds = 0.02 + abs(3.0 - length(p.yx)) * (0.09 + 0.07*ap);
        d += ds;
        col += (1.0 + cos(d + vec4(4.0, 2.0, 1.0, 0.0) + ap*1.2)) / ds;
    }

    o = tanh(col / 2e3);
}
