const fs = require('node:fs');
const path = require('node:path');

function removeIfPresent(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function removeDebugSymbols(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) removeDebugSymbols(target);
    else if (entry.name.toLowerCase().endsWith('.pdb')) fs.rmSync(target, { force: true });
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const modules = path.join(context.appOutDir, 'resources', 'runtime', 'dsh', 'node_modules');
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'win32-arm64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'darwin-arm64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'darwin-x64'));
  removeDebugSymbols(path.join(modules, 'node-pty', 'prebuilds', 'win32-x64'));
};
