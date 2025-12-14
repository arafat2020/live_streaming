import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  // Use FFmpeg from PATH (Windows/Linux safe)
  private readonly FFMPEG_PATH = 'ffmpeg';

  transcodeVideoToHLS(videoPath: string, lessonId: string): void {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const outputDir = path.join(uploadsDir, 'videos', lessonId);

    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');
    const inputPath = path.resolve(videoPath);

    this.logger.log(`🎬 FFmpeg started for ${inputPath}`);
    this.logger.log(`Output HLS: ${playlistPath}`);

    const ffmpeg = spawn(
      this.FFMPEG_PATH,
      [
        '-y',
        '-i',
        inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-hls_time', '6',
        '-hls_playlist_type', 'event', // event type allows appending segments
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ],
      { windowsHide: true },
    );

    ffmpeg.stderr.on('data', (data) => {
      this.logger.log(`FFmpeg: ${data.toString()}`);
    });

    ffmpeg.on('error', (err) => {
      this.logger.error('FFmpeg failed to start', err);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        this.logger.log(`✅ HLS transcoding finished for lesson ${lessonId}`);
      } else {
        this.logger.error(`FFmpeg exited with code ${code}`);
      }
    });
  }


}
