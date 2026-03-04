/**
 * @fileoverview Video Rendition Constants
 *
 * Defines the available video transcoding renditions (quality levels)
 * for HLS adaptive bitrate streaming. Renditions are ordered with
 * 720p first as the default starting quality.
 */

export interface VideoRendition {
  name: string;
  width: number;
  height: number;
  vBitrate: string;
  maxrate: string;
  bufsize: string;
  aBitrate: string;
}

/** Active renditions for video transcoding, ordered by priority (720p default). */
export const VIDEO_RENDITIONS: VideoRendition[] = [
  {
    name: '720p',
    width: 1280,
    height: 720,
    vBitrate: '2800k',
    maxrate: '3360k',
    bufsize: '4800k',
    aBitrate: '128k',
  },
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    vBitrate: '6000k',
    maxrate: '7200k',
    bufsize: '9000k',
    aBitrate: '192k',
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    vBitrate: '1400k',
    maxrate: '1680k',
    bufsize: '2400k',
    aBitrate: '128k',
  },
];
