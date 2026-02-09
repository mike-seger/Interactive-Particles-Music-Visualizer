// https://www.shadertoy.com/view/4sySDt

vec3 B2_spline(vec3 x) { // returns 3 B-spline functions of degree 2
    vec3 t = 3.0 * x;
    vec3 b0 = step(0.0, t)     * step(0.0, 1.0-t);
	vec3 b1 = step(0.0, t-1.0) * step(0.0, 2.0-t);
	vec3 b2 = step(0.0, t-2.0) * step(0.0, 3.0-t);
	return 0.5 * (
    	b0 * pow(t, vec3(2.0)) +
    	b1 * (-2.0*pow(t, vec3(2.0)) + 6.0*t - 3.0) + 
    	b2 * pow(3.0-t,vec3(2.0))
    );
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Pixel-aligned regular grid:
    // - Choose integer cell sizes in pixels.
    // - Center the grid.
    // - Build divider lines using a constant pixel gap.

    float desiredVBars = 100.0;
    float desiredHBars = 100.0;

    vec2 cellPx = max(vec2(1.0), floor(iResolution.xy / vec2(desiredVBars, desiredHBars)));
    vec2 barCount = floor(iResolution.xy / cellPx);
    vec2 gridPx = barCount * cellPx;
    vec2 originPx = floor((iResolution.xy - gridPx) * 0.5);

    vec2 localPx = fragCoord.xy - originPx;
    if (any(lessThan(localPx, vec2(0.0))) || any(greaterThanEqual(localPx, gridPx))) {
        fragColor = vec4(0.0);
        return;
    }

    vec2 uv = localPx / gridPx;

    // Divider thickness (in pixels). Keep this constant across resolutions.
    float gapPx = 1.0;
    vec2 gapN = min(vec2(0.45), vec2(gapPx) / cellPx);

    vec2 cellF = fract(localPx / cellPx);
    float interior =
        step(gapN.x, cellF.x) * step(gapN.x, 1.0 - cellF.x) *
        step(gapN.y, cellF.y) * step(gapN.y, 1.0 - cellF.y);

    // Sample FFT per column (stable per cell, mirrored about center).
    float colIndex = floor(localPx.x / cellPx.x);
    float x = (colIndex + 0.5) / max(1.0, barCount.x);
    float fSample = texture(iChannel0, vec2(abs(2.0 * x - 1.0), 0.25)).x;
    float fft = fSample * 0.5;

    vec2 centered = vec2(1.0) * uv - vec2(1.0);
    float t = iTime / 100.0;
    float polychrome = 1.0;
    vec3 spline_args = fract(vec3(polychrome*uv.x-t) + vec3(0.0, -1.0/3.0, -2.0/3.0));
    vec3 spline = B2_spline(spline_args);
    
    float f = abs(centered.y);
    vec3 base_color  = vec3(1.0, 1.0, 1.0) - f*spline;
    vec3 flame_color = pow(base_color, vec3(3.0));
    
    float tt = 0.3 - uv.y;
    float df = sign(tt);
    df = (df + 1.0)/0.5;
    vec3 col = flame_color * vec3(1.0 - step(fft, abs(0.3-uv.y)));
    col -= col * df * 0.180;

    // Apply the grid mask last so divider lines are crisp & regular.
    col *= interior;
    
    // output final color
    fragColor = vec4(col,1.0);
}
