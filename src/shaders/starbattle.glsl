// https://www.shadertoy.com/view/4sSXRt

//Starbattle by codesorc@gmail.com
//First attempt hacking procedural effects, mixing different procedural shaders to create space battle. 
//background is tweaked Kali Starnest http://glsl.herokuapp.com/e#14485.0
precision highp float;
precision highp int;

#define iterations 15
#define formuparam 0.340

#define volsteps 12
#define stepsize 0.110

#define zoom 1.0
#define tile 0.750
#define speed 2.

#define brightness 0.0019
#define darkmatter 0.400
#define distfading 0.960
#define saturation 1.7
#define PI 3.1415

#define SHADERTOY
#ifdef SHADERTOY
  #define time iTime
  #define resolution iResolution
#else
  uniform float time;
  uniform vec2 resolution;
#endif


float sat(float v){
  return clamp(v,0.,1.);
}

vec3 nrand3( vec2 co )
{
    vec3 a = fract( cos( co.x*8.3e-3 + co.y )*vec3(1.3e5, 4.7e5, 2.9e5) );
    vec3 b = fract( sin( co.x*0.3e-3 + co.y )*vec3(8.1e5, 1.0e5, 0.1e5) );
    vec3 c = mix(a, b, 0.5);
    return c;
}


float permutation(float index) {
	return mod(index * index, 257.0);
}

vec3 gradient(float index) {

	index = mod(index * index, 251.0);
	
	float angleAroundZ = mod(index, 16.0) * (2.0 * PI / 16.0);
	float angleAroundY = floor(index / 16.0) * (2.0 * PI / 16.0);
	
	vec3 gradient = vec3(cos(angleAroundZ), sin(angleAroundZ), 0.0);
	vec3 rotatedGradient;
	rotatedGradient.x = gradient.x * cos(angleAroundY);
	rotatedGradient.y = gradient.y;
	rotatedGradient.z = gradient.x * sin(angleAroundY);
	
	return rotatedGradient;
}

float hermit3D(vec3 position) {
	vec3 square = position * position;
	vec3 cube = square * position;
	return (3.0*square.x - 2.0*cube.x) * (3.0*square.y - 2.0*cube.y) * (3.0*square.z - 2.0*cube.z);
}

mat2 makem2(in float theta){float c = cos(theta);float s = sin(theta);return mat2(c,-s,s,c);}


mat2 m2 = mat2( 0.80, 0.60, -0.60, 0.80 );


float perlinNoise3D(int gridWidth, int gridHeight, int gridDepth, vec3 position) {
	
	// Takes input position in the interval [0, 1] in all axes, outputs noise in the range [0, 1].
	vec3 gridDimensions = vec3(gridWidth, gridHeight, gridDepth);
	position *= gridDimensions;
	
	// Get corners,
	vec3 lowerBoundPosition = floor(position);
	
	// Calculate gradient values!
	float gradientValues[8];
  for (int corner = 0; corner < 8; corner++) {
    int ix = corner - (corner / 2) * 2;
    int iy = (corner / 2) - ((corner / 4) * 2);
    int iz = corner / 4;
    vec3 currentPointPosition = lowerBoundPosition + vec3(float(ix), float(iy), float(iz));
    vec3 displacementVector = (currentPointPosition - position);
    vec3 gradientVector = gradient(mod(currentPointPosition.x + permutation(mod(currentPointPosition.y + permutation(currentPointPosition.z), 256.0)), 256.0));
    gradientValues[corner] = dot(gradientVector, displacementVector) * 2.0;
  }
	
	
	
	// Interpolate using Hermit,
	vec3 interpolationRatio = position - lowerBoundPosition;
	float finalNoise = 0.0;
	finalNoise += gradientValues[7] * hermit3D(interpolationRatio);
	finalNoise += gradientValues[6] * hermit3D(vec3(1.0 - interpolationRatio.x, interpolationRatio.y, interpolationRatio.z));
	finalNoise += gradientValues[5] * hermit3D(vec3( interpolationRatio.x, 1.0 - interpolationRatio.y, interpolationRatio.z));
	finalNoise += gradientValues[4] * hermit3D(vec3(1.0 - interpolationRatio.x, 1.0 - interpolationRatio.y, interpolationRatio.z));
	
	finalNoise += gradientValues[3] * hermit3D(vec3( interpolationRatio.x, interpolationRatio.y, 1.0 - interpolationRatio.z));
	finalNoise += gradientValues[2] * hermit3D(vec3(1.0 - interpolationRatio.x, interpolationRatio.y, 1.0 - interpolationRatio.z));
	finalNoise += gradientValues[1] * hermit3D(vec3( interpolationRatio.x, 1.0 - interpolationRatio.y, 1.0 - interpolationRatio.z));
	finalNoise += gradientValues[0] * hermit3D(vec3(1.0 - interpolationRatio.x, 1.0 - interpolationRatio.y, 1.0 - interpolationRatio.z));
	
	
	
	return finalNoise;
}


