const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  onState: (callback) => ipcRenderer.on('pet-state', (_event, state) => callback(state)),
  openMain: () => ipcRenderer.send('pet-open-main'),
  retryService: () => ipcRenderer.send('pet-retry-service'),
  contextMenu: () => ipcRenderer.send('pet-context-menu'),
  dragStart: (point) => ipcRenderer.send('pet-drag-start', point),
  dragMove: (point) => ipcRenderer.send('pet-drag-move', point),
  dragEnd: () => ipcRenderer.send('pet-drag-end')
});
