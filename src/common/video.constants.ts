export interface VideoRendition {
  name: string;
  width: number;
  height: number;
  vBitrate: string;
  maxrate: string;
  bufsize: string;
  aBitrate: string;
}

// Ordered to prioritize 720p as the default start quality
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
  // {
  //   name: '2160p',
  //   width: 3840,
  //   height: 2160,
  //   vBitrate: '15000k',
  //   maxrate: '18000k',
  //   bufsize: '22000k',
  //   aBitrate: '256k',
  // },
  {
    name: '480p',
    width: 854,
    height: 480,
    vBitrate: '1400k',
    maxrate: '1680k',
    bufsize: '2400k',
    aBitrate: '128k',
  },
  {
    name: '360p',
    width: 640,
    height: 360,
    vBitrate: '800k',
    maxrate: '960k',
    bufsize: '1400k',
    aBitrate: '96k',
  },
  {
    name: '240p',
    width: 426,
    height: 240,
    vBitrate: '400k',
    maxrate: '480k',
    bufsize: '800k',
    aBitrate: '64k',
  },
  {
    name: '144p',
    width: 256,
    height: 144,
    vBitrate: '200k',
    maxrate: '240k',
    bufsize: '400k',
    aBitrate: '64k',
  },
];
