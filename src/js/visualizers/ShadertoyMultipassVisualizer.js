import * as THREE from 'three'
import App from '../App'

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

  // Keep existing casing mostly (some are stylized), but title-case plain lowercase.
  if (base && base === base.toLowerCase()) {
    return base.replace(/\b\w/g, (m) => m.toUpperCase())
  }
  return base
}

function parseShaderSections(source, debugName = 'shader') {
  const text = String(source ?? '')
  const lines = text.split(/\r?\n/)

  /** @type {{ name: string, code: string }[]} */
  const sections = []

  let currentName = '__implicit__'
  let currentLines = []

  const flush = () => {
    const code = currentLines.join('\n').trimEnd()
    if (code.trim().length > 0) {
      sections.push({ name: currentName, code })
    }
    currentLines = []
  }

  for (const line of lines) {
    const m = line.match(/^\s*\/\/\s*#\s*(.+?)\s*$/)
    if (m) {
      flush()
      currentName = m[1]
      continue
    }
    currentLines.push(line)
  }
  flush()

  // No markers: whole file is one Image pass.
  if (sections.length === 1 && sections[0].name === '__implicit__') {
    return {
      common: '',
      passes: [{ name: 'Image', code: sections[0].code }],
      debugName,
    }
  }

  let common = ''
  const passes = []

  for (const s of sections) {
    const n = String(s.name).trim()
    if (/^common$/i.test(n)) {
      common += `\n${s.code}`
      continue
    }

    // Treat any unlabelled chunk as common glue (helps with some files)
    if (s.name === '__implicit__') {
      common += `\n${s.code}`
      continue
    }

    passes.push({ name: n, code: s.code })
  }

  if (passes.length === 0) {
    // Edge-case: only Common. Render nothing but keep valid.
    passes.push({ name: 'Image', code: 'void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0); }' })
  }

  return { common: common.trim(), passes, debugName }
}

function inferPassType(sectionName) {
  const n = String(sectionName).toLowerCase()
  if (n.includes('buffer')) return 'buffer'
  if (n.includes('image')) return 'image'
  // default
  return 'image'
}

function shaderHas(source, re) {
  return re.test(String(source))
}

function injectIfMissing(source, testRe, inject) {
  if (testRe.test(source)) return source
  return `${inject}\n${source}`
}

function transformTextureCalls(source) {
  // Shadertoy uses texture(); WebGL1 expects texture2D().
  return source.replace(/\btexture\s*\(/g, 'texture2D(')
}

function transformFloatLiteralSuffix(source) {
  // Some shaders use C/GLSL3 style float suffixes like `0.4f` or `1.0f`.
  // GLSL ES 1.00 (WebGL1) does not allow this suffix.
  // Also supports exponent forms like `1e-3f`.
  return String(source).replace(/(\b(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)f\b/g, '$1')
}

function transformVec2Array3x3Fill(source) {
  // WebGL1/GLSL ES 1.00 restriction (common on mobile/ANGLE): indexing into
  // non-uniform arrays often must use a constant or the loop symbol of the
  // current canonical for-loop.
  //
  // Many Shadertoy shaders build a 3x3 neighborhood like:
  //   vec2 p[9];
  //   int i = 0;
  //   for(float y=-1.; y<=1.; y++)
  //     for(float x=-1.; x<=1.; x++, i++)
  //       p[i] = GetPos(id, vec2(x,y));
  //
  // Rewrite into:
  //   vec2 p[9];
  //   for (int i=0; i<9; i++) { float x = float(i%3)-1.; float y = float(i/3)-1.; p[i]=...; }
  const src = String(source)

  const re = /\b(vec2)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*9\s*\]\s*;\s*\n\s*int\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*0\s*;\s*\n\s*for\s*\(\s*float\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*-?1\.?0*\s*;\s*\4\s*<=\s*1\.?0*\s*;\s*\4\s*\+\+\s*\)\s*\{?\s*\n\s*for\s*\(\s*float\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*-?1\.?0*\s*;\s*\5\s*<=\s*1\.?0*\s*;\s*\5\s*\+\+\s*,\s*\3\s*\+\+\s*\)\s*\{\s*\n\s*\2\s*\[\s*\3\s*\]\s*=\s*([\s\S]*?)\s*;\s*\n\s*\}\s*\n\s*\}?/m

  const m = src.match(re)
  if (!m) return src

  const arrName = m[2]
  const idxName = m[3]
  const yName = m[4]
  const xName = m[5]
  const rhs = m[6].trim()

  const replacement = [
    `vec2 ${arrName}[9];`,
    `for (int ${idxName} = 0; ${idxName} < 9; ${idxName}++) {`,
    `  float ${xName} = float(${idxName} - (${idxName}/3)*3) - 1.0;`,
    `  float ${yName} = float(${idxName}/3) - 1.0;`,
    `  ${arrName}[${idxName}] = ${rhs};`,
    `}`,
  ].join('\n')

  return src.replace(re, replacement)
}

function transformTextureLod(source) {
  // GLSL3 textureLod -> WebGL1 EXT_shader_texture_lod equivalents.
  // Note: we also inject the extension directive when needed.
  return source.replace(/\btextureLod\s*\(/g, 'texture2DLodEXT(')
}

function inferChannelSamplerTypes(source) {
  const src = String(source || '')

  /** @type {Set<string>} */
  const vec3Names = new Set()
  /** @type {Set<string>} */
  const vec2Names = new Set()

  // Very lightweight inference: gather obvious vec2/vec3 declarations.
  for (const m of src.matchAll(/\bvec3\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    vec3Names.add(m[1])
  }
  for (const m of src.matchAll(/\bvec2\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    vec2Names.add(m[1])
  }

  const types = ['sampler2D', 'sampler2D', 'sampler2D', 'sampler2D']

  const findMatchingParen = (text, openIndex) => {
    let depth = 0
    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  const splitTopLevelArgs = (text) => {
    /** @type {string[]} */
    const out = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        out.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    out.push(text.slice(start).trim())
    return out
  }

  let i = 0
  while (i < src.length) {
    const j = src.indexOf('texture', i)
    if (j === -1) break

    const openParen = src.indexOf('(', j + 'texture'.length)
    if (openParen === -1) break
    const closeParen = findMatchingParen(src, openParen)
    if (closeParen === -1) break

    const inner = src.slice(openParen + 1, closeParen)
    const args = splitTopLevelArgs(inner)
    if (args.length >= 2) {
      const chanMatch = args[0].match(/^iChannel([0-3])$/)
      if (chanMatch) {
        const idx = Number(chanMatch[1])
        const coord = args[1]

        // If it's obviously a vec2 expression, keep sampler2D.
        const looks2D = /\bvec2\s*\(/.test(coord) || /\.[xy]{2}\b/.test(coord)

        // If it's obviously a vec3 expression, prefer samplerCube.
        const looks3D = /\bvec3\s*\(/.test(coord) || /\.[xyz]{3}\b/.test(coord)

        // If it's a single identifier, attempt type lookup.
        const ident = coord.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1] || null
        const identIsVec3 = ident ? vec3Names.has(ident) && !vec2Names.has(ident) : false

        if (looks3D || identIsVec3) {
          types[idx] = 'samplerCube'
        } else if (looks2D) {
          types[idx] = 'sampler2D'
        }
      }
    }

    i = closeParen + 1
  }

  return types
}

/**
 * Heuristically infer what each iChannel is intended to represent.
 * This helps multipass shaders that expect:
 * - buffer textures on iChannel0..2
 * - a small noise/LUT texture on some channel (often iChannel1)
 * - audio FFT on a channel (often iChannel0 on Shadertoy)
 *
 * Returns an array of 4 hints: 'buffer' | 'noise' | 'audio' | 'unknown'.
 */
function inferChannelHints(source) {
  const src = String(source || '')
  const hints = ['unknown', 'unknown', 'unknown', 'unknown']

  for (let ch = 0; ch < 4; ch++) {
    const name = `iChannel${ch}`

    // AUDIO heuristics:
    // - texelFetch on row 0/1 (our texelFetch transform maps row 0 -> y=0.25)
    // - texture sampling at y~=0.25 or y~=0.75
    const usesTexelFetch = new RegExp(`\\btexelFetch\\s*\\(\\s*${name}\\b`).test(src)
    const audioRowTexture = new RegExp(
      // Allow both `texture()` and `texture2D()`; allow both `0.25` and `.25`.
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,\\s*vec2\\s*\\([^)]*,\\s*0?\\.(?:25|75)\\s*\\)`
    ).test(src)
    // Many Shadertoy audio shaders sample the top/bottom row using y=0/1.
    const audioLegacyRowTexture = new RegExp(
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,\\s*vec2\\s*\\([^)]*,\\s*(?:0(?:\\.0*)?|\\.0+|1(?:\\.0*)?)\\s*\\)`
    ).test(src)
    if (usesTexelFetch || audioRowTexture) {
      hints[ch] = 'audio'
      continue
    }
    if (audioLegacyRowTexture) {
      hints[ch] = 'audio'
      continue
    }

    // NOISE / LUT heuristics:
    // - common dither patterns: mod(fragCoord/8.,1.), mod(frag/8.,1.)
    // - sampling with mod/fract wrapping but without iResolution normalization
    const noisePattern = new RegExp(
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,\\s*(?:mod|fract)\\s*\\(`
    ).test(src)
    const ditherPattern = new RegExp(
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,\\s*mod\\s*\\(\\s*(?:fragCoord|gl_FragCoord\\.xy|frag)\\s*/\\s*\\d+\\.?\\d*\\s*,\\s*1\\.?0*\\s*\\)`
    ).test(src)
    // Sampling a constant vec2 is often a LUT/noise, but many Shadertoy audio shaders
    // sample the audio texture with constant y (0/1) and varying x.
    const constUvMatch = new RegExp(
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,\\s*vec2\\s*\\(\\s*([0-9.+\-eE]+)\\s*,\\s*([0-9.+\-eE]+)\\s*\\)`
    ).exec(src)
    const constUvLooksLikeNoise = (() => {
      if (!constUvMatch) return false
      const y = Number.parseFloat(constUvMatch[2])
      if (!Number.isFinite(y)) return true
      // Keep LUT/noise for mid-row constants (e.g. 0.5), but don't override audio for y=0/1.
      const isLegacyRow = Math.abs(y - 0) < 1e-6 || Math.abs(y - 1) < 1e-6
      return !isLegacyRow
    })()

    if (noisePattern || ditherPattern || constUvLooksLikeNoise) {
      hints[ch] = 'noise'
      continue
    }

    // BUFFER heuristics:
    // If the shader samples with screen-space coords (fragCoord/iResolution, uv derived from that)
    // it likely expects a full-resolution buffer.
    const bufferPattern = new RegExp(
      `\\btexture(?:2D)?\\s*\\(\\s*${name}\\s*,[\\s\\S]{0,140}?\\b(?:fragCoord|gl_FragCoord\\.xy|iResolution)\\b`
    ).test(src)
    if (bufferPattern) {
      hints[ch] = 'buffer'
      continue
    }
  }

  return hints
}

function transformAudioLegacyRowSampling(source, channelHints) {
  const hints = Array.isArray(channelHints) ? channelHints : null
  if (!hints || hints.length !== 4) return String(source)

  const isAudioCh = (ch) => hints[ch] === 'audio'
  if (![0, 1, 2, 3].some(isAudioCh)) return String(source)

  const src = String(source)

  const findMatchingParen = (text, openIndex) => {
    let depth = 0
    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  const splitTopLevelArgs = (text) => {
    /** @type {string[]} */
    const out = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        out.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    out.push(text.slice(start).trim())
    return out
  }

  const rewriteCall = (fnName, callArgs) => {
    const args = splitTopLevelArgs(callArgs)
    if (args.length < 2) return null

    const chan = args[0]
    const m = chan.match(/^iChannel([0-3])$/)
    if (!m) return null
    const idx = Number(m[1])
    if (!isAudioCh(idx)) return null

    const coord = args[1]
    const coordMatch = coord.match(/^vec2\s*\((.*)\)$/)
    if (!coordMatch) return null
    const uvArgs = splitTopLevelArgs(coordMatch[1])
    if (uvArgs.length < 2) return null

    const xExpr = uvArgs[0]
    const yExpr = uvArgs[1].trim()

    // Only rewrite literal 0/1 (including 0., .0, 0.0, 1., 1.0).
    const yIsZero = /^(?:0(?:\.0*)?|\.0+)$/.test(yExpr)
    const yIsOne = /^1(?:\.0*)?$/.test(yExpr)
    if (!yIsZero && !yIsOne) return null

    const newY = yIsZero ? '0.25' : '0.75'
    const newCoord = `vec2(${xExpr}, ${newY})`
    const rest = args.slice(2)
    const newArgs = [chan, newCoord, ...rest]
    return `${fnName}(${newArgs.join(', ')})`
  }

  let out = ''
  let i = 0
  while (i < src.length) {
    const jTex = src.indexOf('texture', i)
    const jTex2D = src.indexOf('texture2D', i)
    let j = -1
    let fnName = 'texture'
    if (jTex2D !== -1 && (jTex === -1 || jTex2D < jTex)) {
      j = jTex2D
      fnName = 'texture2D'
    } else {
      j = jTex
      fnName = 'texture'
    }

    if (j === -1) {
      out += src.slice(i)
      break
    }

    const openParen = src.indexOf('(', j + fnName.length)
    if (openParen === -1) {
      out += src.slice(i)
      break
    }
    const between = src.slice(j + fnName.length, openParen)
    if (/\S/.test(between)) {
      out += src.slice(i, j + fnName.length)
      i = j + fnName.length
      continue
    }

    const closeParen = findMatchingParen(src, openParen)
    if (closeParen === -1) {
      out += src.slice(i)
      break
    }

    out += src.slice(i, j)
    const inner = src.slice(openParen + 1, closeParen)
    const rewritten = rewriteCall(fnName, inner)
    out += rewritten || `${fnName}(${inner})`
    i = closeParen + 1
  }

  return out
}

function transformTexelFetch(source) {
  // WebGL1 doesn't support texelFetch; approximate via texture2D + iChannelResolution.
  // Use a small parser so nested parentheses in the ivec2() args don't break replacement.
  const src = String(source)
  const needle = 'texelFetch'

  const findMatchingParen = (text, openIndex) => {
    let depth = 0
    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  const splitTopLevelArgs = (text) => {
    /** @type {string[]} */
    const out = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        out.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    out.push(text.slice(start).trim())
    return out
  }

  const tryRewrite = (callArgs) => {
    const args = splitTopLevelArgs(callArgs)
    if (args.length < 3) return null

    const chan = args[0]
    const m = chan.match(/^iChannel([0-3])$/)
    if (!m) return null
    const idx = Number(m[1])

    const coord = args[1]
    const coordMatch = coord.match(/^ivec2\s*\((.*)\)$/)
    if (!coordMatch) return null
    const coordArgs = splitTopLevelArgs(coordMatch[1])
    if (coordArgs.length < 2) return null
    const xExpr = coordArgs[0]
    const yExpr = coordArgs[1]

    // Only safe for LOD=0 patterns; still rewrite if it's explicitly 0.
    const lodExpr = args[2]
    if (!/^0\s*$/.test(lodExpr)) return null

    const res = `iChannelResolution[${idx}].xy`
    return `texture2D(${chan}, (vec2(float(${xExpr}), float(${yExpr})) + 0.5) / ${res})`
  }

  let out = ''
  let i = 0
  while (i < src.length) {
    const j = src.indexOf(needle, i)
    if (j === -1) {
      out += src.slice(i)
      break
    }

    // Ensure this is actually a call: texelFetch(...)
    const after = src.slice(j + needle.length)
    const callOpen = j + needle.length
    const openParenIndex = src.indexOf('(', callOpen)
    const between = src.slice(callOpen, openParenIndex)
    if (openParenIndex === -1 || /\S/.test(between)) {
      // Not a function call; copy and continue.
      out += src.slice(i, j + needle.length)
      i = j + needle.length
      continue
    }

    const closeParenIndex = findMatchingParen(src, openParenIndex)
    if (closeParenIndex === -1) {
      out += src.slice(i)
      break
    }

    out += src.slice(i, j)
    const inner = src.slice(openParenIndex + 1, closeParenIndex)
    const rewritten = tryRewrite(inner)
    if (rewritten) {
      out += rewritten
    } else {
      out += `${needle}(${inner})`
    }
    i = closeParenIndex + 1
  }

  return out
}

function transformDynamicForLoops(source) {
  // GLSL ES 1.00 requires compile-time constant loop bounds in many drivers.
  // Rewrite common dynamic-bound loops:
  //   for (float i = 0.; i < samples; i++) stmt;
  // into:
  //   for (float i = 0.; i < float(_ST_LOOP_MAX); i++) { if (i >= (samples)) break; stmt; }
  const src = String(source)

  const findMatchingParen = (text, openIndex) => {
    let depth = 0
    for (let i = openIndex; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  const findStatementEnd = (text, startIndex) => {
    let depthParen = 0
    let depthBracket = 0
    let depthBrace = 0
    let inLineComment = false
    let inBlockComment = false
    let inString = false

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i]
      const next = text[i + 1]

      if (inLineComment) {
        if (ch === '\n') inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          i++
        }
        continue
      }
      if (!inString && ch === '/' && next === '/') {
        inLineComment = true
        i++
        continue
      }
      if (!inString && ch === '/' && next === '*') {
        inBlockComment = true
        i++
        continue
      }

      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue

      if (ch === '(') depthParen++
      else if (ch === ')') depthParen--
      else if (ch === '[') depthBracket++
      else if (ch === ']') depthBracket--
      else if (ch === '{') depthBrace++
      else if (ch === '}') {
        if (depthBrace === 0) return i
        depthBrace--
      } else if (ch === ';' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
        return i
      }
    }
    return -1
  }

  const splitForParts = (insideParens) => {
    const parts = []
    let depth = 0
    let start = 0
    for (let i = 0; i < insideParens.length; i++) {
      const ch = insideParens[i]
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ';' && depth === 0) {
        parts.push(insideParens.slice(start, i).trim())
        start = i + 1
      }
    }
    parts.push(insideParens.slice(start).trim())
    return parts
  }

  const splitTopLevelCommas = (text) => {
    const parts = []
    let depthParen = 0
    let depthBracket = 0
    let depthBrace = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '(') depthParen++
      else if (ch === ')') depthParen--
      else if (ch === '[') depthBracket++
      else if (ch === ']') depthBracket--
      else if (ch === '{') depthBrace++
      else if (ch === '}') depthBrace--
      else if (ch === ',' && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
        parts.push(text.slice(start, i).trim())
        start = i + 1
      }
    }
    parts.push(text.slice(start).trim())
    return parts.filter((p) => p.length)
  }

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  let changed = false
  let out = ''
  let i = 0

  while (i < src.length) {
    const j = src.indexOf('for', i)
    if (j === -1) {
      out += src.slice(i)
      break
    }

    // Ensure token boundary
    const before = src[j - 1]
    const after = src[j + 3]
    const isIdentChar = (c) => /[A-Za-z0-9_]/.test(c || '')
    if (isIdentChar(before) || isIdentChar(after)) {
      out += src.slice(i, j + 3)
      i = j + 3
      continue
    }

    // Find "for ( ... )"
    const openParen = src.indexOf('(', j + 3)
    if (openParen === -1) {
      out += src.slice(i)
      break
    }
    const between = src.slice(j + 3, openParen)
    if (/\S/.test(between)) {
      out += src.slice(i, openParen)
      i = openParen
      continue
    }

    const closeParen = findMatchingParen(src, openParen)
    if (closeParen === -1) {
      out += src.slice(i)
      break
    }

    const inside = src.slice(openParen + 1, closeParen)
    const [init, cond, inc] = splitForParts(inside)
    if (!init || !cond || !inc) {
      out += src.slice(i, closeParen + 1)
      i = closeParen + 1
      continue
    }

    // Grab loop body (needed for any rewrite).
    let bodyStart = closeParen + 1
    while (bodyStart < src.length && /\s/.test(src[bodyStart])) bodyStart++
    const bodyEnd = findStatementEnd(src, bodyStart)
    if (bodyEnd === -1) {
      out += src.slice(i)
      break
    }
    const body = src.slice(bodyStart, bodyEnd + 1)

    // Handle non-canonical loops often found in "minishaders", e.g.
    //   for(vec3 r=iResolution; ++i<77.; z+=.8*d+1e-3) exprStatement;
    // Many GLSL ES 1.00 compilers require the loop header to use a single loop index
    // in init/cond/inc, so we rewrite to a canonical int loop and move the original
    // init/inc into the surrounding code/body.
    //
    // Notes:
    // - Assumes the bound is a numeric literal.
    // - Preserves "++i<..." semantics by assigning i=float(iter+1) each iteration.
    const nonCanonicalMatch = cond.match(
      /^\s*\+\+\s*([A-Za-z_][A-Za-z0-9_]*)\s*<\s*([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*$/
    )
    if (nonCanonicalMatch) {
      const loopVar = nonCanonicalMatch[1]
      const boundLit = nonCanonicalMatch[2]

      // Avoid rewriting if the increment already is the same loop var.
      const incUsesLoopVar = new RegExp(`\\b${escapeRegExp(loopVar)}\\b`).test(inc)
      if (!incUsesLoopVar) {
        const boundInt = Math.max(0, Math.floor(Number(boundLit)))
        const iterVar = `_st_i${j}`
        const initStmt = init.trim().length ? `${init.trim()};\n` : ''

        let newBody = ''
        const bodyTrim = body.trim()
        const assignLoopVar = `  ${loopVar} = float(${iterVar} + 1);`
        const movedInc = inc.trim().length ? `  ${inc.trim()};` : ''

        if (bodyTrim.startsWith('{')) {
          const braceIndex = body.indexOf('{')
          newBody = `${body.slice(0, braceIndex + 1)}\n${assignLoopVar}\n${body.slice(braceIndex + 1)}`
          // ensure movedInc runs at end of loop body
          if (movedInc) {
            const closeBrace = newBody.lastIndexOf('}')
            if (closeBrace !== -1) {
              newBody = `${newBody.slice(0, closeBrace)}\n${movedInc}\n${newBody.slice(closeBrace)}`
            } else {
              newBody += `\n${movedInc}\n`
            }
          }
        } else {
          // Wrap single statement.
          const stmt = bodyTrim.endsWith(';') || bodyTrim.endsWith('}') ? bodyTrim : `${bodyTrim};`
          newBody = `{\n${assignLoopVar}\n  ${stmt}\n${movedInc}\n}`
        }

        out += src.slice(i, j)
        out += `${initStmt}${loopVar} = 0.0;\nfor (int ${iterVar} = 0; ${iterVar} < ${boundInt}; ${iterVar}++) ${newBody}`
        changed = true
        i = bodyEnd + 1
        continue
      }
    }

    // Some GLSL ES 1.00 compilers reject multi-declarator init like:
    //   for (float i = 0., t = 0.; i < 30.; i++)
    // Rewrite to:
    //   float t = 0.;
    //   for (float i = 0.; i < 30.; i++)
    const multiInit = init.match(
      /^\s*(float|int)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^,;]+?)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+?)\s*$/
    )
    if (multiInit) {
      const varType = multiInit[1]
      const loopVar = multiInit[2]
      const loopInitExpr = multiInit[3]
      const extraVar = multiInit[4]
      const extraInitExpr = multiInit[5]

      const newInit = `${varType} ${loopVar} = ${loopInitExpr}`
      const prefixDecl = `${varType} ${extraVar} = ${extraInitExpr};\n`

      out += src.slice(i, j)
      out += `${prefixDecl}for (${newInit}; ${cond}; ${inc}) ${body}`
      changed = true
      i = bodyEnd + 1
      continue
    }

    const initMatch = init.match(/^\s*(float|int)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+)\s*$/)
    if (!initMatch) {
      out += src.slice(i, bodyEnd + 1)
      i = bodyEnd + 1
      continue
    }

    const varType = initMatch[1]
    const varName = initMatch[2]
    const initExpr = initMatch[3]
    const varNameRe = escapeRegExp(varName)

    // IMPORTANT: Order matters here. If we match '<' before '<=', then a condition
    // like 'i <= samples' will be parsed as op '<' with bound '= samples', which
    // later generates invalid GLSL like 'if (i >= (= samples)) break;'.
    const condMatch = cond.match(new RegExp(`^\\s*${varNameRe}\\s*(<=|<)\\s*(.+?)\\s*$`))
    if (!condMatch) {
      out += src.slice(i, closeParen + 1)
      i = closeParen + 1
      continue
    }

    const op = condMatch[1]
    const boundExpr = condMatch[2]

    // Skip if bound already looks constant-ish.
    const boundLooksConstant = /^\s*([0-9]+(\.[0-9]+)?|\.[0-9]+)\s*$/.test(boundExpr)
    const initLooksConstant = /^\s*[-+]?(?:[0-9]+(\.[0-9]+)?|\.[0-9]+)\s*$/.test(initExpr)

    // Some WebGL1/GLSL ES 1.00 compilers reject float loop indices and/or comma
    // expressions in the increment clause. If we have a float loop with constant
    // bounds, rewrite it into an int loop.
    if (varType === 'float' && boundLooksConstant && initLooksConstant) {
      const incParts = splitTopLevelCommas(inc)
      const primaryInc = incParts[0] || ''
      const movedIncs = incParts.slice(1)

      const incStepOk = new RegExp(
        `^\\s*(` +
          `${varNameRe}\\s*\\+\\+` +
          `|\\+\\+\\s*${varNameRe}` +
          `|${varNameRe}\\s*\\+=\\s*1(?:\\.0*)?\\s*` +
          `|${varNameRe}\\s*=\\s*${varNameRe}\\s*\\+\\s*1(?:\\.0*)?\\s*` +
        `)\\s*$`
      ).test(primaryInc)

      // Only handle increasing loops for now ( < / <= ) with +1 steps.
      const startNum = Number(initExpr)
      const endNum = Number(boundExpr)
      const startInt = Math.round(startNum)
      const endInt = Math.round(endNum)
      const startIsInt = Number.isFinite(startNum) && Math.abs(startNum - startInt) < 1e-6
      const endIsInt = Number.isFinite(endNum) && Math.abs(endNum - endInt) < 1e-6

      if (incStepOk && startIsInt && endIsInt && endInt >= startInt) {
        const count = Math.max(0, (endInt - startInt) + (op === '<=' ? 1 : 0))
        const iterVar = `_st_f${j}`
        const assignLoopVar = `  float ${varName} = ${initExpr.trim()} + float(${iterVar});`
        const movedIncCode = movedIncs
          .map((s) => s.trim())
          .filter((s) => s.length)
          .map((s) => `  ${s};`)
          .join('\n')

        let newBody = ''
        if (body.trimStart().startsWith('{')) {
          const braceIndex = body.indexOf('{')
          newBody = `${body.slice(0, braceIndex + 1)}\n${assignLoopVar}\n${body.slice(braceIndex + 1)}`

          if (movedIncCode) {
            const closeBrace = newBody.lastIndexOf('}')
            if (closeBrace !== -1) {
              newBody = `${newBody.slice(0, closeBrace)}\n${movedIncCode}\n${newBody.slice(closeBrace)}`
            } else {
              newBody += `\n${movedIncCode}\n`
            }
          }
        } else {
          const stmt = body.trim().endsWith(';') || body.trim().endsWith('}') ? body.trim() : `${body.trim()};`
          newBody = `\n{\n${assignLoopVar}\n  ${stmt}\n${movedIncCode ? `${movedIncCode}\n` : ''}}`
        }

        out += src.slice(i, j)
        out += `for (int ${iterVar} = 0; ${iterVar} < ${count}; ${iterVar}++) ${newBody}`
        changed = true
        i = bodyEnd + 1
        continue
      }
    }

    if (boundLooksConstant) {
      out += src.slice(i, closeParen + 1)
      i = closeParen + 1
      continue
    }

    // Only handle simple increments.
    const incOk = new RegExp(
      `^\\s*(` +
        `${varNameRe}\\s*\\+\\+` +
        `|\\+\\+\\s*${varNameRe}` +
        `|${varNameRe}\\s*\\+=\\s*1\\s*` +
        `|${varNameRe}\\s*=\\s*${varNameRe}\\s*\\+\\s*1\\s*` +
      `)\\s*$`
    ).test(inc)
    if (!incOk) {
      out += src.slice(i, closeParen + 1)
      i = closeParen + 1
      continue
    }

    const maxBound = varType === 'int' ? '_ST_LOOP_MAX' : 'float(_ST_LOOP_MAX)'
    const newCond = `${varName} < ${maxBound}`
    const breakCheck = op === '<=' ? `if (${varName} > (${boundExpr})) break;` : `if (${varName} >= (${boundExpr})) break;`

    let newBody = ''
    if (body.trimStart().startsWith('{')) {
      // Insert after the first '{'
      const braceIndex = body.indexOf('{')
      newBody = `${body.slice(0, braceIndex + 1)}\n  ${breakCheck}\n${body.slice(braceIndex + 1)}`
    } else {
      // Wrap single statement
      newBody = `{\n  ${breakCheck}\n  ${body.trim()}\n}`
    }

    out += src.slice(i, j)
    out += `for (${init}; ${newCond}; ${inc}) ${newBody}`
    changed = true
    i = bodyEnd + 1
  }

  return { source: out, changed }
}

function getShadertoyCompatFns(source) {
  const src = String(source)
  const out = []

  // Polyfill Shadertoy/GLSL3 sampling APIs for GLSL ES 1.00.
  // NOTE: We intentionally do NOT rewrite texture() calls to texture2D() because
  // shaders may sample cubemaps (samplerCube) which must use textureCube().
  const usesTextureFn = /\btexture\s*\(/.test(src)
  const hasTextureFnDef = /\bvec4\s+texture\s*\(/.test(src)
  if (usesTextureFn && !hasTextureFnDef) {
    out.push('vec4 texture(sampler2D s, vec2 uv) { return texture2D(s, uv); }')
    out.push('vec4 texture(samplerCube s, vec3 dir) { return textureCube(s, dir); }')
  }

  const usesTextureLodFn = /\btextureLod\s*\(/.test(src)
  const hasTextureLodFnDef = /\bvec4\s+textureLod\s*\(/.test(src)
  if (usesTextureLodFn && !hasTextureLodFnDef) {
    out.push(
      [
        '#ifndef ST_HAS_TEXLOD',
        '#define ST_HAS_TEXLOD 0',
        '#endif',
        'vec4 textureLod(sampler2D s, vec2 uv, float lod) {',
        '#if ST_HAS_TEXLOD',
        '  return texture2DLodEXT(s, uv, lod);',
        '#else',
        '  return texture2D(s, uv);',
        '#endif',
        '}',
      ].join('\n')
    )
  }

  const usesRound = /\bround\s*\(/.test(src)
  const hasRoundDef = /\b(float|vec2|vec3|vec4)\s+round\s*\(/.test(src)

  const usesTanh = /\btanh\s*\(/.test(src)
  const hasTanhDef = /\b(float|vec2|vec3|vec4)\s+tanh\s*\(/.test(src)

  if (usesRound && !hasRoundDef) {
    out.push(`float round(float x) { return (x < 0.0) ? ceil(x - 0.5) : floor(x + 0.5); }`)
    out.push(`vec2 round(vec2 x) { return vec2(round(x.x), round(x.y)); }`)
    out.push(`vec3 round(vec3 x) { return vec3(round(x.x), round(x.y), round(x.z)); }`)
    out.push(`vec4 round(vec4 x) { return vec4(round(x.x), round(x.y), round(x.z), round(x.w)); }`)
  }

  if (usesTanh && !hasTanhDef) {
    out.push(`float tanh(float x) { float e = exp(2.0*x); return (e - 1.0) / (e + 1.0); }`)
    out.push(`vec2 tanh(vec2 x) { return vec2(tanh(x.x), tanh(x.y)); }`)
    out.push(`vec3 tanh(vec3 x) { return vec3(tanh(x.x), tanh(x.y), tanh(x.z)); }`)
    out.push(`vec4 tanh(vec4 x) { return vec4(tanh(x.x), tanh(x.y), tanh(x.z), tanh(x.w)); }`)
  }

  return out
}

function getShadertoyCompatDefines(source) {
  const src = String(source)
  const out = []

  const hasDefine = (name) => new RegExp(`(^|\n)\s*#\s*define\s+${name}\b`).test(src)
  const hasConst = (name) => new RegExp(`\bconst\s+\w+\s+${name}\b`).test(src)

  // Some Shadertoy shaders rely on external/common #defines that may not be
  // present when imported as a single file.
  if (src.includes('MAX_NUM_TRACE_ITERATIONS') && !hasDefine('MAX_NUM_TRACE_ITERATIONS') && !hasConst('MAX_NUM_TRACE_ITERATIONS')) {
    out.push('#ifndef MAX_NUM_TRACE_ITERATIONS')
    out.push('#define MAX_NUM_TRACE_ITERATIONS 128')
    out.push('#endif')
  }

  if (src.includes('NUM_POLAR_MARCH_STEPS') && !hasDefine('NUM_POLAR_MARCH_STEPS') && !hasConst('NUM_POLAR_MARCH_STEPS')) {
    out.push('#ifndef NUM_POLAR_MARCH_STEPS')
    out.push('#define NUM_POLAR_MARCH_STEPS 64')
    out.push('#endif')
  }

  if (src.includes('FOG_EXTENT') && !hasDefine('FOG_EXTENT') && !hasConst('FOG_EXTENT')) {
    out.push('#ifndef FOG_EXTENT')
    out.push('#define FOG_EXTENT 150.0')
    out.push('#endif')
  }

  return out
}

function ensureMainWrapper(source, opts = {}) {
  const hasMainImage = /void\s+mainImage\s*\(/.test(source)
  const hasMain = /void\s+main\s*\(/.test(source)
  if (hasMain) return source
  if (!hasMainImage) return source

  const forceOpaqueOutput = !!opts.forceOpaqueOutput

  // Our renderer uses an alpha canvas with a transparent clear color.
  // Many Shadertoy shaders output alpha=0.0 (Shadertoy ignores alpha), which
  // makes the result fully transparent (appearing black) on our canvas.
  const alphaFixLine = forceOpaqueOutput ? '  fragColor.a = 1.0;\n' : ''

  return `${source}\n\nvoid main() {\n  vec4 fragColor = vec4(0.0);\n  mainImage(fragColor, gl_FragCoord.xy);\n${alphaFixLine}  gl_FragColor = fragColor;\n}\n`
}

function buildFragmentSource(common, passCode, opts = {}) {
  const original = `${common ? `${common}\n` : ''}${passCode}`

  const needsDerivatives = /\b(dFdx|dFdy|fwidth)\s*\(/.test(original)
  const needsTextureLod = /\btextureLod\s*\(/.test(original)

  const caps = opts?.caps || {}
  const supportsDerivatives = !!caps.derivatives
  const supportsTextureLodExt = !!caps.textureLod

  let body = original

  // Compatibility transforms
  body = transformFloatLiteralSuffix(body)
  body = transformVec2Array3x3Fill(body)
  body = transformTexelFetch(body)
  body = transformAudioLegacyRowSampling(body, opts?.channelHints)

  const loopResult = transformDynamicForLoops(body)
  body = loopResult.source

  /** @type {string[]} */
  const prelude = []

  // WebGL1 extensions must appear before any non-preprocessor statements.
  if (needsDerivatives && supportsDerivatives) {
    prelude.push('#extension GL_OES_standard_derivatives : enable')
  }
  if (needsTextureLod && supportsTextureLodExt) {
    prelude.push('#extension GL_EXT_shader_texture_lod : enable')
    prelude.push('#define ST_HAS_TEXLOD 1')
  }

  if (loopResult.changed) {
    prelude.push('#ifndef _ST_LOOP_MAX')
    prelude.push('#define _ST_LOOP_MAX 512')
    prelude.push('#endif')
  }

  const compatDefines = getShadertoyCompatDefines(body)
  if (compatDefines.length) {
    prelude.push(...compatDefines)
  }

  // Precision must appear before any non-preprocessor statement that uses floats.
  // In particular, we may inject compat functions (round/tanh) which use float/vec
  // types, so declare precision early.
  if (!/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(body)) {
    prelude.push('precision highp float;')
  }
  if (!/\bprecision\s+(lowp|mediump|highp)\s+int\s*;/.test(body)) {
    prelude.push('precision highp int;')
  }

  const compatFns = getShadertoyCompatFns(body)
  if (compatFns.length) {
    prelude.push(...compatFns)
  }

  // Shadertoy uniforms (only if not already declared)
  if (!/\buniform\s+vec3\s+iResolution\b/.test(body)) prelude.push('uniform vec3 iResolution;')
  if (!/\buniform\s+float\s+iTime\b/.test(body)) prelude.push('uniform float iTime;')
  if (!/\buniform\s+float\s+iTimeDelta\b/.test(body)) prelude.push('uniform float iTimeDelta;')
  if (!/\buniform\s+float\s+iFrameRate\b/.test(body)) prelude.push('uniform float iFrameRate;')
  if (!/\buniform\s+int\s+iFrame\b/.test(body)) prelude.push('uniform int iFrame;')
  if (!/\buniform\s+vec4\s+iMouse\b/.test(body)) prelude.push('uniform vec4 iMouse;')
  if (!/\buniform\s+vec4\s+iDate\b/.test(body)) prelude.push('uniform vec4 iDate;')
  if (!/\buniform\s+float\s+iSampleRate\b/.test(body)) prelude.push('uniform float iSampleRate;')

  // Channels
  const chTypes = Array.isArray(opts?.channelTypes) && opts.channelTypes.length === 4
    ? opts.channelTypes
    : ['sampler2D', 'sampler2D', 'sampler2D', 'sampler2D']

  for (let ch = 0; ch < 4; ch++) {
    const name = `iChannel${ch}`
    const want = chTypes[ch] === 'samplerCube' ? 'samplerCube' : 'sampler2D'
    const has2D = new RegExp(`\\buniform\\s+sampler2D\\s+${name}\\b`).test(body)
    const hasCube = new RegExp(`\\buniform\\s+samplerCube\\s+${name}\\b`).test(body)
    if (!has2D && !hasCube) prelude.push(`uniform ${want} ${name};`)
  }

  // Channel meta
  if (!/\buniform\s+vec3\s+iChannelResolution\s*\[\s*4\s*\]/.test(body)) prelude.push('uniform vec3 iChannelResolution[4];')
  if (!/\buniform\s+float\s+iChannelTime\s*\[\s*4\s*\]/.test(body)) prelude.push('uniform float iChannelTime[4];')

  let src = prelude.length ? `${prelude.join('\n')}\n\n${body}` : body

  // Ensure there is a main(). For the final Image pass, default to forcing opaque
  // output so Shadertoy-style alpha=0.0 doesn't become fully transparent.
  src = ensureMainWrapper(src, { forceOpaqueOutput: !!opts.forceOpaqueOutput })

  return src
}

const FULLSCREEN_VERT = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`

function makeFullscreenGeometry() {
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ])
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 0,
    1, 1,
    0, 1,
  ])
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return geo
}

function makeBlackTexture() {
  const data = new Uint8Array([0, 0, 0, 255])
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

function makeNoiseTexture(size = 512) {
  const w = size
  const h = size
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    // simple deterministic-ish noise (no RNG needed)
    const v = (i * 1103515245 + 12345) >>> 24
    data[o + 0] = v
    data[o + 1] = v
    data[o + 2] = v
    data[o + 3] = 255
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.minFilter = THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

function makeDefaultCubeTexture() {
  // Simple 1x1-per-face cube texture so samplerCube shaders can compile and display
  // something even when we don't have a Shadertoy cubemap asset.
  const makeFace = (r, g, b) => {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(0, 0, 1, 1)
    }
    return c
  }

  const faces = [
    makeFace(255, 80, 80),
    makeFace(80, 255, 80),
    makeFace(80, 80, 255),
    makeFace(255, 255, 80),
    makeFace(80, 255, 255),
    makeFace(255, 80, 255),
  ]

  const t = new THREE.CubeTexture(faces)
  t.needsUpdate = true
  return t
}

function computeShaderCaps(gl) {
  if (!gl) return { textureLod: false, derivatives: false }

  // getExtension returns null if unsupported; calling it enables the extension when present.
  const textureLod = !!gl.getExtension('EXT_shader_texture_lod')
  const derivatives = !!gl.getExtension('OES_standard_derivatives')
  return { textureLod, derivatives }
}

function detectUsedChannels(source) {
  const src = String(source || '')
  const used = [false, false, false, false]
  for (let i = 0; i < 4; i++) {
    used[i] = new RegExp(`\\biChannel${i}\\b`).test(src)
  }
  return used
}

function imagePassLooksLikePostprocess(fragmentSource) {
  const src = String(fragmentSource || '')
  // Heuristic: samples iChannel0 using fragCoord/gl_FragCoord (screen-space) and
  // relies on iChannelResolution[0] as an image size. These shaders usually expect
  // an input image rather than our 512x2 audio texture.
  const usesChannel0 = /\biChannel0\b/.test(src)
  const usesFragCoordSampling = /(texture2D\s*\(\s*iChannel0\s*,[^\)]*\bfragCoord\b|texture2D\s*\(\s*iChannel0\s*,[^\)]*\bgl_FragCoord\b)/.test(src)
  const usesChannel0Res = /iChannelResolution\s*\[\s*0\s*\]\s*\.xy/.test(src)
  return usesChannel0 && (usesFragCoordSampling || usesChannel0Res)
}

function makeRenderTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  })
  rt.texture.wrapS = THREE.ClampToEdgeWrapping
  rt.texture.wrapT = THREE.ClampToEdgeWrapping
  return rt
}

function formatGlslLog(log) {
  const text = String(log || '').trim()
  return text.length ? text : null
}

function compileAndLinkProgram(gl, { vertexSource, fragmentSource }) {
  const result = {
    ok: true,
    vertexLog: null,
    fragmentLog: null,
    programLog: null,
  }

  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    const ok = !!gl.getShaderParameter(shader, gl.COMPILE_STATUS)
    const log = formatGlslLog(gl.getShaderInfoLog(shader))
    return { shader, ok, log }
  }

  const vs = compile(gl.VERTEX_SHADER, vertexSource)
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource)
  result.vertexLog = vs.log
  result.fragmentLog = fs.log

  if (!vs.ok || !fs.ok) {
    result.ok = false
    if (vs.shader) gl.deleteShader(vs.shader)
    if (fs.shader) gl.deleteShader(fs.shader)
    return result
  }

  const program = gl.createProgram()
  gl.attachShader(program, vs.shader)
  gl.attachShader(program, fs.shader)
  gl.linkProgram(program)
  const linkOk = !!gl.getProgramParameter(program, gl.LINK_STATUS)
  result.programLog = formatGlslLog(gl.getProgramInfoLog(program))
  result.ok = linkOk

  gl.deleteProgram(program)
  gl.deleteShader(vs.shader)
  gl.deleteShader(fs.shader)

  return result
}

function makeAudioTexture() {
  // 512x2 RGBA:
  // - row 0: FFT (used by many shaders at y ~= 0.25)
  // - row 1: waveform (used by some shaders at y ~= 0.75)
  const width = 512
  const height = 2
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    data[o + 0] = 0
    data[o + 1] = 0
    data[o + 2] = 0
    data[o + 3] = 255
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return { tex, data, width, height }
}

function resampleTo512(src, dst /* Uint8Array */) {
  const n = src.length
  const width = 512
  for (let i = 0; i < width; i++) {
    const srcIdx = Math.min(n - 1, Math.floor((i / (width - 1)) * (n - 1)))
    dst[i] = src[srcIdx]
  }
}

export default class ShadertoyMultipassVisualizer extends THREE.Object3D {
  constructor({ name, source, filePath } = {}) {
    super()

    this.name = name || `Shader: ${niceTitleFromFile(filePath || 'shader')}`
    this._debugName = filePath || this.name

    this._source = String(source || '')

    this._geo = null
    this._camera = null

    this._imageMesh = null
    this._imageMat = null

    /** @type {{ name: string, type: 'buffer'|'image', scene: THREE.Scene, mesh: THREE.Mesh, mat: THREE.RawShaderMaterial, rts?: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget], ping?: 0|1 }[]} */
    this._passes = []

    this._blackTex = null
    this._noiseTex = null
    this._cubeTex = null

    this._caps = { textureLod: false, derivatives: false }

    // Some shaders are post-process passes and expect iChannel0 to be a full-frame image.
    // Default is audio-in-channel0.
    this._imageChannel0Mode = 'audio' // 'audio' | 'noise'
    this._imageChannelTypes = ['sampler2D', 'sampler2D', 'sampler2D', 'sampler2D']
    this._imageUsedChannels = [true, false, false, false]

    // Audio
    this._analyser = null
    this._fftBytes = null
    this._waveBytes = null
    this._audio = null // {tex,data,width,height}
    this._audioStartAt = performance.now()

    // Time
    this._startAt = performance.now()
    this._lastNow = performance.now()
    this._frame = 0

    // Mouse (Shadertoy-ish): x,y current; z,w click pos when down; z<0 when not pressed
    this._mouse = new THREE.Vector4(0, 0, -1, -1)
    this._isMouseDown = false

    this._onResize = () => this._resizeTargets()
    this._onPointerMove = (e) => this._handlePointerMove(e)
    this._onPointerDown = (e) => this._handlePointerDown(e)
    this._onPointerUp = () => this._handlePointerUp()

    this._scenePrevBackground = null

    // Error overlay (GLSL compile/link logs)
    this._errorOverlayEl = null
    this._errorOverlayDismissed = false
  }

  init() {
    this._scenePrevBackground = App.scene?.background ?? null
    if (App.scene) {
      App.scene.background = new THREE.Color(0x000000)
    }

    this._startAt = performance.now()
    this._lastNow = this._startAt
    this._frame = 0

    const gl = App.renderer?.getContext?.() || null
    this._caps = computeShaderCaps(gl)

    this._blackTex = makeBlackTexture()
    this._noiseTex = makeNoiseTexture(512)
    this._cubeTex = makeDefaultCubeTexture()
    this._geo = makeFullscreenGeometry()
    this._camera = new THREE.Camera()

    this._bindAnalyser()
    this._audio = makeAudioTexture()
    this._audioStartAt = performance.now()

    this._buildPasses()

    this._validateShadersAndMaybeShowOverlay()

    this._resizeTargets()

    window.addEventListener('resize', this._onResize)
    window.addEventListener('pointermove', this._onPointerMove, { passive: true })
    window.addEventListener('pointerdown', this._onPointerDown, { passive: true })
    window.addEventListener('pointerup', this._onPointerUp, { passive: true })
    window.addEventListener('pointercancel', this._onPointerUp, { passive: true })
  }

  _ensureErrorOverlay() {
    if (this._errorOverlayEl) return this._errorOverlayEl

    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = '12px'
    el.style.top = '12px'
    el.style.right = '12px'
    el.style.maxHeight = '45vh'
    el.style.overflow = 'auto'
    el.style.zIndex = '99999'
    el.style.background = 'rgba(0,0,0,0.85)'
    el.style.border = '1px solid rgba(255,80,80,0.65)'
    el.style.borderRadius = '8px'
    el.style.boxShadow = '0 10px 40px rgba(0,0,0,0.45)'
    el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
    el.style.fontSize = '12px'
    el.style.lineHeight = '1.4'
    el.style.color = '#ffd3d3'
    el.style.padding = '10px 12px'
    el.style.whiteSpace = 'pre-wrap'
    el.style.display = 'none'

    const header = document.createElement('div')
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    header.style.justifyContent = 'space-between'
    header.style.gap = '12px'
    header.style.marginBottom = '8px'

    const title = document.createElement('div')
    title.textContent = 'Shader compile errors'
    title.style.fontWeight = '700'
    title.style.color = '#ff9f9f'

    const actions = document.createElement('div')
    actions.style.display = 'flex'
    actions.style.gap = '8px'

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.textContent = 'Copy'
    copyBtn.style.cursor = 'pointer'
    copyBtn.style.border = '1px solid rgba(255,255,255,0.25)'
    copyBtn.style.background = 'rgba(255,255,255,0.08)'
    copyBtn.style.color = '#fff'
    copyBtn.style.padding = '4px 8px'
    copyBtn.style.borderRadius = '6px'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.textContent = 'Dismiss'
    closeBtn.style.cursor = 'pointer'
    closeBtn.style.border = '1px solid rgba(255,255,255,0.25)'
    closeBtn.style.background = 'rgba(255,255,255,0.08)'
    closeBtn.style.color = '#fff'
    closeBtn.style.padding = '4px 8px'
    closeBtn.style.borderRadius = '6px'

    actions.appendChild(copyBtn)
    actions.appendChild(closeBtn)
    header.appendChild(title)
    header.appendChild(actions)

    const content = document.createElement('div')
    content.dataset.role = 'content'

    el.appendChild(header)
    el.appendChild(content)

    closeBtn.addEventListener('click', () => {
      this._errorOverlayDismissed = true
      el.style.display = 'none'
    })

    copyBtn.addEventListener('click', async () => {
      try {
        const text = content.textContent || ''
        await navigator.clipboard.writeText(text)
        copyBtn.textContent = 'Copied'
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
        }, 1200)
      } catch {
        // clipboard may be blocked; ignore
      }
    })

    document.body.appendChild(el)
    this._errorOverlayEl = el
    return el
  }

  _setErrorOverlayText(text) {
    const el = this._ensureErrorOverlay()
    const content = el.querySelector('[data-role="content"]')
    if (content) content.textContent = text
    if (!this._errorOverlayDismissed) el.style.display = 'block'
  }

  _validateShadersAndMaybeShowOverlay() {
    if (this._errorOverlayDismissed) return
    if (!App.renderer) return
    const gl = App.renderer.getContext?.()
    if (!gl) return

    const errors = []
    const pushErrorsForMat = (label, mat) => {
      if (!mat?.vertexShader || !mat?.fragmentShader) return
      const r = compileAndLinkProgram(gl, {
        vertexSource: mat.vertexShader,
        fragmentSource: mat.fragmentShader,
      })
      if (r.ok) return

      const parts = []
      if (r.vertexLog) parts.push(`VERTEX:\n${r.vertexLog}`)
      if (r.fragmentLog) parts.push(`FRAGMENT:\n${r.fragmentLog}`)
      if (r.programLog) parts.push(`LINK:\n${r.programLog}`)
      errors.push({ label, log: parts.join('\n\n') || '(no info log available)' })
    }

    for (const p of this._passes) {
      pushErrorsForMat(`${this._debugName} :: ${p.name}`, p.mat)
    }
    if (this._imageMat) {
      pushErrorsForMat(`${this._debugName} :: Image`, this._imageMat)
    }

    if (!errors.length) {
      if (this._errorOverlayEl) this._errorOverlayEl.style.display = 'none'
      return
    }

    const lines = []
    lines.push(`Visualizer: ${this.name}`)
    lines.push(`Source: ${this._debugName}`)
    lines.push('')
    lines.push('Some shaders require WebGL2 or additional Shadertoy features; the logs below should point to the exact line.')
    lines.push('')

    for (const e of errors) {
      lines.push('------------------------------------------------------------')
      lines.push(e.label)
      lines.push('')
      lines.push(e.log)
      lines.push('')
    }

    this._setErrorOverlayText(lines.join('\n'))
  }

  _bindAnalyser() {
    if (App.audioManager?.analyserNode) {
      this._analyser = App.audioManager.analyserNode
      this._fftBytes = new Uint8Array(this._analyser.frequencyBinCount)
      this._waveBytes = new Uint8Array(this._analyser.fftSize)
    }
  }

  _handlePointerMove(e) {
    const dpr = App.renderer?.getPixelRatio?.() || Math.max(1, window.devicePixelRatio || 1)
    const x = e.clientX * dpr
    const y = (window.innerHeight - e.clientY) * dpr
    this._mouse.x = x
    this._mouse.y = y
    // keep z/w as click coords
  }

  _handlePointerDown(e) {
    this._isMouseDown = true
    const dpr = App.renderer?.getPixelRatio?.() || Math.max(1, window.devicePixelRatio || 1)
    const x = e.clientX * dpr
    const y = (window.innerHeight - e.clientY) * dpr
    this._mouse.z = x
    this._mouse.w = y
  }

  _handlePointerUp() {
    this._isMouseDown = false
    // Shadertoy commonly uses negative z when not pressed
    this._mouse.z = -Math.abs(this._mouse.z || 1)
    this._mouse.w = -Math.abs(this._mouse.w || 1)
  }

  _buildPasses() {
    // Cleanup existing
    for (const p of this._passes) {
      p.mat?.dispose?.()
      if (p.rts) {
        p.rts[0].dispose()
        p.rts[1].dispose()
      }
    }
    this._passes = []

    if (this._imageMesh?.parent) {
      this._imageMesh.parent.remove(this._imageMesh)
    }
    this._imageMat?.dispose?.()
    this._imageMat = null
    this._imageMesh = null

    const parsed = parseShaderSections(this._source, this._debugName)

    // Assign buffer channels sequentially by appearance; duplicates are OK.
    const bufferPasses = []
    const imagePasses = []

    for (const pass of parsed.passes) {
      const type = inferPassType(pass.name)
      if (type === 'buffer') bufferPasses.push(pass)
      else imagePasses.push(pass)
    }

    // If there are multiple Image sections, we just take the last one.
    const imagePass = imagePasses.length ? imagePasses[imagePasses.length - 1] : { name: 'Image', code: '' }

    // Build buffer passes (A->iChannel1, B->iChannel2, C->iChannel3)
    for (let i = 0; i < Math.min(3, bufferPasses.length); i++) {
      const pass = bufferPasses[i]
      const chanIndex = i + 1

      const combinedSrc = `${parsed.common ? `${parsed.common}\n` : ''}${pass.code}`
      const channelTypes = inferChannelSamplerTypes(combinedSrc)
      const channelHints = inferChannelHints(combinedSrc)
      const usedChannels = detectUsedChannels(combinedSrc)

      const frag = buildFragmentSource(parsed.common, pass.code, { caps: this._caps, channelTypes, channelHints, forceOpaqueOutput: false })
      const mat = new THREE.RawShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: frag,
        uniforms: this._makeUniforms(),
        depthTest: false,
        depthWrite: false,
      })

      const scene = new THREE.Scene()
      const mesh = new THREE.Mesh(this._geo, mat)
      mesh.frustumCulled = false
      scene.add(mesh)

      this._passes.push({
        name: pass.name || `Buffer ${String.fromCharCode(65 + i)}`,
        type: 'buffer',
        scene,
        mesh,
        mat,
        rts: [makeRenderTarget(4, 4), makeRenderTarget(4, 4)],
        ping: 0,
        chanIndex,
        channelTypes,
        channelHints,
        usedChannels,
      })
    }

    // Image pass
    {
      const combinedSrc = `${parsed.common ? `${parsed.common}\n` : ''}${imagePass.code}`
      this._imageChannelTypes = inferChannelSamplerTypes(combinedSrc)
      this._imageChannelHints = inferChannelHints(combinedSrc)
      this._imageUsedChannels = detectUsedChannels(combinedSrc)

      const frag = buildFragmentSource(parsed.common, imagePass.code, { caps: this._caps, channelTypes: this._imageChannelTypes, channelHints: this._imageChannelHints, forceOpaqueOutput: true })
      const mat = new THREE.RawShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: frag,
        uniforms: this._makeUniforms(),
        depthTest: false,
        depthWrite: false,
      })

      // Decide what iChannel0 should represent for the image pass.
      // If the shader looks like a postprocess pass (screen-space sampling), feed a noise
      // texture by default so it doesn't render black when no buffer/image inputs exist.
      this._imageChannel0Mode = imagePassLooksLikePostprocess(frag) ? 'noise' : 'audio'

      const mesh = new THREE.Mesh(this._geo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = -1000

      this._imageMat = mat
      this._imageMesh = mesh
      App.holder.add(mesh)
    }
  }

  _makeUniforms() {
    const now = performance.now()
    const res = this._getResolutionVec3()

    // iChannelResolution[4]
    const chRes = [
      new THREE.Vector3(512, 2, 1),
      new THREE.Vector3(res.x, res.y, 1),
      new THREE.Vector3(res.x, res.y, 1),
      new THREE.Vector3(res.x, res.y, 1),
    ]

    return {
      iResolution: { value: res },
      iTime: { value: 0 },
      iTimeDelta: { value: 0 },
      iFrameRate: { value: 0 },
      iFrame: { value: 0 },
      iMouse: { value: this._mouse },
      iDate: { value: new THREE.Vector4(0, 0, 0, 0) },
      iSampleRate: { value: App.audioManager?.audioContext?.sampleRate || 44100 },

      iChannel0: { value: this._audio?.tex || this._blackTex },
      iChannel1: { value: this._blackTex },
      iChannel2: { value: this._blackTex },
      iChannel3: { value: this._blackTex },

      iChannelResolution: { value: chRes },
      iChannelTime: { value: [0, 0, 0, 0] },
    }
  }

  _getResolutionVec3() {
    const dpr = App.renderer?.getPixelRatio?.() || Math.max(1, window.devicePixelRatio || 1)
    return new THREE.Vector3(window.innerWidth * dpr, window.innerHeight * dpr, 1)
  }

  _resizeTargets() {
    const res = this._getResolutionVec3()

    // Update all uniforms iResolution + iChannelResolution
    for (const p of this._passes) {
      p.mat.uniforms.iResolution.value.copy(res)
      p.mat.uniforms.iChannelResolution.value[0].set(512, 2, 1)
      p.mat.uniforms.iChannelResolution.value[1].set(res.x, res.y, 1)
      p.mat.uniforms.iChannelResolution.value[2].set(res.x, res.y, 1)
      p.mat.uniforms.iChannelResolution.value[3].set(res.x, res.y, 1)

      if (p.rts) {
        p.rts[0].setSize(res.x, res.y)
        p.rts[1].setSize(res.x, res.y)
      }
    }

    if (this._imageMat) {
      this._imageMat.uniforms.iResolution.value.copy(res)
      // Channel 0 resolution depends on what we bind (audio/noise/cube)
      if (this._imageChannelTypes?.[0] === 'samplerCube') {
        const w = this._cubeTex?.image?.[0]?.width || 1
        const h = this._cubeTex?.image?.[0]?.height || 1
        this._imageMat.uniforms.iChannelResolution.value[0].set(w, h, 1)
      } else if (this._imageChannel0Mode === 'noise' && this._noiseTex?.image) {
        this._imageMat.uniforms.iChannelResolution.value[0].set(this._noiseTex.image.width, this._noiseTex.image.height, 1)
      } else {
        this._imageMat.uniforms.iChannelResolution.value[0].set(512, 2, 1)
      }
      this._imageMat.uniforms.iChannelResolution.value[1].set(res.x, res.y, 1)
      this._imageMat.uniforms.iChannelResolution.value[2].set(res.x, res.y, 1)
      this._imageMat.uniforms.iChannelResolution.value[3].set(res.x, res.y, 1)
    }
  }

  _updateAudioTexture() {
    if (!this._audio) return

    // Re-bind if audio source changed.
    if (this._analyser !== App.audioManager?.analyserNode && App.audioManager?.analyserNode) {
      this._bindAnalyser()
    }

    const isPlaying = !!App.audioManager?.isPlaying || !!App.audioManager?.isUsingMicrophone
    if (!isPlaying || !this._analyser || !this._fftBytes || !this._waveBytes) return

    this._analyser.getByteFrequencyData(this._fftBytes)
    this._analyser.getByteTimeDomainData(this._waveBytes)

    const tmpFft = new Uint8Array(512)
    const tmpWave = new Uint8Array(512)
    resampleTo512(this._fftBytes, tmpFft)
    resampleTo512(this._waveBytes, tmpWave)

    const width = this._audio.width
    const data = this._audio.data

    // Row 0: FFT
    for (let i = 0; i < width; i++) {
      const v = tmpFft[i]
      const o = (i + 0 * width) * 4
      data[o + 0] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = 255
    }

    // Row 1: waveform
    for (let i = 0; i < width; i++) {
      const v = tmpWave[i]
      const o = (i + 1 * width) * 4
      data[o + 0] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = 255
    }

    this._audio.tex.needsUpdate = true
  }

  update() {
    if (!App.renderer) return

    const now = performance.now()
    const t = (now - this._startAt) / 1000
    const dt = Math.max(0, (now - this._lastNow) / 1000)
    this._lastNow = now

    this._frame += 1

    // Update audio
    this._updateAudioTexture()

    // Update date
    const d = new Date()
    const seconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000
    const iDate = this._imageMat?.uniforms?.iDate?.value || null
    if (iDate && iDate.isVector4) {
      iDate.set(d.getFullYear(), d.getMonth() + 1, d.getDate(), seconds)
    }

    const audioTime = (now - this._audioStartAt) / 1000

    // Render buffers sequentially
    for (let i = 0; i < this._passes.length; i++) {
      const pass = this._passes[i]
      if (pass.type !== 'buffer' || !pass.rts) continue

      const prevTex = pass.rts[pass.ping].texture
      const nextIndex = pass.ping === 0 ? 1 : 0
      const nextRt = pass.rts[nextIndex]

      // Update common uniforms
      this._applyCommonUniforms(pass.mat, t, dt, audioTime)

      // Channel convention:
      // - iChannel0: audio
      // - iChannel1: Buffer A (previous when rendering A)
      // - iChannel2: Buffer B
      // - iChannel3: Buffer C
      this._applyChannelUniformsForPass(pass, prevTex)

      const prevAutoClear = App.renderer.autoClear
      App.renderer.autoClear = true
      App.renderer.setRenderTarget(nextRt)
      App.renderer.clear(true, true, true)
      App.renderer.render(pass.scene, this._camera)
      App.renderer.setRenderTarget(null)
      App.renderer.autoClear = prevAutoClear

      // Swap
      pass.ping = nextIndex
    }

    // Update image pass uniforms (drawn as a mesh in App.scene)
    if (this._imageMat) {
      this._applyCommonUniforms(this._imageMat, t, dt, audioTime)
      this._applyChannelUniformsForImage(this._imageMat)
    }
  }

  _applyCommonUniforms(mat, t, dt, audioTime) {
    mat.uniforms.iTime.value = t
    mat.uniforms.iTimeDelta.value = dt
    // Shadertoy's iFrameRate is frames-per-second. Use the inverse of iTimeDelta.
    // Clamp to avoid huge spikes on tab-switch / timer hiccups.
    mat.uniforms.iFrameRate.value = dt > 0 ? Math.min(240, 1 / dt) : 0
    mat.uniforms.iFrame.value = this._frame

    // Mouse: use z sign to indicate down
    if (this._isMouseDown) {
      // keep z/w as click coords
    } else {
      // ensure negative
      mat.uniforms.iMouse.value.z = this._mouse.z < 0 ? this._mouse.z : -this._mouse.z
      mat.uniforms.iMouse.value.w = this._mouse.w < 0 ? this._mouse.w : -this._mouse.w
    }

    // iChannelTime
    mat.uniforms.iChannelTime.value[0] = audioTime
    mat.uniforms.iChannelTime.value[1] = t
    mat.uniforms.iChannelTime.value[2] = t
    mat.uniforms.iChannelTime.value[3] = t
  }

  _getBufferTexture(channelIndex /* 1..3 */) {
    const pass = this._passes[channelIndex - 1]
    if (!pass || !pass.rts) return this._blackTex
    return pass.rts[pass.ping].texture
  }

  _getBufferPrevTexture(channelIndex /* 1..3 */) {
    const pass = this._passes[channelIndex - 1]
    if (!pass || !pass.rts) return this._blackTex
    const prevIndex = pass.ping === 0 ? 1 : 0
    return pass.rts[prevIndex].texture
  }

  _setChannel(mat, ch, tex, kind) {
    const uniformName = `iChannel${ch}`
    if (!mat?.uniforms?.[uniformName] || !mat?.uniforms?.iChannelResolution) return

    mat.uniforms[uniformName].value = tex

    const res = mat.uniforms.iChannelResolution.value
    if (!Array.isArray(res) || !res[ch]) return

    if (kind === 'audio') {
      res[ch].set(512, 2, 1)
      return
    }

    if (kind === 'noise') {
      const w = this._noiseTex?.image?.width || 1
      const h = this._noiseTex?.image?.height || 1
      res[ch].set(w, h, 1)
      return
    }

    if (kind === 'cube') {
      const w = this._cubeTex?.image?.[0]?.width || 1
      const h = this._cubeTex?.image?.[0]?.height || 1
      res[ch].set(w, h, 1)
      return
    }

    if (kind === 'buffer') {
      const r = this._getResolutionVec3()
      res[ch].set(r.x, r.y, 1)
      return
    }

    // black/unknown
    res[ch].set(1, 1, 1)
  }

  _applyChannelUniformsForPass(pass, selfPrevTex) {
    const mat = pass.mat
    const hints = pass.channelHints || ['unknown', 'unknown', 'unknown', 'unknown']
    const types = pass.channelTypes || ['sampler2D', 'sampler2D', 'sampler2D', 'sampler2D']

    for (let ch = 0; ch < 4; ch++) {
      if (!mat.uniforms[`iChannel${ch}`]) continue

      // Cubemap expectation always wins.
      if (types[ch] === 'samplerCube') {
        this._setChannel(mat, ch, this._cubeTex || this._blackTex, this._cubeTex ? 'cube' : 'black')
        continue
      }

      const hint = hints[ch]
      if (hint === 'noise') {
        this._setChannel(mat, ch, this._noiseTex || this._blackTex, this._noiseTex ? 'noise' : 'black')
        continue
      }
      if (hint === 'audio') {
        this._setChannel(mat, ch, this._audio?.tex || this._blackTex, this._audio?.tex ? 'audio' : 'black')
        continue
      }

      // Buffer channels: map iChannel0..2 -> Buffer A/B/C (with self-feedback)
      if (ch <= 2) {
        const bufIndex = ch + 1 // 1..3
        const hasBuf = !!this._passes[bufIndex - 1]
        if (hasBuf) {
          if (bufIndex === pass.chanIndex) {
            this._setChannel(mat, ch, selfPrevTex || this._blackTex, selfPrevTex ? 'buffer' : 'black')
          } else if (bufIndex < pass.chanIndex) {
            this._setChannel(mat, ch, this._getBufferTexture(bufIndex), 'buffer')
          } else {
            this._setChannel(mat, ch, this._getBufferPrevTexture(bufIndex), 'buffer')
          }
          continue
        }
      }

      // Fallback channel (often used for audio)
      if (ch === 3 && this._audio?.tex) {
        this._setChannel(mat, ch, this._audio.tex, 'audio')
      } else {
        this._setChannel(mat, ch, this._blackTex, 'black')
      }
    }
  }

  _applyChannelUniformsForImage(mat) {
    const chTypes = this._imageChannelTypes || ['sampler2D', 'sampler2D', 'sampler2D', 'sampler2D']
    const hints = this._imageChannelHints || ['unknown', 'unknown', 'unknown', 'unknown']
    const used = this._imageUsedChannels || [true, false, false, false]

    const bufferCount = this._passes.length
    const lastBufferTex = bufferCount ? this._getBufferTexture(bufferCount) : this._blackTex

    for (let ch = 0; ch < 4; ch++) {
      const uniformName = `iChannel${ch}`
      if (!mat.uniforms[uniformName]) continue

      if (chTypes[ch] === 'samplerCube') {
        this._setChannel(mat, ch, this._cubeTex || this._blackTex, this._cubeTex ? 'cube' : 'black')
        continue
      }

      const hint = hints[ch]
      if (hint === 'noise') {
        this._setChannel(mat, ch, this._noiseTex || this._blackTex, this._noiseTex ? 'noise' : 'black')
        continue
      }
      if (hint === 'audio') {
        this._setChannel(mat, ch, this._audio?.tex || this._blackTex, this._audio?.tex ? 'audio' : 'black')
        continue
      }

      if (ch === 0) {
        // If we have buffers, default Image iChannel0 to the last buffer unless
        // shader also looks like it expects A/B mapping (iChannel1 as buffer).
        if (bufferCount > 0) {
          const wantsABMapping = hints[1] === 'buffer'
          if (wantsABMapping) {
            this._setChannel(mat, 0, this._getBufferTexture(1), 'buffer')
          } else {
            this._setChannel(mat, 0, lastBufferTex, lastBufferTex !== this._blackTex ? 'buffer' : 'black')
          }
          continue
        }

        // Single-pass behavior
        if (this._imageChannel0Mode === 'noise') {
          this._setChannel(mat, 0, this._noiseTex || this._blackTex, this._noiseTex ? 'noise' : 'black')
        } else {
          this._setChannel(mat, 0, this._audio?.tex || this._blackTex, this._audio?.tex ? 'audio' : 'black')
        }
        continue
      }

      // Channels 0..2 map to buffers A/B/C when present
      if (ch <= 2) {
        const bufIndex = ch + 1
        const bufTex = this._getBufferTexture(bufIndex)
        if (bufTex !== this._blackTex) {
          this._setChannel(mat, ch, bufTex, 'buffer')
        } else if (used[ch]) {
          this._setChannel(mat, ch, this._noiseTex || this._blackTex, this._noiseTex ? 'noise' : 'black')
        } else {
          this._setChannel(mat, ch, this._blackTex, 'black')
        }
        continue
      }

      // Channel 3 fallback
      if (used[ch]) {
        this._setChannel(
          mat,
          ch,
          this._audio?.tex || (this._noiseTex || this._blackTex),
          this._audio?.tex ? 'audio' : (this._noiseTex ? 'noise' : 'black')
        )
      } else {
        this._setChannel(mat, ch, this._blackTex, 'black')
      }
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerUp)

    if (this._imageMesh?.parent) {
      this._imageMesh.parent.remove(this._imageMesh)
    }

    for (const p of this._passes) {
      p.mat?.dispose?.()
      // geometry is shared; disposed below
      if (p.rts) {
        p.rts[0].dispose()
        p.rts[1].dispose()
      }
    }
    this._passes = []

    this._imageMat?.dispose?.()
    this._imageMat = null
    this._imageMesh = null

    this._geo?.dispose?.()
    this._geo = null

    if (this._audio?.tex) this._audio.tex.dispose()
    this._audio = null

    if (this._blackTex) this._blackTex.dispose()
    this._blackTex = null

    if (this._noiseTex) this._noiseTex.dispose()
    this._noiseTex = null

    if (this._cubeTex) this._cubeTex.dispose()
    this._cubeTex = null

    if (this._errorOverlayEl?.parentNode) {
      this._errorOverlayEl.parentNode.removeChild(this._errorOverlayEl)
    }
    this._errorOverlayEl = null

    this._fftBytes = null
    this._waveBytes = null
    this._analyser = null

    if (App.scene) {
      App.scene.background = this._scenePrevBackground
    }
  }
}
