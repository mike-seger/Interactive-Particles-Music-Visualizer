const fallbackDefaultControls = {
  bassFreqHz: 130,
  bassWidthHz: 40,
  bassGainDb: 8,
  hiRolloffDb: -6,
  attack: 0.75,
  release: 0.12,
  noiseFloor: 0.02,
  peakCurve: 1.25,
  beatBoost: 0.65,
  minDb: -80,
  maxDb: -18,
  baselinePercentile: 0.18,
  baselineStrength: 0.48,
  displayThreshold: 0.005,
  targetPeak: 0.95,
  minGain: 0.9,
  maxGain: 1.22,
  agcAttack: 0.18,
  agcRelease: 0.07
}

export async function loadSpectrumFilters() {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) ? import.meta.env.BASE_URL : '/'
  const withBase = (path) => {
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
    return `${trimmed}/${path.replace(/^\//, '')}`
  }

  const tryLoadDefaultFile = async () => {
    try {
      const res = await fetch(withBase('spectrum-filters/default.json'), { cache: 'no-cache' })
      if (!res.ok) throw new Error(`default fetch failed: ${res.status}`)
      const json = await res.json()
      const controls = json?.controls && typeof json.controls === 'object' ? json.controls : json
      if (!controls || typeof controls !== 'object') throw new Error('default missing controls')
      const name = (json?.name && typeof json.name === 'string') ? json.name : 'Default'
      return { [name]: controls }
    } catch (err) {
      console.warn('[SpectrumFilters] default preset load failed', err)
      return { Default: fallbackDefaultControls }
    }
  }

  try {
    const indexRes = await fetch(withBase('spectrum-filters/index.json'), { cache: 'no-cache' })
    if (!indexRes.ok) throw new Error(`index fetch failed: ${indexRes.status}`)
    const files = await indexRes.json()
    const entries = await Promise.all(
      (files || []).map(async (file) => {
        try {
          const res = await fetch(withBase(`spectrum-filters/${file}`), { cache: 'no-cache' })
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
          const json = await res.json()
          const name = (json?.name && typeof json.name === 'string') ? json.name : file.replace(/\.json$/i, '')
          const controls = json?.controls && typeof json.controls === 'object' ? json.controls : json
          if (!controls || typeof controls !== 'object') return null
          return [name, controls]
        } catch (err) {
          console.warn('[SpectrumFilters] failed to load', file, err)
          return null
        }
      })
    )
    const result = {}
    entries.forEach((entry) => {
      if (entry && entry[0] && entry[1]) {
        result[entry[0]] = entry[1]
      }
    })
    if (!Object.keys(result).length) {
      return await tryLoadDefaultFile()
    }
    return result
  } catch (err) {
    console.warn('[SpectrumFilters] load failed', err)
    return await tryLoadDefaultFile()
  }
}
