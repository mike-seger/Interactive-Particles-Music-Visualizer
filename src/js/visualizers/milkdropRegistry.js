import butterchurnPresets from 'butterchurn-presets'
import ButterchurnVisualizer from './ButterchurnVisualizer'

/**
 * MilkDrop visualizer registry – mirrors entityRegistry.js / shaderRegistry.js.
 *
 * Phase 1: loads all presets from the butterchurn-presets package.
 * Each entry creates a ButterchurnVisualizer on demand.
 */

const allPresets = butterchurnPresets.getPresets()
const presetKeys = Object.keys(allPresets).sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })
)

const entries = presetKeys.map((key) => ({
  name: `M: ${key}`,
  create: () =>
    new ButterchurnVisualizer({
      name: `M: ${key}`,
      preset: allPresets[key],
      blendTime: 0,
    }),
}))

export const MILKDROP_VISUALIZERS = entries
export const MILKDROP_VISUALIZER_NAMES = entries.map((e) => e.name)

const factoryMap = new Map(entries.map((e) => [e.name, e.create]))

export function createMilkdropVisualizerByName(name) {
  const fn = factoryMap.get(name)
  return fn ? fn() : null
}
