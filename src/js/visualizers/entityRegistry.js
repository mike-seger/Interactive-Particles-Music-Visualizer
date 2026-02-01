function stableSortEntries(entries) {
  return [...entries].sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 1_000_000
    const bo = Number.isFinite(b.order) ? b.order : 1_000_000
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

// Convention: any entity visualizer directory can be added/removed independently
// as long as it contains an `index.js` exporting:
//   - `meta = { name: string, order?: number }`
//   - `default` export = visualizer class (instantiated with `new`)
const entityModules = import.meta.glob('../entities/**/index.js', { eager: true })

const rawEntries = Object.entries(entityModules)
  .map(([filePath, mod]) => {
    const meta = mod?.meta || null
    const Ctor = mod?.default || null

    if (!Ctor) return null
    const name = meta?.name || Ctor?.name || filePath
    const order = meta?.order

    return {
      name,
      order,
      filePath,
      create: () => new Ctor(),
    }
  })
  .filter(Boolean)

export const ENTITY_VISUALIZERS = stableSortEntries(rawEntries)
export const ENTITY_VISUALIZER_NAMES = ENTITY_VISUALIZERS.map((e) => e.name)

const factoryMap = new Map(ENTITY_VISUALIZERS.map((e) => [e.name, e.create]))

export function createEntityVisualizerByName(name) {
  const fn = factoryMap.get(name)
  return fn ? fn() : null
}
