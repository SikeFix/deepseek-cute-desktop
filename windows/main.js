const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  safeStorage,
  Tray,
  nativeImage,
  screen,
  shell
} = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const APP_URL = 'http://127.0.0.1:3080';
const APP_NAME = 'DeepSeek Cute';
const APP_ID = 'com.sikefix.deepseek.cute.windows';
const STARTED_AT = Date.now();

let mainWindow;
let petWindow;
let tray;
let providerWindow;
let backendProcess;
let backendStarting = false;
let backendLogStream;
let backendRestartAttempts = 0;
let lastBackendExit = '';
let lastBackendError = '';
let healthTimer;
let updateTimer;
let healthFailures = 0;
let quitting = false;
let taskBusy = false;
let taskStartedAt = 0;
let lastTaskTitle = '当前任务';
let lastTaskURL = APP_URL;
let petState = { mood: 'thinking', text: '正在启动服务…', color: '#f5dc26' };
let dragState;
let serviceStatus = { state: 'starting', message: '正在准备本地服务…' };
let updateStatus = { state: 'idle', message: `当前版本 ${app.getVersion()}`, percent: 0 };
let insertedThemeCSS;
let themeMode = 'cute';
const PROVIDER_WIZARD_VERSION = '2026-09-v5-ssnh';
const QWEN_ENDPOINT = 'https://www.ssnh.top/v1';
const WEBSITE_URL = 'https://www.ssnh.top';
const BUILTIN_THEMES = [
  { id: 'official', label: '官方样式' },
  { id: 'cute', label: '正太主题' },
  { id: 'aurora', label: '暗夜极光' },
  { id: 'paper', label: '奶油纸感' },
  { id: 'deepsea', label: '深海鲸语' }
];

const resourcePath = (...parts) => path.join(app.isPackaged ? process.resourcesPath : __dirname, ...parts);
const petPositionPath = () => path.join(app.getPath('userData'), 'pet-position.json');
const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');
const providerSecretPath = () => path.join(app.getPath('userData'), 'provider-secret.json');
const backendLogPath = () => path.join(app.getPath('userData'), 'backend.log');

function readJSON(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return fallback; }
}

function writeJSON(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function preferences() {
  return readJSON(preferencesPath(), {});
}

function updatePreferences(patch) {
  writeJSON(preferencesPath(), { ...preferences(), ...patch });
}

// ---------- 主题(内置 5 套 + 用户自定义) ----------
// 自定义主题保存在用户目录(<userData>/Themes), 应用更新只替换安装目录,
// 因此用户主题与自定义吉祥物不会因升级丢失。

function themesDir() {
  const dir = path.join(app.getPath('userData'), 'Themes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function customTheme(id) {
  const obj = readJSON(path.join(themesDir(), `${id}.json`), null);
  if (!obj || typeof obj.css !== 'string' || !obj.css) return null;
  return obj;
}

function customThemes() {
  let entries = [];
  try { entries = fs.readdirSync(themesDir()); } catch (_) { return []; }
  const themes = entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(themesDir(), f), null))
    .filter((t) => t && typeof t.css === 'string' && t.css);
  themes.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return themes;
}

function saveCustomTheme(theme) {
  const id = String(theme.id || '').trim();
  if (!id || typeof theme.css !== 'string' || !theme.css) return null;
  const safe = id.replace(/[\\/]/g, '-');
  try {
    writeJSON(path.join(themesDir(), `${safe}.json`), { ...theme, id: safe, createdAt: theme.createdAt || Date.now() });
    return safe;
  } catch (_) {
    return null;
  }
}

function removeCustomTheme(id) {
  const file = path.join(themesDir(), `${id}.json`);
  if (!fs.existsSync(file)) return false;
  try { fs.rmSync(file); return true; } catch (_) { return false; }
}

function themeList() {
  const list = BUILTIN_THEMES.slice();
  for (const t of customThemes()) list.push({ id: t.id, label: t.name || t.id });
  return list;
}

function isValidTheme(id) {
  return id === 'official'
    || BUILTIN_THEMES.some((t) => t.id === id)
    || customTheme(id) !== null;
}

