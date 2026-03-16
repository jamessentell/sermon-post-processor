import { app, BrowserWindow, ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import * as converter from './converter';
import * as facebook from './facebook';
import * as authServer from './auth-server';
import * as db from './database';
import { FacebookPage, FacebookSettings, CameraDetectionData } from './types';

let mainWindow: BrowserWindow | null = null;
let usbMonitoringInterval: ReturnType<typeof setInterval> | null = null;
let driveMonitoringInterval: ReturnType<typeof setInterval> | null = null;
let knownMountPoints = new Set<string>();
let isProcessingCamera = false;
let driveWatcher: ReturnType<typeof fs.watch> | null = null;
let driveSpaceUpdateTimer: ReturnType<typeof setTimeout> | null = null;


function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Initialize converter with event callbacks
  converter.init({
    onProgress: (percent: number) => mainWindow!.webContents.send('conversion-progress', percent),
    onStatus: (message: string) => mainWindow!.webContents.send('conversion-status', message),
    onCopyProgress: (percent: number) => mainWindow!.webContents.send('copy-progress', percent)
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle file selection
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Handle output folder selection
ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    defaultPath: db.getSetting<string>('outputFolder')
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  db.setSetting('outputFolder', folderPath);
  return folderPath;
});

// Get saved output folder
ipcMain.handle('get-output-folder', async () => {
  return db.getSetting<string>('outputFolder') || null;
});

// Handle video conversion — copies to output folder first, then converts
ipcMain.handle('convert-video', async (_event: IpcMainInvokeEvent, inputPath: string) => {
  const outputFolder = db.getSetting<string>('outputFolder');
  if (!outputFolder) {
    throw new Error('Please select an output folder first');
  }

  const basename = path.basename(inputPath);
  let convertInput = inputPath;

  // If this is already a temp file in the output folder (from auto-detect), skip the copy
  const isAlreadyCopied = basename.startsWith('temp_') && inputPath.startsWith(outputFolder);

  if (!isAlreadyCopied) {
    // Copy to output folder first
    const tempPath = path.join(outputFolder, `temp_${basename}`);
    mainWindow!.webContents.send('conversion-status', 'Copying file to output folder...');
    await converter.copyFile(inputPath, tempPath);
    mainWindow!.webContents.send('copy-progress', 100);
    mainWindow!.webContents.send('conversion-status', 'Copy complete, starting conversion...');

    // Update DB status to copied
    try {
      const stats = fs.statSync(inputPath);
      const record = db.getVideoBySource(basename, stats.size);
      if (record) {
        db.updateVideoStatus(record.id!, 'copied', { copied: tempPath });
      }
    } catch {
      // Source may not be a tracked camera file
    }

    convertInput = tempPath;
  }

  const outputPath = await converter.convertVideo(convertInput, outputFolder);

  // Update video status in database
  if (basename.startsWith('temp_')) {
    const record = db.getVideoByCopiedPath(inputPath);
    if (record) {
      db.updateVideoStatus(record.id!, 'converted', { converted: outputPath });
    }
  } else {
    try {
      const stats = fs.statSync(inputPath);
      const record = db.getVideoBySource(basename, stats.size);
      if (record) {
        db.updateVideoStatus(record.id!, 'converted', { converted: outputPath });
      }
    } catch {
      // Source may not be a tracked camera file
    }
  }

  return outputPath;
});

// Handle conversion/copy cancellation
ipcMain.handle('cancel-conversion', async () => {
  const { wasCopying } = converter.cancel();
  if (wasCopying) {
    isProcessingCamera = false;
  }
  return true;
});

// USB Monitoring Functions - Cross-platform mount point detection
function getMountPoints(): string[] {
  const mountPoints: string[] = [];
  const platform = process.platform;

  try {
    if (platform === 'linux') {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8');
      const lines = mounts.split('\n');
      for (const line of lines) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          const mountPath = parts[1];
          if (mountPath.startsWith('/media/') || mountPath.startsWith('/mnt/') || mountPath.startsWith('/run/media/')) {
            mountPoints.push(mountPath);
          }
        }
      }
    } else if (platform === 'darwin') {
      const volumes = fs.readdirSync('/Volumes');
      for (const vol of volumes) {
        mountPoints.push(path.join('/Volumes', vol));
      }
    } else if (platform === 'win32') {
      const output = execSync('wmic logicaldisk get name', { encoding: 'utf8' });
      const lines = output.split('\n');
      for (const line of lines) {
        const drive = line.trim();
        if (/^[A-Z]:$/.test(drive)) {
          mountPoints.push(drive + '\\');
        }
      }
    }
  } catch (err) {
    console.error('Error getting mount points:', err);
  }

  return mountPoints;
}

