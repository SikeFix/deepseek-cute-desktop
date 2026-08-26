const {
  app,
  BrowserWindow,
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
const PROVIDER_WIZARD_VERSION = '2026-08-v4-vision-qwen-1';
const QWEN_ENDPOINT = 'https://ai-xtu.yangrucheng.eu.org/v1';

const resourcePath = (...parts) => path.join(app.isPackaged ? process.resourcesPath : __dirname, ...parts);
const petPositionPath = () => path.join(app.getPath('userData'), 'pet-position.json');
const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');
const providerSecretPath = () => path.join(app.getPath('userData'), 'provider-secret.json');

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
  if (serviceStatus.state !== next.state || serviceStatus.message !== next.message) {
    log.info(`[startup ${elapsed()}] service=${next.state} ${next.message}`);
  }
  serviceStatus = next;
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
  const backendLogPath = path.join(app.getPath('userData'), 'backend.log');
  backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });
  backendLogStream.write(`\n[${new Date().toISOString()}] starting ${nodeExe} ${dshBin} web\n`);
  try {
    backendProcess = spawn(nodeExe, [dshBin, 'web'], {
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
    log.warn(`[backend] exit code=${code} signal=${signal}`);
    backendLogStream?.end(`\n[${new Date().toISOString()}] exit code=${code} signal=${signal}\n`);
    backendLogStream = undefined;
    backendProcess = undefined;
    if (!quitting) {
      publishServiceStatus('offline');
      setTimeout(() => checkHealth(true), 1400);
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
  mainWindow.loadFile(path.join(__dirname, 'waiting.html'), { query: { message } }).catch(() => {});
}

function loadMainURL(url = APP_URL) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeURL = new URL(url, APP_URL);
  if (!['127.0.0.1', 'localhost'].includes(safeURL.hostname)) return;
  mainWindow.loadURL(safeURL.href).catch(() => showWaiting());
}

async function applyThemeMode(mode, persist = true) {
  themeMode = mode === 'official' ? 'official' : 'cute';
  if (persist) updatePreferences({ themeMode });
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (insertedThemeCSS) {
    try { await mainWindow.webContents.removeInsertedCSS(insertedThemeCSS); } catch (_) {}
    insertedThemeCSS = undefined;
  }
  if (themeMode === 'cute' && mainWindow.webContents.getURL().startsWith(APP_URL)) {
    const css = fs.readFileSync(resourcePath('theme', 'theme.css'), 'utf8');
    insertedThemeCSS = await mainWindow.webContents.insertCSS(css).catch(() => undefined);
  }
  mainWindow.webContents.executeJavaScript(
    `window.__dsmThemeMode=${JSON.stringify(themeMode)};document.documentElement.dataset.dsmTheme=window.__dsmThemeMode;window.__dsmSetThemeMode&&window.__dsmSetThemeMode(window.__dsmThemeMode);window.__dsmWindowsThemeChanged&&window.__dsmWindowsThemeChanged(window.__dsmThemeMode)`
  ).catch(() => {});
  refreshTrayMenu();
}

async function injectTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentURL = mainWindow.webContents.getURL();
  if (!currentURL.startsWith(APP_URL)) return;
  const interactions = fs.readFileSync(resourcePath('theme', 'interactions.js'), 'utf8');
  const windowsChrome = fs.readFileSync(path.join(__dirname, 'window-inject.js'), 'utf8');
  themeMode = preferences().themeMode === 'official' ? 'official' : 'cute';
  await mainWindow.webContents.executeJavaScript(`window.__dsmThemeMode=${JSON.stringify(themeMode)}`).catch(() => {});
  await applyThemeMode(themeMode, false);
  mainWindow.webContents.executeJavaScript(interactions).catch(() => {});
  mainWindow.webContents.executeJavaScript(windowsChrome).catch(() => {});
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
  petWindow.webContents.on('did-finish-load', () => setPetState(petState.mood, petState.text, petState.color));
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

function restartBackendForProviderChange() {
  publishServiceStatus('starting', '模型服务已更新，正在重启本地内核…');
  showWaiting('模型服务已更新，正在安全重启本地 DeepSeek 内核…');
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  else startBackend();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 DeepSeek', click: () => showMain() },
    { label: '显示/隐藏桌面宠物', click: () => petWindow?.isVisible() ? petWindow.hide() : petWindow.showInactive() },
    { label: '重试本地服务', click: () => startBackend() },
    {
      label: '界面主题',
      submenu: [
        { label: 'DeepSeek 官方样式', type: 'radio', checked: themeMode === 'official', click: () => applyThemeMode('official') },
        { label: '正太主题', type: 'radio', checked: themeMode === 'cute', click: () => applyThemeMode('cute') }
      ]
    },
    { label: '模型服务设置…', click: () => showModelProviderWizard() },
    { label: '检查应用更新', click: () => checkForUpdates(true) },
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
ipcMain.handle('dsm-theme-get', () => themeMode);
ipcMain.on('dsm-theme-set', (_event, mode) => applyThemeMode(mode));
ipcMain.on('dsm-provider-open', () => showModelProviderWizard());
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
    themeMode = preferences().themeMode === 'official' ? 'official' : 'cute';
    createMainWindow();
    createPetWindow();
    createTray();
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