function loadThemeCSS(id) {
  if (id === 'official') return '';
  const custom = customTheme(id);
  if (custom) return custom.css;
  const file = id === 'cute'
    ? resourcePath('theme', 'theme.css')
    : resourcePath('theme', 'Themes', `${id}.css`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function qwenAPIKey() {
  try {
    const payload = readJSON(providerSecretPath(), {});
    if (!payload.qwen || !safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(payload.qwen, 'base64'));
  } catch (error) {
    log.warn('[provider] unable to decrypt Qwen credential', error.message);
    return '';
  }
}

function saveQwenAPIKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储当前不可用');
  const encrypted = safeStorage.encryptString(apiKey).toString('base64');
  writeJSON(providerSecretPath(), { qwen: encrypted });
}

function runProviderConfig({ provider, endpoint, model }) {
  const nodeExe = resourcePath('runtime', 'node', 'node.exe');
  const script = resourcePath('provider', 'provider-config.mjs');
  const modules = resourcePath('runtime', 'dsh', 'node_modules');
  const args = [script, '--modules', modules, '--provider', provider];
  if (endpoint) args.push('--baseURL', endpoint);
  if (model) args.push('--model', model);
  const result = spawnSync(nodeExe, args, {
    cwd: app.getPath('home'),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || '模型配置写入失败').trim());
  log.info(`[provider] configured provider=${provider}`);
}

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'info';

function elapsed() {
  return `${Date.now() - STARTED_AT}ms`;
}

function sendRendererStatus(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function formatDuration(milliseconds) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`;
}

// 清理占用 3080 端口的残留后端(上次异常退出/重复启动)。不清理会导致
// EADDRINUSE → 新进程起不来, 旧进程还在跑, 内存翻倍、状态错乱。
function killStalePortListeners() {
  try {
    const result = spawnSync('netstat', ['-ano'], { windowsHide: true, encoding: 'utf8', timeout: 6000 });
    if (result.status !== 0 || !result.stdout) return;
    const stale = new Set();
    for (const line of result.stdout.split(/\r?\n/)) {
      const m = line.match(/TCP\s+127\.0\.0\.1:3080\s+\S+\s+LISTENING\s+(\d+)/);
      if (m && Number(m[1]) !== process.pid) stale.add(m[1]);
    }
    for (const pid of stale) {
      spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true, timeout: 6000 });
      log.warn(`[backend] killed stale port 3080 listener pid=${pid}`);
    }
  } catch (error) {
    log.warn('[backend] stale port cleanup failed', error.message);
  }
}

function checkOnline() {
  return new Promise((resolve) => {
    const request = http.request(APP_URL, { method: 'HEAD', timeout: 1400 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end();
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForBackendReady(maxAttempts = 60) {
  for (let attempt = 1; attempt <= maxAttempts && !quitting; attempt += 1) {
    if (await checkOnline()) {
      healthFailures = 0;
      backendRestartAttempts = 0;
      publishServiceStatus('online');
      loadMainURL();
      log.info(`[startup ${elapsed()}] backend ready after ${attempt} fast checks`);
      return true;
    }
    if (attempt % 8 === 0) {
      publishServiceStatus('starting', `本地服务正在初始化… ${Math.ceil(attempt / 4)}秒`);
    }
    await delay(250);
  }
  publishServiceStatus('offline', '服务启动超时，可点击重试或打开诊断日志');
  return false;
}

function setPetState(mood, text, color) {
  petState = { mood, text, color };
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-state', petState);
  }
}

function publishServiceStatus(status, message) {
  const messages = {
    online: '本地 DeepSeek 服务已连接',
    starting: '正在启动本地 DeepSeek 服务…',
    offline: '本地服务暂时不可用'
  };
  const next = { state: status, message: message || messages[status] || messages.offline };
  const changed = serviceStatus.state !== next.state || serviceStatus.message !== next.message;
  if (changed) log.info(`[startup ${elapsed()}] service=${next.state} ${next.message}`);
  serviceStatus = next;
  // 健康探测每 5 秒一次, 状态没变化时不向渲染进程推送,
  // 避免在主页面繁忙时反复 executeJavaScript 造成卡顿。
  if (!changed) return;
  sendRendererStatus('service-status', serviceStatus);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      `window.__dsmSetServiceStatus && window.__dsmSetServiceStatus(${JSON.stringify(status)})`
    ).catch(() => {});
  }
  if (taskBusy) return;
  if (status === 'online') setPetState('idle', 'DeepSeek 已连接', '#55d8c2');
  else if (status === 'starting') setPetState('thinking', '正在启动服务…', '#f5dc26');
  else setPetState('error', '服务异常 · 点我重试', '#fb684f');
}

function publishUpdateStatus(state, message, percent = updateStatus.percent || 0) {
  const nextPercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const stateChanged = updateStatus.state !== state;
  const progressStepChanged = Math.floor(nextPercent / 10) !== Math.floor((updateStatus.percent || 0) / 10);
  updateStatus = { state, message, percent: nextPercent };
  if (stateChanged || progressStepChanged) log.info(`[update] ${state} ${nextPercent}% ${message}`);
  sendRendererStatus('update-status', updateStatus);
}

let manualUpdateCheck = false;

async function checkForUpdates(manual = false) {
  if (!app.isPackaged || process.platform !== 'win32') {
    publishUpdateStatus('disabled', '开发模式不执行在线更新');
    return;
  }
  manualUpdateCheck = manual;
  publishUpdateStatus('checking', '正在连接 GitHub 检查更新…', 0);
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[update] check failed', error);
    publishUpdateStatus('error', '更新检查失败，可稍后重试', 0);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    publishUpdateStatus('checking', '正在连接 GitHub 检查更新…', 0);
  });
  autoUpdater.on('update-available', (info) => {
    publishUpdateStatus('available', `发现 ${info.version}，正在后台下载…`, 0);
  });
  autoUpdater.on('update-not-available', () => {
    publishUpdateStatus('current', `已是最新版 ${app.getVersion()}`, 100);
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: APP_NAME,
        message: '已经是最新版',
        detail: `当前版本 ${app.getVersion()}`
      }).catch(() => {});
    }
    manualUpdateCheck = false;
  });
  autoUpdater.on('download-progress', (progress) => {
    const speed = progress.bytesPerSecond > 0
      ? `${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
      : '正在下载';
    publishUpdateStatus('downloading', `正在下载更新 · ${speed}`, progress.percent);
  });
  autoUpdater.on('update-downloaded', async (info) => {
    publishUpdateStatus('ready', `${info.version} 已下载，等待安装`, 100);
    const notice = Notification.isSupported() ? new Notification({
      title: 'DeepSeek Cute 更新已准备好',
      body: `版本 ${info.version} 已下载，点击即可安装。`,
      icon: resourcePath('assets', 'icon.png')
    }) : null;
    notice?.on('click', () => showMain());
    notice?.show();

    if (!mainWindow || mainWindow.isDestroyed()) return;
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下载',
      message: `DeepSeek Cute ${info.version} 已准备好`,
      detail: '现在安装会保存本地配置，关闭应用并自动重新启动。',
      buttons: ['立即更新并重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) {
      quitting = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on('error', (error) => {
    log.error('[update] updater error', error);
    publishUpdateStatus('error', '联网更新暂时失败，可点击重试', 0);
    manualUpdateCheck = false;
  });

  setTimeout(() => checkForUpdates(false), 8000);
  updateTimer = setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

// ---------- 诊断信息(复制/保存, 供开发者定位问题) ----------

function tailLines(filePath, maxLines, maxChars = 60000) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    let text = lines.slice(-maxLines).join('\n');
    if (text.length > maxChars) text = text.slice(-maxChars);
    return text || '(空)';
  } catch (_) {
    return '(无法读取)';
  }
}

// 脱敏: 诊断内容绝不包含任何 API 密钥(即使内核把 env 打到日志里)
function sanitizeDiagnostics(text) {
  return text
    .split('\n')
    .filter((line) => !/sk-[A-Za-z0-9_-]{8,}/.test(line) && !/api[_-]?key\s*[=:]\s*\S/i.test(line))
    .join('\n');
}

function lastBackendErrorLine() {
  try {
    const raw = fs.readFileSync(backendLogPath(), 'utf8');
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
      if (/exit code=/.test(lines[i])) continue;
      if (/error|E[A-Z]{2,4}S?|MODULE_NOT_FOUND|Uncaught|Unhandled/i.test(lines[i])) return lines[i].slice(0, 300);
    }
    return (lines[lines.length - 1] || '').slice(0, 300);
  } catch (_) {
    return '';
  }
}

function buildDiagnostics() {
  const header = [
    'DeepSeek Cute 诊断信息',
    '==================',
    `平台: ${process.platform} ${process.arch}`,
    `系统: ${os.type()} ${os.release()} (node ${process.versions.node})`,
    `应用版本: ${app.getVersion()}`,
    `服务状态: ${serviceStatus.state} - ${serviceStatus.message}`,
    `后端: ${backendProcess && !backendProcess.killed ? '运行中' : '已停止'}${lastBackendExit ? `，最近退出 ${lastBackendExit}` : ''}`,
    `用户数据目录: ${app.getPath('userData')}`
  ].join('\n');
  const backendSection = `\n\n---- backend.log(最近 300 行, 内核真实报错在这里) ----\n${tailLines(backendLogPath(), 300)}`;
  let mainSection = '';
  try { mainSection = `\n\n---- main.log(最近 150 行) ----\n${tailLines(log.transports.file.getFile().path, 150)}`; } catch (_) {}
  return sanitizeDiagnostics(header + backendSection + mainSection);
}

function copyDiagnostics() {
  try {
    const text = buildDiagnostics();
    clipboard.writeText(text);
    // 同时落一份到用户数据目录, 方便直接发文件
    const stamp = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 12);
    const file = path.join(app.getPath('userData'), `diagnostics-${stamp}.txt`);
    fs.writeFileSync(file, text, { mode: 0o600 });
    log.info(`[diagnostics] copied to clipboard, saved ${file}`);
    return file;
  } catch (error) {
    log.error('[diagnostics] failed', error);
    return '';
  }
}

