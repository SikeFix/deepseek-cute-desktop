const fs = require('node:fs');
const path = require('node:path');

// 打包后瘦身: 删除 dsh node_modules 里与 win32-x64 运行无关的文件,
// 直接减小 NSIS 安装体积(源码映射/测试/文档/其它平台的原生预编译)。

const PRUNE_DIR_NAMES = new Set([
  'test', 'tests', '__tests__', '__test__', 'spec', 'specs',
  'examples', 'example', 'docs', 'doc', '.github', '.vscode',
  'bench', 'benchmark', 'coverage', '.vite', '.cache', 'fixture', 'fixtures'
]);

// 只删确定与运行无关的文件: 源码映射 + 文档 + 编辑器配置。
// 不碰 .json/.txt/.yml 等 —— 有些包在运行时读取数据文件。
const PRUNE_FILE_EXTENSIONS = new Set([
  '.map', '.md', '.markdown', '.rst',
  '.gitignore', '.npmignore', '.eslintrc', '.prettierrc', '.flowconfig', '.editorconfig'
]);

function removeIfPresent(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function dirSize(directory) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) { return total; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else { try { total += fs.statSync(full).size; } catch (_) {} }
  }
  return total;
}

function removeDebugSymbols(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) removeDebugSymbols(target);
    else if (entry.name.toLowerCase().endsWith('.pdb')) fs.rmSync(target, { force: true });
  }
}

let removedBytes = 0;

function pruneTree(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIR_NAMES.has(entry.name)) {
        removedBytes += dirSize(full);
        removeIfPresent(full);
        continue;
      }
      pruneTree(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name.toLowerCase());
      if (entry.name === 'LICENSE' || entry.name === 'NOTICE') continue;
      if (PRUNE_FILE_EXTENSIONS.has(ext)) {
        try {
          removedBytes += fs.statSync(full).size;
          fs.rmSync(full, { force: true });
        } catch (_) {}
      }
    }
  }
}

function prunePlatformPackages(modules) {
  // @esbuild: 只留 win32-x64
  const esbuildDir = path.join(modules, '@esbuild');
  if (fs.existsSync(esbuildDir)) {
    for (const entry of fs.readdirSync(esbuildDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'win32-x64') {
        removedBytes += dirSize(path.join(esbuildDir, entry.name));
        removeIfPresent(path.join(esbuildDir, entry.name));
      }
    }
  }
  // @img(sharp 原生预编译): 留 win32-x64 与 wasm 兜底
  const imgDir = path.join(modules, '@img');
  if (fs.existsSync(imgDir)) {
    for (const entry of fs.readdirSync(imgDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'sharp-win32-x64' || entry.name === 'sharp-libvips-win32-x64' || entry.name.includes('wasm')) continue;
      removedBytes += dirSize(path.join(imgDir, entry.name));
      removeIfPresent(path.join(imgDir, entry.name));
    }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const modules = path.join(context.appOutDir, 'resources', 'runtime', 'dsh', 'node_modules');
  if (!fs.existsSync(modules)) return;

  // node-pty 预编译: 只留 win32-x64 并去符号
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'win32-arm64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'darwin-arm64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'darwin-x64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'linux-arm64'));
  removeIfPresent(path.join(modules, 'node-pty', 'prebuilds', 'linux-x64'));
  removeDebugSymbols(path.join(modules, 'node-pty', 'prebuilds', 'win32-x64'));

  prunePlatformPackages(modules);
  pruneTree(modules);

  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
  const log = context.log || globalThis.console;
  log.info(`[after-pack] pruned ${mb(removedBytes)} from dsh node_modules`);
};
