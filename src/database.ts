import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Settings, FacebookSettings, VideoRecord, VideoStatus } from './types';

let db: Database.Database;

export function initDatabase(userDataPath: string): void {
  const dbPath = path.join(userDataPath, 'sermon-post-processor.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source_size INTEGER NOT NULL,
      source_mtime INTEGER NOT NULL,
      copied_path TEXT,
      converted_path TEXT,
      status TEXT NOT NULL DEFAULT 'on-camera'
        CHECK(status IN ('on-camera', 'copied', 'converted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_name, source_size)
    );
  `);

  // Migrate settings.json if it exists
  const settingsJsonPath = path.join(userDataPath, 'settings.json');
  if (fs.existsSync(settingsJsonPath)) {
    try {
      const settings: Settings = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf8'));
      if (settings.outputFolder !== undefined) {
        setSetting('outputFolder', settings.outputFolder);
      }
      if (settings.usbMonitoringEnabled !== undefined) {
        setSetting('usbMonitoringEnabled', settings.usbMonitoringEnabled);
      }
      if (settings.facebook !== undefined) {
        setSetting('facebook', settings.facebook);
      }
      // Rename to backup
      fs.renameSync(settingsJsonPath, settingsJsonPath + '.backup');
      console.log('Migrated settings.json to database');
    } catch (err) {
      console.error('Failed to migrate settings.json:', err);
    }
  }

  // Cleanup orphaned copies on startup
  cleanupOrphanedCopies();
}

// Settings operations

export function getSetting<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export function setSetting(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, serialized);
}

export function getAllSettings(): Settings {
  const settings: Settings = {};
  const outputFolder = getSetting<string>('outputFolder');
  if (outputFolder !== undefined) settings.outputFolder = outputFolder;
  const usbMonitoringEnabled = getSetting<boolean>('usbMonitoringEnabled');
  if (usbMonitoringEnabled !== undefined) settings.usbMonitoringEnabled = usbMonitoringEnabled;
  const facebook = getSetting<FacebookSettings>('facebook');
  if (facebook !== undefined) settings.facebook = facebook;
  return settings;
}

// Video operations

export function upsertVideo(record: VideoRecord): number {
  const stmt = db.prepare(`
    INSERT INTO videos (source_name, source_path, source_size, source_mtime, copied_path, converted_path, status)
    VALUES (@source_name, @source_path, @source_size, @source_mtime, @copied_path, @converted_path, @status)
    ON CONFLICT(source_name, source_size) DO UPDATE SET
      source_path = @source_path,
      source_mtime = @source_mtime,
      copied_path = COALESCE(@copied_path, copied_path),
      converted_path = COALESCE(@converted_path, converted_path),
      status = @status,
      updated_at = datetime('now')
  `);
  const result = stmt.run({
    source_name: record.source_name,
    source_path: record.source_path,
    source_size: record.source_size,
    source_mtime: record.source_mtime,
    copied_path: record.copied_path ?? null,
    converted_path: record.converted_path ?? null,
    status: record.status
  });

  // If it was an insert, return lastInsertRowid; if update, look up the id
  if (result.changes === 1 && result.lastInsertRowid) {
    return Number(result.lastInsertRowid);
  }
  const existing = getVideoBySource(record.source_name, record.source_size);
  return existing!.id!;
}

export function getVideoBySource(name: string, size: number): VideoRecord | null {
  const row = db.prepare('SELECT * FROM videos WHERE source_name = ? AND source_size = ?').get(name, size) as VideoRecord | undefined;
  return row ?? null;
}

export function getVideoByCopiedPath(copiedPath: string): VideoRecord | null {
  const row = db.prepare('SELECT * FROM videos WHERE copied_path = ?').get(copiedPath) as VideoRecord | undefined;
  return row ?? null;
}

export function getVideosByStatus(status: VideoStatus): VideoRecord[] {
  return db.prepare('SELECT * FROM videos WHERE status = ?').all(status) as VideoRecord[];
}

export function updateVideoStatus(id: number, status: VideoStatus, paths?: { copied?: string; converted?: string }): void {
  if (paths?.copied !== undefined && paths?.converted !== undefined) {
    db.prepare('UPDATE videos SET status = ?, copied_path = ?, converted_path = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, paths.copied, paths.converted, id);
  } else if (paths?.copied !== undefined) {
    db.prepare('UPDATE videos SET status = ?, copied_path = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, paths.copied, id);
  } else if (paths?.converted !== undefined) {
    db.prepare('UPDATE videos SET status = ?, converted_path = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, paths.converted, id);
  } else {
    db.prepare('UPDATE videos SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(status, id);
  }
}

export function cleanupOrphanedCopies(): void {
  const copiedVideos = getVideosByStatus('copied');
  for (const video of copiedVideos) {
    if (video.copied_path && !fs.existsSync(video.copied_path)) {
      // Reset to on-camera since the temp file is gone
      updateVideoStatus(video.id!, 'on-camera', { copied: undefined });
      db.prepare('UPDATE videos SET copied_path = NULL WHERE id = ?').run(video.id);
      console.log(`Reset orphaned copy: ${video.source_name}`);
    }
  }
}
