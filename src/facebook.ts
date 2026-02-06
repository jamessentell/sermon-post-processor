import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { FacebookPage } from './types';

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

export function getAuthUrl(appId: string, redirectUri: string): string {
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts'
  ].join(',');

  return `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code`;
}

export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string
): Promise<string> {
  const response = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code: code
    }
  });
  return response.data.access_token;
}

export async function getLongLivedToken(
  shortToken: string,
  appId: string,
  appSecret: string
): Promise<string> {
  const response = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken
    }
  });
  return response.data.access_token;
}

export async function getUserPages(userAccessToken: string): Promise<FacebookPage[]> {
  const response = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
    params: {
      access_token: userAccessToken,
      fields: 'id,name,access_token'
    }
  });
  return response.data.data;
}

export function formatSermonDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export async function uploadVideoToPage(
  pageId: string,
  pageAccessToken: string,
  videoPath: string,
  sermonDate: Date,
  onProgress?: (percent: number) => void,
  onStatus?: (message: string) => void
): Promise<{ success: boolean; videoId: string }> {
  const fileSize = fs.statSync(videoPath).size;
  const fileName = path.basename(videoPath);
  const description = `Sermon ${formatSermonDate(sermonDate)}`;

  onStatus?.('Initializing upload...');

  // Step 1: Initialize upload session
  const startResponse = await axios.post(
    `${GRAPH_API_BASE}/${pageId}/videos`,
    null,
    {
      params: {
        access_token: pageAccessToken,
        upload_phase: 'start',
        file_size: fileSize
      }
    }
  );

  const { upload_session_id, video_id } = startResponse.data;

  onStatus?.('Uploading video...');

  // Step 2: Upload chunks
  const fileHandle = fs.openSync(videoPath, 'r');
  let startOffset = 0;

  try {
    while (startOffset < fileSize) {
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - startOffset);
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fileHandle, buffer, 0, chunkSize, startOffset);

      const form = new FormData();
      form.append('access_token', pageAccessToken);
      form.append('upload_phase', 'transfer');
      form.append('upload_session_id', upload_session_id);
      form.append('start_offset', startOffset.toString());
      form.append('video_file_chunk', buffer, { filename: fileName });

      const transferResponse = await axios.post(
        `${GRAPH_API_BASE}/${pageId}/videos`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      startOffset = parseInt(transferResponse.data.start_offset, 10);

      const percent = Math.round((startOffset / fileSize) * 100);
      onProgress?.(percent);
    }
  } finally {
    fs.closeSync(fileHandle);
  }

  onStatus?.('Finalizing upload...');

  // Step 3: Finish upload
  const finishResponse = await axios.post(
    `${GRAPH_API_BASE}/${pageId}/videos`,
    null,
    {
      params: {
        access_token: pageAccessToken,
        upload_phase: 'finish',
        upload_session_id: upload_session_id,
        title: description,
        description: description
      }
    }
  );

  onProgress?.(100);
  onStatus?.('Upload complete!');

  return {
    success: finishResponse.data.success,
    videoId: video_id
  };
}