async function startBackend() {
  if ((backendProcess && !backendProcess.killed) || backendStarting) return;
  backendStarting = true;
  publishServiceStatus('starting', '正在检测本地 DeepSeek 服务…');
  if (await checkOnline()) {
    backendStarting = false;
    publishServiceStatus('online');
    loadMainURL();
    return;
  }

  const nodeExe = resourcePath('runtime', 'node', 'node.exe');
  const dshBin = resourcePath('runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (!fs.existsSync(nodeExe) || !fs.existsSync(dshBin)) {
    backendStarting = false;
    publishServiceStatus('offline');
    showWaiting('内置运行组件不完整，请重新下载应用。');
    return;
  }

  publishServiceStatus('starting', '组件已就绪，正在启动本地服务…');
  killStalePortListeners();
  backendLogStream = fs.createWriteStream(backendLogPath(), { flags: 'a' });
  // --max-old-space-size: 限制后端 V8 堆, 防止长会话内存无上限增长触发
  // 长 GC 停顿(表现为界面一卡一卡); --no-open: 内核启动/自动重启时
  // 不再弹出系统浏览器窗口。
  const backendArgs = ['--max-old-space-size=1024', dshBin, 'web', '--no-open'];
  backendLogStream.write(`\n[${new Date().toISOString()}] starting ${nodeExe} ${backendArgs.join(' ')}\n`);
  try {
    backendProcess = spawn(nodeExe, backendArgs, {
      cwd: app.getPath('home'),
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...(qwenAPIKey() ? { QWEN_API_KEY: qwenAPIKey() } : {}),
        PATH: `${path.dirname(nodeExe)};${process.env.PATH || ''}`
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    backendStarting = false;
    backendLogStream.end(`\n[${new Date().toISOString()}] spawn failed: ${error.message}\n`);
    backendLogStream = undefined;
    log.error('[backend] spawn failed', error);
    publishServiceStatus('offline', '本地服务启动失败，请打开诊断日志');
    return;
  }
  backendStarting = false;
  backendProcess.stdout.pipe(backendLogStream, { end: false });
  backendProcess.stderr.pipe(backendLogStream, { end: false });
  log.info(`[startup ${elapsed()}] backend spawned pid=${backendProcess.pid}`);
  waitForBackendReady().catch((error) => log.error('[backend] readiness check failed', error));

  backendProcess.once('error', (error) => {
    log.error('[backend] spawn error', error);
    backendLogStream?.end(`\n[${new Date().toISOString()}] spawn error: ${error.message}\n`);
    backendLogStream = undefined;
    backendProcess = undefined;
    publishServiceStatus('offline');
  });
  backendProcess.once('exit', (code, signal) => {
    log.warn(`[backend] exit code=${code} signal=${signal} restartAttempt=${backendRestartAttempts}`);
    lastBackendExit = `code=${code} signal=${signal}`;
    // 退出前先抓最后一段报错, 供等待页与诊断信息展示
    lastBackendError = code === 0 ? '' : lastBackendErrorLine();
    backendLogStream?.end(`\n[${new Date().toISOString()}] exit code=${code} signal=${signal}\n`);
    backendLogStream = undefined;
    backendProcess = undefined;
    if (!quitting) {
      // 指数退避重启: 1.5s → 3s → 6s → 12s → 30s 封顶。连续崩溃时不再
      // 每 1.4 秒拉一次(旧行为), 避免崩溃循环占满 CPU 与内存。
      backendRestartAttempts += 1;
      const backoff = Math.min(1500 * 2 ** Math.min(backendRestartAttempts - 1, 4), 30000);
      publishServiceStatus('offline', '本地服务异常退出，正在自动恢复…');
      setTimeout(() => checkHealth(true), backoff);
    }
  });
}

async function checkHealth(recover = true) {
  const online = await checkOnline();
  if (online) {
    healthFailures = 0;
    publishServiceStatus('online');
    const currentURL = mainWindow?.webContents.getURL() || '';
    if (!currentURL.startsWith(APP_URL)) loadMainURL();
    return;
  }

  healthFailures += 1;
  publishServiceStatus(backendProcess ? 'starting' : 'offline');
  if (recover && !quitting && !backendProcess) startBackend();
  if (healthFailures > 10) showWaiting('正在恢复本地 DeepSeek 服务…');
}

function showWaiting(message = '正在等待本地 DeepSeek 服务启动…') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const error = lastBackendError ? `内核最后报错：${lastBackendError}` : '';
  mainWindow.loadFile(path.join(__dirname, 'waiting.html'), { query: { message, error } }).catch(() => {});
}

function loadMainURL(url = APP_URL) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeURL = new URL(url, APP_URL);
  if (!['127.0.0.1', 'localhost'].includes(safeURL.hostname)) return;
  mainWindow.loadURL(safeURL.href).catch(() => showWaiting());
}

