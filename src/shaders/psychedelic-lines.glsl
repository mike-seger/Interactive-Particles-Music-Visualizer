#define StepSize .07
#define LineCount 14

//Function to draw a line, taken from the watch shader
float line(vec2 p, vec2 a, vec2 b, float thickness )
{
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba),0.0,1.0);
    thickness *= 1.0+abs(texture(iChannel0, vec2(h, 1)).x);//floor(iTime * 20.0) * StepSize;
	return 1.0 - smoothstep(thickness * 0.001, thickness * 1.5, length(pa - ba * h));
}	
                    
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = (fragCoord.xy / iResolution.xy);
		
	// vec2 wav = vec2(length(texture(iChannel0, vec2(uv.x, 0)).xyz),
	// 				length(texture(iChannel0, vec2(uv.y, 0)).xyz));
    // wav *= 0.2;
    //vec4 spec = texture(iChannel0, vec2(uv.y, 0));

	uv = uv * 2.0 - 1.0;
    // float extend  = wav.y;

	// convert the input coordinates by a cosinus
	// warpMultiplier is the frequency
	// float warpMultiplier = (1.0 + 1.5 * sin(iTime * 0.125));
	// vec2 warped = cos(uv * 6.28318530718 * warpMultiplier * sin(wav.yx) + 2.7* cos(iTime*0.9))-cos(uv.yx*7.77*sin(wav.xy)+2.0*sin(iTime));


	float gt = iTime * 1.5;


	// blend between the warpeffect and no effect
	// don't go all the way to the warp effect
	// float warpornot = smoothstep(.5, 18.0, 2.0*sin(iTime * .25)+warped.x+warped.y)*0.125;

	// Variate the thickness of the lines
	float thickness = 0.0001 + 0.002 * pow(1.5- 1.45 * cos(iTime), 2.0) / iResolution.x;// - wav.x*0.003 + wav.y*0.003;
	// thickness *= .1 + (warpMultiplier * warpornot)  + wav.x + wav.y;

    float brighness = 0.9;///pow(thickness,.5);
	// Add 10 lines to the pixel
	vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
	for (int i = 0; i < LineCount; i++)
	{
		gt -= StepSize;

		thickness *= 1.3;
        brighness *= 0.9;
		// uv = mix(uv, warped * float(i), warpornot);

		//Calculate the next two points
		vec2 point1 = vec2(sin(gt * 0.93), cos(gt * 0.33) );
		vec2 point2 = vec2(cos(gt * 0.59), sin(gt * 0.92) );
        
        vec2 ctr = (point1 + point2) * 0.5;
        float len = float(LineCount - i)*0.1+2.5*texture(iChannel0, vec2(float(i)/float(LineCount-1), 0.0)).r;
        point1 -= ctr;
        point2 -= ctr;
        mat2 rot = mat2(cos(gt * 1.93), -sin(gt * 1.92), sin(gt * 1.97), -cos(gt * 1.95));
        point1 *= rot;
        point2 *= rot;

		// Add new line
		color.rgb += line(	uv,
							point1 * len + ctr, 
                            point2 * len + ctr,
							thickness * (0.1+40.0*len))
					//With color
					* ( brighness +
						brighness * vec3(	sin(gt * 4.3),
									cos(gt * 2.7),
									sin(gt * 8.9)));
    }

	// Clamp oversaturation
	fragColor = clamp(color, 0.0, 1.0);
}
