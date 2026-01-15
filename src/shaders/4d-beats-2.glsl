// CC0: 4D Beats
// Continuing experiments with yesterday's grid structure
// Note: Music may require clicking play/stop to initialize
// Shader animation depends on audio input - static without music
// BPM: 114
// https://www.shadertoy.com/view/WfG3WV

#define DISTORT 3.

void mainImage(out vec4 O, vec2 C) {
  vec4 o,p,U=vec4(1,2,3,0);
  
  // Musical timing: beat-synced animation
  float i,z,d,k,P,T=iChannelTime[0]*1.9,F=sqrt(fract(T)),t=floor(T)+F;
  
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
    p*=k=(9.+DISTORT*F)/dot(p,p),
    
    // Offset by time to animate
    p-=.5*t,
    
    // Store Z coordinate for coloring before folding
    P=p.z,
    
    // Fold space: move to unit cell of infinite lattice
    p-=round(p),
    
    // Distance field
    d=abs(min(
       min(
        min(
         // Cross pattern centered in each unit cell
         min(length(p.xz),length(p.yz)), length(p.xy))
         // 4D sphere at the center of each unit cell
       , length(p)-.2)
         // Box edges: thin walls along each axis
       , min(abs(p.w),min(abs(p.x),min(abs(p.z),abs(p.y))))+.05))/k,
    
    // Color calculation based on depth and inversion factor
    p=1.+sin(P+log2(k)+U.wxyw),
    
    // Accumulate color: brightness scales with inversion + beat fade
    o+=U*exp(.7*k-4.*F)+p.w*p/max(d,1e-3);
    
  // Tanh tone mapping
  O=tanh(o/1E4)/.9;
}