const selectBtn = document.getElementById('selectBtn');
const convertBtn = document.getElementById('convertBtn');
const cancelBtn = document.getElementById('cancelBtn');
const outputFolderBtn = document.getElementById('outputFolderBtn');
const fileDisplay = document.getElementById('fileDisplay');
const folderDisplay = document.getElementById('folderDisplay');
const progressBar = document.getElementById('progressBar');
const status = document.getElementById('status');
const usbToggle = document.getElementById('usbToggle');
const usbStatus = document.getElementById('usbStatus');

let selectedFile = null;
let outputFolder = null;
let isConverting = false;

function showCancelButton(show) {
  if (show) {
    cancelBtn.classList.add('visible');
  } else {
    cancelBtn.classList.remove('visible');
  }
}

// Load saved output folder and USB monitoring status on startup
async function init() {
  const savedFolder = await window.api.getOutputFolder();
  if (savedFolder) {
    outputFolder = savedFolder;
    folderDisplay.textContent = savedFolder;
    folderDisplay.classList.add('has-folder');
    updateConvertButton();
  }

  // Load USB monitoring status
  const usbMonitoring = await window.api.getUsbMonitoringStatus();
  usbToggle.checked = usbMonitoring.enabled;
  updateUsbStatus(usbMonitoring.active ? 'monitoring' : null);
}

function updateUsbStatus(state) {
  usbStatus.className = 'usb-status';
  switch (state) {
    case 'monitoring':
      usbStatus.textContent = 'Monitoring...';
      usbStatus.classList.add('active');
      break;
    case 'detected':
      usbStatus.textContent = 'Camera detected!';
      usbStatus.classList.add('detected');
      break;
    case 'copying':
      usbStatus.textContent = 'Copying...';
      usbStatus.classList.add('detected');
      break;
    default:
      usbStatus.textContent = '';
  }
}

function updateConvertButton() {
  convertBtn.disabled = !selectedFile || !outputFolder || isConverting;
}

function updateStatus() {
  if (!outputFolder && !selectedFile) {
    status.textContent = 'Select an output folder and video file to begin';
  } else if (!outputFolder) {
    status.textContent = 'Select an output folder';
  } else if (!selectedFile) {
    status.textContent = 'Select a video file';
  } else {
    status.textContent = 'Ready to convert';
  }
  status.className = 'status';
}

outputFolderBtn.addEventListener('click', async () => {
  if (isConverting) return;

  const folderPath = await window.api.selectOutputFolder();
  if (folderPath) {
    outputFolder = folderPath;
    folderDisplay.textContent = folderPath;
    folderDisplay.classList.add('has-folder');
    updateConvertButton();
    updateStatus();
  }
});

selectBtn.addEventListener('click', async () => {
  if (isConverting) return;

  const filePath = await window.api.selectFile();
  if (filePath) {
    selectedFile = filePath;
    fileDisplay.textContent = filePath;
    fileDisplay.classList.add('has-file');
    progressBar.style.width = '0%';
    updateConvertButton();
    updateStatus();
  }
});

convertBtn.addEventListener('click', async () => {
  if (!selectedFile || !outputFolder || isConverting) return;

  isConverting = true;
  convertBtn.disabled = true;
  selectBtn.disabled = true;
  outputFolderBtn.disabled = true;
  showCancelButton(true);

  try {
    const outputPath = await window.api.convertVideo(selectedFile);
    status.textContent = `Saved: ${outputPath}`;
    status.className = 'status success';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  } finally {
    isConverting = false;
    updateConvertButton();
    selectBtn.disabled = false;
    outputFolderBtn.disabled = false;
    showCancelButton(false);
  }
});

