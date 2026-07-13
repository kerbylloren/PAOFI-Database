const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paofiClipboard", {
  copyPng: dataUrl => ipcRenderer.invoke("clipboard:write-png", dataUrl)
});
