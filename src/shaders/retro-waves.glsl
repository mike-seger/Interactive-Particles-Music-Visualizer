// https://www.shadertoy.com/view/XsGBzK

float hash(float p) {
	vec3 p3  = fract(vec3(p) * 443.8975);
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.x + p3.y) * p3.z);
}
void mainImage( out vec4 c, in vec2 p ) {
	p /= iResolution.xy;
    
    /* look at buffer A contents
    c = texture(iChannel0, p);
    return;
	//*/
    
    // use manhatten dist in voronoi to get the blocky effect (thanks shadertoy)
    // todo look into plane tilings

    // todo parallelogram is neat but a diagonal high tech (possibly mini voronoi)
    // pattern might be cooler

    const float freq = 33.;
    const float bezel = .7;
    const float skew = .5;

    vec2 uv = p;
    uv.x *= iResolution.x / iResolution.y;

	// background mesh
    vec2 pp = fract(uv*sqrt(iResolution.y*14.));
    float mesh_bezel = .4 - .08 * smoothstep(500., 900., iResolution.y);
	vec4 bgmesh = 1.4*vec4(.05, .086, .04, 1.) * step(mesh_bezel, pp.x) * step(mesh_bezel, pp.y);
    
    // give the fragment a skewed lattice point
    uv = vec2(uv.x-skew*uv.y, uv.y);
    vec2 lattice = floor(uv * freq) / freq;
    // unskew latice point
    lattice.x += floor(skew * uv.y * freq) / freq;
    
    // compute skewed grid
    uv = fract(uv * freq);
    float grid = step(bezel, 1. - abs(uv.x - .5));
    grid *= step(bezel, 1. - abs(uv.y - .5));

    const float pinkness = .7;
    const float blueness = .8;
    const float brightness = 1.85;
    
    vec4 pink = 1.4 * vec4(255./256., 20./256., 144./256., 1);
    vec4 blue = vec4(0., 204./256., 1., 1);
    vec4 bg = vec4(0);

    lattice.x *= iResolution.y / iResolution.x;
    float x = texture(iChannel0, lattice).r;
    c = mix(mix(bg, blue, smoothstep(.0, .3, blueness*x)), pink, pinkness*x);
    c *= grid * brightness;
    c = mix(bgmesh, c, smoothstep(.05, 1., length(c)));
    
    // vignette - I like the color distortion of the pinks this gives
    // gives a more 'retro tv' feel
    c.rgb *= pow(16.*p.x*p.y*(1.-p.x)*(1.-p.y), .35);
    
    c *= 1. - .5*sqrt(hash(p.x*p.y+2.));
}
