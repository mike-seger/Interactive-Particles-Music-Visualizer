// Created by David Gallardo - xjorma/2020
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0

// https://www.shadertoy.com/view/3dsyzS
//Music: You're Not Leaving by La Josephine
//https://soundcloud.com/lajosephine/youre-not-leaving

#define MAX_STEPS 100
#define MAX_DIST 7.
#define SURF_DIST .001

// GLSL ES 1.00 (WebGL1) has no bitwise operators. Helpers below emulate
// the small bit-extraction patterns used in this shader via integer arithmetic.
int imod2(int v) { return v - (v/2)*2; }

float hash( float n ) {
    return fract(sin(n)*43758.5453);
    
}

float snoise( in vec3 x ) { // in [0,1]
    vec3 p = floor(x);
    vec3 f = fract(x);

    f = f*f*(3.-2.*f);

    float n = p.x + p.y*57. + 113.*p.z;

    float res = mix(mix(mix( hash(n+  0.), hash(n+  1.),f.x),
                        mix( hash(n+ 57.), hash(n+ 58.),f.x),f.y),
                    mix(mix( hash(n+113.), hash(n+114.),f.x),
                        mix( hash(n+170.), hash(n+171.),f.x),f.y),f.z);
    return res * 2.0 - 1.0;
}

    

mat2 Rot(float a){

    float c = cos(a);
    float s = sin(a);
    return mat2(c,-s,s,c);
}
vec3 Transform ( vec3 p ,float time){
    p.z -= time * .5;

    
    p += sin(p.x+p.z+time)*.03
        +sin(p.y+time)*.05
        +cos(p.x+p.z+time)*.03
        -cos(p.x+time)*.03
        +cos(p.y+time)*.05;
        
    //p.xy *= Rot(time*.15);
    return p;
    
}

float sdBox(vec3 p, vec3 s) {
    p = abs(p)-s;
    return length(max(p, 0.))+min(max(p.x, max(p.y, p.z)), 0.);
}

float sdGyroid(vec3 p, float scale, float thickness, float bias) {
    p *= scale;
    return abs(dot(sin(p), cos(p.zxy))+bias)/scale - thickness;
}

float sdSphere( vec3 p, float s )
{
    return length(p)-s;
}


float sdRoundCone( vec3 p, float r1, float r2, float h )
{
  vec2 q = vec2( length(p.xz), p.y );
    
  float b = (r1-r2)/h;
  float a = sqrt(1.0-b*b);
  float k = dot(q,vec2(-b,a));
    
  if( k < 0.0 ) return length(q) - r1;
  if( k > a*h ) return length(q-vec2(0.0,h)) - r2;
        
  return dot(q, vec2(a,b) ) - r1;
}

float line( vec3 p, float h, float r )
{
  p.y -= clamp( p.y, 0.0, h );
  return length( p ) - r;
}



float smin(float a, float b, float k)
{
    float h=clamp(0.5+0.5*(b-a)/k, 0.0, 1.0);
    return mix(b,a,h)-k*h*(1.0-h);
}

float smax(float a, float b, float k)
{
   
    float h = clamp( 0.5 + 0.5*(a-b)/k, 0., 1.);
    return mix(b, a, h) + h*(1.0-h)*k;
}
vec2 opUMin( vec2 a, vec2 b, float k ) { 
    float h = clamp( 0.5+0.5*(b.x-a.x)/k, 0.0, 1.0 ); 
    return vec2( mix( b.x, a.x, h ) - k*h*(1.0-h), (a.x<b.x) ? a.y : b.y ); 
}

vec2 opU( vec2 d1, vec2 d2 )
{
    return (d1.x<d2.x) ? d1 : d2;
}


const float PI  = 3.14159265359;
const float PHI = 1.61803398875;


void basis(vec3 n, out vec3 b1, out vec3 b2) 
{
    if(n.y<-0.999999) 
    {
        b1=vec3(0,0,-1);
        b2=vec3(-1,0,0);
    } 
    else 
    {
        float a=1./(1.+n.y);
        float b=-n.x*n.z*a;
        b1=vec3(1.-n.x*n.x*a,-n.x,b);
        b2=vec3(b,-n.z,1.-n.z*n.z*a);
    }
}

