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

// Inline safety fallback presets in case fetching from /public fails (file:// or base-path issues).
const inlinePresets = {
  Default: fallbackDefaultControls,
  Standard: {
    bassFreqHz: 120,
    bassWidthHz: 35,
    bassGainDb: 6,
    hiRolloffDb: -8,
    attack: 0.82,
    release: 0.22,
    noiseFloor: 0.02,
    peakCurve: 1.4,
    beatBoost: 0.6,
    minDb: -88,
    maxDb: -24,
    baselinePercentile: 0.2,
    baselineStrength: 0.5,
    displayThreshold: 0.006,
    targetPeak: 0.95,
    minGain: 0.9,
    maxGain: 1.25,
    agcAttack: 0.2,
    agcRelease: 0.1
  },
  'Bass-peak': {
    bassFreqHz: 110,
    bassWidthHz: 50,
    bassGainDb: 10,
    hiRolloffDb: -4,
    attack: 0.9,
    release: 0.18,
    noiseFloor: 0.015,
    peakCurve: 1.3,
    beatBoost: 0.8,
    minDb: -85,
    maxDb: -22,
    baselinePercentile: 0.16,
    baselineStrength: 0.45,
    displayThreshold: 0.005,
    targetPeak: 0.95,
    minGain: 0.9,
    maxGain: 1.3,
    agcAttack: 0.18,
    agcRelease: 0.08
  },
  'Frequency Visualization': {
    weightingMode: 'fv2',
    analyserSmoothing: 0,
    spatialKernel: 'narrow',
    useBinFloor: false,
    beatBoostEnabled: 0,
    bassFreqHz: 130,
    bassWidthHz: 40,
    bassGainDb: 8,
    hiRolloffDb: -6,
    attack: 0.92,
    release: 0.28,
    noiseFloor: 0.02,
    peakCurve: 1.7,
    beatBoost: 0.65,
    minDb: -90,
    maxDb: -25,
    baselinePercentile: 0.18,
    baselineStrength: 0.48,
    displayThreshold: 0.005,
    targetPeak: 0.95,
    minGain: 0.9,
    maxGain: 1.22,
    agcAttack: 0.18,
    agcRelease: 0.07,
    kickHz: 70,
    kickWidthOct: 0.65,
    kickBoostDb: 6,
    subShelfDb: 2,
    tiltHi: 1,
    tiltLo: 1.35
  },
  'Frequency Visualization 2': {
    weightingMode: 'fv2',
    analyserSmoothing: 0,
    spatialKernel: 'narrow',
    useBinFloor: true,
    floorAtkLow: 0.18,
    floorRelLow: 0.03,
    floorAtkHi: 0.1,
    floorRelHi: 0.015,
    floorStrengthLow: 0.8,
    floorStrengthHi: 0.6,
    beatBoostEnabled: 0,
    bassFreqHz: 120,
    bassWidthHz: 70,
    bassGainDb: 10,
    hiRolloffDb: -4,
    attack: 0.92,
    release: 0.78,
    noiseFloor: 0.01,
    peakCurve: 1.22,
    beatBoost: 0.55,
    minDb: -90,
    maxDb: -25,
    baselinePercentile: 0.18,
    baselineStrength: 0.32,
    displayThreshold: 0.005,
    targetPeak: 0.95,
    minGain: 0.9,
    maxGain: 1.35,
    agcAttack: 0.18,
    agcRelease: 0.18,
    kickHz: 70,
    kickWidthOct: 0.65,
    kickBoostDb: 8,
    subShelfDb: 4,
    tiltHi: 1,
    tiltLo: 1.45
  }
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
      console.warn('[SpectrumFilters] index fetched but empty; using inline presets')
      return { ...inlinePresets }
    }
    return result
  } catch (err) {
    console.warn('[SpectrumFilters] load failed; using inline presets', err)
    return { ...inlinePresets }
  }
}
