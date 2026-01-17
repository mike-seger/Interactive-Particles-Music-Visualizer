// https://www.shadertoy.com/view/wffXDr

/*
    "Turbulent Flame" by @XorDev
    
    For my tutorial on Turbulence:
    https://mini.gmshaders.com/p/turbulence
    
    Simulating proper fluid dynamics can be complicated, limited, and requires a multi-pass setup.

    Sometimes you just want some smoke, fire, or fluid, and you don't want to go through all that trouble.

    This method is very simple! Start with pixel coordinates and scale them down as desired,
    then loop through adding waves, rotating the wave direction and increasing the frequency.
    To animate it, you can add a time offset to the sine wave.
    It also helps to shift each iteration with the iterator "i" to break up visible patterns.

    The resulting coordinates will appear turbulent, and you can use these coordinates in a coloring function.
    
    Smooth, continious equations look best!
    
    To complete the flame look, we need to scroll the waves and expand the coordinate space upwards 
*/

//Fire ring radius
#define RADIUS 0.4
//Falloff gradient
#define GRADIENT 0.3
//Scroll speed
#define SCROLL 1.6
//Flicker intensity
#define FLICKER 0.12
//Flicker animation speed
#define FLICKER_SPEED 12.0

//Number of turbulence waves
#define TURB_NUM 10.0
//Turbulence wave amplitude
#define TURB_AMP 0.4
//Turbulence wave speed
#define TURB_SPEED 6.0
//Turbulence frequency (inverse of scale)
#define TURB_FREQ 7.0
//Turbulence frequency multiplier
#define TURB_EXP 1.3

//Apply turbulence to coordinates
vec2 turbulence(vec2 p)
{
    //Turbulence starting scale
    float freq = TURB_FREQ;
    
    //Turbulence rotation matrix
    mat2 rot = mat2(0.6, -0.8, 0.8, 0.6);
    
    //Loop through turbulence octaves (use int loop for WebGL1 compatibility)
    for (int ii = 0; ii < 10; ii++)
    {
        float i = float(ii);
        //Scroll along the rotated y coordinate
        float phase = freq * (p * rot).y + TURB_SPEED*iTime + i;
        //Add a perpendicular sine wave offset
        p += TURB_AMP * rot[0] * sin(phase) / freq;
        
        //Rotate for the next octave
        rot *= mat2(0.6, -0.8, 0.8, 0.6);
        //Scale down for the next octave
        freq *= TURB_EXP;
    }
    
    return p;
}

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

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    float a = audioLevel();
    float ap = pow(a, 1.5);

    //Screen coordinates, centered and aspect corrected
    vec2 p = (fragCoord.xy*2.0-iResolution.xy) / iResolution.y;
    vec2 screen = p;
    
    //Expand vertically
    float xstretch = 2.0 - 1.5*smoothstep(-2.0,2.0,p.y);
    //Decelerate horizontally
    float ystretch = 1.0 - 0.5 / (1.0+p.x*p.x);
    //Combine
    vec2 stretch = vec2(xstretch, ystretch);
    //Stretch coordinates
    p *= stretch;
    
    //Scroll upward
    float scroll = SCROLL*iTime*(1.0 + 0.45*ap);
    p.y -= scroll;
    
    p = turbulence(p);
    
    //Reverse the scrolling offset
    p.y += scroll;
    
    //Distance to fireball
    float dist = length(min(p,p/vec2(1,stretch.y))) - RADIUS;
    //Attenuate outward and fade vertically
    float light = 1.0/pow(dist*dist+GRADIENT*max(p.y+.5,0.0),3.0);
    //Coordinates relative to the source
    vec2 source = p + 2.0*vec2(0,RADIUS) * stretch;
    //RGB falloff gradient
    vec3 grad = 0.1 / (1.0 + 8.0*length(source) / vec3(9, 2, 1));
    
    //Flicker animation time
    float ft = FLICKER_SPEED * iTime;
    //Flicker brightness
    float flicker = 1.0 + (FLICKER*(1.0 + 2.2*ap))*cos(ft+sin(ft*1.618-p.y));
    //Ambient lighting
    vec3 amb = 16.0*flicker/(1.0+dot(screen,screen))*grad;
    
    //Scrolling texture uvs
    vec2 uv = (p - SCROLL*vec2(0,iTime)) / 1e2 * TURB_FREQ;
    //Sample texture for fire
    vec3 tex = texture(iChannel1,uv).rgb;
    
    //Combine ambient light and fire
    vec3 col = amb + light*grad*tex;
    col *= 0.9 + 1.6*ap;
    //Exponential tonemap
    //https://mini.gmshaders.com/p/tonemaps
    col = 1.0 - exp(-col);
    fragColor = vec4(col,1);
}