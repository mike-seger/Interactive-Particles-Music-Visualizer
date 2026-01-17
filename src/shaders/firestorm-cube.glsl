// https://www.shadertoy.com/view/ldyyWm

float burn;

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

mat2 rot(float a)
{
    float s=sin(a), c=cos(a);
    return mat2(s, c, -c, s);
}

float map(vec3 p)
{
    float d = max(max(abs(p.x), abs(p.y)), abs(p.z)) - .5;
    burn = d;
    
    mat2 rm = rot(-iTime/3. + length(p));
    p.xy *= rm, p.zy *= rm;
    
    vec3 q = abs(p) - iTime;
    q = abs(q - round(q));
    
    rm = rot(iTime);
    q.xy *= rm, q.xz *= rm;
    
    d = min(d, min(min(length(q.xy), length(q.yz)), length(q.xz)) + .01);
    
    burn = pow(d - burn, 2.);
    
    return d;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    float a = audioLevel();
    float ap = pow(a, 1.5);

    vec3 rd = normalize(vec3(2.*fragCoord-iResolution.xy, iResolution.y)), 
         ro = vec2(0, -2).xxy;
    
    mat2 r1 = rot(iTime/4. * (1.0 + 0.45*ap)), r2 = rot(iTime/2. * (1.0 + 0.25*ap));
    rd.xz *= r1, ro.xz *= r1, rd.yz *= r2, ro.yz *= r2;
    
    float t = 0.0;
    int steps = int(floor(24.0 * (1.0 - exp(-0.2*iTime - 0.1))));
    // WebGL1 / GLSL ES 1.0 portability: avoid int clamp() overload.
    if (steps < 0) steps = 0;
    if (steps > 24) steps = 24;
    for (int s = 0; s < 24; s++)
    {
        if (s >= steps) break;
        t += map(ro + rd * t) * 0.5;
    }

    vec3 col = vec3(1.0 - burn, exp(-t), exp(-t/2.));
    col *= 0.9 + 1.8*ap;
    fragColor = vec4(col, 1.0);
}