cancelBtn.addEventListener('click', async () => {
  if (!isConverting) return;

  cancelBtn.disabled = true;
  status.textContent = 'Cancelling...';
  status.className = 'status';

  try {
    await window.api.cancelConversion();
  } catch (err) {
    console.error('Error cancelling:', err);
  } finally {
    cancelBtn.disabled = false;
    isConverting = false;
    updateConvertButton();
    selectBtn.disabled = false;
    outputFolderBtn.disabled = false;
    usbToggle.disabled = false;
    showCancelButton(false);
    // Reset USB status if monitoring is enabled
    if (usbToggle.checked) {
      updateUsbStatus('monitoring');
    }
    // Reset file display
    selectedFile = null;
    fileDisplay.textContent = 'No file selected';
    fileDisplay.classList.remove('has-file');
  }
});

window.api.onProgress((percent) => {
  progressBar.style.width = `${percent}%`;
});

window.api.onStatus((message) => {
  status.textContent = message;
  status.className = 'status';

  if (message.includes('complete')) {
    status.className = 'status success';
  } else if (message.includes('Error')) {
    status.className = 'status error';
  }
});

// USB monitoring toggle
usbToggle.addEventListener('change', async () => {
  const enabled = usbToggle.checked;
  await window.api.toggleUsbMonitoring(enabled);
  updateUsbStatus(enabled ? 'monitoring' : null);
});

// Camera detection events
window.api.onCameraDetected((data) => {
  switch (data.status) {
    case 'detected':
      updateUsbStatus('detected');
      status.textContent = 'Camera detected, searching for videos...';
      status.className = 'status';
      // Disable UI when camera is detected
      selectBtn.disabled = true;
      outputFolderBtn.disabled = true;
      convertBtn.disabled = true;
      usbToggle.disabled = true;
      break;
    case 'found-video':
      updateUsbStatus('copying');
      status.textContent = `Found: ${data.file}`;
      status.className = 'status';
      // Show cancel button for copy operation
      showCancelButton(true);
      isConverting = true; // Treat copy as part of conversion process
      break;
    case 'skipped':
      updateUsbStatus('monitoring');
      status.textContent = `${data.file} already processed, skipping`;
      status.className = 'status success';
      // Re-enable UI
      selectBtn.disabled = false;
      outputFolderBtn.disabled = false;
      usbToggle.disabled = false;
      updateConvertButton();
      break;
  }
});

// Copy progress
window.api.onCopyProgress((percent) => {
  progressBar.style.width = `${percent}%`;
  if (percent < 100) {
    status.textContent = `Copying: ${percent.toFixed(1)}%`;
    status.className = 'status';
  }
});

// Auto-convert after copy completes
window.api.onAutoConvertReady(async (filePath) => {
  updateUsbStatus('monitoring');
  isConverting = true;
  convertBtn.disabled = true;
  selectBtn.disabled = true;
  outputFolderBtn.disabled = true;
  usbToggle.disabled = true;
  showCancelButton(true);

  // Update file display to show the auto-detected file (remove temp_ prefix for cleaner display)
  selectedFile = filePath;
  let displayName = filePath;
  const tempPrefix = 'temp_';
  const lastSlash = filePath.lastIndexOf('/') !== -1 ? filePath.lastIndexOf('/') : filePath.lastIndexOf('\\');
  if (lastSlash !== -1) {
    const dir = filePath.substring(0, lastSlash + 1);
    const filename = filePath.substring(lastSlash + 1);
    if (filename.startsWith(tempPrefix)) {
      displayName = dir + filename.substring(tempPrefix.length);
    }
  }
  fileDisplay.textContent = displayName;
  fileDisplay.classList.add('has-file');

  // Reset progress bar for conversion (was showing copy progress)
  progressBar.style.width = '0%';

  try {
    const outputPath = await window.api.convertVideo(filePath);
    status.textContent = `Saved: ${outputPath}`;
    status.className = 'status success';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  } finally {
    isConverting = false;
    updateConvertButton();
    selectBtn.disabled = false;
    outputFolderBtn.disabled = false;
    usbToggle.disabled = false;
    showCancelButton(false);
  }
});

init();