async function applyThemeMode(mode, persist = true) {
  if (!isValidTheme(mode)) mode = 'cute';
  themeMode = mode;
  if (persist) updatePreferences({ themeMode });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (insertedThemeCSS) {
    try { await mainWindow.webContents.removeInsertedCSS(insertedThemeCSS); } catch (_) {}
    insertedThemeCSS = undefined;
  }
  const css = loadThemeCSS(themeMode);
  if (css && mainWindow.webContents.getURL().startsWith(APP_URL)) {
    insertedThemeCSS = await mainWindow.webContents.insertCSS(css).catch(() => undefined);
  }
  // dataset 用具体主题 ID(内置 aurora/paper/deepsea 或 custom-*),
  // __dsmThemeMode 只区分 official/cute(交互层: 波纹/指针光效仅在 cute 系生效)。
  const normalized = themeMode === 'official' ? 'official' : 'cute';
  const mascot = customTheme(themeMode)?.mascot || '';
  mainWindow.webContents.executeJavaScript(
    `document.documentElement.dataset.dsmTheme=${JSON.stringify(themeMode)};` +
    `window.__dsmThemeMode=${JSON.stringify(normalized)};` +
    `window.__dsmMascotURL=${JSON.stringify(mascot)};` +
    `window.__dsmWindowsThemeChanged&&window.__dsmWindowsThemeChanged(${JSON.stringify(themeMode)});` +
    `window.__dsmApplyMascot&&window.__dsmApplyMascot(${JSON.stringify(mascot)});`
  ).catch(() => {});
  syncMascotAssets(mascot);
  refreshTrayMenu();
}

// ---------- 快捷操作(键盘快捷键 / 托盘菜单共用) ----------

