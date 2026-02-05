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

// Facebook elements
const facebookStatus = document.getElementById('facebookStatus');
const facebookConnectBtn = document.getElementById('facebookConnectBtn');
const postToFacebookBtn = document.getElementById('postToFacebookBtn');
const setupModal = document.getElementById('setupModal');
const pageModal = document.getElementById('pageModal');
const appIdInput = document.getElementById('appIdInput');
const appSecretInput = document.getElementById('appSecretInput');
const setupSaveBtn = document.getElementById('setupSaveBtn');
const setupCancelBtn = document.getElementById('setupCancelBtn');
const pageList = document.getElementById('pageList');
const pageCancelBtn = document.getElementById('pageCancelBtn');

let selectedFile = null;
let outputFolder = null;
let isConverting = false;
let lastConvertedPath = null;
let isPostingToFacebook = false;
let isFacebookConnected = false;

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

  // Load Facebook status
  await initFacebook();
}

async function initFacebook() {
  try {
    const fbStatus = await window.api.getFacebookStatus();
    updateFacebookUI(fbStatus);
  } catch (err) {
    console.error('Error loading Facebook status:', err);
  }
}

function updateFacebookUI(fbStatus) {
  isFacebookConnected = fbStatus.connected;
  if (fbStatus.connected) {
    facebookStatus.textContent = `Connected: ${fbStatus.pageName}`;
    facebookStatus.classList.add('connected');
    facebookConnectBtn.textContent = 'Disconnect';
    facebookConnectBtn.classList.add('disconnect');
  } else {
    facebookStatus.textContent = 'Not connected';
    facebookStatus.classList.remove('connected');
    facebookConnectBtn.textContent = fbStatus.hasCredentials ? 'Connect' : 'Setup';
    facebookConnectBtn.classList.remove('disconnect');
  }
  updatePostToFacebookButton();
}

function updatePostToFacebookButton() {
  postToFacebookBtn.disabled = !lastConvertedPath || !isFacebookConnected || isPostingToFacebook || isConverting;
}

function showSetupModal() {
  setupModal.classList.add('visible');
}

function hideSetupModal() {
  setupModal.classList.remove('visible');
  appIdInput.value = '';
  appSecretInput.value = '';
}

function showPageModal(pages) {
  pageList.innerHTML = '';
  pages.forEach(page => {
    const item = document.createElement('div');
    item.className = 'page-item';
    item.innerHTML = `
      <div class="page-name">${page.name}</div>
      <div class="page-id">ID: ${page.id}</div>
    `;
    item.addEventListener('click', () => selectPage(page));
    pageList.appendChild(item);
  });
  pageModal.classList.add('visible');
}

function hidePageModal() {
  pageModal.classList.remove('visible');
}

async function selectPage(page) {
  try {
    await window.api.selectFacebookPage(page);
    hidePageModal();
    await initFacebook();
    status.textContent = `Connected to ${page.name}`;
    status.className = 'status success';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  }
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
  updatePostToFacebookButton();

  try {
    const outputPath = await window.api.convertVideo(selectedFile);
    lastConvertedPath = outputPath;
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
    updatePostToFacebookButton();
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
  updatePostToFacebookButton();

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
    lastConvertedPath = outputPath;
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
    updatePostToFacebookButton();
  }
});

// Facebook event handlers
facebookConnectBtn.addEventListener('click', async () => {
  if (isFacebookConnected) {
    // Disconnect
    try {
      await window.api.disconnectFacebook();
      await initFacebook();
      status.textContent = 'Disconnected from Facebook';
      status.className = 'status';
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'status error';
    }
  } else {
    // Check if we have credentials
    const fbStatus = await window.api.getFacebookStatus();
    if (fbStatus.hasCredentials) {
      // Start OAuth flow
      startFacebookAuth();
    } else {
      // Show setup modal
      showSetupModal();
    }
  }
});

setupCancelBtn.addEventListener('click', hideSetupModal);

setupSaveBtn.addEventListener('click', async () => {
  const appId = appIdInput.value.trim();
  const appSecret = appSecretInput.value.trim();

  if (!appId || !appSecret) {
    status.textContent = 'Please enter both App ID and App Secret';
    status.className = 'status error';
    return;
  }

  try {
    await window.api.saveFacebookCredentials({ appId, appSecret });
    hideSetupModal();
    startFacebookAuth();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  }
});

pageCancelBtn.addEventListener('click', hidePageModal);

async function startFacebookAuth() {
  facebookConnectBtn.disabled = true;
  status.textContent = 'Opening browser for authorization...';
  status.className = 'status';

  try {
    const pages = await window.api.startFacebookAuth();
    showPageModal(pages);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  } finally {
    facebookConnectBtn.disabled = false;
  }
}

postToFacebookBtn.addEventListener('click', async () => {
  if (!lastConvertedPath || !isFacebookConnected || isPostingToFacebook) return;

  isPostingToFacebook = true;
  postToFacebookBtn.disabled = true;
  progressBar.style.width = '0%';

  try {
    const result = await window.api.postToFacebook(lastConvertedPath);
    if (result.success) {
      status.textContent = 'Video posted to Facebook!';
      status.className = 'status success';
    }
  } catch (err) {
    status.textContent = `Facebook upload failed: ${err.message}`;
    status.className = 'status error';
  } finally {
    isPostingToFacebook = false;
    updatePostToFacebookButton();
  }
});

// Facebook progress and status listeners
window.api.onFacebookUploadProgress((percent) => {
  progressBar.style.width = `${percent}%`;
});

window.api.onFacebookStatus((message) => {
  status.textContent = message;
  status.className = 'status';
});

init();
