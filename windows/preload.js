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

contextBridge.exposeInMainWorld('pluginMarket', {
  list: () => ipcRenderer.invoke('plugin-market-list'),
  install: (payload) => ipcRenderer.invoke('plugin-market-install', payload),
  disable: (payload) => ipcRenderer.invoke('plugin-market-disable', payload),
  enable: (payload) => ipcRenderer.invoke('plugin-market-enable', payload),
  uninstall: (payload) => ipcRenderer.invoke('plugin-market-uninstall', payload),
  close: () => ipcRenderer.send('plugin-market-close')
});
