// CC0: 4D Beats
// Continuing experiments with yesterday's grid structure
// Note: Music may require clicking play/stop to initialize
// Shader animation depends on audio timestamp - static without music
// BPM: 114

// https://www.shadertoy.com/view/tfK3Dy
// Variant here: https://www.shadertoy.com/view/WfG3WV

// One thing that bothers me abit about these minishaders is that it's
//  harder for me to reference where I found tricks and inspiritation. 
//  Normal shaders I just copy the function and put a comment on it. 
//  So here is an incomplete list of shader devs that were source of 
//   tricks and inspiration for the minishaders (alphabetical sorting)
//   @byt3_m3chanic
//   @FabriceNeyrat2
//   @iq
//   @shane
//   @XorDev

// App convention: iChannel0 is a 512x2 audio texture; FFT row sampled at y≈0.25
float stAudio(float x) {
  x = clamp(x, 0.0, 0.999);
  return texture(iChannel0, vec2(x, 0.25)).r;
}

float stVol() {
  // quick bass/low-mid average
  float a = 0.0;
  const int N = 12;
  for (int i = 0; i < N; i++) a += stAudio(float(i) / float(N));
  return a / float(N);
}

void mainImage(out vec4 O, vec2 C) {
  vec4 o,p,P,U=vec4(1,2,3,0);
  
  // Musical timing: beat-synced animation
  //  floor(T)+sqrt(F) gives the beat synchronized speed-up
  //  floor(T)+F*F also works
  float vol = stVol();
  float motion = smoothstep(0.02, 0.08, vol);
  float i,z,d,k,T=iTime*1.9*motion,F=fract(T),t=floor(T)+sqrt(F);
  
  // 2D rotation matrix that spins based on musical beats
  mat2 R=mat2(cos(t*.1+11.*U.wxzw));
  
  // Raymarching loop
  for(vec3 r=iResolution;++i<77.;z+=.8*d+1e-3)
    
    // Create ray from camera through current pixel
    //  Extend to 4D because why not?
    p=vec4(z*normalize(vec3(C-.5*r.xy,r.y)),.2),
    
    // Move camera back in Z
    p.z-=3.,
    
    p.xw*=R,  // Rotate in XW plane
    p.yw*=R,  // Rotate in YW plane  
    p.zw*=R,  // Rotate in ZW plane
    
    // @mla inversion
    //  Makes the boring grid more interesting
    p*=k=9./dot(p,p),
    
    // Offset by time to move grid
    //  Store P for coloring later
    P=p-=.5*t,
    
    // Fold space: move to unit cell of infinite lattice
    //  abs here in to avoid doing it for each individual box edge
    p=abs(p-round(p)),
    
    // Distance field
    d=abs(
     min(
       min(
           // Cross pattern centered in each unit cell
           min(min(length(p.xz),length(p.yz)), length(p.xy))
           // 4D sphere at the center of each unit cell
         , length(p)-.2
         )
         // Box edges: thin walls along each axis
       , min(p.w,min(p.x,min(p.z,p.y)))+.05)
       )/k,
    
    // Color calculation based on depth and inversion factor
    p=1.+sin(P.z+log2(k)+U.wxyw),
    
    // Accumulate color: brightness scales with inversion + beat fade
    o+=U*exp(.7*k-6.*F)+p.w*p/max(d,1e-3);
    
  // Tanh tone mapping, divide by .9 to get a slight clipping effect
  O=tanh(o/1e4)/.9;
}
