const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    dsmService: { postMessage: (message) => ipcRenderer.send('dsm-service', message) }
  }
});

contextBridge.exposeInMainWorld('deepseekDesktop', {
  windowAction: (action) => {
    if (['minimize', 'maximize', 'close'].includes(action)) ipcRenderer.send('window-action', action);
  },
  checkForUpdates: () => ipcRenderer.send('dsm-update'),
  recoverService: () => ipcRenderer.send('dsm-service', 'recover'),
  getStatus: () => ipcRenderer.invoke('dsm-status'),
  copyDiagnostics: () => ipcRenderer.invoke('dsm-diagnostics-copy'),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_event, status) => callback(status)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, status) => callback(status))
});
