# Shader Customization System

This directory contains optional configuration files for shaders that enable runtime customization via dat.GUI controls.

## How It Works

1. **Config Files**: Create a `.js` file in `src/shaders-config/` with the same name as your shader (e.g., `reactive-radial-ripples.js` for `reactive-radial-ripples.glsl`)

2. **Config Format**:
```javascript
export default {
  name: 'Shader Display Name',
  controls: [
    {
      type: 'select',           // Control type: 'select', 'slider', etc.
      name: 'Palette',          // Display label
      uniform: 'PALETTE_INDEX', // Uniform name to control
      default: 0,               // Default value
      options: [                // For select: array of { label, value }
        { label: 'Blueish Palette', value: 0 },
        { label: 'Orange → Blue', value: 1 }
      ]
    }
  ]
}
```

3. **Shader Code**: Use `#ifndef` pattern to allow uniform injection:
```glsl
#ifndef PALETTE_INDEX
#define PALETTE_INDEX 0
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = getPaletteColor(PALETTE_INDEX, t);
  // ...
}
```

## System Architecture

- **Zero Overhead**: Shaders without config files work exactly as before
- **Non-Invasive**: No shader code changes required for basic operation
- **Generic**: All shader-specific logic lives in config files
- **Automatic**: System automatically loads configs and creates GUI controls

## Files

- `shaderCustomization.js`: Generic utilities for config loading, uniform injection, GUI creation
- `shaderRegistry.js`: Modified to load configs and inject uniforms during shader creation
- `App.js`: Integrated `setupShaderControls()` and `teardownShaderControls()`
- `ShadertoyMultipassVisualizer.js`: Added `setUniform()` method for runtime uniform updates

## Example: Adding Customization to a Shader

1. Create `src/shaders-config/my-shader.js`:
```javascript
export default {
  name: 'My Shader',
  controls: [
    {
      type: 'select',
      name: 'Color Mode',
      uniform: 'COLOR_MODE',
      default: 0,
      options: [
        { label: 'Rainbow', value: 0 },
        { label: 'Grayscale', value: 1 }
      ]
    }
  ]
}
```

2. Update `src/shaders/my-shader.glsl`:
```glsl
#ifndef COLOR_MODE
#define COLOR_MODE 0
#endif

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color;
  if (COLOR_MODE == 0) {
    color = rainbow(t);
  } else {
    color = grayscale(t);
  }
  fragColor = vec4(color, 1.0);
}
```

3. That's it! The system will automatically create GUI controls when the shader is selected.