function checkForCameraDrive(mountPoints: string[]): string | null {
  for (const mountPath of mountPoints) {
    const clipPath = path.join(mountPath, 'PRIVATE', 'M4ROOT', 'CLIP');
    if (fs.existsSync(clipPath)) {
      return clipPath;
    }
  }
  return null;
}

function getDriveSpace(drivePath: string): number | null {
  try {
    // --output=avail avoids multi-line wrapping issues with long paths
    const output = execSync(`df --output=avail -B 1 "${drivePath}"`, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    const freeBytes = parseInt(lines[lines.length - 1].trim(), 10);
    return isNaN(freeBytes) ? null : freeBytes;
  } catch {
    return null;
  }
}

function startDriveWatcher(clipPath: string): void {
  stopDriveWatcher();
  try {
    driveWatcher = fs.watch(clipPath, () => {
      if (driveSpaceUpdateTimer) clearTimeout(driveSpaceUpdateTimer);
      driveSpaceUpdateTimer = setTimeout(() => {
        const freeBytes = getDriveSpace(clipPath);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('drive-space-updated', { freeBytes });
        }
      }, 500);
    });
  } catch (err) {
    console.error('Error starting drive watcher:', err);
  }
}

function stopDriveWatcher(): void {
  if (driveSpaceUpdateTimer) {
    clearTimeout(driveSpaceUpdateTimer);
    driveSpaceUpdateTimer = null;
  }
  if (driveWatcher) {
    driveWatcher.close();
    driveWatcher = null;
  }
}

