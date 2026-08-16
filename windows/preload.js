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
  }
});
