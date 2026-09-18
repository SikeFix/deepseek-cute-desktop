import assert from 'node:assert/strict';
import {digest, validateBundle, validateCatalog, validateManifest} from '../shared/market-engine/validate.mjs';

const files = {'main.mjs': 'export const apply = () => {};', 'LICENSE.md': 'MIT'};
const permissions = [];
const bundle = {format: 1, id: 'demo-plugin', version: '1.0.0', entry: 'main.mjs', permissions, files};
const bytes = Buffer.from(JSON.stringify(bundle));
const manifest = {
  id: 'demo-plugin', version: '1.0.0', name: {'zh-CN': '演示插件', en: 'Demo Plugin'}, description: {'zh-CN': '演示', en: 'Demo'},
  author: 'SikeFix', repository: 'https://github.com/SikeFix/demo-plugin', sourceCommit: '0123456789012345678901234567890123456789',
  release: {tag: 'v1.0.0', asset: 'demo.plugin.json', sha256: digest(bytes)}, platforms: ['windows-x64', 'macos-arm64'],
  minAppVersion: '1.8.1', kernelVersion: '0.1.5-rc.2', permissions, license: 'MIT', manifest: 'plugin.json', entry: 'main.mjs', dependencies: [],
  review: {status: 'approved', reviewer: 'SikeFix'}, updatedAt: '2026-09-18T00:00:00Z'
};
validateManifest(manifest);
validateCatalog({catalogVersion: 1, generatedAt: '2026-09-18T00:00:00Z', source: 'https://github.com/SikeFix/deepseek-cute-desktop', plugins: [manifest]});
validateBundle(bytes, manifest);
assert.throws(() => validateBundle(Buffer.from(JSON.stringify({...bundle, files: {...files, 'bad.mjs': 'import x from "node:child_process"'}})), manifest, {checksum: false}), /Unreviewed import|Forbidden/);
assert.throws(() => validateBundle(Buffer.from(JSON.stringify({...bundle, permissions: ['network']})), manifest, {checksum: false}), /Bundle\/manifest mismatch/);
console.log('PASS: plugin market manifest, bundle, checksum and capability checks');
