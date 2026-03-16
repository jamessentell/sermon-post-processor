import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  convertVideo: (filePath: string) => ipcRenderer.invoke('convert-video', filePath),
  cancelConversion: () => ipcRenderer.invoke('cancel-conversion'),
  onProgress: (callback: (percent: number) => void) =>
    ipcRenderer.on('conversion-progress', (_event, percent: number) => callback(percent)),
  onStatus: (callback: (message: string) => void) =>
    ipcRenderer.on('conversion-status', (_event, message: string) => callback(message)),
  // USB Monitoring APIs
  toggleUsbMonitoring: (enabled: boolean) => ipcRenderer.invoke('toggle-usb-monitoring', enabled),
  getUsbMonitoringStatus: () => ipcRenderer.invoke('get-usb-monitoring-status'),
  toggleAutoConvert: (enabled: boolean) => ipcRenderer.invoke('toggle-auto-convert', enabled),
  getAutoConvertStatus: () => ipcRenderer.invoke('get-auto-convert-status'),
  onCameraDetected: (callback: (data: unknown) => void) =>
    ipcRenderer.on('camera-detected', (_event, data: unknown) => callback(data)),
  onCopyProgress: (callback: (percent: number) => void) =>
    ipcRenderer.on('copy-progress', (_event, percent: number) => callback(percent)),
  onAutoConvertReady: (callback: (filePath: string) => void) =>
    ipcRenderer.on('auto-convert-ready', (_event, filePath: string) => callback(filePath)),
  // Camera folder selection
  selectCameraFolder: () => ipcRenderer.invoke('select-camera-folder'),
  clearCameraFolder: () => ipcRenderer.invoke('clear-camera-folder'),
  deleteCameraFile: (filePath: string) => ipcRenderer.invoke('delete-camera-file', filePath),
  // Video List APIs
  listVideoFiles: () => ipcRenderer.invoke('list-video-files'),
  listConvertedVideos: () => ipcRenderer.invoke('list-converted-videos'),
  getDriveStatus: () => ipcRenderer.invoke('get-drive-status'),
  onDriveConnectionChanged: (callback: (data: unknown) => void) =>
    ipcRenderer.on('drive-connection-changed', (_event, data: unknown) => callback(data)),
  // Facebook APIs
  saveFacebookCredentials: (credentials: { appId: string; appSecret: string }) =>
    ipcRenderer.invoke('save-facebook-credentials', credentials),
  getFacebookStatus: () => ipcRenderer.invoke('get-facebook-status'),
  startFacebookAuth: () => ipcRenderer.invoke('start-facebook-auth'),
  selectFacebookPage: (pageInfo: { id: string; name: string; access_token: string }) =>
    ipcRenderer.invoke('select-facebook-page', pageInfo),
  disconnectFacebook: () => ipcRenderer.invoke('disconnect-facebook'),
  postToFacebook: (videoPath: string) => ipcRenderer.invoke('post-to-facebook', videoPath),
  onFacebookUploadProgress: (callback: (percent: number) => void) =>
    ipcRenderer.on('facebook-upload-progress', (_event, percent: number) => callback(percent)),
  onFacebookStatus: (callback: (message: string) => void) =>
    ipcRenderer.on('facebook-status', (_event, message: string) => callback(message)),
  onDriveSpaceUpdated: (callback: (data: { freeBytes: number | null }) => void) =>
    ipcRenderer.on('drive-space-updated', (_event, data) => callback(data)),
  ejectCameraDrive: () => ipcRenderer.invoke('eject-camera-drive')
});
