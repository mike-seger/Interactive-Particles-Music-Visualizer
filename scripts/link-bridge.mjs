import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const source = path.join(root, 'public', 'bridge-integration.js');
// adjust this if your visualizer build emits into a subfolder
const link = path.join(root, 'dist', 'bridge-integration.js');

await fs.rm(link, { force: true });
await fs.mkdir(path.dirname(link), { recursive: true });
await fs.copyFile(source, link);
console.log(`Copied ${source} -> ${link}`);
