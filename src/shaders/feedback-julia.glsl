// # Buffer A

vec2 tile (vec2 v) {return ((fract(v)*2.-1.)*sign(fract(0.5*v)*2.-1.))*0.5+0.5;}
vec2 mul (vec2 a, vec2 b) {return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec4 s (vec2 v) {return texture(iChannel0,tile(v));}
float m (float i) {return texture(iChannel1,vec2(0.3*i,1.)).x;}
void mainImage( out vec4 C, in vec2 U )
{	U = U/iResolution.xy;
    C = 0.5+0.25*(vec4(m(U.x))*2.-1.);
 	C = exp(-5e3*(U.y-C)*(U.y-C));
 	float t = 1.3*sin(iTime);
 	vec2 a = sin(t+vec2(0,1.5707963));
 	mat2 m = mat2(a.x,-a.y,a.y,a.x);
 	U = U*2.-1.;
 	U = (1.5+.25*cos(5.*t+5.*iTime))*mul(U,U)+0.3*vec2(sin(1.235*iTime),cos(2.25*iTime));
 	U = m*U - vec2(0.,0);
    U = U*0.5+0.5;
 	C += 0.9*s(U);
}

// # Image

vec2 tile (vec2 v) {return ((fract(v)*2.-1.)*sign(fract(0.5*v)*2.-1.))*0.5+0.5;}
vec2 mul (vec2 a, vec2 b) {return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec4 s (vec2 v) {return texture(iChannel0,tile(v));}
float m (float i) {return texture(iChannel1,vec2(0.3*i,1.)).x;}
void mainImage( out vec4 C, in vec2 U )
{	U = U/iResolution.xy;
    C = 0.5+0.25*(vec4(m(U.x))*2.-1.);
 	C = exp(-5e3*(U.y-C)*(U.y-C));
 	float t = 1.3*sin(iTime);
 	vec2 a = sin(t+vec2(0,1.5707963));
 	mat2 m = mat2(a.x,-a.y,a.y,a.x);
 	U = U*2.-1.;
 	U = (1.5+.25*cos(5.*t+5.*iTime))*mul(U,U)+0.3*vec2(sin(1.235*iTime),cos(2.25*iTime));
 	U = m*U - vec2(0.,0);
    U = U*0.5+0.5;
 	C += 0.9*s(U);
}
