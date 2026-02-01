const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  convertVideo: (filePath) => ipcRenderer.invoke('convert-video', filePath),
  onProgress: (callback) => ipcRenderer.on('conversion-progress', (event, percent) => callback(percent)),
  onStatus: (callback) => ipcRenderer.on('conversion-status', (event, message) => callback(message))
});
