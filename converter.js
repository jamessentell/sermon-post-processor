const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// State
let currentFfmpegProcess = null;
let currentOutputPath = null;
let currentTempPath = null;
let currentCopyStreams = null;
let isCopyCancelled = false;

// Event callbacks (set by init)
let onProgress = null;
let onStatus = null;
let onCopyProgress = null;

/**
 * Initialize the converter with event callbacks
 */
function init(callbacks) {
  onProgress = callbacks.onProgress || (() => {});
  onStatus = callbacks.onStatus || (() => {});
  onCopyProgress = callbacks.onCopyProgress || (() => {});
}

/**
 * Convert a video file to 1080p
 * @param {string} inputPath - Path to input video file
 * @param {string} outputFolder - Base output folder
 * @returns {Promise<string>} - Path to converted file
 */
function convertVideo(inputPath, outputFolder) {
  if (!outputFolder) {
    return Promise.reject(new Error('Please select an output folder first'));
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
        onStatus('Starting conversion...');
      })
      .on('progress', (progress) => {
        const percent = progress.percent || 0;
        onProgress(percent);
        onStatus(`Converting: ${percent.toFixed(1)}%`);
      })
      .on('end', () => {
        currentFfmpegProcess = null;
        currentOutputPath = null;
        // Clean up temp file after successful conversion
        if (currentTempPath && fs.existsSync(currentTempPath)) {
          fs.unlinkSync(currentTempPath);
          currentTempPath = null;
        }
        onProgress(100);
        onStatus('Conversion complete!');
        resolve(outputPath);
      })
      .on('error', (err) => {
        currentFfmpegProcess = null;
        currentOutputPath = null;
        // Don't report error if it was cancelled
        if (err.message.includes('SIGKILL') || err.message.includes('ffmpeg was killed')) {
          return;
        }
        onStatus(`Error: ${err.message}`);
        reject(err);
      });

    currentFfmpegProcess = ffmpegProcess;
    ffmpegProcess.run();
  });
}

/**
 * Copy a file with progress reporting
 * @param {string} sourcePath - Source file path
 * @param {string} destPath - Destination file path
 * @returns {Promise<void>}
 */
function copyFile(sourcePath, destPath) {
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
      onCopyProgress(percent);
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

/**
 * Cancel any ongoing conversion or copy operation
 * @returns {{ wasCopying: boolean }} - Info about what was cancelled
 */
function cancel() {
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
  onStatus(message);
  onProgress(0);

  return { wasCopying };
}

/**
 * Check if the output file already exists for a given source
 * @param {string} sourcePath - Source file path
 * @param {string} outputFolder - Output folder path
 * @returns {boolean}
 */
function outputExists(sourcePath, outputFolder) {
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

/**
 * Check if a copy operation is in progress
 * @returns {boolean}
 */
function isCopying() {
  return currentCopyStreams !== null;
}

module.exports = {
  init,
  convertVideo,
  copyFile,
  cancel,
  outputExists,
  isCopying
};