function runInPage(code) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(undefined);
  return mainWindow.webContents.executeJavaScript(code).catch(() => undefined);
}

function pageToast(message) {
  runInPage(`window.__dsmToast&&window.__dsmToast(${JSON.stringify(message)});`);
}

async function copyConversationMarkdown() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const md = await mainWindow.webContents.executeJavaScript(
      "window.__dsmConversationMarkdown ? window.__dsmConversationMarkdown() : ''");
    if (typeof md !== 'string' || !md) {
      pageToast('当前没有可复制的会话');
      return;
    }
    clipboard.writeText(md);
    pageToast('对话已复制为 Markdown');
  } catch (error) {
    log.warn('[export] copy conversation failed', error);
  }
}

function cycleThemeMode() {
  const list = themeList();
  if (!list.length) return;
  const index = Math.max(0, list.findIndex((t) => t.id === themeMode));
  applyThemeMode(list[(index + 1) % list.length].id);
}

function triggerNewSession() {
  runInPage("window.__dsmNewSession&&window.__dsmNewSession();");
}

// 把激活主题的自定义吉祥物同步给桌面宠物与托盘图标(与 macOS 行为一致)
function syncMascotAssets(mascot) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-mascot', mascot || '');
  }
  if (!tray) return;
  try {
    if (mascot && mascot.startsWith('data:image')) {
      const img = nativeImage.createFromDataURL(mascot);
      if (!img.isEmpty()) {
        tray.setImage(img.resize({ width: 20, height: 20 }));
        return;
      }
    }
    tray.setImage(nativeImage.createFromPath(resourcePath('assets', 'icon.png')).resize({ width: 20, height: 20 }));
  } catch (_) {}
}

async function injectTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentURL = mainWindow.webContents.getURL();
  if (!currentURL.startsWith(APP_URL)) return;
  const interactions = fs.readFileSync(resourcePath('theme', 'interactions.js'), 'utf8');
  const windowsChrome = fs.readFileSync(path.join(__dirname, 'window-inject.js'), 'utf8');
  const savedTheme = preferences().themeMode;
  themeMode = isValidTheme(savedTheme) ? savedTheme : 'cute';
  await mainWindow.webContents.executeJavaScript(`window.__dsmThemeMode=${JSON.stringify(themeMode === 'official' ? 'official' : 'cute')}`).catch(() => {});
  await applyThemeMode(themeMode, false);
  mainWindow.webContents.executeJavaScript(interactions).catch(() => {});
  mainWindow.webContents.executeJavaScript(windowsChrome).catch(() => {});
  // 会话导出层: 复制对话 Markdown / 新建会话 / 首次快捷键提示
  const exportJS = fs.readFileSync(path.join(__dirname, 'conversation-export.js'), 'utf8');
  mainWindow.webContents.executeJavaScript(exportJS).catch(() => {});
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 660,
    frame: false,
    show: true,
    backgroundColor: '#17191a',
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    log.info(`[startup ${elapsed()}] renderer ready ${mainWindow.webContents.getURL()}`);
    sendRendererStatus('service-status', serviceStatus);
    sendRendererStatus('update-status', updateStatus);
    injectTheme();
  });
  mainWindow.webContents.on('did-fail-load', () => showWaiting());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      if (!['127.0.0.1', 'localhost'].includes(target.hostname) && target.protocol !== 'file:') {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (_) {}
  });
  // 应用内键盘快捷键: Ctrl+K 新建会话 / Ctrl+Shift+C 复制对话 / Ctrl+T 切主题
  // / Ctrl+, 模型设置 / Ctrl+Shift+S Token 统计。用 before-input-event 在
  // 页面处理前拦截, 不抢占系统全局焦点(与 macOS 菜单快捷键行为一致)。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown' || !input.control) return;
    const key = String(input.key || '').toLowerCase();
    const shift = Boolean(input.shift);
    if (key === 'k' && !shift) {
      event.preventDefault();
      triggerNewSession();
    } else if (key === 'c' && shift) {
      event.preventDefault();
      copyConversationMarkdown();
    } else if (key === 't' && !shift) {
      event.preventDefault();
      cycleThemeMode();
    } else if (key === ',') {
      event.preventDefault();
      showModelProviderWizard();
    } else if (key === 's' && shift) {
      event.preventDefault();
      showStatsWindow();
    }
  });
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  showWaiting();
}

function clampPetPosition(x, y) {
  const bounds = { x: Math.round(x), y: Math.round(y), width: 184, height: 194 };
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    x: Math.min(Math.max(bounds.x, area.x - 14), area.x + area.width - bounds.width + 14),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height)
  };
}

function initialPetPosition() {
  try {
    const saved = JSON.parse(fs.readFileSync(petPositionPath(), 'utf8'));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPetPosition(saved.x, saved.y);
  } catch (_) {}
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - 210, y: area.y + area.height - 224 };
}

function savePetPosition() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { x, y } = petWindow.getBounds();
  fs.writeFile(petPositionPath(), JSON.stringify({ x, y }), () => {});
}

function createPetWindow() {
  const position = initialPetPosition();
  petWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: 184,
    height: 194,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.once('ready-to-show', () => petWindow.showInactive());
  petWindow.webContents.on('did-finish-load', () => {
    setPetState(petState.mood, petState.text, petState.color);
    petWindow.webContents.send('pet-mascot', customTheme(themeMode)?.mascot || '');
  });
  petWindow.on('moved', savePetPosition);
}