float fbm( in vec2 p )
{
	float z=2.;
	float rz = 0.;
	for (float i= 1.;i < 7.;i++ )
	{
		rz+= abs((perlinNoise3D(1,1,1,vec3(p,0.5))-0.5)*2.)/z;
		z = z*2.;
		p = p*2.;
		p*= m2;
	}
	return rz;
}


vec3 hsv(float h,float s,float v) {
return mix(vec3(1.),clamp((abs(fract(h+vec3(3.,2.,1.)/3.)*6.-3.)-1.),0.,1.),s)*v;
}

vec2 rotate(vec2 p, float a)
{
    return vec2(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
}

// 1D random numbers
float rand(float n)
{
    return fract(sin(n) * 43758.5453123);
}

// 2D random numbers
vec2 rand2(in vec2 p,float t)
{
    return fract(vec2(sin(p.x * 591.32 + p.y * 154.077 + t), cos(p.x * 391.32 + p.y * 49.077 + t)));
}

// 1D noise
float noise1(float p)
{
    float fl = floor(p);
    float fc = fract(p);
    return mix(rand(fl), rand(fl + 1.0), fc);
}

// voronoi distance noise, based on iq's articles
float voronoi(in vec2 x,float t)
{
    vec2 p = floor(x);
    vec2 f = fract(x);
    
    vec2 res = vec2(8.0);
    for(int j = -1; j <= 1; j ++)
    {
        for(int i = -1; i <= 1; i ++)
        {
            vec2 b = vec2(i, j);
            vec2 r = vec2(b) - f + rand2(p + b,t);
            
            // chebyshev distance, one of many ways to do this
            float d = sqrt(abs(r.x*r.x) + abs(r.y*r.y));
            
            if(d < res.x)
            {
                res.y = res.x;
                res.x = d;
            }
            else if(d < res.y)
            {
                res.y = d;
            }
        }
    }
    return res.y - res.x;
}

vec3 worly_star_base(vec2 pos,vec2 uv,vec2 suv,float r,float t,vec3 col){
    float flicker = noise1(time * 2.0) * 0.8 + 0.4;
    float v = 0.0;
    
    v = 1.0 - length(uv-pos.xy)/r;
    float a = 0.16, f = 12.0;
    
    for(int i = 0; i < 4; i ++)
    {    
        float v1 = voronoi(uv * f + 5.0,t);
        float v2 = 0.0;
 
        if(i > 0)
        {
            // of course everything based on voronoi
            v2 = voronoi(uv * f * 0.5 + 50.0 + t,t);
            
            float va = 0.0, vb = 0.0;
            va = 1.0 - smoothstep(0.0, 0.1, v1);
            vb = 1.0 - smoothstep(0.0, 0.08, v2);
            v += a * pow(va * (0.5 + vb), 2.0);
        }
        
        // make sharp edges
        v1 = 1.0 - smoothstep(0.0, 0.3, v1);
        
        // noise is used as intensity map
        v2 = a * (noise1(v1 * 0.5 + 0.1));
        
        // octave 0's intensity changes a bit
        if(i == 0)
            v += v2 * flicker;
        else
            v += v2;
        
        f *= 3.0;
        a *= 0.7;
    }

    // slight vignetting
    v *= exp(-0.6 * length(suv)) * 1.2;
    
    // old blueish color set
    vec3 cexp = col;vec3(1.0, 2.0, 4.0);
        cexp *= 1.3;

    col = pow( vec3(max(v,0.0)), cexp ) * 8.0;
    
    return col;
}


vec3 worly_star(vec2 pos,vec2 uv,vec2 suv,float r,float t){
    return worly_star_base(pos,uv,suv,r,t,vec3(1.0, 2.0, 4.0));
}

vec3 worly_star_blue(vec2 pos,vec2 uv,vec2 suv,float r,float t){
   return worly_star_base(pos,uv,suv,r,t,vec3(2.0, 1.0, 1.0));
}

vec4 eye(vec2 pos,vec2 pointPosition,float sphereRadius){
  float noise = 0.0;
  vec3 noisePoint = vec3(pointPosition.xy,-(time*0.16));
  noise +=         abs(perlinNoise3D(4, 4, 4, noisePoint));
  noise += 0.500 * abs(perlinNoise3D(8, 8, 8, noisePoint));
  noise += 0.250 * abs(perlinNoise3D(16, 16, 16, noisePoint));
  noise += 0.125 * abs(perlinNoise3D(32, 32, 32, noisePoint));
  noise += 0.0625 * abs(perlinNoise3D(64, 64, 64, noisePoint));
	    
  float radius = length(pointPosition) - 1.0*sphereRadius;
  radius /= sphereRadius * 0.3;
  float phase = clamp(radius + 1.0*noise, 0.0, 0.5*PI);
  radius = sin(phase);
  
  vec4 color;
  color = mix(vec4(0.8, 0.95, 0.2, 1.0), vec4(1.0, 0.1, 0.0, 1.0), radius)*(noise-0.2)* 2.*(1.0 - radius);
  color*=5.*pow(smoothstep(0.0,1.0,2.0*length(pos)),0.85);
  vec3 col=clamp(worly_star(pointPosition,pos,pos,0.1,time),0.,1.);
  col=clamp(col,0.,1.);
  color=color;
  color=clamp(color,0.,1.);
  color+=vec4(col,1.);
  return clamp(color,0.,1.);
}



vec3 something(vec2 uv,vec3 obj_pos, vec2 fragCoord){
  	vec3 v=vec3(0.);
	float noise = 0.0;
	vec3 pointPosition=vec3(uv,length(uv.xy))*4.;
;
	float sr=0.05;
	float radius = length(pointPosition-obj_pos) - 1.0*sr;
	float phase = clamp(+1.*noise, 0.0, 0.5*PI);
	radius = sin(phase);

	
	const float kNumParts=7.0;
	for(float part=0.0;part<kNumParts;part+=1.0){
		float ang=2.0*3.14*(part/(kNumParts))+time*4.0;
		vec2 dxy=vec2(cos(ang),sin(ang))*0.01;
		float mag=(1.0 / exp(pow(600.0 * length(uv-obj_pos.xy-dxy), 0.5)));
		vec3 c=vec3(mag,mag,0.);
		v+=2.*c;
	}
	
	float tau = 3.1415926535*2.0;
	float ang = atan(uv.x-obj_pos.x,uv.y-obj_pos.y)-time*1.9;
	float d = abs(length(uv-obj_pos.xy)-0.025);
	
	
	
	v.b-=0.4;
	vec2 xy=fragCoord.xy/resolution.xy;
	v+=0.5*hsv((ang+0.5)/3.14/2.0,1.0,1.0)*pow(cos(clamp(d*5.0,-3.14*0.6,3.14*0.15)),2000.0);//*(1.0+sin(ang+pow(time,0.1)*10.))*(1.0+sin(d+time*3.));
	return clamp(v,0.,1.);
}

/*
*fireball thingy
*/
float snoise(vec3 uv, float res)
{
  const vec3 s = vec3(1e0, 1e2, 1e3);
  
  uv *= res;
  
  vec3 uv0 = floor(mod(uv, res))*s;
  vec3 uv1 = floor(mod(uv+vec3(1.), res))*s;
  
  vec3 f = fract(uv); f = f*f*(3.0-2.0*f);

  vec4 v = vec4(uv0.x+uv0.y+uv0.z, uv1.x+uv0.y+uv0.z,
              uv0.x+uv1.y+uv0.z, uv1.x+uv1.y+uv0.z);

  vec4 r = fract(sin(v*1e-1)*1e3);
  float r0 = mix(mix(r.x, r.y, f.x), mix(r.z, r.w, f.x), f.y);
  
  r = fract(sin((v + uv1.z - uv0.z)*1e-1)*1e3);
  float r1 = mix(mix(r.x, r.y, f.x), mix(r.z, r.w, f.x), f.y);
  
  return mix(r0, r1, f.z)*2.-1.;
}

float fireball_mono(vec2 p,float t){
  float color = 3.0 - (3.*length(2.*p));
  
  vec3 coord = vec3(atan(p.x,p.y)/6.2832+.5, length(p)*.4, .5);
  
  for(int i = 1; i <=4; i++)
  {
    float power = pow(2.0, float(i));
    color += (1.5 / power) * snoise(coord + vec3(0.,-t*.05, t*.01), power*16.);
  }
  return color;
}

vec3 fireball(vec2 p,float t,vec3 pos,float r){
        float color=fireball_mono((p-pos.xy)/r,t);
  return clamp(vec3(color, pow(max(color,0.),2.)*0.4, pow(max(color,0.),3.)*0.15),0.,1.);
}

/*
*end fireball thingy
*/

/*
*start rocket
*/
vec3 flame_rocket(vec2 uv,vec2 pos,float r,vec2 dir,vec2 rdir){
  //TODO change this mess with better flame eye noise, thought not sure if it works well on small details
  vec3 v;
  float flame=0.;
  float a=atan(dir.x,rdir.y);
  float nx=cos(a)*(uv.x-pos.x)-sin(a)*(uv.y-pos.y);
  float ny=sin(a)*(uv.x-pos.x)+cos(a)*(uv.y-pos.y);
  
  vec2 uv2=vec2(nx,ny)/r;
  uv2.x*=4.;
  float octaves=0.;
  float t=time*8.;
  octaves+=perlinNoise3D(1,1,1,vec3(uv2*128.,t));
  octaves+=perlinNoise3D(1,1,1,vec3(uv2*64.,t))*2.;
  octaves+=perlinNoise3D(1,1,1,vec3(uv2*32.,t))*4.;
  octaves+=perlinNoise3D(1,1,1,vec3(uv2*16.,t))*8.;
  octaves+=perlinNoise3D(1,1,1,vec3(uv2*8.,t))*10.;
  flame+=0.00175*octaves;
    
  v=vec3( sat(100.*((0.5-abs(uv2.x)+flame)-0.5*(uv2.y+0.5))) ) ;
  v*=sat(100.*(2.*flame+ 0.2-abs(uv2.y)));
  
  v*=mix(vec3(1.,1.0,0.),vec3(1.,0.2,0.),sat(((uv2.y+0.2)*2.)*2.))*(perlinNoise3D(1,1,1,vec3(uv2*16.,t*4.))+1.)*2.;
  v*=1./(1.+length(uv)*10.);
  return clamp(v,0.,1.);
}
/*
*end rocket
*/

/*
*star laser
*/
    
float laser(vec2 uv,vec2 laser_start,vec2 laser_end,float laser_radius){
laser_radius*=0.3;
  float laser_len=distance(laser_end,laser_start);
  vec2 laser_normal=normalize(laser_end-laser_start);
  float t=dot(laser_normal,uv-laser_start)/laser_len;
  float d=pow(distance(laser_start+laser_normal*laser_len*t,uv),1.);
  float d2=laser_len*float(t<0.)*pow(-t,2.0)+float(t>1.0)*pow(t-1.,2.);
  float d3=sqrt(d*d+d2*d2);
  return laser_radius/pow(d3,1.0); 
}
/*
*end laser
*/

vec3 starnest(vec2 uv){
  vec3 v=vec3(0.4);
  vec3 dir=vec3(uv*zoom,1.);
  float a1=0.18;
  float a2=2.;
  mat2 rot1=mat2(cos(a1),sin(a1),-sin(a1),cos(a1));
  mat2 rot2=mat2(cos(a2),sin(a2),-sin(a2),cos(a2));
  dir.xz*=rot1;
  dir.xy*=rot2;
  vec3 from=vec3(0.,0.,0.);
  from+=vec3(.1*time+0.1*sin(time),.120*time-0.1*cos(time*0.1),2.+0.010*time);
  float s=.05,fade=.0377;
  float frequencyVariation=0.5;
  for (int r=0; r<volsteps; r++) {
    vec3 p=from+s*dir*1.5;
    p = abs(vec3(frequencyVariation) - mod(p, vec3(frequencyVariation * 2.0)));

    p.x+=float(r*r)*0.01;
    p.y+=float(r)*0.02;
    float pa,a=pa=0.;
    for (int i=0; i<iterations; i++){
      p=abs(p)/dot(p,p)-formuparam;
      a+=abs(length(p)-pa*0.1);
      pa=length(p);
    }
    a*=pow(a,2.750)*1.; // add contrast
    v+=vec3(s,s*s,s*s*s*s)*a*brightness*fade; // coloring based on distance
    fade*=distfading; // distance fading
    s+=stepsize;
  }
  v=pow(v,vec3(1.05));
  v=mix(vec3(length(v)),v,saturation); //color adjust
  v=v*0.005;
  return v;
}


float noise2D(vec2 uv)
{
    uv = fract(uv)*1e3;
    vec2 f = fract(uv);
    uv = floor(uv);
    float v = uv.x+uv.y*1e3;
    vec4 r = vec4(v, v+1., v+1e3, v+1e3+1.);
    r = fract(1e5*sin(r*1e-2));
    f = f*f*(3.0-2.0*f);
    return (mix(mix(r.x, r.y, f.x), mix(r.z, r.w, f.x), f.y));    
}

float fractal(vec2 p) {
    float v = 0.5;
    v += noise2D(p*16.); v*=.5;
    v += noise2D(p*8.); v*=.5;
    v += noise2D(p*4.); v*=.5;
    v += noise2D(p*2.); v*=.5;
    v += noise2D(p*1.); v*=.5;
    return v;
}

vec3 func( vec2  p,float t) {
    p = p*.1+.5;
    vec3 c = vec3(.0, .0, .1);
    vec2 d = vec2(t*.0001, 0.);
    c = mix(c, vec3(.8, .1, .1), pow(fractal(p*.20-d), 3.)*2.);
    c = mix(c, vec3(.9, .6, .6), pow(fractal(p.y*p*.10+d)*1.3, 3.));
    c = mix(c, vec3(1., 1., 1.), pow(fractal(p.y*p*.05+d*2.)*1.2, 1.5));
    return c;
}

vec4 planet(vec2 uv,vec3 pos,float r,float t){
    vec2 p=(uv-pos.xy)*1./r;
    vec3 n;
    n.xy=p;
    n.z=sqrt(1.-(p.x*p.x+p.y*p.y));
    n=normalize(n);
    vec3 l=normalize(vec3(-uv,0.));
    
	
    float d = length(p);
    p *= (acos(d) - 1.57079632)/d;    
    vec3 v;
    v=func(p,t*8.)*max(1.-d*d*d, 0.);
    

    v=2.*clamp(v,0.,1.)*(vec3(1.0,0.6,0.)*sat(dot(n,l))+0.25);
    v+=vec3(1.,0.8,0.6)*sat(pow(1.-abs(n.z),1.5));
    
    return vec4(v,length(uv-pos.xy)/r);
}

vec3 draw_planets(vec2 uv,vec3 v,vec3 planet_to_be_attacked_position,float planet_to_be_attacked_radius){
  vec4 red_planet=planet(uv,planet_to_be_attacked_position,planet_to_be_attacked_radius,time);
  red_planet.xyz-=0.3;
  float is_planet=sat(pow(sat(1.-sat(red_planet.w*0.5-0.3)),1.))*sat((length(red_planet)-0.10)*1000.) ;
  return clamp(3.*red_planet.xyz,0.,1.)*is_planet+v*(1.-is_planet);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
  vec2 uv=fragCoord.xy/resolution.xy-.5;
  uv.y*=resolution.y/resolution.x;
  vec3 v=starnest(uv);

  vec3 planet_to_be_attacked_position=vec3(cos(time*0.6),sin(time*0.6),0.)*0.25;  
  float planet_to_be_attacked_radius=.05;
  v+=draw_planets(uv,v,planet_to_be_attacked_position,planet_to_be_attacked_radius);
	
  v+=clamp(0.2*worly_star(vec2(0.0),uv,uv,0.2,time),0.,1.);

  
  vec3 attacker_1_position_at_shot_time=vec3(-0.15,0.1,0.);
  vec3 attacker_1_pos=attacker_1_position_at_shot_time+vec3(sin(time)*0.1,sin(time*0.5)*0.2,0.);
  vec3 obj=something(uv,attacker_1_pos, fragCoord);
  
   
  #define NUM_FIREBALLS 2
  for(int i=0;i<NUM_FIREBALLS;i++){
    vec2 dxy=nrand3(vec2(float(i)*5.,0.5)).xy-0.5;
    vec3 dir_fireball=normalize(planet_to_be_attacked_position-attacker_1_pos)+vec3(0.8*dxy,0.);
    float dist_fireball=(length(planet_to_be_attacked_position-attacker_1_pos)-planet_to_be_attacked_radius*0.5);
    float rocket_offset=float(i)*0.5;
    vec3 fireball_traectory=dir_fireball*dist_fireball*sin(mod(time*1.1+rocket_offset,3.14159*0.5));
    vec3 fireball_pos=attacker_1_pos+fireball_traectory;
    v+=fireball(uv,time*4.,fireball_pos,0.035+0.155*pow(clamp(sin(mod(time*1.1+rocket_offset,3.14159*0.5))-0.9,0.,1.),0.25));
  }

  #define NUM_GUIDED_ROCKETS 7
  for(int i=0;i<NUM_GUIDED_ROCKETS;i++){
    vec2 dir=(attacker_1_pos-planet_to_be_attacked_position).xy;    
    vec2 ndir=normalize(dir);
    vec2 left_dir=vec2(-ndir.y,ndir.x);//90 ccw rotate
    float dist=length(dir);
    float sin_amp=(nrand3(vec2(float(i)*160.,0.5)).x-0.5)*0.7;
    sin_amp+=0.1*abs(sin_amp)/sin_amp;
    sin_amp*=8.*dist;
    float t=mod(time*0.5+float(i)*0.24,1.);
    t=pow(t,float(i)*2.250/float(NUM_GUIDED_ROCKETS));
    //vec2 rocket_pos_t0=planet_to_be_attacked_position.xy;
    vec2 rocket_pos=planet_to_be_attacked_position.xy+0.87*(ndir*dist+left_dir*sin_amp*sin(pow(t,0.25)*3.14159))*t;
    vec2 rocket_pos_next=planet_to_be_attacked_position.xy+0.87*(ndir*dist+left_dir*sin_amp*sin(pow((t+0.01),0.25)*3.14159))*(t+0.01);
    vec2 dir_d_rocket_pos=normalize(rocket_pos_next-rocket_pos);
    v+=3.*flame_rocket(uv,rocket_pos.xy,0.075,ndir,dir_d_rocket_pos);
    v+=fireball(uv,time*4.,vec3(rocket_pos,0.),0.015+0.155*pow(clamp(sin(t-0.87),0.,1.),0.25));      
    float laser_attack_time=sat(mod(time*0.05,1.)-0.90);
    vec2 laser_target_xy=attacker_1_pos.xy+(planet_to_be_attacked_position.xy-attacker_1_pos.xy)*sat(1.*laser_attack_time)*0.7;
    v+=vec3(0.5,1.,0.1)*laser(uv,planet_to_be_attacked_position.xy,laser_target_xy.xy,0.002)*sat(10.*laser_attack_time);
  }
  
  v+=clamp(eye(uv-attacker_1_pos.xy,uv,0.075).rgb,0.,1.);
  v+=clamp(0.2*worly_star_blue(attacker_1_pos.xy,uv,uv,0.1,time),0.,1.);
  
  fragColor = vec4(v,1.);
}