function getLatestVideoFile(clipPath: string): string | null {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  try {
    const files = fs.readdirSync(clipPath)
      .filter(f => videoExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(clipPath, f);
        return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return files[0] ? files[0].path : null;
  } catch (err) {
    console.error('Error reading clip directory:', err);
    return null;
  }
}

async function copyAndConvert(sourcePath: string): Promise<void> {
  const outputFolder = db.getSetting<string>('outputFolder');

  if (!outputFolder) {
    mainWindow!.webContents.send('conversion-status', 'Error: No output folder configured');
    return;
  }

  // Check if already processed via database
  const sourceName = path.basename(sourcePath);
  const sourceStats = fs.statSync(sourcePath);
  const existing = db.getVideoBySource(sourceName, sourceStats.size);
  if (existing && existing.status === 'converted') {
    mainWindow!.webContents.send('conversion-status', 'File already processed, skipping');
    mainWindow!.webContents.send('camera-detected', { status: 'skipped', file: sourceName } as CameraDetectionData);
    return;
  }

  // Upsert video record
  const videoId = db.upsertVideo({
    source_name: sourceName,
    source_path: sourcePath,
    source_size: sourceStats.size,
    source_mtime: sourceStats.mtime.getTime(),
    status: 'on-camera'
  });

  // Create temp copy path
  const tempPath = path.join(outputFolder, `temp_${sourceName}`);

  try {
    // Copy file
    mainWindow!.webContents.send('conversion-status', 'Copying file from camera...');
    await converter.copyFile(sourcePath, tempPath);
    mainWindow!.webContents.send('copy-progress', 100);
    mainWindow!.webContents.send('conversion-status', 'Copy complete, starting conversion...');

    // Update status to copied
    db.updateVideoStatus(videoId, 'copied', { copied: tempPath });

    // Trigger conversion via the existing convert-video handler logic
    mainWindow!.webContents.send('auto-convert-ready', tempPath);
  } catch (err) {
    console.error('Error copying file:', err);
    if ((err as Error).message !== 'Copy cancelled') {
      mainWindow!.webContents.send('conversion-status', `Error copying file: ${(err as Error).message}`);
    }
    // Clean up temp file if exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function pollDrives(): void {
  if (isProcessingCamera) return;

  try {
    const currentMountPoints = getMountPoints();
    const currentSet = new Set(currentMountPoints);

    // Check for new mount points
    const newMounts: string[] = [];
    for (const mountPath of currentMountPoints) {
      if (!knownMountPoints.has(mountPath)) {
        newMounts.push(mountPath);
      }
    }

    // Update known mount points
    knownMountPoints = currentSet;

    // If there are new mounts, check if any is a camera
    if (newMounts.length > 0) {
      const clipPath = checkForCameraDrive(newMounts);
      if (clipPath) {
        mainWindow!.webContents.send('camera-detected', { status: 'detected', clipPath } as CameraDetectionData);

        // Only auto copy+convert if the setting is enabled
        if (db.getSetting<boolean>('autoConvertEnabled') !== false) {
          isProcessingCamera = true;
          const latestVideo = getLatestVideoFile(clipPath);
          if (latestVideo) {
            mainWindow!.webContents.send('camera-detected', {
              status: 'found-video',
              file: path.basename(latestVideo)
            } as CameraDetectionData);
            copyAndConvert(latestVideo).finally(() => {
              isProcessingCamera = false;
            });
          } else {
            mainWindow!.webContents.send('conversion-status', 'No video files found on camera');
            mainWindow!.webContents.send('camera-detected', { status: 'skipped' } as CameraDetectionData);
            isProcessingCamera = false;
          }
        } else {
          // Auto-convert disabled — clear the detection UI state
          mainWindow!.webContents.send('camera-detected', { status: 'skipped' } as CameraDetectionData);
        }
      }
    }
  } catch (err) {
    console.error('Error polling drives:', err);
  }
}

function startUsbMonitoring(): void {
  if (usbMonitoringInterval) return;

  // Initialize known mount points
  knownMountPoints = new Set(getMountPoints());

  usbMonitoringInterval = setInterval(pollDrives, 2000);
  console.log('USB monitoring started');
}

function stopUsbMonitoring(): void {
  if (usbMonitoringInterval) {
    clearInterval(usbMonitoringInterval);
    usbMonitoringInterval = null;
    console.log('USB monitoring stopped');
  }
}

// USB Monitoring IPC Handlers
ipcMain.handle('toggle-usb-monitoring', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
  db.setSetting('usbMonitoringEnabled', enabled);

  if (enabled) {
    startUsbMonitoring();
  } else {
    stopUsbMonitoring();
  }
  return enabled;
});

ipcMain.handle('get-usb-monitoring-status', async () => {
  return {
    enabled: db.getSetting<boolean>('usbMonitoringEnabled') || false,
    active: usbMonitoringInterval !== null
  };
});

ipcMain.handle('toggle-auto-convert', async (_event: IpcMainInvokeEvent, enabled: boolean) => {
  db.setSetting('autoConvertEnabled', enabled);
  return enabled;
});

ipcMain.handle('get-auto-convert-status', async () => {
  return db.getSetting<boolean>('autoConvertEnabled') !== false || false;
});

// Start drive monitoring (always active for video list updates)
function startDriveMonitoring(): void {
  if (driveMonitoringInterval) return;
  driveMonitoringInterval = setInterval(pollDrivesWithNotification, 2000);
  console.log('Drive monitoring started');
}

function stopDriveMonitoring(): void {
  if (driveMonitoringInterval) {
    clearInterval(driveMonitoringInterval);
    driveMonitoringInterval = null;
    console.log('Drive monitoring stopped');
  }
}

// Track previous drive status for change detection
let previousDriveConnected = false;

// Start monitoring on app ready if enabled in settings
app.on('ready', () => {
  // Initialize database
  db.initDatabase(app.getPath('userData'));

  // Initialize drive connection status
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  previousDriveConnected = clipPath !== null;

  // Always start drive monitoring for video list updates
  startDriveMonitoring();

  if (db.getSetting<boolean>('usbMonitoringEnabled')) {
    startUsbMonitoring();
  }
});

// Stop monitoring on app quit
app.on('before-quit', () => {
  stopUsbMonitoring();
  stopDriveMonitoring();
});

// Facebook IPC Handlers
const REDIRECT_URI = 'http://localhost:8888/callback';

ipcMain.handle('save-facebook-credentials', async (_event: IpcMainInvokeEvent, credentials: { appId: string; appSecret: string }) => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook') || {};
  fbSettings.appId = credentials.appId;
  fbSettings.appSecret = credentials.appSecret;
  db.setSetting('facebook', fbSettings);
  return true;
});