function showMain(taskURL) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (taskURL) loadMainURL(taskURL);
}

function showCompletionNotification(title, duration, taskURL) {
  if (!Notification.isSupported()) return;
  const notice = new Notification({
    title: 'DeepSeek · 任务完成',
    subtitle: title,
    body: `${title} · 用时 ${formatDuration(duration)}`,
    icon: resourcePath('assets', 'icon.png'),
    silent: false
  });
  notice.on('click', () => showMain(taskURL));
  notice.show();
}

function showModelProviderWizard() {
  if (providerWindow && !providerWindow.isDestroyed()) {
    providerWindow.show();
    providerWindow.focus();
    return;
  }
  providerWindow = new BrowserWindow({
    width: 560,
    height: 610,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow,
    modal: true,
    show: false,
    title: '模型服务设置',
    backgroundColor: '#fff9ee',
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'model-setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  providerWindow.removeMenu();
  providerWindow.loadFile(path.join(__dirname, 'model-setup.html'), {
    query: { endpoint: QWEN_ENDPOINT, model: 'qwen3.8-27b' }
  });
  providerWindow.once('ready-to-show', () => providerWindow?.show());
  providerWindow.on('closed', () => { providerWindow = undefined; });
}

// ---------- 主题工坊(自定义主题: 颜色/壁纸/文案/吉祥物) ----------

let studioWindow;

function showThemeStudioWindow() {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    return;
  }
  const htmlFile = path.join(__dirname, 'theme-studio.html');
  if (!fs.existsSync(htmlFile)) {
    dialog.showErrorBox(APP_NAME, '主题工坊不可用，应用组件不完整，请重新安装最新版。');
    return;
  }
  studioWindow = new BrowserWindow({
    width: 1040,
    height: 800,
    minWidth: 860,
    minHeight: 620,
    title: '主题工坊',
    show: false,
    backgroundColor: '#17191a',
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'studio-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  studioWindow.removeMenu();
  studioWindow.loadFile(htmlFile);
  studioWindow.once('ready-to-show', () => studioWindow?.show());
  studioWindow.on('closed', () => { studioWindow = undefined; });
}

function studioReply(replyID, result) {
  if (!replyID || !studioWindow || studioWindow.isDestroyed()) return;
  studioWindow.webContents.executeJavaScript(
    `window.__dsmStudioReplies&&window.__dsmStudioReplies[${JSON.stringify(replyID)}]` +
    `&&(window.__dsmStudioReplies[${JSON.stringify(replyID)}](${JSON.stringify(result)}),delete window.__dsmStudioReplies[${JSON.stringify(replyID)}])`
  ).catch(() => {});
}

function handleStudioMessage(payload = {}) {
  if (typeof payload !== 'object') return;
  const replyID = payload.replyId;
  switch (payload.action) {
    case 'save': {
      const theme = { ...payload };
      delete theme.replyId;
      delete theme.action;
      const applyNow = Boolean(theme.apply);
      delete theme.apply;
      const savedID = saveCustomTheme(theme);
      if (savedID) {
        if (applyNow) applyThemeMode(savedID);
        studioReply(replyID, { ok: true, id: savedID });
        log.info(`[studio] custom theme saved id=${savedID}`);
      } else {
        studioReply(replyID, { ok: false, error: '保存失败，请重试' });
      }
      break;
    }
    case 'list': {
      const themes = customThemes().map((t) => ({
        id: t.id,
        name: t.name || t.id,
        colors: t.colors || null
      }));
      studioReply(replyID, { ok: true, themes });
      break;
    }
    case 'get': {
      const tid = String(payload.id || '');
      const theme = customTheme(tid);
      studioReply(replyID, theme ? { ok: true, theme } : { ok: false });
      break;
    }
    case 'apply': {
      const tid = String(payload.id || '');
      if (customTheme(tid)) {
        applyThemeMode(tid);
        studioReply(replyID, { ok: true });
      } else {
        studioReply(replyID, { ok: false, error: '主题不存在' });
      }
      break;
    }
    case 'remove': {
      const tid = String(payload.id || '');
      if (removeCustomTheme(tid)) {
        if (themeMode === tid) applyThemeMode('cute');
        studioReply(replyID, { ok: true });
      } else {
        studioReply(replyID, { ok: false, error: '删除失败' });
      }
      break;
    }
    case 'close':
      studioWindow?.close();
      break;
    default:
      studioReply(replyID, { ok: false, error: '未知操作' });
  }
}

// ---------- Token 使用统计 ----------

let statsWindow;

function statsCacheFile() {
  return path.join(app.getPath('userData'), 'usage-stats.json');
}

function readCachedStatsResult() {
  const obj = readJSON(statsCacheFile(), null);
  return obj && obj.result ? obj.result : null;
}

function runUsageStats(force = false) {
  return new Promise((resolve) => {
    const nodeExe = resourcePath('runtime', 'node', 'node.exe');
    const script = resourcePath('runtime', 'usage-stats.mjs');
    if (!fs.existsSync(nodeExe) || !fs.existsSync(script)) {
      resolve(readCachedStatsResult());
      return;
    }
    let child;
    try {
      child = spawn(nodeExe, ['--max-old-space-size=1024', script, '--out', statsCacheFile()], {
        cwd: app.getPath('home'),
        windowsHide: true,
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (error) {
      log.warn('[stats] spawn failed', error.message);
      resolve(readCachedStatsResult());
      return;
    }
    let stdout = '';
    let settled = false;
    const watchdog = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch (_) {}
        resolve(readCachedStatsResult());
      }
    }, 90000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      log.warn('[stats] run failed', error.message);
      resolve(readCachedStatsResult());
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      const text = stdout.trim();
      if (code === 0 && text) {
        try { resolve(JSON.parse(text)); return; } catch (_) {}
      }
      log.warn(`[stats] run status=${code}, fallback to cache`);
      resolve(readCachedStatsResult());
    });
  });
}

function showStatsWindow() {
  if (statsWindow && !statsWindow.isDestroyed()) {
    statsWindow.show();
    statsWindow.focus();
    return;
  }
  const htmlFile = path.join(__dirname, 'stats.html');
  if (!fs.existsSync(htmlFile)) {
    dialog.showErrorBox(APP_NAME, '统计不可用，应用组件不完整，请重新安装最新版。');
    return;
  }
  statsWindow = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 800,
    minHeight: 620,
    title: 'Token 使用统计',
    show: false,
    backgroundColor: '#17191a',
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  statsWindow.removeMenu();
  statsWindow.once('ready-to-show', () => statsWindow?.show());
  statsWindow.on('closed', () => { statsWindow = undefined; });
  // 有缓存就立刻渲染, 随后后台增量扫描并注入最新数据
  // 转义: </ 防止提前闭合 <script>; */ 防止截断占位注释(JSON 字符串内 \/ 合法)。
  const rendered = fs.readFileSync(htmlFile, 'utf8')
    .replace(/\/\*__DSM_STATS_DATA__\*\/null/, (match) => {
      const cached = readCachedStatsResult();
      if (!cached) return match;
      const json = JSON.stringify(cached).replace(/</g, '\\u003c').replace(/\*\//g, '*\\/');
      return `/*__DSM_STATS_DATA__*/${json}`;
    });
  const tempFile = path.join(app.getPath('userData'), 'stats-rendered.html');
  fs.mkdirSync(path.dirname(tempFile), { recursive: true });
  fs.writeFileSync(tempFile, rendered);
  statsWindow.loadFile(tempFile).catch(() => {});
  runUsageStats(false).then((data) => {
    if (!data || !statsWindow || statsWindow.isDestroyed()) return;
    statsWindow.webContents.executeJavaScript(
      `window.__dsmStatsInject&&window.__dsmStatsInject(${JSON.stringify(data)})`
    ).catch(() => {});
  });
}

function restartBackendForProviderChange() {
  publishServiceStatus('starting', '模型服务已更新，正在重启本地内核…');
  showWaiting('模型服务已更新，正在安全重启本地 DeepSeek 内核…');
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  else startBackend();
}

function refreshTrayMenu() {
  if (!tray) return;
  const themeItems = themeList().map((t) => ({
    label: t.label,
    type: 'radio',
    checked: themeMode === t.id,
    click: () => applyThemeMode(t.id)
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 DeepSeek', click: () => showMain() },
    { label: '在浏览器中打开', click: () => shell.openExternal(APP_URL) },
    { label: '新建会话 (Ctrl+K)', click: () => { showMain(); triggerNewSession(); } },
    { label: '复制当前对话为 Markdown (Ctrl+Shift+C)', click: () => copyConversationMarkdown() },
    { label: '显示/隐藏桌面宠物', click: () => petWindow?.isVisible() ? petWindow.hide() : petWindow.showInactive() },
    { label: '重试本地服务', click: () => startBackend() },
    {
      label: '界面主题',
      submenu: [
        ...themeItems,
        { type: 'separator' },
        { label: '主题工坊…（创建自定义主题）', click: () => showThemeStudioWindow() }
      ]
    },
    { label: 'Token 使用统计', click: () => showStatsWindow() },
    { label: '模型服务设置…', click: () => showModelProviderWizard() },
    { label: '邀请登录 ssnh.top', click: () => shell.openExternal(WEBSITE_URL) },
    { label: '检查应用更新', click: () => checkForUpdates(true) },
    { label: '复制诊断信息（含内核报错）', click: () => copyDiagnostics() },
    { label: '打开诊断日志', click: () => shell.showItemInFolder(log.transports.file.getFile().path) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const image = nativeImage.createFromPath(resourcePath('assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();
  tray.on('double-click', () => showMain());
}

ipcMain.on('window-action', (event, action) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (action === 'minimize') mainWindow.minimize();
  else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.hide();
});

ipcMain.on('dsm-service', (_event, command) => {
  if (command === 'recover') startBackend();
  else checkHealth(true);
});

ipcMain.on('dsm-update', () => checkForUpdates(true));
ipcMain.handle('dsm-status', () => ({ service: serviceStatus, update: updateStatus }));
ipcMain.handle('dsm-diagnostics-copy', () => copyDiagnostics());
ipcMain.handle('dsm-theme-get', () => themeMode);
ipcMain.handle('dsm-theme-list', () => themeList());
ipcMain.on('dsm-theme-set', (event, mode) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  applyThemeMode(String(mode));
});
ipcMain.on('dsm-provider-open', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  showModelProviderWizard();
});
ipcMain.on('dsm-studio-open', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  showThemeStudioWindow();
});
ipcMain.on('dsm-studio', (_event, payload) => {
  if (!studioWindow || _event.sender !== studioWindow.webContents) return;
  handleStudioMessage(payload);
});
ipcMain.on('dsm-stats-open', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  showStatsWindow();
});
ipcMain.on('dsm-open-website', (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  shell.openExternal(WEBSITE_URL);
});
ipcMain.handle('provider-save', (_event, payload = {}) => {
  try {
    let needsRestart = false;
    if (payload.provider === 'official') {
      runProviderConfig({ provider: 'official' });
    } else if (payload.provider === 'qwen') {
      const endpoint = String(payload.endpoint || '').trim();
      const model = String(payload.model || '').trim();
      const apiKey = String(payload.apiKey || '').trim();
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') throw new Error('接口必须使用 HTTPS');
      if (!model || !apiKey) throw new Error('模型名称和 API 密钥不能为空');
      saveQwenAPIKey(apiKey);
      runProviderConfig({ provider: 'qwen', endpoint, model });
      needsRestart = true;
    } else {
      throw new Error('未知的模型服务');
    }
    updatePreferences({ providerWizardVersion: PROVIDER_WIZARD_VERSION });
    if (needsRestart) restartBackendForProviderChange();
    else setTimeout(() => loadMainURL(), 400);
    providerWindow?.close();
    return { ok: true };
  } catch (error) {
    log.error('[provider] save failed', error);
    return { ok: false, error: error.message || '模型设置失败' };
  }
});
ipcMain.on('provider-cancel', () => {
  updatePreferences({ providerWizardVersion: PROVIDER_WIZARD_VERSION });
  providerWindow?.close();
});

ipcMain.on('dsm-pet', (_event, payload = {}) => {
  if (payload.event === 'busy') {
    if (!taskBusy) taskStartedAt = Date.now();
    taskBusy = true;
    if (payload.title) lastTaskTitle = payload.title;
    if (payload.url) lastTaskURL = payload.url;
    setPetState('thinking', '正在认真思考…', '#f5dc26');
  } else if (payload.event === 'complete' && taskBusy) {
    const duration = Number(payload.durationMs) > 0 ? Number(payload.durationMs) : Date.now() - taskStartedAt;
    taskBusy = false;
    if (payload.title) lastTaskTitle = payload.title;
    if (payload.url) lastTaskURL = payload.url;
    setPetState('complete', `完成 · ${formatDuration(duration)}`, '#55d8c2');
    showCompletionNotification(lastTaskTitle, duration, lastTaskURL);
    mainWindow?.flashFrame(true);
    setTimeout(() => {
      if (!taskBusy) checkHealth(false);
    }, 6000);
  }
});

ipcMain.on('pet-open-main', () => showMain(lastTaskURL));
ipcMain.on('pet-retry-service', () => startBackend());
ipcMain.on('pet-context-menu', () => {
  Menu.buildFromTemplate([
    { label: '打开 DeepSeek', click: () => showMain(lastTaskURL) },
    { label: '重试本地服务', click: () => startBackend() },
    { label: '测试完成表情', click: () => {
      setPetState('complete', '测试完成啦！', '#55d8c2');
      showCompletionNotification('桌面宠物提醒测试', 3800, lastTaskURL);
      setTimeout(() => checkHealth(false), 5000);
    } },
    { type: 'separator' },
    { label: '隐藏桌面宠物', click: () => petWindow?.hide() }
  ]).popup({ window: petWindow });
});

ipcMain.on('pet-drag-start', (_event, point) => {
  if (!petWindow || !point) return;
  dragState = { point, bounds: petWindow.getBounds() };
});
ipcMain.on('pet-drag-move', (_event, point) => {
  if (!petWindow || !dragState || !point) return;
  const next = clampPetPosition(
    dragState.bounds.x + point.x - dragState.point.x,
    dragState.bounds.y + point.y - dragState.point.y
  );
  petWindow.setPosition(next.x, next.y, false);
});
ipcMain.on('pet-drag-end', () => {
  dragState = undefined;
  savePetPosition();
});

app.setAppUserModelId(APP_ID);
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(() => {
    log.info(`[startup ${elapsed()}] app ready version=${app.getVersion()} packaged=${app.isPackaged}`);
    const savedTheme = preferences().themeMode;
    themeMode = isValidTheme(savedTheme) ? savedTheme : 'cute';
    createMainWindow();
    createPetWindow();
    createTray();
    syncMascotAssets(customTheme(themeMode)?.mascot || '');
    startBackend();
    setupAutoUpdater();
    healthTimer = setInterval(() => checkHealth(true), 5000);
    if (preferences().providerWizardVersion !== PROVIDER_WIZARD_VERSION) {
      setTimeout(() => showModelProviderWizard(), 1400);
    }
  });
}

app.on('activate', () => showMain());
app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  quitting = true;
  clearInterval(healthTimer);
  clearInterval(updateTimer);
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  backendLogStream?.end();
});