vec4 invsf(vec3 p, float n)
{
    float m=1.-1./n;
    float phi=min(atan(p.y,p.x),PI);
    float k=max(2.,floor(log(n*PI*sqrt(5.)*
                             (1.-p.z*p.z))/log(PHI+1.)));
    float Fk=pow(PHI,k)/sqrt(5.);
    vec2  F=vec2(round(Fk), round(Fk*PHI));
    vec2 ka=2.*F/n;
    vec2 kb=2.*PI*(fract((F+1.)*PHI)-(PHI-1.));    
    mat2 iB=mat2(ka.y,-ka.x, 
                    kb.y,-kb.x)/(ka.y*kb.x-ka.x*kb.y);
    
    vec2 c=floor(iB*vec2(phi, p.z-m));
    float d=0.;
    vec4 res=vec4(0);
    for(int s=0; s<4; s++) 
    {
        int sx = imod2(s);
        int sy = s/2;
        vec2 uv = vec2(float(sx), float(sy));
        float i=dot(F,uv+c); 
        float phi=2.*PI*fract(i*PHI);
        float ct=m-2.*i/n; //costheta
        float st=sqrt(1.-ct*ct); //sintheta
        
        vec3 q=vec3(cos(phi)*st, 
                    sin(phi)*st, 
                    ct);
        float d1=dot(p,q);
        if(d1>d) 
        {
            d=d1;
            res=vec4(q,d);
        }
    }
    return res;
}

float udRoundBox( vec3 p, vec3 b, float r ) {
  return length(max(abs(p)-b,0.0))-r;
}


vec3 Background ( vec3 rd){
    vec3 col = vec3(0);
    float y = abs(rd.z)*.5+.5;
    col += y*vec3(1,0.58,0.03);
    return col;
}
vec3 opRep( in vec3 p, in float s )
{
    return mod(p+s*0.5,s)-s*0.5;
}
vec2 e = vec2(.01, 0);



vec2 Virus( vec3 p, float atime){
    
   
    
    p = p - vec3(sin(atime+2.0)*.1,sin(atime)*.1+sin(atime)*.02,0);
    float t=mod(atime,1.5)/1.5;
    p*=1.-0.05*clamp(sin(6.*t)*exp(-t*4.),-2.,2.);

    p.xy *= Rot(0.04*atime);
    p.xz *= Rot(0.06*atime);
    p += sin(p.x+p.z+atime)*.01+sin(p.y+atime)*.042*p.y;
    
    
    
    vec3 r,f;
    vec4 fibo=invsf(normalize(p),20.);
    p += sin(p.x+p.z+atime)*.01+sin(p.y+atime)*.042*fibo.w*1.;
    
    float cvwidth = .54 +(- (sin(90.*p.x)*cos(40.*p.z)*sin(90.*p.y))*.06
    - (cos(100.*p.x)*sin(100.*p.z)*sin(40.*p.y))*.06
     - (sin(100.*p.y)*sin(100.*p.z)*sin(40.*p.x))*.06)*0.09;
    
    float sphere = sdSphere(p,cvwidth);
     
    vec2 d0Vector= vec2(sphere,2.0);
 
   
    
    vec3 q=p-fibo.xyz;
    vec3 n=normalize(fibo.xyz);
    basis(n,r,f);
    q=vec3(dot(r,q),dot(n,q),dot(f,q));


   
   
   
    q=q-vec3(0,-cvwidth+.08,0);
    
    float d1= sdRoundCone( q, 0.02,0.03 , 0.1);
    
    q=q-vec3(-.03,.12,0.0);
    d1 = smin(sdSphere(q, 0.002)-0.003*snoise(q*83.),d1,.1);
    
  
               
    
    vec2 d1Vector=vec2(d1,3.0);
    
    d1 = min(sdSphere(q-vec3(-.1,-.11,0.05), 0.02),
             sdSphere(q-vec3(.1,-.11,.0), 0.02));
    
    d0Vector=opUMin( d0Vector,vec2(d1,4.0),0.02);
    
    d0Vector=opUMin( d0Vector,d1Vector,0.02);
    
    
    return d0Vector;
   
}

float cell(vec3 p, float atime){

    vec3 c = mod(abs(p),1.5) - .75;
    c.y += sin(c.z) * .15;
    c.xy *= Rot( c.z*.95) ;

    
    float r = 0.1;
   
   
    return sdSphere(c,r)*.8;
}

vec2 Bloodstream (vec3 p, float atime){
    
    p = p - vec3(snoise(p)*sin(atime)*.2,sin(atime)*snoise(p)*0.2,0.);
    p.z += atime * .9;
    p.xy *= Rot( p.z*.5) ;
    
    
    if (abs(p.x) > 3. || abs(p.y) > 3.) {
       return vec2(100.,-1.0);
    }
    

    
    return vec2(cell( p,  atime),5.0);
}


