import { google, type youtube_v3 } from 'googleapis';
import type { YouTubeOAuth2Client } from './YouTubeAuthIntegration.js';

/** A YouTube Data API client that calls with `auth`. */
export function createYouTubeClient(auth: YouTubeOAuth2Client): youtube_v3.Youtube {
  return google.youtube({ version: 'v3', auth });
}
