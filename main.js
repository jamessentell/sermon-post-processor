const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

let mainWindow;
let usbMonitoringInterval = null;
let knownMountPoints = new Set();
let isProcessingCamera = false;
let currentFfmpegProcess = null;
let currentOutputPath = null;
let currentTempPath = null;
let currentCopyStreams = null;
let isCopyCancelled = false;

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
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
  const outputFolder = settings.outputFolder;

  if (!outputFolder) {
    throw new Error('Please select an output folder first');
  }

  // Track if this is a temp file (from auto-detection)
  const basename = path.basename(inputPath);
  if (basename.startsWith('temp_')) {
    currentTempPath = inputPath;
  }

  return new Promise((resolve, reject) => {
    // Get file modification date
    const stats = fs.statSync(inputPath);
    const fileDate = stats.mtime;
    const dateFolderName = fileDate.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Create date-based subfolder
    const dateFolder = path.join(outputFolder, dateFolderName);
    if (!fs.existsSync(dateFolder)) {
      fs.mkdirSync(dateFolder, { recursive: true });
    }

    const ext = path.extname(inputPath);
    // Remove temp_ prefix from output filename if present
    let outputBasename = path.basename(inputPath, ext);
    if (outputBasename.startsWith('temp_')) {
      outputBasename = outputBasename.substring(5);
    }
    const outputPath = path.join(dateFolder, `${outputBasename}_1080p${ext}`);
    currentOutputPath = outputPath;

    const ffmpegProcess = ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'scale=-2:1080',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k'
      ])
      .output(outputPath)
      .on('start', () => {
        mainWindow.webContents.send('conversion-status', 'Starting conversion...');
      })
      .on('progress', (progress) => {
        const percent = progress.percent || 0;
        mainWindow.webContents.send('conversion-progress', percent);
        mainWindow.webContents.send('conversion-status', `Converting: ${percent.toFixed(1)}%`);
      })
      .on('end', () => {
        currentFfmpegProcess = null;
        currentOutputPath = null;
        // Clean up temp file after successful conversion
        if (currentTempPath && fs.existsSync(currentTempPath)) {
          fs.unlinkSync(currentTempPath);
          currentTempPath = null;
        }
        mainWindow.webContents.send('conversion-progress', 100);
        mainWindow.webContents.send('conversion-status', 'Conversion complete!');
        resolve(outputPath);
      })
      .on('error', (err, stdout, stderr) => {
        currentFfmpegProcess = null;
        currentOutputPath = null;
        // Don't report error if it was cancelled
        if (err.message.includes('SIGKILL') || err.message.includes('ffmpeg was killed')) {
          return;
        }
        mainWindow.webContents.send('conversion-status', `Error: ${err.message}`);
        reject(err);
      });

    currentFfmpegProcess = ffmpegProcess;
    ffmpegProcess.run();
  });
});

// Handle conversion/copy cancellation
ipcMain.handle('cancel-conversion', async () => {
  let wasCopying = false;

  // Cancel copy operation if in progress
  if (currentCopyStreams) {
    wasCopying = true;
    isCopyCancelled = true;
    const { readStream, writeStream, destPath } = currentCopyStreams;

    readStream.destroy();
    writeStream.destroy();
    currentCopyStreams = null;

    // Clean up partial copy file
    if (destPath && fs.existsSync(destPath)) {
      try {
        fs.unlinkSync(destPath);
      } catch (err) {
        console.error('Error deleting partial copy file:', err);
      }
    }

    isProcessingCamera = false;
  }

  // Cancel ffmpeg if in progress
  if (currentFfmpegProcess) {
    currentFfmpegProcess.kill('SIGKILL');
    currentFfmpegProcess = null;
  }

  // Clean up partial output file
  if (currentOutputPath && fs.existsSync(currentOutputPath)) {
    try {
      fs.unlinkSync(currentOutputPath);
    } catch (err) {
      console.error('Error deleting partial output file:', err);
    }
  }

  // Clean up temp file from auto-detection
  if (currentTempPath && fs.existsSync(currentTempPath)) {
    try {
      fs.unlinkSync(currentTempPath);
    } catch (err) {
      console.error('Error deleting temp file:', err);
    }
  }

  currentOutputPath = null;
  currentTempPath = null;

  const message = wasCopying ? 'Copy cancelled' : 'Conversion cancelled';
  mainWindow.webContents.send('conversion-status', message);
  mainWindow.webContents.send('conversion-progress', 0);

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

function fileExistsInOutput(sourcePath) {
  const settings = loadSettings();
  const outputFolder = settings.outputFolder;
  if (!outputFolder) return false;

  const stats = fs.statSync(sourcePath);
  const fileDate = stats.mtime;
  const dateFolderName = fileDate.toISOString().split('T')[0];
  const dateFolder = path.join(outputFolder, dateFolderName);

  const ext = path.extname(sourcePath);
  const basename = path.basename(sourcePath, ext);
  const outputPath = path.join(dateFolder, `${basename}_1080p${ext}`);

  return fs.existsSync(outputPath);
}

async function copyFile(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(sourcePath);
    const totalSize = stats.size;
    let copiedSize = 0;
    isCopyCancelled = false;

    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destPath);

    // Store streams for potential cancellation
    currentCopyStreams = { readStream, writeStream, destPath };

    readStream.on('data', (chunk) => {
      copiedSize += chunk.length;
      const percent = (copiedSize / totalSize) * 100;
      mainWindow.webContents.send('copy-progress', percent);
    });

    readStream.on('error', (err) => {
      currentCopyStreams = null;
      if (!isCopyCancelled) {
        reject(err);
      }
    });

    writeStream.on('error', (err) => {
      currentCopyStreams = null;
      if (!isCopyCancelled) {
        reject(err);
      }
    });

    writeStream.on('finish', () => {
      currentCopyStreams = null;
      if (!isCopyCancelled) {
        resolve();
      }
    });

    writeStream.on('close', () => {
      if (isCopyCancelled) {
        reject(new Error('Copy cancelled'));
      }
    });

    readStream.pipe(writeStream);
  });
}

async function copyAndConvert(sourcePath) {
  const settings = loadSettings();
  const outputFolder = settings.outputFolder;

  if (!outputFolder) {
    mainWindow.webContents.send('conversion-status', 'Error: No output folder configured');
    return;
  }

  // Check if already processed
  if (fileExistsInOutput(sourcePath)) {
    mainWindow.webContents.send('conversion-status', 'File already processed, skipping');
    mainWindow.webContents.send('camera-detected', { status: 'skipped', file: path.basename(sourcePath) });
    return;
  }

  // Create temp copy path
  const tempPath = path.join(outputFolder, `temp_${path.basename(sourcePath)}`);

  try {
    // Copy file
    mainWindow.webContents.send('conversion-status', 'Copying file from camera...');
    await copyFile(sourcePath, tempPath);
    mainWindow.webContents.send('copy-progress', 100);
    mainWindow.webContents.send('conversion-status', 'Copy complete, starting conversion...');

    // Trigger conversion via the existing convert-video handler logic
    // We'll emit an event to tell renderer to start conversion
    mainWindow.webContents.send('auto-convert-ready', tempPath);
  } catch (err) {
    console.error('Error copying file:', err);
    mainWindow.webContents.send('conversion-status', `Error copying file: ${err.message}`);
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

// Start monitoring on app ready if enabled in settings
app.on('ready', () => {
  const settings = loadSettings();
  if (settings.usbMonitoringEnabled) {
    startUsbMonitoring();
  }
});

// Stop monitoring on app quit
app.on('before-quit', () => {
  stopUsbMonitoring();
});
