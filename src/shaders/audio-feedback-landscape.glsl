// # Buffer A

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
	
	vec3 colorq = vec3(0.0, 0.0, 0.0);
	float piikit  = texture(iChannel0, vec2(uv.x/7.5, 0.25)).r;
	
	float flash = texture(iChannel0, vec2(0.12, 0.0)).r;
	float glow = (0.01 + flash*0.0012)/abs(piikit - uv.y + 0.05);
	colorq = vec3(0.0, glow*0.15, glow);
	colorq += vec3(sqrt(glow*0.05*(piikit+0.1)));

    vec4 color= vec4(colorq,0.2);

	fragColor = color;
}

// # Buffer B

#define time iTime

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 uvDist = fragCoord / vec2(iResolution.x,iResolution.y)+vec2(0.005,0.025+sin(time/6.)/1000.);
    if(iFrame == 0) {
        fragColor = vec4(0.0,0.0,0.0,1.0);
    } else {
        vec3 prev = texture(iChannel1, uvDist).rgb;
        vec4 acol = texture(iChannel0, uv);
        float alpha = acol.a;
        vec3 bias = vec3(0.919,0.989,0.999);
        fragColor = vec4(acol.rgb + prev*(1.0-alpha)*bias, 1.0);
    }
}

// # Image

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
	fragColor = texture(iChannel0, uv);
}