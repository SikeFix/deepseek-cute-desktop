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
  getStatus: () => ipcRenderer.invoke('dsm-status'),
  onServiceStatus: (callback) => ipcRenderer.on('service-status', (_event, status) => callback(status)),
  onUpdateStatus: (callback) => ipcRenderer.on('update-status', (_event, status) => callback(status))
});
