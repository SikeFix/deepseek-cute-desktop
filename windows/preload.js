const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    dsmService: { postMessage: (message) => ipcRenderer.send('dsm-service', message) },
    dsmPet: { postMessage: (message) => ipcRenderer.send('dsm-pet', message) }
  }
});

const THEME_MODES = ['official', 'cute', 'aurora', 'paper', 'deepsea'];

contextBridge.exposeInMainWorld('deepseekDesktop', {
  windowAction: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action);
  },
  checkForUpdates: () => ipcRenderer.send('dsm-update'),
  getTheme: () => ipcRenderer.invoke('dsm-theme-get'),
  getThemeList: () => ipcRenderer.invoke('dsm-theme-list'),
  setTheme: (mode) => {
    if (THEME_MODES.includes(mode)) ipcRenderer.send('dsm-theme-set', mode);
  },
  openModelSettings: () => ipcRenderer.send('dsm-provider-open'),
  openThemeStudio: () => ipcRenderer.send('dsm-studio-open'),
  openStats: () => ipcRenderer.send('dsm-stats-open'),
  openInviteLogin: () => ipcRenderer.send('dsm-open-website'),
  getStatus: () => ipcRenderer.invoke('dsm-status'),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_event, status) => callback(status)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, status) => callback(status))
});
