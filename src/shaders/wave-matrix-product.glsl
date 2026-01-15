// Iain Melvin 2014

// https://www.shadertoy.com/view/4dfSRS
// uncomment this to turn off peak offset adjustment
//#define OFFSET_OFF

// comment these to get the basic effect:
#define RADIAL
#define REFLECT



float get_max(){
  // find max offset (there is probably a better way)
  float jmax = 0.0;
  float jmaxf=0.0;
  float jf=0.0;
  float ja;
  for (int j=0;j<200;j++){
    jf = jf+0.005;
    ja = texture( iChannel0, vec2(jf,0.75)).x;
    if ( ja>jmaxf) {jmax = jf;jmaxf = ja;}
  }
  return jmax;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    

#ifdef OFFSET_OFF
    float jmax = 0.0;
#else
    float jmax = get_max();
#endif
    

    
    float a = 1.0;
#ifdef REFLECT
	uv=abs(2.0*(uv-0.5));
#endif
	
#ifdef RADIAL
    float theta = 1.0*(1.0/(3.14159/2.0))*atan(uv.x,uv.y);
    float r = length(uv);
	a=1.0-r;//vignette
    uv = vec2(theta,r);	
#endif

    
	vec4 t1 = texture(iChannel0, vec2(uv[0],0.761)+jmax )-0.5;
    vec4 t2 = texture(iChannel0, vec2(uv[1],0.761)+jmax )-0.5;
   	float y = t1[0]*t2[0]*a*10.5;
	fragColor = vec4( sin(y*3.141*2.5), sin(y*3.141*2.0),sin(y*3.141*1.0),1.0);
}
