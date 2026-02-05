const selectBtn = document.getElementById('selectBtn');
const convertBtn = document.getElementById('convertBtn');
const cancelBtn = document.getElementById('cancelBtn');
const outputFolderBtn = document.getElementById('outputFolderBtn');
const fileDisplay = document.getElementById('fileDisplay');
const folderDisplay = document.getElementById('folderDisplay');
const progressBar = document.getElementById('progressBar');
const status = document.getElementById('status');
const statusMeta = document.getElementById('statusMeta');
const usbToggle = document.getElementById('usbToggle');
const usbIndicator = document.getElementById('usbIndicator');
const usbStatus = document.getElementById('usbStatus');

// Facebook elements
const facebookStatusContainer = document.getElementById('facebookStatusContainer');
const facebookStatusText = document.getElementById('facebookStatus');
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
    cancelBtn.classList.remove('hidden');
  } else {
    cancelBtn.classList.add('hidden');
  }
}

function setProgressState(state) {
  progressBar.classList.remove('active', 'success', 'error');
  if (state) {
    progressBar.classList.add(state);
  }
}

function setStatusState(state) {
  status.classList.remove('success', 'error', 'working');
  if (state) {
    status.classList.add(state);
  }
}

// Load saved output folder and USB monitoring status on startup
async function init() {
  const savedFolder = await window.api.getOutputFolder();
  if (savedFolder) {
    outputFolder = savedFolder;
    folderDisplay.textContent = savedFolder;
    folderDisplay.classList.add('has-value');
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
    facebookStatusText.textContent = `Facebook: ${fbStatus.pageName}`;
    facebookStatusContainer.classList.add('connected');
    facebookConnectBtn.textContent = 'Disconnect';
  } else {
    facebookStatusText.textContent = 'Facebook: Not connected';
    facebookStatusContainer.classList.remove('connected');
    facebookConnectBtn.textContent = fbStatus.hasCredentials ? 'Connect' : 'Setup';
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
    setStatusState('success');
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    setStatusState('error');
  }
}

function updateUsbStatus(state) {
  usbIndicator.classList.remove('active', 'detected');
  switch (state) {
    case 'monitoring':
      usbStatus.textContent = 'Monitoring for USB';
      usbIndicator.classList.add('active');
      break;
    case 'detected':
      usbStatus.textContent = 'Camera detected!';
      usbIndicator.classList.add('detected');
      break;
    case 'copying':
      usbStatus.textContent = 'Copying from camera...';
      usbIndicator.classList.add('detected');
      break;
    default:
      usbStatus.textContent = 'USB Monitoring Off';
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
  setStatusState(null);
}

outputFolderBtn.addEventListener('click', async () => {
  if (isConverting) return;

  const folderPath = await window.api.selectOutputFolder();
  if (folderPath) {
    outputFolder = folderPath;
    folderDisplay.textContent = folderPath;
    folderDisplay.classList.add('has-value');
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
    fileDisplay.classList.add('has-value');
    progressBar.style.width = '0%';
    setProgressState(null);
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
  setProgressState('active');
  setStatusState('working');

  try {
    const outputPath = await window.api.convertVideo(selectedFile);
    lastConvertedPath = outputPath;
    status.textContent = `Saved: ${outputPath}`;
    setStatusState('success');
    setProgressState('success');
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    setStatusState('error');
    setProgressState('error');
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
  setStatusState(null);

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
    setProgressState(null);
    progressBar.style.width = '0%';
    statusMeta.textContent = '';
    // Reset USB status if monitoring is enabled
    if (usbToggle.checked) {
      updateUsbStatus('monitoring');
    }
    // Reset file display
    selectedFile = null;
    fileDisplay.textContent = 'No file selected';
    fileDisplay.classList.remove('has-value');
  }
});

window.api.onProgress((percent) => {
  progressBar.style.width = `${percent}%`;
  statusMeta.textContent = `${percent.toFixed(0)}%`;
});

window.api.onStatus((message) => {
  status.textContent = message;
  setStatusState('working');

  if (message.includes('complete') || message.includes('Saved')) {
    setStatusState('success');
    setProgressState('success');
  } else if (message.includes('Error')) {
    setStatusState('error');
    setProgressState('error');
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
      setStatusState('working');
      // Disable UI when camera is detected
      selectBtn.disabled = true;
      outputFolderBtn.disabled = true;
      convertBtn.disabled = true;
      usbToggle.disabled = true;
      break;
    case 'found-video':
      updateUsbStatus('copying');
      status.textContent = `Found: ${data.file}`;
      setStatusState('working');
      setProgressState('active');
      // Show cancel button for copy operation
      showCancelButton(true);
      isConverting = true; // Treat copy as part of conversion process
      break;
    case 'skipped':
      updateUsbStatus('monitoring');
      status.textContent = `${data.file} already processed, skipping`;
      setStatusState('success');
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
  statusMeta.textContent = `Copying: ${percent.toFixed(0)}%`;
  if (percent < 100) {
    status.textContent = `Copying from camera...`;
    setStatusState('working');
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
  setProgressState('active');
  setStatusState('working');

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
  fileDisplay.classList.add('has-value');

  // Reset progress bar for conversion (was showing copy progress)
  progressBar.style.width = '0%';
  statusMeta.textContent = '';

  try {
    const outputPath = await window.api.convertVideo(filePath);
    lastConvertedPath = outputPath;
    status.textContent = `Saved: ${outputPath}`;
    setStatusState('success');
    setProgressState('success');
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    setStatusState('error');
    setProgressState('error');
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
      setStatusState(null);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      setStatusState('error');
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
    setStatusState('error');
    return;
  }

  try {
    await window.api.saveFacebookCredentials({ appId, appSecret });
    hideSetupModal();
    startFacebookAuth();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    setStatusState('error');
  }
});

pageCancelBtn.addEventListener('click', hidePageModal);

async function startFacebookAuth() {
  facebookConnectBtn.disabled = true;
  status.textContent = 'Opening browser for authorization...';
  setStatusState('working');

  try {
    const pages = await window.api.startFacebookAuth();
    showPageModal(pages);
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    setStatusState('error');
  } finally {
    facebookConnectBtn.disabled = false;
  }
}

postToFacebookBtn.addEventListener('click', async () => {
  if (!lastConvertedPath || !isFacebookConnected || isPostingToFacebook) return;

  isPostingToFacebook = true;
  postToFacebookBtn.disabled = true;
  progressBar.style.width = '0%';
  setProgressState('active');
  setStatusState('working');
  statusMeta.textContent = '';

  try {
    const result = await window.api.postToFacebook(lastConvertedPath);
    if (result.success) {
      status.textContent = 'Video posted to Facebook!';
      setStatusState('success');
      setProgressState('success');
    }
  } catch (err) {
    status.textContent = `Facebook upload failed: ${err.message}`;
    setStatusState('error');
    setProgressState('error');
  } finally {
    isPostingToFacebook = false;
    updatePostToFacebookButton();
  }
});

// Facebook progress and status listeners
window.api.onFacebookUploadProgress((percent) => {
  progressBar.style.width = `${percent}%`;
  statusMeta.textContent = `Uploading: ${percent}%`;
});

window.api.onFacebookStatus((message) => {
  status.textContent = message;
  setStatusState('working');
});

init();
