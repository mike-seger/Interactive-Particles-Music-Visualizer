// https://www.shadertoy.com/view/4tt3RH

#define NUM_PARTICLES 45.0
#define GLOW 0.5
#define TIME_SKIP 0.0
#define SPEED_UP 1.15
//#define MUSIC

vec3 Orb(vec2 uv, vec3 color, float radius, float offset)
{        
    vec2 position = vec2(sin((1.9 + offset * 4.9) * ((iTime * SPEED_UP) + TIME_SKIP)),
                         cos((2.2 + offset * 4.5) * ((iTime * SPEED_UP) + TIME_SKIP)));
    
    position *= ((sin(((iTime * SPEED_UP) + TIME_SKIP) - offset) + 7.0) * 0.1) * sin(offset);
    
    radius = ((radius * offset) + 0.005);
    float dist = radius / distance(uv, position);
    return color * pow(dist, 1.0 / GLOW);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = 2.0 * vec2(fragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    vec3 pixel = vec3(0.0, 0.0, 0.0);
   	vec3 color = vec3(0.0, 0.0, 0.0);
    
 	color.r = ((sin(((iTime * SPEED_UP) + TIME_SKIP) * 0.25) + 1.5) * 0.4); // 0.2 - 1.0
    color.g = ((sin(((iTime * SPEED_UP) + TIME_SKIP) * 0.34) + 2.0) * 0.4); // 0.4 - 1.2
    color.b = ((sin(((iTime * SPEED_UP) + TIME_SKIP) * 0.71) + 4.5) * 0.2); // 0.7 - 1.1
    
    float radius = 0.045;
    
#ifdef MUSIC
    float beat[4];
    beat[0] = texture( iChannel0, vec2(0.10 ,0.25) ).x;
    beat[1] = texture( iChannel0, vec2(0.25 ,0.25) ).x;
    beat[2] = texture( iChannel0, vec2(0.40 ,0.25) ).x;
    beat[3] = texture( iChannel0, vec2(0.55 ,0.25) ).x;
    
    beat[0] = (beat[0] + beat[1] + beat[2] + beat[3]) * 0.25;
    radius += beat[0] / 8.0;    
#endif
    
    for	(float i = 0.0; i < NUM_PARTICLES; i++)
        pixel += Orb(uv, color, radius, i / NUM_PARTICLES);

    
    fragColor = vec4(pixel, 1.0);
}