ipcMain.handle('get-facebook-status', async () => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook');
  if (fbSettings && fbSettings.pageAccessToken && fbSettings.pageName) {
    return {
      connected: true,
      pageName: fbSettings.pageName
    };
  }
  return {
    connected: false,
    hasCredentials: !!(fbSettings && fbSettings.appId && fbSettings.appSecret)
  };
});

ipcMain.handle('start-facebook-auth', async () => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook');
  if (!fbSettings || !fbSettings.appId || !fbSettings.appSecret) {
    throw new Error('Facebook App credentials not configured');
  }

  const { appId, appSecret } = fbSettings;

  // Start local server to receive OAuth callback
  const authPromise = authServer.startAuthServer(8888, 300000);

  // Open browser for authorization
  const authUrl = facebook.getAuthUrl(appId, REDIRECT_URI);
  shell.openExternal(authUrl);

  try {
    // Wait for authorization code
    const code = await authPromise;

    // Exchange code for token
    mainWindow!.webContents.send('facebook-status', 'Exchanging authorization code...');
    const shortToken = await facebook.exchangeCodeForToken(code, appId, appSecret, REDIRECT_URI);

    // Get long-lived token
    mainWindow!.webContents.send('facebook-status', 'Getting long-lived token...');
    const longToken = await facebook.getLongLivedToken(shortToken, appId, appSecret);

    // Get user's pages
    mainWindow!.webContents.send('facebook-status', 'Fetching your pages...');
    const pages = await facebook.getUserPages(longToken);

    if (pages.length === 0) {
      throw new Error('No Facebook Pages found. You must manage at least one Page.');
    }

    return pages;
  } catch (err) {
    authServer.stopAuthServer();
    throw err;
  }
});

ipcMain.handle('select-facebook-page', async (_event: IpcMainInvokeEvent, pageInfo: FacebookPage) => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook') || {};
  fbSettings.pageId = pageInfo.id;
  fbSettings.pageName = pageInfo.name;
  fbSettings.pageAccessToken = pageInfo.access_token;
  db.setSetting('facebook', fbSettings);
  return true;
});

ipcMain.handle('disconnect-facebook', async () => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook');
  if (fbSettings) {
    delete fbSettings.pageId;
    delete fbSettings.pageName;
    delete fbSettings.pageAccessToken;
    db.setSetting('facebook', fbSettings);
  }
  return true;
});

ipcMain.handle('post-to-facebook', async (_event: IpcMainInvokeEvent, videoPath: string) => {
  const fbSettings = db.getSetting<FacebookSettings>('facebook');
  if (!fbSettings || !fbSettings.pageAccessToken) {
    throw new Error('Facebook not connected');
  }

  const { pageId, pageAccessToken } = fbSettings;

  try {
    const result = await facebook.uploadVideoToPage(
      pageId!,
      pageAccessToken,
      videoPath,
      new Date(),
      (percent: number) => mainWindow!.webContents.send('facebook-upload-progress', percent),
      (message: string) => mainWindow!.webContents.send('facebook-status', message)
    );

    db.markFacebookUploaded(videoPath);

    return result;
  } catch (err) {
    mainWindow!.webContents.send('facebook-status', `Upload failed: ${(err as Error).message}`);
    throw err;
  }
});

// Manual camera folder selection
let manualCameraFolder: string | null = null;

