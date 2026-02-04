# Sermon Post Processor

A simple Electron app that converts 4K video files to 1080p for Facebook posting using ffmpeg.

## Features

- **Video conversion**: Converts any video to 1080p using H.264/AAC encoding optimized for Facebook
- **Persistent output folder**: Select a parent output folder that's remembered between sessions
- **Date-based organization**: Automatically creates subfolders named with the video file's date (YYYY-MM-DD)
- **Progress tracking**: Real-time progress bar during conversion

## Architecture

```
sermon-post-processor/
├── package.json      # Dependencies: electron, fluent-ffmpeg
├── main.js           # Electron main process (file dialogs, ffmpeg, settings)
├── preload.js        # IPC bridge between main and renderer
├── index.html        # UI layout and styles
├── renderer.js       # Frontend logic (button handlers, progress updates)
└── README.md         # This file
```

### Main Process (`main.js`)

- Creates browser window with context isolation
- Handles IPC channels:
  - `select-file`: Opens file dialog for video selection
  - `select-output-folder`: Opens folder dialog, saves selection to settings
  - `get-output-folder`: Returns saved output folder path
  - `convert-video`: Runs ffmpeg conversion with progress reporting
- Settings stored in `~/.config/sermon-post-processor/settings.json`

### Preload (`preload.js`)

Exposes safe IPC methods to renderer:
- `selectFile()`, `selectOutputFolder()`, `getOutputFolder()`
- `convertVideo(filePath)`
- `onProgress(callback)`, `onStatus(callback)`

### Renderer (`renderer.js`)

- Loads saved output folder on startup
- Handles UI interactions and button states
- Updates progress bar and status messages

## ffmpeg Settings

```
-vf scale=-2:1080    # Scale to 1080p, maintain aspect ratio
-c:v libx264         # H.264 video codec
-preset medium       # Balance speed/quality
-crf 23              # Good quality (lower = better, 18-28 typical)
-c:a aac             # AAC audio codec
-b:a 128k            # Audio bitrate
```

## Output Structure

```
[Output Folder]/
└── 2026-01-26/              # Date from video file (modification date)
    └── Video_1080p.mp4     # Converted file
```

## Prerequisites

- Node.js
- ffmpeg installed on system (`sudo apt install ffmpeg` on Ubuntu)

## Usage

```bash
npm install
npm start
```

1. Click "Choose" to select an output folder (saved for future sessions)
2. Click "Select Video" to choose a 4K video file
3. Click "Convert to 1080p" to start conversion
4. Output saved to `[output folder]/[YYYY-MM-DD]/[filename]_1080p.mp4`

## Development Notes

- Uses `--no-sandbox` flag on Linux due to Electron sandbox permissions
- Settings persisted via simple JSON file in Electron's userData directory
- Date folder uses video file's modification time (`mtime`)
