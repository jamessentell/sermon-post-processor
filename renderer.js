const convertBtn = document.getElementById('convertBtn');
const cancelBtn = document.getElementById('cancelBtn');
const outputFolderBtn = document.getElementById('outputFolderBtn');
const folderDisplay = document.getElementById('folderDisplay');
const progressBar = document.getElementById('progressBar');
const status = document.getElementById('status');
const statusMeta = document.getElementById('statusMeta');
const usbToggle = document.getElementById('usbToggle');
const usbIndicator = document.getElementById('usbIndicator');
const usbStatus = document.getElementById('usbStatus');

// Page elements
const navItems = document.querySelectorAll('.nav-item');
const homePage = document.getElementById('homePage');
const settingsPage = document.getElementById('settingsPage');

// Video list elements
const cameraVideoList = document.getElementById('cameraVideoList');
const convertedVideoList = document.getElementById('convertedVideoList');
const cameraEmptyState = document.getElementById('cameraEmptyState');
const convertedEmptyState = document.getElementById('convertedEmptyState');

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

// Page and video list state
let currentPage = 'home';
let cameraVideos = [];
let convertedVideos = [];
let connectedDrivePath = null;
let isDriveConnected = false;
let isUsbMonitoringEnabled = false;

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

// Page navigation
function switchToPage(pageName) {
  currentPage = pageName;

  // Update nav items
  navItems.forEach(item => {
    if (item.dataset.page === pageName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Show/hide pages
  if (pageName === 'home') {
    homePage.classList.remove('hidden');
    settingsPage.classList.add('hidden');
  } else if (pageName === 'settings') {
    homePage.classList.add('hidden');
    settingsPage.classList.remove('hidden');
  }
}

// Nav click handlers
navItems.forEach(item => {
  item.addEventListener('click', () => {
    switchToPage(item.dataset.page);
  });
});


// Helper functions for formatting
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

// Video list functions
async function refreshCameraVideos() {
  try {
    const result = await window.api.listVideoFiles();
    cameraVideos = result.files || [];
    connectedDrivePath = result.clipPath || null;
    renderCameraVideoList();
  } catch (err) {
    console.error('Error refreshing camera videos:', err);
    showCameraEmptyState('Error loading videos');
  }
}

async function refreshConvertedVideos() {
  try {
    const result = await window.api.listConvertedVideos();
    convertedVideos = result.files || [];
    renderConvertedVideoList();
  } catch (err) {
    console.error('Error refreshing converted videos:', err);
    showConvertedEmptyState('Error loading videos');
  }
}

async function refreshAllVideos() {
  await Promise.all([refreshCameraVideos(), refreshConvertedVideos()]);
}

function renderCameraVideoList() {
  // Clear existing items (except empty state)
  const existingItems = cameraVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  if (cameraVideos.length === 0) {
    showCameraEmptyState();
    return;
  }

  // Hide empty state
  cameraEmptyState.style.display = 'none';

  // Render video items
  cameraVideos.forEach(video => {
    const item = createVideoItem(video, 'camera');
    cameraVideoList.appendChild(item);
  });
}

function renderConvertedVideoList() {
  // Clear existing items (except empty state)
  const existingItems = convertedVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  if (convertedVideos.length === 0) {
    showConvertedEmptyState();
    return;
  }

  // Hide empty state
  convertedEmptyState.style.display = 'none';

  // Render video items
  convertedVideos.forEach(video => {
    const item = createVideoItem(video, 'converted');
    convertedVideoList.appendChild(item);
  });
}

function createVideoItem(video, type) {
  const item = document.createElement('div');
  item.className = 'video-item';
  if (selectedFile === video.path) {
    item.classList.add('selected');
  }
  item.dataset.path = video.path;
  item.dataset.type = type;

  let badgeHtml = '';
  if (type === 'camera' && video.status === 'copied') {
    badgeHtml = '<span class="video-status-badge copied">Copied</span>';
  } else if (type === 'camera' && video.status === 'converted') {
    badgeHtml = '<span class="video-status-badge converted">Converted</span>';
  }

  let metaText = `${formatFileSize(video.size)} • ${formatDate(video.mtime)}`;
  if (type === 'converted' && video.folder) {
    metaText = `${video.folder} • ${formatFileSize(video.size)}`;
  }

  item.innerHTML = `
    <span class="video-icon">${type === 'camera' ? '&#127909;' : '&#127916;'}</span>
    <div class="video-item-info">
      <div class="video-item-name">${video.name}</div>
      <div class="video-item-meta">${metaText}</div>
    </div>
    ${badgeHtml}
  `;
  item.addEventListener('click', () => selectVideoFromList(video, type));
  return item;
}

function showCameraEmptyState(message) {
  // Remove video items
  const existingItems = cameraVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  // Show empty state
  cameraEmptyState.style.display = 'flex';

  if (message) {
    cameraEmptyState.querySelector('.empty-title').textContent = message;
  } else {
    cameraEmptyState.querySelector('.empty-title').textContent = 'No camera connected';
    cameraEmptyState.querySelector('.empty-description').textContent =
      'Connect your camera via USB to see available video files.';
  }
}

function showConvertedEmptyState(message) {
  // Remove video items
  const existingItems = convertedVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  // Show empty state
  convertedEmptyState.style.display = 'flex';

  if (message) {
    convertedEmptyState.querySelector('.empty-title').textContent = message;
  } else {
    convertedEmptyState.querySelector('.empty-title').textContent = 'No converted videos';
    convertedEmptyState.querySelector('.empty-description').textContent =
      'Converted videos will appear here after processing.';
  }
}

function selectVideoFromList(video, type) {
  selectedFile = video.path;
  progressBar.style.width = '0%';
  setProgressState(null);

  // Update button states based on video type
  if (type === 'camera') {
    lastConvertedPath = null;
    updateConvertButton();
    updatePostToFacebookButton();
  } else {
    // Converted videos can be posted but not converted again
    lastConvertedPath = video.path;
    convertBtn.disabled = true;
    updatePostToFacebookButton();
  }

  updateStatus();

  // Update selected state in both lists
  const allItems = document.querySelectorAll('.video-item');
  allItems.forEach(item => {
    if (item.dataset.path === video.path) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Drive connection change listener
window.api.onDriveConnectionChanged((data) => {
  connectedDrivePath = data.clipPath;
  isDriveConnected = data.connected;
  updateUsbIndicator();
  refreshCameraVideos();
});

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
  isUsbMonitoringEnabled = usbMonitoring.enabled;

  // Load initial drive connection status
  const driveStatus = await window.api.getDriveStatus();
  isDriveConnected = driveStatus.connected;
  connectedDrivePath = driveStatus.clipPath || null;
  updateUsbIndicator();

  // Load Facebook status
  await initFacebook();

  // Load video lists
  await refreshAllVideos();
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

function updateUsbIndicator(override) {
  usbIndicator.classList.remove('active', 'detected', 'connected');

  // Transient states from camera auto-detect flow
  if (override === 'detected') {
    usbStatus.textContent = 'Camera detected!';
    usbIndicator.classList.add('detected');
    return;
  }
  if (override === 'copying') {
    usbStatus.textContent = 'Copying from camera...';
    usbIndicator.classList.add('detected');
    return;
  }

  // Steady states derived from connection + monitoring
  if (isDriveConnected) {
    usbStatus.textContent = 'USB Connected';
    usbIndicator.classList.add('connected');
  } else if (isUsbMonitoringEnabled) {
    usbStatus.textContent = 'Monitoring for USB';
    usbIndicator.classList.add('active');
  } else {
    usbStatus.textContent = 'USB Not Connected';
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

convertBtn.addEventListener('click', async () => {
  if (!selectedFile || !outputFolder || isConverting) return;

  isConverting = true;
  convertBtn.disabled = true;
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
    outputFolderBtn.disabled = false;
    showCancelButton(false);
    updatePostToFacebookButton();
    // Refresh converted videos list after conversion
    refreshConvertedVideos();
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
    outputFolderBtn.disabled = false;
    usbToggle.disabled = false;
    showCancelButton(false);
    setProgressState(null);
    progressBar.style.width = '0%';
    statusMeta.textContent = '';
    // Reset USB indicator
    updateUsbIndicator();
    // Reset selection
    selectedFile = null;
    // Deselect any selected video items
    document.querySelectorAll('.video-item.selected').forEach(item => item.classList.remove('selected'));
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
  isUsbMonitoringEnabled = enabled;
  await window.api.toggleUsbMonitoring(enabled);
  updateUsbIndicator();
});

// Camera detection events
window.api.onCameraDetected((data) => {
  switch (data.status) {
    case 'detected':
      updateUsbIndicator('detected');
      status.textContent = 'Camera detected, searching for videos...';
      setStatusState('working');
      // Disable UI when camera is detected
      outputFolderBtn.disabled = true;
      convertBtn.disabled = true;
      usbToggle.disabled = true;
      break;
    case 'found-video':
      updateUsbIndicator('copying');
      status.textContent = `Found: ${data.file}`;
      setStatusState('working');
      setProgressState('active');
      // Show cancel button for copy operation
      showCancelButton(true);
      isConverting = true; // Treat copy as part of conversion process
      break;
    case 'skipped':
      updateUsbIndicator();
      status.textContent = `${data.file} already processed, skipping`;
      setStatusState('success');
      // Re-enable UI
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
  updateUsbIndicator();
  isConverting = true;
  convertBtn.disabled = true;
  outputFolderBtn.disabled = true;
  usbToggle.disabled = true;
  showCancelButton(true);
  updatePostToFacebookButton();
  setProgressState('active');
  setStatusState('working');

  // Set the selected file for auto-conversion
  selectedFile = filePath;

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
    outputFolderBtn.disabled = false;
    usbToggle.disabled = false;
    showCancelButton(false);
    updatePostToFacebookButton();
    // Refresh converted videos list after conversion
    refreshConvertedVideos();
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
