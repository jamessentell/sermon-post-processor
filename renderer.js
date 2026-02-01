const selectBtn = document.getElementById('selectBtn');
const convertBtn = document.getElementById('convertBtn');
const outputFolderBtn = document.getElementById('outputFolderBtn');
const fileDisplay = document.getElementById('fileDisplay');
const folderDisplay = document.getElementById('folderDisplay');
const progressBar = document.getElementById('progressBar');
const status = document.getElementById('status');

let selectedFile = null;
let outputFolder = null;
let isConverting = false;

// Load saved output folder on startup
async function init() {
  const savedFolder = await window.api.getOutputFolder();
  if (savedFolder) {
    outputFolder = savedFolder;
    folderDisplay.textContent = savedFolder;
    folderDisplay.classList.add('has-folder');
    updateConvertButton();
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

init();
