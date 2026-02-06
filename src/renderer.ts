interface VideoFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  status?: 'on-camera' | 'copied' | 'converted';
}

interface ConvertedVideo {
  name: string;
  path: string;
  size: number;
  mtime: number;
  folder?: string;
}

interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

interface FacebookStatus {
  connected: boolean;
  pageName?: string;
  hasCredentials?: boolean;
}

interface DriveConnectionData {
  connected: boolean;
  clipPath: string | null;
}

interface CameraDetectionData {
  status: 'detected' | 'found-video' | 'skipped';
  clipPath?: string;
  file?: string;
}

interface ElectronApi {
  selectFile: () => Promise<string | null>;
  selectOutputFolder: () => Promise<string | null>;
  getOutputFolder: () => Promise<string | null>;
  convertVideo: (filePath: string) => Promise<string>;
  cancelConversion: () => Promise<boolean>;
  onProgress: (callback: (percent: number) => void) => void;
  onStatus: (callback: (message: string) => void) => void;
  toggleUsbMonitoring: (enabled: boolean) => Promise<boolean>;
  getUsbMonitoringStatus: () => Promise<{ enabled: boolean; active: boolean }>;
  onCameraDetected: (callback: (data: CameraDetectionData) => void) => void;
  onCopyProgress: (callback: (percent: number) => void) => void;
  onAutoConvertReady: (callback: (filePath: string) => void) => void;
  listVideoFiles: () => Promise<{ connected: boolean; clipPath?: string; files: VideoFile[] }>;
  listConvertedVideos: () => Promise<{ files: ConvertedVideo[] }>;
  getDriveStatus: () => Promise<{ connected: boolean; clipPath?: string | null }>;
  onDriveConnectionChanged: (callback: (data: DriveConnectionData) => void) => void;
  saveFacebookCredentials: (credentials: { appId: string; appSecret: string }) => Promise<boolean>;
  getFacebookStatus: () => Promise<FacebookStatus>;
  startFacebookAuth: () => Promise<FacebookPage[]>;
  selectFacebookPage: (pageInfo: FacebookPage) => Promise<boolean>;
  disconnectFacebook: () => Promise<boolean>;
  postToFacebook: (videoPath: string) => Promise<{ success: boolean; videoId: string }>;
  onFacebookUploadProgress: (callback: (percent: number) => void) => void;
  onFacebookStatus: (callback: (message: string) => void) => void;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

const convertBtn = document.getElementById('convertBtn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
const outputFolderBtn = document.getElementById('outputFolderBtn') as HTMLButtonElement;
const folderDisplay = document.getElementById('folderDisplay') as HTMLElement;
const progressBar = document.getElementById('progressBar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const statusMeta = document.getElementById('statusMeta') as HTMLElement;
const usbToggle = document.getElementById('usbToggle') as HTMLInputElement;
const usbIndicator = document.getElementById('usbIndicator') as HTMLElement;
const usbStatus = document.getElementById('usbStatus') as HTMLElement;

// Page elements
const navItems = document.querySelectorAll('.nav-item') as NodeListOf<HTMLElement>;
const homePage = document.getElementById('homePage') as HTMLElement;
const settingsPage = document.getElementById('settingsPage') as HTMLElement;

// Video list elements
const cameraVideoList = document.getElementById('cameraVideoList') as HTMLElement;
const convertedVideoList = document.getElementById('convertedVideoList') as HTMLElement;
const cameraEmptyState = document.getElementById('cameraEmptyState') as HTMLElement;
const convertedEmptyState = document.getElementById('convertedEmptyState') as HTMLElement;

// Facebook elements
const facebookStatusContainer = document.getElementById('facebookStatusContainer') as HTMLElement;
const facebookStatusText = document.getElementById('facebookStatus') as HTMLElement;
const facebookConnectBtn = document.getElementById('facebookConnectBtn') as HTMLButtonElement;
const postToFacebookBtn = document.getElementById('postToFacebookBtn') as HTMLButtonElement;
const setupModal = document.getElementById('setupModal') as HTMLElement;
const pageModal = document.getElementById('pageModal') as HTMLElement;
const appIdInput = document.getElementById('appIdInput') as HTMLInputElement;
const appSecretInput = document.getElementById('appSecretInput') as HTMLInputElement;
const setupSaveBtn = document.getElementById('setupSaveBtn') as HTMLButtonElement;
const setupCancelBtn = document.getElementById('setupCancelBtn') as HTMLButtonElement;
const pageList = document.getElementById('pageList') as HTMLElement;
const pageCancelBtn = document.getElementById('pageCancelBtn') as HTMLButtonElement;

let selectedFile: string | null = null;
let outputFolder: string | null = null;
let isConverting = false;
let lastConvertedPath: string | null = null;
let isPostingToFacebook = false;
let isFacebookConnected = false;

// Page and video list state
let currentPage = 'home';
let cameraVideos: VideoFile[] = [];
let convertedVideos: ConvertedVideo[] = [];
let connectedDrivePath: string | null = null;
let isDriveConnected = false;
let isUsbMonitoringEnabled = false;

function showCancelButton(show: boolean): void {
  if (show) {
    cancelBtn.classList.remove('hidden');
  } else {
    cancelBtn.classList.add('hidden');
  }
}

function setProgressState(state: string | null): void {
  progressBar.classList.remove('active', 'success', 'error');
  if (state) {
    progressBar.classList.add(state);
  }
}

function setStatusState(state: string | null): void {
  status.classList.remove('success', 'error', 'working');
  if (state) {
    status.classList.add(state);
  }
}

// Page navigation
function switchToPage(pageName: string): void {
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
    switchToPage(item.dataset.page!);
  });
});


