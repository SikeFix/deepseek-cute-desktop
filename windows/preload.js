const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    dsmService: { postMessage: (message) => ipcRenderer.send('dsm-service', message) },
    dsmPet: { postMessage: (message) => ipcRenderer.send('dsm-pet', message) }
  }
});

contextBridge.exposeInMainWorld('deepseekDesktop', {
  windowAction: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action);
  },
  checkForUpdates: () => ipcRenderer.send('dsm-update'),
  getTheme: () => ipcRenderer.invoke('dsm-theme-get'),
  setTheme: (mode) => {
    if (['official', 'cute'].includes(mode)) ipcRenderer.send('dsm-theme-set', mode);
  },
  openModelSettings: () => ipcRenderer.send('dsm-provider-open'),
  getStatus: () => ipcRenderer.invoke('dsm-status'),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_event, status) => callback(status)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, status) => callback(status))
});
