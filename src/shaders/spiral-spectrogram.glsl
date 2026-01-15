#define PI 3.14159265358979323846

float nturns   = 10.;
float vol_min  = 0.; // Minimum volume that shows up
float vol_max  = 1.; // Volume that saturates the color

// Musical parameters
float A        = 440.0 / 2.;       // Lowest note
float tet_root = 1.05946309435929; // 12th root of 2

// Spiral visual parameters from https://www.shadertoy.com/view/WtjSWt
float dis      = .05;
float width    = .02;
float blur     = .02;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2  uv     = fragCoord.xy / iResolution.xy;
    float aspect = iResolution.xy.x / iResolution.xy.y;
    
    vec2 uvcorrected = uv - vec2(0.5, 0.5);
    uvcorrected.x   *= aspect;

    float angle      = atan(uvcorrected.y, uvcorrected.x);
    float offset     = length(uvcorrected) + (angle/(2. * PI)) * dis;
    float which_turn = floor(offset / dis);
    float cents      = (which_turn - (angle / 2. / PI)) * 1200.;
    float freq       = A * pow(tet_root, cents / 100.);
    float bin        = freq / iSampleRate;
    float bri        = texture(iChannel0, vec2(bin, 0.25)).x;
    
    bri = (bri - vol_min) / (vol_max - vol_min);
    bri = max(bri, 0.);
    
    // Control the curve of the color mapping. Try e.g. 2. or 4.
    bri = pow(bri, 2.);

    vec3 lineColor;
    if (bri < 0.5) {
        lineColor = vec3(bri/.5, 0., bri/.5);
    } else {
        lineColor = vec3(1., (bri - .5) * 2., 1.);
    }

    float circles = mod(offset, dis);
    vec3  col     = bin > 1. ? vec3(0., 0., 0.) :
                    (smoothstep(circles-blur,circles,width) -
                     smoothstep(circles,circles+blur,width)) * lineColor;
    
    fragColor     = vec4(col, 1.);
}
