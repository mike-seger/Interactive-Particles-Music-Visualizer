/**
 * Generic shader customization system
 * Loads optional config files for shaders and creates lil-gui controls
 */

/**
 * Dynamically load shader config if it exists
 * @param {string} shaderFileName - The shader file name (e.g., 'reactive-radial-ripples.glsl')
 * @returns {Promise<Object|null>} Config object or null if not found
 */
export async function loadShaderConfig(shaderFileName) {
  try {
    const configName = shaderFileName.replace(/\.glsl$/i, '')
    const configModule = await import(`../shaders-config/${configName}.js`)
    return configModule.default || null
  } catch (error) {
    // Config file doesn't exist or failed to load - this is OK
    return null
  }
}

/**
 * Inject uniform declarations into shader source based on config
 * @param {string} source - Original shader source
 * @param {Object} config - Shader config object
 * @returns {string} Modified shader source with uniform declarations
 */
export function injectUniforms(source, config) {
  if (!config || !config.controls || config.controls.length === 0) {
    return source
  }

  const uniformDeclarations = []
  const preprocessorDefines = []
  
  for (const control of config.controls) {
    if (!control.uniform) continue
    
    // Determine uniform type based on control type
    let uniformType = 'int' // default for select
    if (control.type === 'slider') {
      uniformType = 'float'
    } else if (control.type === 'color') {
      uniformType = 'vec3'
    }
    
    // Add both uniform declaration and preprocessor define
    // The define triggers #ifndef guards in the shader
    preprocessorDefines.push(`#define ${control.uniform} ${control.uniform}`)
    uniformDeclarations.push(`uniform ${uniformType} ${control.uniform};`)
  }

  if (uniformDeclarations.length === 0) {
    return source
  }

  // Insert defines first (before #ifndef checks), then uniforms
  const injectionBlock = `\n// Injected shader customization\n${preprocessorDefines.join('\n')}\n${uniformDeclarations.join('\n')}\n`
  
  // Find the insertion point - right at the beginning after initial comments
  const lines = source.split('\n')
  let insertIndex = 0
  
  // Skip only the very first comment block if it exists
  let inCommentBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('/*')) inCommentBlock = true
    if (inCommentBlock) {
      if (line.endsWith('*/')) {
        inCommentBlock = false
        insertIndex = i + 1
      }
      continue
    }
    if (line.startsWith('//') && i < 10) {
      insertIndex = i + 1
      continue
    }
    break
  }
  
  lines.splice(insertIndex, 0, injectionBlock)
  return lines.join('\n')
}

/**
 * Create lil-gui controls for a shader based on its config
 * @param {GUI} gui - The lil-gui instance
 * @param {Object} visualizer - The shader visualizer instance
 * @param {Object} config - The shader config
 * @returns {GUI|null} The created folder or null
 */
export function createShaderControls(gui, visualizer, config) {
  if (!config || !config.controls || config.controls.length === 0) {
    return null
  }

  const folder = gui.addFolder(config.name || 'Shader Settings')
  const params = {}
  const storageKeyPrefix = `shaderConfig:${config.name}:`

  for (const control of config.controls) {
    if (control.type === 'select') {
      // Create dropdown options object for lil-gui
      const options = {}
      control.options.forEach(opt => {
        options[opt.label] = opt.value
      })

      // Load saved value from localStorage or use default
      const storageKey = storageKeyPrefix + control.uniform
      const savedValue = localStorage.getItem(storageKey)
      const initialValue = savedValue !== null ? parseInt(savedValue, 10) : control.default

      // Set initial value
      params[control.name] = initialValue

      // Create the GUI control
      folder.add(params, control.name, options)
        .name(control.name)
        .onChange((value) => {
          console.log(`[ShaderControls] ${control.name} changed to:`, value, `uniform: ${control.uniform}`)
          // Save to localStorage
          localStorage.setItem(storageKey, String(value))
          if (visualizer.setUniform) {
            visualizer.setUniform(control.uniform, value)
          } else {
            console.warn('[ShaderControls] visualizer.setUniform not available')
          }
        })

      // Set initial uniform value
      console.log(`[ShaderControls] Setting initial value for ${control.uniform}:`, initialValue)
      if (visualizer.setUniform) {
        visualizer.setUniform(control.uniform, initialValue)
      }
    } else if (control.type === 'slider') {
      // Load saved value from localStorage or use default
      const storageKey = storageKeyPrefix + control.uniform
      const savedValue = localStorage.getItem(storageKey)
      const initialValue = savedValue !== null ? parseFloat(savedValue) : control.default

      params[control.name] = initialValue

      folder.add(params, control.name, control.min, control.max)
        .name(control.name)
        .onChange((value) => {
          // Save to localStorage
          localStorage.setItem(storageKey, String(value))
          if (visualizer.setUniform) {
            visualizer.setUniform(control.uniform, value)
          }
        })

      if (visualizer.setUniform) {
        visualizer.setUniform(control.uniform, initialValue)
      }
    }
    // Add more control types as needed (color, checkbox, etc.)
  }

  folder.open()
  return folder
}
