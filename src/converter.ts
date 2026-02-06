import path from 'path';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import { ConverterCallbacks, CopyStreams } from './types';

// State
let currentFfmpegProcess: ffmpeg.FfmpegCommand | null = null;
let currentOutputPath: string | null = null;
let currentTempPath: string | null = null;
let currentCopyStreams: CopyStreams | null = null;
let isCopyCancelled = false;

// Event callbacks (set by init)
let onProgress: (percent: number) => void = () => {};
let onStatus: (message: string) => void = () => {};
let onCopyProgress: (percent: number) => void = () => {};

export function init(callbacks: ConverterCallbacks): void {
  onProgress = callbacks.onProgress || (() => {});
  onStatus = callbacks.onStatus || (() => {});
  onCopyProgress = callbacks.onCopyProgress || (() => {});
}

export function convertVideo(inputPath: string, outputFolder: string): Promise<string> {
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
      .on('error', (err: Error) => {
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

export function copyFile(sourcePath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(sourcePath);
    const totalSize = stats.size;
    let copiedSize = 0;
    isCopyCancelled = false;

    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destPath);

    // Store streams for potential cancellation
    currentCopyStreams = { readStream, writeStream, destPath };

    readStream.on('data', (chunk: Buffer) => {
      copiedSize += chunk.length;
      const percent = (copiedSize / totalSize) * 100;
      onCopyProgress(percent);
    });

    readStream.on('error', (err: Error) => {
      currentCopyStreams = null;
      if (!isCopyCancelled) {
        reject(err);
      }
    });

    writeStream.on('error', (err: Error) => {
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

export function cancel(): { wasCopying: boolean } {
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
    const proc = currentFfmpegProcess;
    const killTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_err) {
        // Ignore errors while forcing termination
      }
    }, 5000);

    (proc as unknown as NodeJS.EventEmitter).once('exit', () => {
      clearTimeout(killTimeout);
    });

    try {
      proc.kill('SIGINT');
    } catch (_err) {
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

export function outputExists(sourcePath: string, outputFolder: string): boolean {
  if (!outputFolder) return false;

  let stats: fs.Stats;
  try {
    stats = fs.statSync(sourcePath);
  } catch (_err) {
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

export function isCopying(): boolean {
  return currentCopyStreams !== null;
}
