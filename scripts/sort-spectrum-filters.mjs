import { promises as fs } from 'fs'
import path from 'path'

const sortObject = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj
  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = obj[key]
      return acc
    }, {})
}

async function sortFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  const sorted = {}

  // Preserve name first if present
  if (parsed.name) sorted.name = parsed.name
  // Keep visualizer second if present
  if (parsed.visualizer) sorted.visualizer = parsed.visualizer

  if (parsed.controls && typeof parsed.controls === 'object') {
    sorted.controls = sortObject(parsed.controls)
  } else {
    Object.assign(sorted, parsed)
  }

  const pretty = `${JSON.stringify(sorted, null, 2)}\n`
  await fs.writeFile(filePath, pretty, 'utf8')
  return filePath
}

async function main() {
  const root = process.cwd()
  const dir = path.resolve(root, 'public', 'spectrum-filters')
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const targets = entries
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .filter((name) => name.toLowerCase() !== 'index.json')

  await Promise.all(targets.map((name) => sortFile(path.join(dir, name))))
  console.log(`Sorted ${targets.length} spectrum filter files.`)
}

main().catch((err) => {
  console.error('Failed to sort spectrum filters', err)
  process.exitCode = 1
})
