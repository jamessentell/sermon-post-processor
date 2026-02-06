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
  onAutoConvertReady: (callback) => ipcRenderer.on('auto-convert-ready', (event, filePath) => callback(filePath)),
  // Video List APIs
  listVideoFiles: () => ipcRenderer.invoke('list-video-files'),
  listConvertedVideos: () => ipcRenderer.invoke('list-converted-videos'),
  getDriveStatus: () => ipcRenderer.invoke('get-drive-status'),
  onDriveConnectionChanged: (callback) => ipcRenderer.on('drive-connection-changed', (event, data) => callback(data)),
  // Facebook APIs
  saveFacebookCredentials: (credentials) => ipcRenderer.invoke('save-facebook-credentials', credentials),
  getFacebookStatus: () => ipcRenderer.invoke('get-facebook-status'),
  startFacebookAuth: () => ipcRenderer.invoke('start-facebook-auth'),
  selectFacebookPage: (pageInfo) => ipcRenderer.invoke('select-facebook-page', pageInfo),
  disconnectFacebook: () => ipcRenderer.invoke('disconnect-facebook'),
  postToFacebook: (videoPath) => ipcRenderer.invoke('post-to-facebook', videoPath),
  onFacebookUploadProgress: (callback) => ipcRenderer.on('facebook-upload-progress', (event, percent) => callback(percent)),
  onFacebookStatus: (callback) => ipcRenderer.on('facebook-status', (event, message) => callback(message))
});
