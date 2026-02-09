export interface VideoFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  status?: 'on-camera' | 'copied' | 'converted';
}

export interface ConvertedVideo {
  name: string;
  path: string;
  size: number;
  mtime: number;
  folder: string;
}

export interface DriveStatus {
  connected: boolean;
  clipPath?: string | null;
}

export interface CameraDetectionData {
  status: 'detected' | 'found-video' | 'skipped';
  clipPath?: string;
  file?: string;
}

export interface FacebookCredentials {
  appId: string;
  appSecret: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
}

export interface FacebookStatus {
  connected: boolean;
  pageName?: string;
  hasCredentials?: boolean;
}

export interface FacebookSettings {
  appId?: string;
  appSecret?: string;
  pageId?: string;
  pageName?: string;
  pageAccessToken?: string;
}

export interface Settings {
  outputFolder?: string;
  usbMonitoringEnabled?: boolean;
  facebook?: FacebookSettings;
}

export interface ConverterCallbacks {
  onProgress: (percent: number) => void;
  onStatus: (message: string) => void;
  onCopyProgress: (percent: number) => void;
}

export interface UsbMonitoringStatus {
  enabled: boolean;
  active: boolean;
}

export interface VideoListResult {
  connected: boolean;
  clipPath?: string;
  files: VideoFile[];
}

export interface ConvertedVideoListResult {
  files: ConvertedVideo[];
}

export interface CopyStreams {
  readStream: NodeJS.ReadableStream & { destroy: () => void };
  writeStream: NodeJS.WritableStream & { destroy: () => void };
  destPath: string;
}

export type VideoStatus = 'on-camera' | 'copied' | 'converted';

export interface VideoRecord {
  id?: number;
  source_name: string;
  source_path: string;
  source_size: number;
  source_mtime: number;
  copied_path?: string | null;
  converted_path?: string | null;
  status: VideoStatus;
  facebook_uploaded_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
