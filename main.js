const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const converter = require('./converter');
const facebook = require('./facebook');
const authServer = require('./auth-server');

let mainWindow;
let usbMonitoringInterval = null;
let driveMonitoringInterval = null;
let knownMountPoints = new Set();
let isProcessingCamera = false;

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

/**
 * Create the main application BrowserWindow and initialize converter callbacks to forward events to the renderer.
 *
 * Sets the global `mainWindow` BrowserWindow, loads the app UI (index.html), and registers converter callbacks that
 * forward `conversion-progress`, `conversion-status`, and `copy-progress` IPC messages to the renderer process.
 */
function createWindow() {
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

  mainWindow.loadFile('index.html');

  // Initialize converter with event callbacks
  converter.init({
    onProgress: (percent) => mainWindow.webContents.send('conversion-progress', percent),
    onStatus: (message) => mainWindow.webContents.send('conversion-status', message),
    onCopyProgress: (percent) => mainWindow.webContents.send('copy-progress', percent)
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
  const result = await dialog.showOpenDialog(mainWindow, {
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
  const settings = loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: settings.outputFolder
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  settings.outputFolder = folderPath;
  saveSettings(settings);
  return folderPath;
});

// Get saved output folder
ipcMain.handle('get-output-folder', async () => {
  const settings = loadSettings();
  return settings.outputFolder || null;
});

// Handle video conversion
ipcMain.handle('convert-video', async (event, inputPath) => {
  const settings = loadSettings();
  return converter.convertVideo(inputPath, settings.outputFolder);
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
function getMountPoints() {
  const mountPoints = [];
  const platform = process.platform;

  try {
    if (platform === 'linux') {
      // Read /proc/mounts for Linux
      const mounts = fs.readFileSync('/proc/mounts', 'utf8');
      const lines = mounts.split('\n');
      for (const line of lines) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          const mountPath = parts[1];
          // Filter for likely removable media paths
          if (mountPath.startsWith('/media/') || mountPath.startsWith('/mnt/') || mountPath.startsWith('/run/media/')) {
            mountPoints.push(mountPath);
          }
        }
      }
    } else if (platform === 'darwin') {
      // macOS - check /Volumes
      const volumes = fs.readdirSync('/Volumes');
      for (const vol of volumes) {
        mountPoints.push(path.join('/Volumes', vol));
      }
    } else if (platform === 'win32') {
      // Windows - enumerate drive letters
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

function checkForCameraDrive(mountPoints) {
  for (const mountPath of mountPoints) {
    const clipPath = path.join(mountPath, 'PRIVATE', 'M4ROOT', 'CLIP');
    if (fs.existsSync(clipPath)) {
      return clipPath;
    }
  }
  return null;
}

/**
 * Find the most recently modified video file inside a camera CLIP directory.
 * @param {string} clipPath - Filesystem path to the directory to scan for video files.
 * @returns {string|null} The full path of the newest video file (extensions checked: .mp4, .mov, .avi, .mkv, .webm), or `null` if no matching file is found or an error occurs.
 */
function getLatestVideoFile(clipPath) {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  try {
    const files = fs.readdirSync(clipPath)
      .filter(f => videoExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(clipPath, f);
        return { name: f, path: fullPath, mtime: fs.statSync(fullPath).mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0] ? files[0].path : null;
  } catch (err) {
    console.error('Error reading clip directory:', err);
    return null;
  }
}

/**
 * Copies a camera video to a temporary file in the configured output folder and triggers conversion.
 *
 * If no output folder is configured, sends an error status and returns. If the file has already been processed,
 * sends a skipped status and returns. Otherwise copies the file to a temp path inside the output folder, reports
 * copy progress and status via IPC, and signals the renderer with `auto-convert-ready` to start conversion. On copy
 * errors (except a cancellation signaled by an error with message "Copy cancelled"), sends an error status and removes
 * any created temporary file.
 *
 * @param {string} sourcePath - Absolute path to the source video file on the camera.
 */
async function copyAndConvert(sourcePath) {
  const settings = loadSettings();
  const outputFolder = settings.outputFolder;

  if (!outputFolder) {
    mainWindow.webContents.send('conversion-status', 'Error: No output folder configured');
    return;
  }

  // Check if already processed
  if (converter.outputExists(sourcePath, outputFolder)) {
    mainWindow.webContents.send('conversion-status', 'File already processed, skipping');
    mainWindow.webContents.send('camera-detected', { status: 'skipped', file: path.basename(sourcePath) });
    return;
  }

  // Create temp copy path
  const tempPath = path.join(outputFolder, `temp_${path.basename(sourcePath)}`);

  try {
    // Copy file
    mainWindow.webContents.send('conversion-status', 'Copying file from camera...');
    await converter.copyFile(sourcePath, tempPath);
    mainWindow.webContents.send('copy-progress', 100);
    mainWindow.webContents.send('conversion-status', 'Copy complete, starting conversion...');

    // Trigger conversion via the existing convert-video handler logic
    mainWindow.webContents.send('auto-convert-ready', tempPath);
  } catch (err) {
    console.error('Error copying file:', err);
    if (err.message !== 'Copy cancelled') {
      mainWindow.webContents.send('conversion-status', `Error copying file: ${err.message}`);
    }
    // Clean up temp file if exists
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function pollDrives() {
  if (isProcessingCamera) return;

  try {
    const currentMountPoints = getMountPoints();
    const currentSet = new Set(currentMountPoints);

    // Check for new mount points
    const newMounts = [];
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
        isProcessingCamera = true;
        mainWindow.webContents.send('camera-detected', { status: 'detected', clipPath });

        const latestVideo = getLatestVideoFile(clipPath);
        if (latestVideo) {
          mainWindow.webContents.send('camera-detected', {
            status: 'found-video',
            file: path.basename(latestVideo)
          });
          copyAndConvert(latestVideo).finally(() => {
            isProcessingCamera = false;
          });
        } else {
          mainWindow.webContents.send('conversion-status', 'No video files found on camera');
          isProcessingCamera = false;
        }
      }
    }
  } catch (err) {
    console.error('Error polling drives:', err);
  }
}

function startUsbMonitoring() {
  if (usbMonitoringInterval) return;

  // Initialize known mount points
  knownMountPoints = new Set(getMountPoints());

  usbMonitoringInterval = setInterval(pollDrives, 2000);
  console.log('USB monitoring started');
}

function stopUsbMonitoring() {
  if (usbMonitoringInterval) {
    clearInterval(usbMonitoringInterval);
    usbMonitoringInterval = null;
    console.log('USB monitoring stopped');
  }
}

// USB Monitoring IPC Handlers
ipcMain.handle('toggle-usb-monitoring', async (event, enabled) => {
  const settings = loadSettings();
  settings.usbMonitoringEnabled = enabled;
  saveSettings(settings);

  if (enabled) {
    startUsbMonitoring();
  } else {
    stopUsbMonitoring();
  }
  return enabled;
});

ipcMain.handle('get-usb-monitoring-status', async () => {
  const settings = loadSettings();
  return {
    enabled: settings.usbMonitoringEnabled || false,
    active: usbMonitoringInterval !== null
  };
});

// Start drive monitoring (always active for video list updates)
function startDriveMonitoring() {
  if (driveMonitoringInterval) return;
  driveMonitoringInterval = setInterval(pollDrivesWithNotification, 2000);
  console.log('Drive monitoring started');
}

function stopDriveMonitoring() {
  if (driveMonitoringInterval) {
    clearInterval(driveMonitoringInterval);
    driveMonitoringInterval = null;
    console.log('Drive monitoring stopped');
  }
}

// Start monitoring on app ready if enabled in settings
app.on('ready', () => {
  // Initialize drive connection status
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  previousDriveConnected = clipPath !== null;

  // Always start drive monitoring for video list updates
  startDriveMonitoring();

  const settings = loadSettings();
  if (settings.usbMonitoringEnabled) {
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

ipcMain.handle('save-facebook-credentials', async (event, credentials) => {
  const settings = loadSettings();
  if (!settings.facebook) {
    settings.facebook = {};
  }
  settings.facebook.appId = credentials.appId;
  settings.facebook.appSecret = credentials.appSecret;
  saveSettings(settings);
  return true;
});

ipcMain.handle('get-facebook-status', async () => {
  const settings = loadSettings();
  if (settings.facebook && settings.facebook.pageAccessToken && settings.facebook.pageName) {
    return {
      connected: true,
      pageName: settings.facebook.pageName
    };
  }
  return {
    connected: false,
    hasCredentials: !!(settings.facebook && settings.facebook.appId && settings.facebook.appSecret)
  };
});

ipcMain.handle('start-facebook-auth', async () => {
  const settings = loadSettings();
  if (!settings.facebook || !settings.facebook.appId || !settings.facebook.appSecret) {
    throw new Error('Facebook App credentials not configured');
  }

  const { appId, appSecret } = settings.facebook;

  // Start local server to receive OAuth callback
  const authPromise = authServer.startAuthServer(8888, 300000);

  // Open browser for authorization
  const authUrl = facebook.getAuthUrl(appId, REDIRECT_URI);
  shell.openExternal(authUrl);

  try {
    // Wait for authorization code
    const code = await authPromise;

    // Exchange code for token
    mainWindow.webContents.send('facebook-status', 'Exchanging authorization code...');
    const shortToken = await facebook.exchangeCodeForToken(code, appId, appSecret, REDIRECT_URI);

    // Get long-lived token
    mainWindow.webContents.send('facebook-status', 'Getting long-lived token...');
    const longToken = await facebook.getLongLivedToken(shortToken, appId, appSecret);

    // Get user's pages
    mainWindow.webContents.send('facebook-status', 'Fetching your pages...');
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

ipcMain.handle('select-facebook-page', async (event, pageInfo) => {
  const settings = loadSettings();
  if (!settings.facebook) {
    settings.facebook = {};
  }
  settings.facebook.pageId = pageInfo.id;
  settings.facebook.pageName = pageInfo.name;
  settings.facebook.pageAccessToken = pageInfo.access_token;
  saveSettings(settings);
  return true;
});

ipcMain.handle('disconnect-facebook', async () => {
  const settings = loadSettings();
  if (settings.facebook) {
    delete settings.facebook.pageId;
    delete settings.facebook.pageName;
    delete settings.facebook.pageAccessToken;
  }
  saveSettings(settings);
  return true;
});

ipcMain.handle('post-to-facebook', async (event, videoPath) => {
  const settings = loadSettings();
  if (!settings.facebook || !settings.facebook.pageAccessToken) {
    throw new Error('Facebook not connected');
  }

  const { pageId, pageAccessToken } = settings.facebook;

  try {
    const result = await facebook.uploadVideoToPage(
      pageId,
      pageAccessToken,
      videoPath,
      new Date(),
      (percent) => mainWindow.webContents.send('facebook-upload-progress', percent),
      (message) => mainWindow.webContents.send('facebook-status', message)
    );

    return result;
  } catch (err) {
    mainWindow.webContents.send('facebook-status', `Upload failed: ${err.message}`);
    throw err;
  }
});

// Video List IPC Handlers
ipcMain.handle('list-video-files', async () => {
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);

  if (!clipPath) {
    return { connected: false, files: [] };
  }

  const settings = loadSettings();
  const outputFolder = settings.outputFolder;

  try {
    const files = fs.readdirSync(clipPath)
      .filter(f => videoExtensions.includes(path.extname(f).toLowerCase()))
      .map(f => {
        const fullPath = path.join(clipPath, f);
        const stats = fs.statSync(fullPath);

        // Determine copy/convert status
        let status = 'on-camera'; // default
        if (outputFolder) {
          // Check if fully converted (in a date subfolder with _1080p suffix)
          if (converter.outputExists(fullPath, outputFolder)) {
            status = 'converted';
          } else {
            // Check if copied but not yet converted (temp_ file in output folder)
            const tempPath = path.join(outputFolder, `temp_${f}`);
            const copiedPath = path.join(outputFolder, f);
            if (fs.existsSync(tempPath) || fs.existsSync(copiedPath)) {
              status = 'copied';
            }
          }
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

    return { connected: true, clipPath, files };
  } catch (err) {
    console.error('Error listing video files:', err);
    return { connected: true, clipPath, files: [] };
  }
});

ipcMain.handle('get-drive-status', async () => {
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  return {
    connected: clipPath !== null,
    clipPath
  };
});

ipcMain.handle('list-converted-videos', async () => {
  const settings = loadSettings();
  const outputFolder = settings.outputFolder;

  if (!outputFolder || !fs.existsSync(outputFolder)) {
    return { files: [] };
  }

  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  try {
    const files = [];

    // Scan date-named subfolders for converted (_1080p) videos
    const entries = fs.readdirSync(outputFolder, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && datePattern.test(entry.name)) {
        const subfolderPath = path.join(outputFolder, entry.name);
        const subFiles = fs.readdirSync(subfolderPath);
        for (const f of subFiles) {
          const ext = path.extname(f).toLowerCase();
          const baseName = path.basename(f, ext);
          if (videoExtensions.includes(ext) && baseName.endsWith('_1080p')) {
            const fullPath = path.join(subfolderPath, f);
            const stats = fs.statSync(fullPath);
            files.push({
              name: f,
              path: fullPath,
              size: stats.size,
              mtime: stats.mtime.getTime(),
              folder: entry.name
            });
          }
        }
      }
    }

    files.sort((a, b) => b.mtime - a.mtime);
    return { files };
  } catch (err) {
    console.error('Error listing converted videos:', err);
    return { files: [] };
  }
});

// Track previous drive status for change detection
let previousDriveConnected = false;

function pollDrivesWithNotification() {
  const mountPoints = getMountPoints();
  const clipPath = checkForCameraDrive(mountPoints);
  const isConnected = clipPath !== null;

  // Emit drive-connection-changed if status changed
  if (isConnected !== previousDriveConnected) {
    previousDriveConnected = isConnected;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive-connection-changed', {
        connected: isConnected,
        clipPath
      });
    }
  }
}