vec2 map(in vec3 p,float atime ){
   

    vec2 cv=Virus(p,atime);
    vec2 b = Bloodstream (p,  atime);
    
    p = Transform(p,atime);
    
    float g1 = sdGyroid(p,1.3,.06,1.4);


    float g2 = sdGyroid(p,10.76,.03,.3);
    float g3 = sdGyroid(p,20.76,.03,.3);
    float g4 = sdGyroid(p,35.76,.03,.3);
    float g5 = sdGyroid(p,60.76,.03,.3);
    
    
    g1 += g2 * .3 * sin(atime*1.53) * cos(atime*2.34) * p.y ;
    g1 -= g3 * .2;
    g1 += g4 * .1;
    g1 += g5 * .2;
    
    
    float tunel = smax(PI*.9 - length(p.xy), .75-g1, 1.) - abs(1.-g1)*.175;
    
    tunel += g2 * .2 * sin(atime*1.53) * cos(atime*2.34) * p.y ;
    tunel -= g3 * .2;
    tunel += g4 * .1;
    tunel += g5 * .2;
     
    
    g1 = smin(tunel, g1,.9); 
    
    
    vec2 vg1 = vec2(g1,1.);
    
    b = opUMin( b,vg1,.31);
    return opU( cv, b);
}

float calcOcclusion( in vec3 pos, in vec3 nor, float time )
{
    float occ = 0.0;
    float sca = 1.0;
    for( int i=0; i<5; i++ )
    {
        float h = 0.01 + 0.11*float(i)/4.0;
        vec3 opos = pos + h*nor;
        float d = map( opos, time ).x;
        occ += (h-d)*sca;
        sca *= 0.95;
    }
    return clamp( 1.0 - 2.0*occ, 0.0, 1.0 );
}

vec2 RayMarching(vec3 ro, vec3 rd,float time){


    vec2 res = vec2(-1.0,-1.0);

    float tmin = 2.;
    float tmax = 100.0;  
    
    float t = tmin;
    for( int i=0; i<512; i++ )
    {
        if( t>=tmax ) break;
        vec2 h = map( ro+rd*t, time );
        if( abs(h.x)<(.001*t))
        { 
            res = vec2(t,h.y); 
            break;
        }
        t += h.x;
    }
    
    return res;
}
 
vec3 calcNormal(in vec3 pos,float time,float quality){
    vec3 n = vec3(0.0);
   for( int i=0; i<4; i++ )
    {
        int bx = imod2((i+3)/2);
        int by = imod2(i/2);
        int bz = imod2(i);
        vec3 e = 0.5773*(2.0*vec3(float(bx), float(by), float(bz)) - 1.0);
        n += e*map(pos+quality*e,time).x;
    }    
    return normalize(n);
}



