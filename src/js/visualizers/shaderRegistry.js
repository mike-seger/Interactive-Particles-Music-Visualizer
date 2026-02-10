import ShadertoyMultipassVisualizer from './ShadertoyMultipassVisualizer'
import { loadShaderConfig, injectUniforms } from '../shaderCustomization'

// Eager-load all GLSL sources as raw strings.
// Note: path is relative to this file: src/js/visualizers -> src/shaders
const shaderModules = import.meta.glob('../../shaders/*.glsl', { query: '?raw', import: 'default', eager: true })

function fileBaseName(filePath) {
  const parts = String(filePath).split('/')
  return parts[parts.length - 1] || filePath
}

function niceTitleFromFile(filePath) {
  const base = fileBaseName(filePath)
    .replace(/\.glsl$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (base && base === base.toLowerCase()) {
    return base.replace(/\b\w/g, (m) => m.toUpperCase())
  }
  return base
}

function stableSortEntries(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

const entries = Object.entries(shaderModules).map(([filePath, source]) => {
  const displayName = `Shader: ${niceTitleFromFile(filePath)}`
  const fileName = fileBaseName(filePath)
  
  return {
    name: displayName,
    filePath,
    fileName,
    create: async () => {
      // Try to load optional shader config
      const config = await loadShaderConfig(fileName)
      
      // Inject uniforms if config exists
      const processedSource = config ? injectUniforms(source, config) : source
      
      const visualizer = new ShadertoyMultipassVisualizer({ 
        name: displayName, 
        source: processedSource, 
        filePath,
        shaderConfig: config
      })
      
      return visualizer
    },
  }
})

export const SHADER_VISUALIZERS = stableSortEntries(entries)
export const SHADER_VISUALIZER_NAMES = SHADER_VISUALIZERS.map((e) => e.name)

const factoryMap = new Map(SHADER_VISUALIZERS.map((e) => [e.name, e.create]))

export function createShaderVisualizerByName(name) {
  const fn = factoryMap.get(name)
  return fn ? fn() : null
}
