import { promises as fs } from 'fs'
import path from 'path'

async function main() {
  const root = process.cwd()
  const dir = path.resolve(root, 'public', 'spectrum-filters')

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = entries
      .filter((ent) => ent.isFile())
      .map((ent) => ent.name)
      .filter((name) => name.toLowerCase().endsWith('.json'))
      .filter((name) => name.toLowerCase() !== 'index.json')
      .sort((a, b) => a.localeCompare(b, 'en'))

    const outPath = path.join(dir, 'index.json')
    const json = `${JSON.stringify(files, null, 2)}\n`
    await fs.writeFile(outPath, json, 'utf8')
    console.log(`[gen-spectrum-index] wrote ${files.length} entries to ${path.relative(root, outPath)}`)
  } catch (err) {
    console.error('[gen-spectrum-index] failed to generate index', err)
    process.exitCode = 1
  }
}

main()
