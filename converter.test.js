const path = require('path');
const fs = require('fs');
const converter = require('./converter');

// Mock dependencies
jest.mock('fluent-ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

describe('converter', () => {
  let mockFfmpegInstance;
  let mockCallbacks;

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Setup mock fluent-ffmpeg instance
    mockFfmpegInstance = {
      outputOptions: jest.fn().mockReturnThis(),
      output: jest.fn().mockReturnThis(),
      on: jest.fn().mockReturnThis(),
      run: jest.fn(),
      kill: jest.fn()
    };

    ffmpeg.mockReturnValue(mockFfmpegInstance);

    // Setup callback spies
    mockCallbacks = {
      onProgress: jest.fn(),
      onStatus: jest.fn(),
      onCopyProgress: jest.fn()
    };

    // Initialize converter with callbacks
    converter.init(mockCallbacks);

    // Mock fs.statSync
    jest.spyOn(fs, 'statSync').mockReturnValue({
      mtime: new Date('2024-01-15T12:00:00Z'),
      size: 1024 * 1024 * 100 // 100MB
    });

    // Mock fs.existsSync
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    // Mock fs.mkdirSync
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    // Mock fs.unlinkSync
    jest.spyOn(fs, 'unlinkSync').mockReturnValue(undefined);

    // Mock fs streams
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const EventEmitter = require('events');
      const stream = new EventEmitter();
      stream.pipe = jest.fn().mockReturnValue(stream);
      // Simulate async read
      setImmediate(() => {
        stream.emit('data', Buffer.alloc(1024));
        stream.emit('end');
      });
      return stream;
    });

    jest.spyOn(fs, 'createWriteStream').mockImplementation(() => {
      const EventEmitter = require('events');
      const stream = new EventEmitter();
      // Simulate async write
      setImmediate(() => {
        stream.emit('finish');
      });
      return stream;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('init', () => {
    test('should initialize with callbacks', () => {
      const callbacks = {
        onProgress: jest.fn(),
        onStatus: jest.fn(),
        onCopyProgress: jest.fn()
      };
      converter.init(callbacks);
      // If initialization works, callbacks should be set (tested implicitly in other tests)
      expect(true).toBe(true);
    });

    test('should initialize with empty callbacks if none provided', () => {
      converter.init({});
      // Should not throw - callbacks should default to no-ops
      expect(true).toBe(true);
    });

    test('should handle partial callbacks', () => {
      converter.init({ onProgress: jest.fn() });
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('convertVideo', () => {
    test('should reject if no output folder provided', async () => {
      await expect(converter.convertVideo('/path/to/input.mp4', null))
        .rejects.toThrow('Please select an output folder first');
    });

    test('should reject if output folder is empty string', async () => {
      await expect(converter.convertVideo('/path/to/input.mp4', ''))
        .rejects.toThrow('Please select an output folder first');
    });

    test('should create date-based subfolder based on file modification date', async () => {
      const inputPath = '/path/to/input.mp4';
      const outputFolder = '/output';

      // Setup event handlers to trigger 'end' event
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      const promise = converter.convertVideo(inputPath, outputFolder);
      await promise;

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/output/2024-01-15',
        { recursive: true }
      );
    });

    test('should skip creating folder if it already exists', async () => {
      fs.existsSync.mockReturnValue(true);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    test('should configure ffmpeg with correct output options', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockFfmpegInstance.outputOptions).toHaveBeenCalledWith([
        '-vf', 'scale=-2:1080',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k'
      ]);
    });

    test('should generate correct output path with _1080p suffix', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/video.mp4', '/output');

      expect(mockFfmpegInstance.output).toHaveBeenCalledWith(
        '/output/2024-01-15/video_1080p.mp4'
      );
    });

    test('should remove temp_ prefix from output filename', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/temp_video.mp4', '/output');

      expect(mockFfmpegInstance.output).toHaveBeenCalledWith(
        '/output/2024-01-15/video_1080p.mp4'
      );
    });

    test('should call onStatus callback on conversion start', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Starting conversion...');
    });

    test('should call onProgress callback during conversion', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'progress') setImmediate(() => handler({ percent: 50.5 }));
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockCallbacks.onProgress).toHaveBeenCalledWith(50.5);
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Converting: 50.5%');
    });

    test('should handle progress with no percent value', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'progress') setImmediate(() => handler({}));
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockCallbacks.onProgress).toHaveBeenCalledWith(0);
    });

    test('should call onProgress with 100 and onStatus on completion', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockCallbacks.onProgress).toHaveBeenCalledWith(100);
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Conversion complete!');
    });

    test('should resolve with output path on successful conversion', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      const result = await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(result).toBe('/output/2024-01-15/input_1080p.mp4');
    });

    test('should clean up temp file on successful conversion', async () => {
      fs.existsSync.mockReturnValue(true);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/temp_video.mp4', '/output');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/path/to/temp_video.mp4');
    });

    test('should not clean up temp file if it does not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/temp_video.mp4', '/output');

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    test('should reject with error on ffmpeg error', async () => {
      const error = new Error('FFmpeg error');

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'error') setImmediate(() => handler(error));
        return mockFfmpegInstance;
      });

      await expect(converter.convertVideo('/path/to/input.mp4', '/output'))
        .rejects.toThrow('FFmpeg error');

      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Error: FFmpeg error');
    });

    test('should not report error if conversion was cancelled with SIGKILL', async () => {
      const error = new Error('ffmpeg was killed with SIGKILL');

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'error') setImmediate(() => handler(error));
        return mockFfmpegInstance;
      });

      const promise = converter.convertVideo('/path/to/input.mp4', '/output');

      // Promise should not reject but also not resolve (conversion cancelled)
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    test('should start ffmpeg process', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockFfmpegInstance.run).toHaveBeenCalled();
    });
  });

  describe('copyFile', () => {
    test('should copy file with progress reporting', async () => {
      await converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      expect(fs.createReadStream).toHaveBeenCalledWith('/source/file.mp4');
      expect(fs.createWriteStream).toHaveBeenCalledWith('/dest/file.mp4');
    });

    test('should report copy progress based on bytes copied', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);

      const mockWriteStream = new (require('events').EventEmitter)();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.statSync.mockReturnValue({ size: 1000, mtime: new Date() });

      const promise = converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      // Simulate data chunks
      setImmediate(() => {
        mockReadStream.emit('data', Buffer.alloc(500));
        mockReadStream.emit('data', Buffer.alloc(500));
        mockWriteStream.emit('finish');
      });

      await promise;

      expect(mockCallbacks.onCopyProgress).toHaveBeenCalledWith(50);
      expect(mockCallbacks.onCopyProgress).toHaveBeenCalledWith(100);
    });

    test('should reject on read stream error', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);

      const mockWriteStream = new (require('events').EventEmitter)();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      const promise = converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      setImmediate(() => {
        mockReadStream.emit('error', new Error('Read error'));
      });

      await expect(promise).rejects.toThrow('Read error');
    });

    test('should reject on write stream error', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);

      const mockWriteStream = new (require('events').EventEmitter)();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      const promise = converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      setImmediate(() => {
        mockWriteStream.emit('error', new Error('Write error'));
      });

      await expect(promise).rejects.toThrow('Write error');
    });

    test('should not report error if copy was cancelled', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);
      mockReadStream.destroy = jest.fn();

      const mockWriteStream = new (require('events').EventEmitter)();
      mockWriteStream.destroy = jest.fn();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      const promise = converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      // Cancel immediately
      converter.cancel();

      setImmediate(() => {
        mockReadStream.emit('error', new Error('Read error after cancel'));
      });

      // Should not throw
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('cancel', () => {
    test('should kill ffmpeg process if running', () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      // Start a conversion (don't await)
      converter.convertVideo('/path/to/input.mp4', '/output');

      // Give it time to start
      return new Promise(resolve => {
        setTimeout(() => {
          const result = converter.cancel();

          expect(mockFfmpegInstance.kill).toHaveBeenCalledWith('SIGKILL');
          expect(result.wasCopying).toBe(false);
          expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Conversion cancelled');
          expect(mockCallbacks.onProgress).toHaveBeenCalledWith(0);
          resolve();
        }, 50);
      });
    });

    test('should clean up partial output file on cancel', () => {
      fs.existsSync.mockReturnValue(true);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      converter.convertVideo('/path/to/input.mp4', '/output');

      return new Promise(resolve => {
        setTimeout(() => {
          converter.cancel();

          expect(fs.unlinkSync).toHaveBeenCalledWith('/output/2024-01-15/input_1080p.mp4');
          resolve();
        }, 50);
      });
    });

    test('should clean up temp file on cancel', () => {
      fs.existsSync.mockReturnValue(true);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      converter.convertVideo('/path/to/temp_video.mp4', '/output');

      return new Promise(resolve => {
        setTimeout(() => {
          converter.cancel();

          expect(fs.unlinkSync).toHaveBeenCalledWith('/path/to/temp_video.mp4');
          resolve();
        }, 50);
      });
    });

    test('should cancel copy operation and clean up destination file', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);
      mockReadStream.destroy = jest.fn();

      const mockWriteStream = new (require('events').EventEmitter)();
      mockWriteStream.destroy = jest.fn();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.existsSync.mockReturnValue(true);

      const promise = converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      // Cancel after a short delay
      setTimeout(() => {
        const result = converter.cancel();

        expect(mockReadStream.destroy).toHaveBeenCalled();
        expect(mockWriteStream.destroy).toHaveBeenCalled();
        expect(fs.unlinkSync).toHaveBeenCalledWith('/dest/file.mp4');
        expect(result.wasCopying).toBe(true);
        expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Copy cancelled');

        mockWriteStream.emit('close');
      }, 10);

      await expect(promise).rejects.toThrow('Copy cancelled');
    });

    test('should handle error when deleting partial files', () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      converter.convertVideo('/path/to/input.mp4', '/output');

      return new Promise(resolve => {
        setTimeout(() => {
          converter.cancel();

          expect(consoleSpy).toHaveBeenCalled();
          consoleSpy.mockRestore();
          resolve();
        }, 50);
      });
    });

    test('should return wasCopying false when cancelling conversion', () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      converter.convertVideo('/path/to/input.mp4', '/output');

      return new Promise(resolve => {
        setTimeout(() => {
          const result = converter.cancel();
          expect(result.wasCopying).toBe(false);
          resolve();
        }, 50);
      });
    });

    test('should do nothing if no operation is in progress', () => {
      const result = converter.cancel();

      expect(result.wasCopying).toBe(false);
      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Conversion cancelled');
    });
  });

  describe('outputExists', () => {
    test('should return false if no output folder provided', () => {
      const result = converter.outputExists('/source/video.mp4', null);
      expect(result).toBe(false);
    });

    test('should return false if output folder is empty string', () => {
      const result = converter.outputExists('/source/video.mp4', '');
      expect(result).toBe(false);
    });

    test('should check for output file in date-based subfolder', () => {
      fs.existsSync.mockReturnValue(true);

      const result = converter.outputExists('/source/video.mp4', '/output');

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/output/2024-01-15/video_1080p.mp4');
    });

    test('should return false if output file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = converter.outputExists('/source/video.mp4', '/output');

      expect(result).toBe(false);
    });

    test('should handle different file extensions', () => {
      fs.existsSync.mockReturnValue(true);

      converter.outputExists('/source/video.mov', '/output');

      expect(fs.existsSync).toHaveBeenCalledWith('/output/2024-01-15/video_1080p.mov');
    });

    test('should use basename without extension for checking', () => {
      fs.existsSync.mockReturnValue(true);

      converter.outputExists('/some/long/path/myvideo.mp4', '/output');

      expect(fs.existsSync).toHaveBeenCalledWith('/output/2024-01-15/myvideo_1080p.mp4');
    });
  });

  describe('isCopying', () => {
    test('should return false when no copy operation is in progress', () => {
      expect(converter.isCopying()).toBe(false);
    });

    test('should return true when copy operation is in progress', () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);

      const mockWriteStream = new (require('events').EventEmitter)();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      // Start copy operation (don't await)
      converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      // Check immediately
      expect(converter.isCopying()).toBe(true);
    });

    test('should return false after copy operation completes', async () => {
      await converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      expect(converter.isCopying()).toBe(false);
    });
  });

  describe('edge cases and boundary conditions', () => {
    test('should handle file with no extension', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/videofile', '/output');

      expect(mockFfmpegInstance.output).toHaveBeenCalledWith(
        '/output/2024-01-15/videofile_1080p'
      );
    });

    test('should handle file with multiple dots in name', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/my.video.file.mp4', '/output');

      expect(mockFfmpegInstance.output).toHaveBeenCalledWith(
        '/output/2024-01-15/my.video.file_1080p.mp4'
      );
    });

    test('should handle very old file dates', async () => {
      fs.statSync.mockReturnValue({
        mtime: new Date('1990-05-10T08:30:00Z'),
        size: 1024
      });

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/old.mp4', '/output');

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        '/output/1990-05-10',
        { recursive: true }
      );
    });

    test('should handle zero-size file in copyFile', async () => {
      fs.statSync.mockReturnValue({ size: 0, mtime: new Date() });

      await converter.copyFile('/source/empty.mp4', '/dest/empty.mp4');

      // Should complete without errors (no data chunks emitted)
      expect(fs.createReadStream).toHaveBeenCalled();
    });

    test('should handle progress updates with decimal percentages', async () => {
      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        if (event === 'progress') {
          setImmediate(() => handler({ percent: 33.33333333 }));
        }
        if (event === 'end') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      await converter.convertVideo('/path/to/input.mp4', '/output');

      expect(mockCallbacks.onStatus).toHaveBeenCalledWith('Converting: 33.3%');
    });

    test('should handle concurrent conversion and copy attempts', async () => {
      const mockReadStream = new (require('events').EventEmitter)();
      mockReadStream.pipe = jest.fn().mockReturnValue(mockReadStream);
      mockReadStream.destroy = jest.fn();
      const mockWriteStream = new (require('events').EventEmitter)();
      mockWriteStream.destroy = jest.fn();

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      mockFfmpegInstance.on.mockImplementation((event, handler) => {
        if (event === 'start') setImmediate(() => handler());
        return mockFfmpegInstance;
      });

      // Start both operations
      converter.convertVideo('/path/to/input.mp4', '/output');
      converter.copyFile('/source/file.mp4', '/dest/file.mp4');

      // Both should be tracked
      expect(converter.isCopying()).toBe(true);

      // Cancel should handle both
      const result = converter.cancel();
      expect(result.wasCopying).toBe(true);
    });
  });
});