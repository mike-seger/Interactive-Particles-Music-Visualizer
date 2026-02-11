#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const sourceDir = path.resolve('tmp/milkpresets/m4');
const targetDir = path.resolve('src/shaders/gpt-5.1-codex-max');

async function main() {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const milkFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.milk'));
  await fs.mkdir(targetDir, { recursive: true });

  await Promise.all(
    milkFiles.map(async (entry) => {
      const filename = entry.name;
      const stem = filename.replace(/\.milk$/, '');
      const sourcePath = path.join(sourceDir, filename);
      const targetPath = path.join(targetDir, `${stem}.glsl`);
      const text = await fs.readFile(sourcePath, 'utf8');
      const preset = parsePreset(text);
      const glsl = buildShader(stem, filename, preset);
      await fs.writeFile(targetPath, glsl, 'utf8');
    })
  );

  console.log(`Ported ${milkFiles.length} presets from ${sourceDir} to ${targetDir}`);
}

function parsePreset(text) {
  const num = (key, fallback = 0) => {
    const m = text.match(new RegExp(`${key}=([-+0-9eE\.]+)`));
    return m ? parseFloat(m[1]) : fallback;
  };

  const wave = {
    r: num('wave_r', 0.6),
    g: num('wave_g', 0.6),
    b: num('wave_b', 0.6),
    a: num('fWaveAlpha', 0.4),
    scale: num('fWaveScale', 1.0),
  };

  const inner = {
    r: num('ib_r', 0.25),
    g: num('ib_g', 0.25),
    b: num('ib_b', 0.25),
  };

  const outer = {
    r: num('ob_r', 1.0),
    g: num('ob_g', 1.0),
    b: num('ob_b', 1.0),
  };

  const warp = {
    scale: num('fWarpScale', 1.0),
    speed: num('fWarpAnimSpeed', 1.0),
  };

  const shape = {
    sides: Math.max(3, Math.floor(num('shapecode_0_sides', 6))),
    radius: num('shapecode_0_rad', 0.3),
    r: num('shapecode_0_r', outer.r),
    g: num('shapecode_0_g', outer.g),
    b: num('shapecode_0_b', outer.b),
    a: num('shapecode_0_a', 0.8),
  };

  const zoom = num('zoom', 1.0);
  const decay = num('fDecay', 0.9);

  return { wave, inner, outer, warp, shape, zoom, decay };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function vec3Literal({ r, g, b }) {
  return `vec3(${clamp01(r).toFixed(3)}, ${clamp01(g).toFixed(3)}, ${clamp01(b).toFixed(3)})`;
}

function buildShader(stem, filename, preset) {
  const { wave, inner, outer, warp, shape, zoom, decay } = preset;
  const baseColor = vec3Literal(inner);
  const waveColor = vec3Literal(wave);
  const accentColor = vec3Literal({ r: shape.r, g: shape.g, b: shape.b });
  const outerColor = vec3Literal(outer);

  return `/*
 * Title: ${stem}
 * Source preset: ${filename} (MilkDrop)
 * Generated: port-milk.mjs (audio-reactive approximation)
 * Audio: PCM via iChannel0 (red channel)
 */
#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 iResolution;
uniform float iTime;
uniform sampler2D iChannel0;

float band(float f) {
    return texture2D(iChannel0, vec2(f, 0.0)).r;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float aspect = iResolution.x / max(iResolution.y, 1.0);
    vec2 p = (uv - 0.5) * vec2(1.0, aspect);

    float bass = band(0.02);
    float mid = band(0.12);
    float treb = band(0.32);
    float energy = bass * 0.6 + mid * 0.3 + treb * 0.1;

    float time = iTime * ${warp.speed.toFixed(3)};
    float angle = atan(p.y, p.x) + energy * 0.5;
    float radius = length(p);
    float swirl = sin(radius * ${warp.scale.toFixed(3)} * 10.0 - time * 1.5);
    float zoomMod = pow(${zoom.toFixed(3)}, 1.0 + energy * 0.5);
    vec2 q = p * zoomMod;

    float sectors = float(${shape.sides.toFixed(0)});
    float sector = cos(angle * sectors + swirl * 2.0);

    vec3 base = ${baseColor};
    vec3 waveTint = ${waveColor};
    vec3 accent = ${accentColor};
    vec3 halo = ${outerColor};

    vec3 color = base;
    color += waveTint * (0.3 + 1.4 * energy * sector);
    color = mix(color, accent, 0.35 + 0.35 * sin(time + radius * 6.0));
    color += halo * 0.25 * smoothstep(${(shape.radius * 1.2).toFixed(3)}, ${(shape.radius * 0.2).toFixed(3)}, radius + energy * 0.2);

    float vignette = smoothstep(1.2, 0.2, length(q) + energy * 0.1);
    float fade = mix(1.0, ${decay.toFixed(3)}, energy);

    gl_FragColor = vec4(color * vignette * fade, 1.0);
}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
