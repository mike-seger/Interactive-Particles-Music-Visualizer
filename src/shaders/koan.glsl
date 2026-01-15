

void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
	
		
	vec2 uPos = ( fragCoord.xy / iResolution.xy );
	
	uPos.y -= 0.5;	//center waves
	
	vec3 color = vec3(0.0);
	float levels = texture(iChannel0, vec2(uPos.x, 1.0)).x * .5 + 0.2;	//audio
	const float k = 5.;	//how many waves
	for( float i = 1.0; i < k; ++i )
	{
		float t = iTime * exp(0.1*iMouse.x/1000.0) * (1.0); //mouse input
	
		uPos.y += exp(6.0*levels) * sin( uPos.x*exp(i) - t) * 0.01;
		float fTemp = abs(1.0/(50.0*k) / uPos.y);
		color += vec3( fTemp*(i*0.03), fTemp*i/k, pow(fTemp,0.93)*1.2 );
	}
	
	vec4 color_final = vec4(color, 65.0);
	fragColor = color_final;
}