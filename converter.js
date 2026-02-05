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
 * Configure callback hooks for progress and status notifications.
 * @param {{onProgress?: function(number):void, onStatus?: function(string):void, onCopyProgress?: function(number):void}} callbacks - Callback functions to receive updates.
 * @param {function(number):void} [callbacks.onProgress] - Called with a number 0–100 to report conversion progress percentage.
 * @param {function(string):void} [callbacks.onStatus] - Called with a human-readable status message.
 * @param {function(number):void} [callbacks.onCopyProgress] - Called with a number 0–100 to report file copy progress percentage.
 */
function init(callbacks) {
  onProgress = callbacks.onProgress || (() => {});
  onStatus = callbacks.onStatus || (() => {});
  onCopyProgress = callbacks.onCopyProgress || (() => {});
}

/**
 * Convert the given video to 1080p and save it into a date-based subfolder under the specified output folder.
 *
 * Creates a YYYY-MM-DD subfolder inside outputFolder, derives an output filename by removing a leading `temp_` prefix (if present) and appending `_1080p` before the original extension, runs ffmpeg to produce the 1080p file, reports progress/status via module callbacks, and resolves with the final output path when complete.
 * @param {string} inputPath - Path to the input video file.
 * @param {string} outputFolder - Base output folder where a date-based subfolder (YYYY-MM-DD) will be created to store the converted file.
 * @returns {Promise<string>} Path to the converted file.
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
 * Copy a file to a destination while reporting progress.
 *
 * Reports percentage progress through the module's `onCopyProgress` callback and stores active streams in `currentCopyStreams` so the operation can be cancelled.
 * Resolves when the copy finishes successfully. Rejects with the underlying stream error if a read/write error occurs, or rejects with `Error('Copy cancelled')` if the copy is cancelled.
 * @param {string} sourcePath - Path to the source file to copy.
 * @param {string} destPath - Path where the file will be written.
 * @returns {Promise<void>} Resolves when the copy completes; rejects on stream error or when cancelled.
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
      if (isCopyCancelled) {
        return;
      }

      fs.utimes(destPath, stats.atime, stats.mtime, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
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
 * Cancel any ongoing copy or conversion operation and remove partial files.
 * @returns {{ wasCopying: boolean }} `wasCopying` is `true` if a file copy was cancelled, `false` otherwise.
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
    const ffmpegProcess = currentFfmpegProcess;
    const killTimeout = setTimeout(() => {
      try {
        ffmpegProcess.kill('SIGKILL');
      } catch (err) {
        // Ignore errors while forcing termination
      }
    }, 5000);

    ffmpegProcess.once('exit', () => {
      clearTimeout(killTimeout);
    });

    try {
      ffmpegProcess.kill('SIGINT');
    } catch (err) {
      clearTimeout(killTimeout);
    }

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
 * Determine whether the 1080p output for a source file already exists in the date-based subfolder.
 * The date subfolder is derived from the source file's modification time (YYYY-MM-DD).
 * @param {string} sourcePath - Path to the source file whose modification date determines the date subfolder.
 * @param {string} outputFolder - Base output folder containing date-named subfolders.
 * @returns {boolean} `true` if the expected `<basename>_1080p<ext>` file exists in the date subfolder, `false` otherwise.
 */
function outputExists(sourcePath, outputFolder) {
  if (!outputFolder) return false;

  let stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch (err) {
    return false;
  }

  const fileDate = stats.mtime;
  const dateFolderName = fileDate.toISOString().split('T')[0];
  const dateFolder = path.join(outputFolder, dateFolderName);

  const ext = path.extname(sourcePath);
  const basename = path.basename(sourcePath, ext);
  const outputPath = path.join(dateFolder, `${basename}_1080p${ext}`);

  return fs.existsSync(outputPath);
}

/**
 * Determine whether a file copy operation is currently active.
 * @returns {boolean} `true` if a copy is in progress, `false` otherwise.
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