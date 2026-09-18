import {createHash} from 'node:crypto';
import {posix} from 'node:path';

export const REPO = 'SikeFix/deepseek-cute-desktop';
export const MAX_BYTES = 8 * 1024 * 1024;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const keys = (o, allowed) => { assert(o && typeof o === 'object' && !Array.isArray(o), 'Expected object'); for (const k of Object.keys(o)) assert(allowed.includes(k), `Unknown field: ${k}`); };
const str = (s, max = 2000) => typeof s === 'string' && s.length > 0 && s.length <= max;
const hash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const version = v => typeof v === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v);
const stamp = s => str(s) && /^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s));
const list = (x, allow) => Array.isArray(x) && new Set(x).size === x.length && x.every(v => allow.includes(v));
export function safeID(id) { assert(typeof id === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(id) && !['constructor','prototype','__proto__'].includes(id), 'Invalid plugin ID'); return id; }
export function safePath(path) {
  assert(str(path, 200) && path.split('/').every(p => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p) && !p.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(p)) && !path.includes('node_modules'), `Unsafe package path: ${path}`);
  return path;
}
export function validateManifest(p) {
  keys(p, ['id','version','name','description','author','repository','sourceCommit','release','platforms','minAppVersion','maxAppVersion','kernelVersion','permissions','license','manifest','entry','dependencies','review','updatedAt']);
  safeID(p.id); assert(version(p.version) && version(p.minAppVersion), 'Invalid SemVer');
  assert(p.maxAppVersion === undefined || (version(p.maxAppVersion) && compare(p.maxAppVersion,p.minAppVersion) >= 0), 'Invalid app version range');
  assert(p.kernelVersion === '0.1.5-rc.2', 'Unsupported kernel version');
  for (const field of ['name','description']) { keys(p[field], ['zh-CN','en']); assert(str(p[field]['zh-CN']) && str(p[field].en), `Missing ${field} translation`); }
  assert(str(p.author,120) && str(p.license,80), 'Author and license required');
  assert(/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(p.repository), 'Repository must be GitHub HTTPS');
  assert(/^[a-f0-9]{40}$/.test(p.sourceCommit), 'Pin sourceCommit to a full Git commit');
  keys(p.release, ['tag','asset','sha256']);
  assert(p.release.tag === `v${p.version}`, 'Release tag must match exact version');
  assert(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.plugin\.json$/.test(p.release.asset) && hash(p.release.sha256), 'Invalid release asset/checksum');
  assert(list(p.platforms,['windows-x64','macos-arm64']) && p.platforms.length, 'Unsupported platform');
  assert(list(p.permissions,['network','workspace-read','workspace-write','credentials']), 'Invalid permissions');
  assert(p.manifest === 'plugin.json' && safePath(p.entry).endsWith('.mjs'), 'Entry must be a relative .mjs module');
  assert(stamp(p.updatedAt), 'Invalid update timestamp');
  keys(p.review,['status','reviewer']);
  assert(p.review.status === 'approved' && p.review.reviewer === 'SikeFix', 'Maintainer approval required');
  assert(Array.isArray(p.dependencies), 'Dependencies must be declared, including an empty list');
  const names = new Set(), files = new Set();
  for (const d of p.dependencies) {
    keys(d,['name','version','license','files']);
    assert(str(d.name,150) && version(d.version) && str(d.license,80) && !names.has(d.name), 'Invalid or duplicate dependency'); names.add(d.name);
    keys(d.files,Object.keys(d.files)); assert(Object.keys(d.files).length, 'Dependency files required');
    for (const [path, sum] of Object.entries(d.files)) { safePath(path); assert(path.startsWith('vendor/') && hash(sum) && !files.has(path), 'Invalid dependency file'); files.add(path); }
  }
  return p;
}
export function validateCatalog(c) {
  keys(c,['catalogVersion','generatedAt','source','plugins']);
  assert(c.catalogVersion === 1 && stamp(c.generatedAt) && c.source === `https://github.com/${REPO}` && Array.isArray(c.plugins) && c.plugins.length <= 500, 'Invalid catalog');
  const ids = new Set();
  for (const p of c.plugins) { validateManifest(p); assert(!ids.has(p.id), 'Duplicate plugin ID'); ids.add(p.id); }
  return c;
}
export function compare(a,b) { const pa=String(a).split('-')[0].split('.').map(Number), pb=String(b).split('-')[0].split('.').map(Number); for(let i=0;i<3;i++){ if((pa[i]||0)!==(pb[i]||0)) return (pa[i]||0)-(pb[i]||0); } return 0; }
export function compatible(p, platform, appVersion) {
  return p.platforms.includes(platform) && compare(appVersion,p.minAppVersion) >= 0 && (!p.maxAppVersion || compare(appVersion,p.maxAppVersion) <= 0);
}
export function newer(a,b) { return compare(a,b) > 0; }
export function releaseURL(p) { return `${p.repository}/releases/download/${encodeURIComponent(p.release.tag)}/${encodeURIComponent(p.release.asset)}`; }
// This is a review aid for trusted code, NOT a sandbox or proof of harmlessness.
export function validateBundle(bytes, p, {checksum = true} = {}) {
  assert(bytes.length <= MAX_BYTES, 'Plugin bundle is too large');
  if (checksum) assert(digest(bytes) === p.release.sha256, 'SHA-256 mismatch; installation refused');
  const bundle = JSON.parse(bytes.toString('utf8'));
  keys(bundle,['format','id','version','entry','permissions','files']);
  assert(bundle.format === 1 && bundle.id === p.id && bundle.version === p.version && bundle.entry === p.entry && JSON.stringify(bundle.permissions) === JSON.stringify(p.permissions), 'Bundle/manifest mismatch');
  keys(bundle.files,Object.keys(bundle.files));
  const paths = Object.keys(bundle.files); assert(paths.length > 0 && paths.length <= 500, 'Invalid bundle file count');
  const folded = new Set();
  for (const file of paths) {
    safePath(file); assert(!folded.has(file.toLowerCase()), 'Case-colliding path'); folded.add(file.toLowerCase());
    assert(typeof bundle.files[file] === 'string' && /\.(mjs|json|md|txt)$/.test(file), 'Only text ESM bundles supported');
    assert(!file.endsWith('package.json'), 'Package manifests/install scripts are not allowed inside bundles');
    if (file.endsWith('.json')) JSON.parse(bundle.files[file]);
  }
  assert(Object.hasOwn(bundle.files,p.entry) && paths.some(f => /(^|\/)LICENSE\.(txt|md)$/i.test(f)), 'Entry and license file required');
  const vendor = new Set();
  for (const dep of p.dependencies) for (const [f,sum] of Object.entries(dep.files)) {
    assert(Object.hasOwn(bundle.files,f) && digest(bundle.files[f]) === sum, `Missing or modified dependency: ${dep.name}`); vendor.add(f);
  }
  for (const f of paths) if (f.startsWith('vendor/')) assert(vendor.has(f), 'Undeclared vendored dependency');
  const imports = new Map();
  const pure = new Set(['node:path','node:url','node:util','node:crypto','node:buffer','node:assert','node:assert/strict']);
  for (const file of paths.filter(f => f.endsWith('.mjs'))) {
    const source = bundle.files[file]; const refs=[];
    assert(!/\b(import\s*\(|eval\s*\(|new\s+Function\s*\(|WebAssembly\b|require\s*\(|process\.)/.test(source), `Forbidden code capability in ${file}`);
    assert(!/(^|[\"'`])(?:file:\/|\/etc\/|[A-Za-z]:\\|~\/)/m.test(source), 'Absolute file paths require manual redesign');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'\"]+?\s+from\s+)?['\"]([^'\"]+)['\"]/g)) refs.push(match[1]);
    for (const spec of refs) {
      if (spec.startsWith('./') || spec.startsWith('../')) { const target = posix.normalize(posix.join(posix.dirname(file),spec)); safePath(target); assert(Object.hasOwn(bundle.files,target), `Missing import ${spec} in ${file}`); }
      else if (['node:fs','node:fs/promises'].includes(spec)) assert(p.permissions.includes('workspace-read') || p.permissions.includes('workspace-write'), 'Undeclared filesystem permission');
      else if (['node:http','node:https','node:net','node:dns','node:tls'].includes(spec)) assert(p.permissions.includes('network'), 'Undeclared network permission');
      else assert(pure.has(spec), `Unreviewed import: ${spec}`);
    }
    if (/\b(fetch|WebSocket)\b/.test(bundle.files[file])) assert(p.permissions.includes('network'),'Undeclared network permission');
    if (/\b(writeFile|appendFile|unlink|rmdir|mkdir|rename|rm|createWriteStream)\b/.test(bundle.files[file])) assert(p.permissions.includes('workspace-write'),'Undeclared write permission');
    imports.set(file,refs);
  }
  return bundle;
}
