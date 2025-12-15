import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);
  private readonly FFMPEG_PATH = 'ffmpeg';

  constructor(private readonly r2UploadService: R2UploadService) {}

  async transcodeVideoToHLS(
    videoPath: string,
    lessonId: string,
  ): Promise<string> {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const outputDir = path.join(uploadsDir, 'videos', lessonId);

    fs.mkdirSync(outputDir, { recursive: true });

    const playlistPath = path.join(outputDir, 'index.m3u8');
    const segmentPattern = path.join(outputDir, 'segment_%03d.ts');
    const inputPath = path.resolve(videoPath);

    this.logger.log(`🎬 Starting HLS transcoding for ${lessonId}`);
    this.logger.log(`📂 Local output: ${outputDir}`);

    const r2Prefix = `videos/${lessonId}`;

    // Start watching for new segments and upload them
    const watcher = this.r2UploadService.watchAndUpload(
      outputDir,
      r2Prefix,
      (url) => {
        this.logger.log(`✅ Segment uploaded: ${url}`);
      },
    );

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(
        this.FFMPEG_PATH,
        [
          '-y',
          '-i', inputPath,
          '-map', '0:v:0',
          '-map', '0:a:0?',

          // Video encoding
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency',
          '-crf', '23',
          '-g', '50',
          '-sc_threshold', '0',

          // Audio encoding
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',

          // HLS settings
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '0', // Keep all segments
          '-hls_flags', 'append_list',
          '-hls_playlist_type', 'event',
          '-hls_segment_filename', segmentPattern,
          '-start_number', '0',

          playlistPath,
        ],
        { windowsHide: true },
      );

      let segmentCount = 0;

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();

        if (output.includes('Opening') && output.includes('segment_')) {
          segmentCount++;
          this.logger.log(`📦 Creating segment ${segmentCount}`);
        }

        if (output.includes('frame=')) {
          this.logger.log(`⚡ ${output.trim()}`);
        }
      });

      ffmpeg.on('error', (err) => {
        this.logger.error('❌ FFmpeg failed', err);
        watcher.close();
        reject(err);
      });

      ffmpeg.on('close', async (code) => {
        watcher.close();

        if (code === 0) {
          try {
            this.logger.log(`✅ Transcoding finished (${segmentCount} segments)`);

            // Upload remaining segments that might have been missed
            await this.r2UploadService.uploadSegments(outputDir, r2Prefix);

            // Upload playlist with updated URLs
            const playlistUrl = await this.r2UploadService.uploadPlaylist(
              playlistPath,
              `${r2Prefix}/index.m3u8`,
              r2Prefix,
            );

            // Clean up local files (optional)
            // fs.rmSync(outputDir, { recursive: true, force: true });

            this.logger.log(`🎉 All files uploaded to R2`);
            resolve(playlistUrl);
          } catch (error) {
            this.logger.error('❌ R2 upload failed', error);
            reject(error);
          }
        } else {
          this.logger.error(`❌ FFmpeg exited with code ${code}`);
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });
    });
  }
}