vec4 render( in vec3 ro, in vec3 rd, float time )
{ 
    
    
    vec3 col = vec3(0.);
        
    vec2 res = RayMarching(ro,rd,time);
    if(res.y>0.5){
        
        float fft  = texelFetch( iChannel0, ivec2(3.,0.75), 0 ).x;
        fft = smoothstep( 0.8, 1., fft )*2.;

        float fft1  = texelFetch( iChannel0, ivec2(5.,0.75), 0 ).x; 
        fft1 = smoothstep( 0.9, 1., fft1 )*1.5;

        float fft2  = texelFetch( iChannel0, ivec2(6.,0.75), 0 ).x; 
        fft2 = smoothstep( 0.9, 1., fft2 );    

        float fft3  = texelFetch( iChannel0, ivec2(7.,0.75), 0 ).x; 
        fft3 = smoothstep( 0.9, 1., fft3 )*2.2;

        float flash =  texture( iChannel0, vec2(512, 0.25)).x;
        flash = smoothstep(.45, .8, flash )*20.;
        flash = clamp(flash,0.,1.);
        
        float d = res.x;
        vec3 pos = ro + rd*d;
        
        
        float quality = res.y < 1.5 ?  0.016 : 0.0025;
        
        vec3 nor = normalize(e.xyy*map(pos+e.xyy,time).x
                     +e.yyx*map(pos+e.yyx,time).x
                     +e.yxy*map(pos+e.yxy,time).x
                     +e.xxx*map(pos+e.xxx,time).x); 
        
         vec3 ref = reflect(rd,nor);
        
        vec3 light_pos = normalize(  vec3( 0., .5, 0.2 ));
        
        vec3 specular = vec3( max( .30, dot( light_pos, ref ) ) );
        specular = pow( specular, vec3( 100.0 ) );
        
       col += vec3(1,.4,.1)* 20. * specular; 
         
        vec3 lin = vec3(0.0);
        
        vec3  sun_lig = light_pos;
        float sun_dif = clamp(dot( nor, sun_lig ), 0.0,1. );
        
        pos = Transform(pos,time);
        if(res.y > 4.5) 
        { 
        
            col += sun_dif *vec3(1.5,0.,.0);
            
        }
        else if(res.y > 3.5)
        {
            col += vec3(1.00,0.24,0.0)*sun_dif;
        }
        else if(res.y > 2.5)
        {
            col += vec3(.79,0.0,0.0)*sun_dif;
        }
        else if(res.y > 1.5) 
        {
            col += sun_dif;
        }
        else if(res.y > 0.5) 
        {
            col += sun_dif *vec3(1.,0.,.0);
            
            float g2 = sdGyroid(pos,10.76,.03,.3);
            col *= smoothstep(-.1,.1,g2);
            
            float beat = abs((g2 * .2 * sin(time*1.53) * cos(time*2.34) * pos.y));
            col += beat*vec3(1.,0.031,.02);
            
            float crackWidth = -.019 + smoothstep(0.,-.1,nor.y)*.04;
            float cracks = smoothstep(crackWidth,-.043,g2);
            cracks *= .5 * smoothstep(.2,.5,nor.y) *.5 +5.5;
            col += cracks*vec3(0.7,0.0,.0)*beat *15.;
            
            
            float speed = 1.5;
            float g5 = sdGyroid(pos+vec3(cos(time*speed),sin(time*speed),time), 1.75, .705, 0.);
            g5 *= sdGyroid(pos+vec3(sin(time*speed),cos(time*speed),time), 1., 1.9, .1);
            col += g5*vec3(.4, .0, .0);
            
     
        }
        
        
        
        
         
       
        
       
        //col *= vec3(fft);
        
        vec3  sun_hal = normalize( sun_lig-rd );
        float sun_sha = calcOcclusion( pos, sun_lig, time );
        lin += sun_dif*vec3(1,.4,.1)*sun_sha;
        
        
        
        float ks = .5;
        float sun_spe = ks*
            pow(clamp(dot(nor,sun_hal),0.0,1.0),9.0)
            *sun_dif
            *(0.04+0.96*pow(clamp(1.0+dot(sun_hal,rd),0.0,1.0),5.0));
        float sky_dif = sqrt(clamp( 0.5+0.5*nor.y, 0.0, 1.0 ));
        lin += sky_dif*vec3(1.0,0.5,.5);
        
        col *= lin;
        col += sun_spe*vec3(8.10,6.00,4.20)*sun_sha;



        vec3 fog = (abs(rd.z)*.5+.5)
            *(
                + (vec3(1.0,0.2,0.0))
                + (vec3(1.0) * flash * 2.)
                + (vec3(2.0,0.5,0.0) * fft1 * 1.3)
            	+ (vec3(1.0,0.0,0.0) * fft2 * 1.3)
            	+ (vec3(1.0,0.0,0.1) * fft3 * 1.3)
             )
            ;
       
        
    
		
        fog = (fog*.5+.5);
        
        col = mix(col, fog,smoothstep(0.,10.,d));
        col *= mix(Background(rd), fog,smoothstep(0.,10.,d));
        
    }
    
        
    return vec4(col,res.x);
}



vec3 GetRayDir(vec2 uv, vec3 p, vec3 l, float z) {
    vec3 f = normalize(l-p),
        r = normalize(cross(vec3(0,1,0), f)),
        u = cross(f,r),
        c = p+f*z,
        i = c + uv.x*r + uv.y*u,
        d = normalize(i-p);
    return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    float t = iTime;
    
    vec2 uv = (fragCoord-.5*iResolution.xy)/iResolution.y;
    vec2 m = iMouse.xy/iResolution.xy;
    
    
    
    vec3 ro = vec3(0, 0, 3.);
    
    ro.xy *= Rot(sin(t*.1)*PI);
    ro.xz *= Rot(sin(t*.1)*PI);
    ro.yz *= Rot(sin(t*.1)*PI);
    
    
    vec3 ta = vec3(0.0,0.,0.);
    vec3 rd = GetRayDir(uv, ro, ta, .6);
    
    vec4 res = render( ro, rd, t );
        
    vec3 col = res.xyz ;
    col = clamp(col, 0.0,1.0);
    
    
    vec2 q = fragCoord/iResolution.xy;
    col *= pow( 16.0*q.x*q.y*(1.0-q.x)*(1.0-q.y), .5 );
    
    
    col = pow(col,vec3(0.4545));
    
    float depth = min(10.0, res.w);
    fragColor = vec4(col,1.0 - (depth - 0.5) / 2.0);
    
}


/** SHADERDATA
{
	"title": "My Shader 0",
	"description": "Lorem ipsum dolor",
	"model": "person"
}
*/