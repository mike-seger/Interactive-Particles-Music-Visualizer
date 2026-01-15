// Code by Flopine
// Thanks to wsmind, leon, XT95, lsdlive, lamogui, Coyhot, Alkama and YX for teaching me
// Thanks LJ for giving me the love of shadercoding :3

// Thanks to the Cookie Collective, which build a cozy and safe environment for me 
// and other to sprout :)  https://twitter.com/CookieDemoparty

// AN AUDIO REACTIVE SHADER, play the sound in iChannel0

#define ITER 64.
#define PI 3.141592
#define megabass (texture(iChannel0, vec2(0.001,0.25)).x)

float hash21 (vec2 x)
{return fract(sin(dot(x,vec2(12.4,14.1)))*1245.4);}

vec2 moda(vec2 p, float per)
{
    float a = atan(p.y, p.x);
    float l = length(p);
    a = mod(a-per/2., per)-per/2.;
    return vec2(cos(a),sin(a))*l;
}

mat2 rot (float a)
{return mat2(cos(a),sin(a),-sin(a),cos(a));}

float smin( float a, float b, float k )
{
    float res = exp( -k*a ) + exp( -k*b );
    return -log( res )/k;
}

float sphe (vec3 p, float r)
{return length(p)-r;}

float cyl (vec2 p, float r)
{return length(p)-r;}

float needles(vec3 p)
{
    vec3 pp = p;
    float l_needle = 0.8 - clamp(megabass,0.,0.75);
    
    p.xz = moda(p.xz, 2.*PI/7.);
    float n1 = cyl(p.yz,0.1-p.x*l_needle);
    
    p = pp;
    p.y = abs(p.y);
    p.y -= 0.1;
    p.xz = moda(p.xz, 2.*PI/7.);
    p.xy *= rot(PI/4.5);

    float n2 = cyl(p.yz,0.1-p.x*l_needle);
    
    p = pp;
    float n3 = cyl(p.xz, 0.1-abs(p.y)*l_needle);
    
    return min(n3,min(n2,n1));
}

float spikyball (vec3 p)
{
    p.y -= iTime;
    p.xz *= rot(iTime);
    p.yz *= rot(iTime*0.5);
    float s = sphe(p,.9);
    return smin(s, needles(p), 5.);
}

// provided by Shane, thank you :3
float room(vec3 p)
{
    p += sin(p.yzx - cos(p.zxy));
    p += sin(p.yzx/1.5 + cos(p.zxy)/2.)*.5;
    return -length(p.xz) + 5.;
}

float SDF (vec3 p)
{ 
    return min(spikyball(p),room(p));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (2.*fragCoord-iResolution.xy)/iResolution.y;
    
    float dither = hash21(uv);
    
    vec3 ro = vec3(0.001,0.001+iTime,-3.); 
    vec3 p = ro;
    vec3 dir = normalize(vec3(uv, 1.));
    
    float shad = 0.;
    
    for (float i = 0.; i<ITER; i++)
    {
        float d = SDF(p);
        if(d<0.001)
        {
        	shad = i/ITER;
            break;
        }
        d *= 0.9+dither*0.1;
        p+=d*dir;
    }    
    
    vec3 c = vec3 (shad);
    
    // Output to screen
    fragColor = vec4(pow(c,vec3(1.5)),1.0);
}
