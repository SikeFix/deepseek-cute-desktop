import {readFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {validateCatalog} from '../shared/market-engine/validate.mjs';

const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const catalog = JSON.parse(await readFile(join(root, 'catalog', 'plugins.json'), 'utf8'));
validateCatalog(catalog);
const dirs = await readdir(join(root, 'catalog', 'plugins'), {withFileTypes: true});
const ids = new Set(catalog.plugins.map(p => p.id));
for (const dir of dirs) if (dir.isDirectory() && !ids.has(dir.name)) throw new Error(`catalog: unlisted plugin directory ${dir.name}`);
for (const p of catalog.plugins) {
  const manifest = JSON.parse(await readFile(join(root, 'catalog', 'plugins', p.id, p.manifest), 'utf8'));
  if (manifest.id !== p.id || manifest.version !== p.version) throw new Error(`catalog: ${p.id} manifest mismatch`);
}
console.log(`PASS: catalog schema and ${catalog.plugins.length} approved plugin(s) validated`);
