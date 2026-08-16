const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  screen,
  shell
} = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const APP_URL = 'http://127.0.0.1:3080';
const APP_NAME = 'DeepSeek Cute';

let mainWindow;
let petWindow;
let tray;
let backendProcess;
let healthTimer;
let healthFailures = 0;
let quitting = false;
let taskBusy = false;
let taskStartedAt = 0;
let lastTaskTitle = '当前任务';
let lastTaskURL = APP_URL;
let petState = { mood: 'thinking', text: '正在启动服务…', color: '#f5dc26' };
let dragState;

const resourcePath = (...parts) => path.join(app.isPackaged ? process.resourcesPath : __dirname, ...parts);
const petPositionPath = () => path.join(app.getPath('userData'), 'pet-position.json');

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

function setPetState(mood, text, color) {
  petState = { mood, text, color };
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-state', petState);
  }
}

function publishServiceStatus(status) {
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

async function startBackend() {
  if (backendProcess && !backendProcess.killed) return;
  if (await checkOnline()) {
    publishServiceStatus('online');
    return;
  }

  const nodeExe = resourcePath('runtime', 'node', 'node.exe');
  const dshBin = resourcePath('runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (!fs.existsSync(nodeExe) || !fs.existsSync(dshBin)) {
    publishServiceStatus('offline');
    showWaiting('内置运行组件不完整，请重新下载应用。');
    return;
  }

  publishServiceStatus('starting');
  backendProcess = spawn(nodeExe, [dshBin, 'web'], {
    cwd: app.getPath('home'),
    env: {
      ...process.env,
      NO_COLOR: '1',
      PATH: `${path.dirname(nodeExe)};${process.env.PATH || ''}`
    },
    windowsHide: true,
    stdio: 'ignore'
  });

  backendProcess.once('error', () => {
    backendProcess = undefined;
    publishServiceStatus('offline');
  });
  backendProcess.once('exit', () => {
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

function injectTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const currentURL = mainWindow.webContents.getURL();
  if (!currentURL.startsWith(APP_URL)) return;
  const css = fs.readFileSync(resourcePath('theme', 'theme.css'), 'utf8');
  const interactions = fs.readFileSync(resourcePath('theme', 'interactions.js'), 'utf8');
  const windowsChrome = fs.readFileSync(path.join(__dirname, 'window-inject.js'), 'utf8');
  mainWindow.webContents.insertCSS(css).catch(() => {});
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
    show: false,
    backgroundColor: '#17191a',
    icon: resourcePath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.on('did-finish-load', injectTheme);
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

function createTray() {
  const image = nativeImage.createFromPath(resourcePath('assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 DeepSeek', click: () => showMain() },
    { label: '显示/隐藏桌面宠物', click: () => petWindow?.isVisible() ? petWindow.hide() : petWindow.showInactive() },
    { label: '重试本地服务', click: () => startBackend() },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(() => {
    app.setAppUserModelId('com.sikefix.deepseek.cute.windows');
    createMainWindow();
    createPetWindow();
    createTray();
    startBackend();
    healthTimer = setInterval(() => checkHealth(true), 5000);
  });
}

app.on('activate', () => showMain());
app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => {
  quitting = true;
  clearInterval(healthTimer);
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
});
