const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

let mainWindow;

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
    const basename = path.basename(inputPath, ext);
    const outputPath = path.join(dateFolder, `${basename}_1080p${ext}`);

    ffmpeg(inputPath)
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
        mainWindow.webContents.send('conversion-progress', 100);
        mainWindow.webContents.send('conversion-status', 'Conversion complete!');
        resolve(outputPath);
      })
      .on('error', (err) => {
        mainWindow.webContents.send('conversion-status', `Error: ${err.message}`);
        reject(err);
      })
      .run();
  });
});
