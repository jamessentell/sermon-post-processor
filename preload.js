const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  convertVideo: (filePath) => ipcRenderer.invoke('convert-video', filePath),
  cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
  onProgress: (callback) => ipcRenderer.on('conversion-progress', (event, percent) => callback(percent)),
  onStatus: (callback) => ipcRenderer.on('conversion-status', (event, message) => callback(message)),
  // USB Monitoring APIs
  toggleUsbMonitoring: (enabled) => ipcRenderer.invoke('toggle-usb-monitoring', enabled),
  getUsbMonitoringStatus: () => ipcRenderer.invoke('get-usb-monitoring-status'),
  onCameraDetected: (callback) => ipcRenderer.on('camera-detected', (event, data) => callback(data)),
  onCopyProgress: (callback) => ipcRenderer.on('copy-progress', (event, percent) => callback(percent)),
  onAutoConvertReady: (callback) => ipcRenderer.on('auto-convert-ready', (event, filePath) => callback(filePath))
});
