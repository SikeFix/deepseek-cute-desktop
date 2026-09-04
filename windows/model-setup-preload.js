const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modelSetup', {
  save: (payload) => ipcRenderer.invoke('provider-save', payload),
  cancel: () => ipcRenderer.send('provider-cancel'),
  openWebsite: () => ipcRenderer.send('dsm-open-website')
});