ipcMain.handle('select-camera-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Camera Video Folder'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  manualCameraFolder = result.filePaths[0];
  return manualCameraFolder;
});

ipcMain.handle('clear-camera-folder', async () => {
  manualCameraFolder = null;
  return true;
});

ipcMain.handle('delete-camera-file', async (_event: IpcMainInvokeEvent, filePath: string) => {
  fs.unlinkSync(filePath);
  return true;
});

ipcMain.handle('eject-camera-drive', async () => {
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  if (!clipPath) return false;
  try {
    const device = execSync(`df --output=source "${clipPath}" | tail -1`, { encoding: 'utf8' }).trim();
    stopDriveWatcher();
    execSync(`udisksctl unmount -b "${device}"`, { encoding: 'utf8' });
    try {
      execSync(`udisksctl power-off -b "${device}"`, { encoding: 'utf8' });
    } catch {
      // power-off is best-effort; some devices don't support it
    }
    return true;
  } catch (err) {
    console.error('Error ejecting drive:', err);
    return false;
  }
});

// Video List IPC Handlers
ipcMain.handle('list-video-files', async () => {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const mountPoints = getMountPoints();
  let clipPath = checkForCameraDrive(mountPoints);

  // Fall back to manually selected folder
  if (!clipPath && manualCameraFolder) {
    if (fs.existsSync(manualCameraFolder)) {
      clipPath = manualCameraFolder;
    } else {
      manualCameraFolder = null;
    }
  }

  if (!clipPath) {
    return { connected: false, files: [] };
  }

  try {
    const files = fs.readdirSync(clipPath)
      .filter(f => videoExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(clipPath, f);
        const stats = fs.statSync(fullPath);

        // Look up status from database
        const record = db.getVideoBySource(f, stats.size);
        let status: 'on-camera' | 'copied' | 'converted' = 'on-camera';
        if (record) {
          status = record.status;
        } else {
          // First time seeing this file — insert as on-camera
          db.upsertVideo({
            source_name: f,
            source_path: fullPath,
            source_size: stats.size,
            source_mtime: stats.mtime.getTime(),
            status: 'on-camera'
          });
        }

        return {
          name: f,
          path: fullPath,
          size: stats.size,
          mtime: stats.mtime.getTime(),
          status
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const freeBytes = getDriveSpace(clipPath);
    return { connected: true, clipPath, freeBytes, files };
  } catch (err) {
    console.error('Error listing video files:', err);
    return { connected: true, clipPath, freeBytes: null, files: [] };
  }
});

ipcMain.handle('get-drive-status', async () => {
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  return {
    connected: clipPath !== null,
    clipPath,
    freeBytes: clipPath ? getDriveSpace(clipPath) : null
  };
});

ipcMain.handle('list-converted-videos', async () => {
  try {
    const convertedRecords = db.getVideosByStatus('converted');
    const files: Array<{ name: string; path: string; size: number; mtime: number; folder: string; uploaded: boolean }> = [];

    for (const record of convertedRecords) {
      if (!record.converted_path || !fs.existsSync(record.converted_path)) {
        continue;
      }
      const stats = fs.statSync(record.converted_path);
      const folder = path.basename(path.dirname(record.converted_path));
      files.push({
        name: path.basename(record.converted_path),
        path: record.converted_path,
        size: stats.size,
        mtime: stats.mtime.getTime(),
        folder,
        uploaded: !!record.facebook_uploaded_at
      });
    }

    files.sort((a, b) => b.mtime - a.mtime);
    return { files };
  } catch (err) {
    console.error('Error listing converted videos:', err);
    return { files: [] };
  }
});

function pollDrivesWithNotification(): void {
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  const isConnected = clipPath !== null;

  // Emit drive-connection-changed if status changed
  if (isConnected !== previousDriveConnected) {
    previousDriveConnected = isConnected;
    if (isConnected && clipPath) {
      startDriveWatcher(clipPath);
    } else {
      stopDriveWatcher();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive-connection-changed', {
        connected: isConnected,
        clipPath,
        freeBytes: clipPath ? getDriveSpace(clipPath) : null
      });
    }
  }
}