// Helper functions for formatting
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

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
async function refreshCameraVideos(): Promise<void> {
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

async function refreshConvertedVideos(): Promise<void> {
  try {
    const result = await window.api.listConvertedVideos();
    convertedVideos = result.files || [];
    renderConvertedVideoList();
  } catch (err) {
    console.error('Error refreshing converted videos:', err);
    showConvertedEmptyState('Error loading videos');
  }
}

async function refreshAllVideos(): Promise<void> {
  await Promise.all([refreshCameraVideos(), refreshConvertedVideos()]);
}

function renderCameraVideoList(): void {
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

function renderConvertedVideoList(): void {
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

function createVideoItem(video: VideoFile | ConvertedVideo, type: 'camera' | 'converted'): HTMLElement {
  const item = document.createElement('div');
  item.className = 'video-item';
  if (selectedFile === video.path) {
    item.classList.add('selected');
  }
  item.dataset.path = video.path;
  item.dataset.type = type;

  let badgeHtml = '';
  if (type === 'camera' && (video as VideoFile).status === 'copied') {
    badgeHtml = '<span class="video-status-badge copied">Copied</span>';
  } else if (type === 'camera' && (video as VideoFile).status === 'converted') {
    badgeHtml = '<span class="video-status-badge converted">Converted</span>';
  }

  let metaText = `${formatFileSize(video.size)} • ${formatDate(video.mtime)}`;
  if (type === 'converted' && (video as ConvertedVideo).folder) {
    metaText = `${(video as ConvertedVideo).folder} • ${formatFileSize(video.size)}`;
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

function showCameraEmptyState(message?: string): void {
  // Remove video items
  const existingItems = cameraVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  // Show empty state
  cameraEmptyState.style.display = 'flex';

  if (message) {
    cameraEmptyState.querySelector('.empty-title')!.textContent = message;
  } else {
    cameraEmptyState.querySelector('.empty-title')!.textContent = 'No camera connected';
    cameraEmptyState.querySelector('.empty-description')!.textContent =
      'Connect your camera via USB to see available video files.';
  }
}

function showConvertedEmptyState(message?: string): void {
  // Remove video items
  const existingItems = convertedVideoList.querySelectorAll('.video-item');
  existingItems.forEach(item => item.remove());

  // Show empty state
  convertedEmptyState.style.display = 'flex';

  if (message) {
    convertedEmptyState.querySelector('.empty-title')!.textContent = message;
  } else {
    convertedEmptyState.querySelector('.empty-title')!.textContent = 'No converted videos';
    convertedEmptyState.querySelector('.empty-description')!.textContent =
      'Converted videos will appear here after processing.';
  }
}

function selectVideoFromList(video: VideoFile | ConvertedVideo, type: 'camera' | 'converted'): void {
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
    if ((item as HTMLElement).dataset.path === video.path) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Drive connection change listener
window.api.onDriveConnectionChanged((data: DriveConnectionData) => {
  connectedDrivePath = data.clipPath;
  isDriveConnected = data.connected;
  updateUsbIndicator();
  refreshCameraVideos();
});

// Load saved output folder and USB monitoring status on startup
async function init(): Promise<void> {
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

async function initFacebook(): Promise<void> {
  try {
    const fbStatus = await window.api.getFacebookStatus();
    updateFacebookUI(fbStatus);
  } catch (err) {
    console.error('Error loading Facebook status:', err);
  }
}

function updateFacebookUI(fbStatus: FacebookStatus): void {
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

function updatePostToFacebookButton(): void {
  postToFacebookBtn.disabled = !lastConvertedPath || !isFacebookConnected || isPostingToFacebook || isConverting;
}

function showSetupModal(): void {
  setupModal.classList.add('visible');
}

function hideSetupModal(): void {
  setupModal.classList.remove('visible');
  appIdInput.value = '';
  appSecretInput.value = '';
}

function showPageModal(pages: FacebookPage[]): void {
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

function hidePageModal(): void {
  pageModal.classList.remove('visible');
}

async function selectPage(page: FacebookPage): Promise<void> {
  try {
    await window.api.selectFacebookPage(page);
    hidePageModal();
    await initFacebook();
    status.textContent = `Connected to ${page.name}`;
    setStatusState('success');
  } catch (err) {
    status.textContent = `Error: ${(err as Error).message}`;
    setStatusState('error');
  }
}

function updateUsbIndicator(override?: string): void {
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

function updateConvertButton(): void {
  convertBtn.disabled = !selectedFile || !outputFolder || isConverting;
}

function updateStatus(): void {
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
    status.textContent = `Error: ${(err as Error).message}`;
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

window.api.onProgress((percent: number) => {
  progressBar.style.width = `${percent}%`;
  statusMeta.textContent = `${percent.toFixed(0)}%`;
});

window.api.onStatus((message: string) => {
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
window.api.onCameraDetected((data: CameraDetectionData) => {
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
window.api.onCopyProgress((percent: number) => {
  progressBar.style.width = `${percent}%`;
  statusMeta.textContent = `Copying: ${percent.toFixed(0)}%`;
  if (percent < 100) {
    status.textContent = `Copying from camera...`;
    setStatusState('working');
  }
});

// Auto-convert after copy completes
window.api.onAutoConvertReady(async (filePath: string) => {
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
    status.textContent = `Error: ${(err as Error).message}`;
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
      status.textContent = `Error: ${(err as Error).message}`;
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
    status.textContent = `Error: ${(err as Error).message}`;
    setStatusState('error');
  }
});

pageCancelBtn.addEventListener('click', hidePageModal);

async function startFacebookAuth(): Promise<void> {
  facebookConnectBtn.disabled = true;
  status.textContent = 'Opening browser for authorization...';
  setStatusState('working');

  try {
    const pages = await window.api.startFacebookAuth();
    showPageModal(pages);
  } catch (err) {
    status.textContent = `Error: ${(err as Error).message}`;
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
    status.textContent = `Facebook upload failed: ${(err as Error).message}`;
    setStatusState('error');
    setProgressState('error');
  } finally {
    isPostingToFacebook = false;
    updatePostToFacebookButton();
  }
});

// Facebook progress and status listeners
window.api.onFacebookUploadProgress((percent: number) => {
  progressBar.style.width = `${percent}%`;
  statusMeta.textContent = `Uploading: ${percent}%`;
});

window.api.onFacebookStatus((message: string) => {
  status.textContent = message;
  setStatusState('working');
});

init();
