const { contextBridge, ipcRenderer } = require('electron');

// 主题工坊平台桥: theme-studio.html 经 webkit.messageHandlers.dsmThemeStudio
// 发送 { replyId, action, ... }, 宿主在 main.js handleStudioMessage 处理,
// 结果回投到页面 window.__dsmStudioReplies[replyId]。
contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    dsmThemeStudio: { postMessage: (message) => ipcRenderer.send('dsm-studio', message) }
  }
});
