import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {releaseURL, validateBundle, validateCatalog} from '../shared/market-engine/validate.mjs';

const root = resolve(process.argv[2] || new URL('..', import.meta.url).pathname);
const catalog = JSON.parse(await readFile(join(root, 'catalog', 'plugins.json'), 'utf8'));
validateCatalog(catalog);
for (const plugin of catalog.plugins) {
  const response = await fetch(releaseURL(plugin), {headers: {'user-agent': 'DeepSeek-Cute-Catalog-Audit/1'}});
  if (!response.ok) throw new Error(`${plugin.id}: GitHub Release asset returned ${response.status}`);
  validateBundle(Buffer.from(await response.arrayBuffer()), plugin);
}
console.log(`PASS: ${catalog.plugins.length} approved plugin asset(s) downloaded and audited`);
