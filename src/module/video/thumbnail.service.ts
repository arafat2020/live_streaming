import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { R2UploadService } from './r2-upload.service';
import { R2_PUBLIC_URL } from '../../config/r2.config';

@Injectable()
export class ThumbnailService {
    private readonly logger = new Logger(ThumbnailService.name);

    constructor(private readonly r2UploadService: R2UploadService) { }

    /**
     * Generate a thumbnail from RTMP stream
     * @param streamKey - The stream key to identify the stream
     * @param rtmpUrl - The RTMP URL to capture from
     * @param r2Prefix - The R2 prefix where to upload the thumbnail
     * @returns Promise<string> - The public URL of the uploaded thumbnail
     */
    async generateThumbnailFromRTMP(
        streamKey: string,
        rtmpUrl: string,
        r2Prefix: string,
    ): Promise<string> {
        const tempDir = path.resolve(process.cwd(), 'uploads', 'thumbnails', streamKey);
        const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');

        try {
            // Create temp directory
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            this.logger.log(`📸 Generating thumbnail for stream: ${streamKey}`);
            this.logger.debug(`🔗 RTMP URL: ${rtmpUrl}`);
            this.logger.debug(`📂 Output Path: ${thumbnailPath}`);

            // Wait a few seconds for stream to stabilize before capturing
            await new Promise((resolve) => setTimeout(resolve, 8000)); // Increased to 8s

            // Generate thumbnail using FFmpeg
            await this.captureThumbnail(rtmpUrl, thumbnailPath);

            // Upload to R2
            const thumbnailUrl = await this.uploadThumbnail(thumbnailPath, r2Prefix);

            // Cleanup local file
            await this.cleanupThumbnailFiles(tempDir);

            this.logger.log(`✅ Thumbnail generated and uploaded: ${thumbnailUrl}`);

            return thumbnailUrl;
        } catch (error) {
            this.logger.error(`❌ Failed to generate thumbnail: ${error.message}`);

            // Cleanup on error
            await this.cleanupThumbnailFiles(tempDir);

            // Return a default/placeholder thumbnail URL or throw error
            throw error;
        }
    }

    /**
     * Capture a thumbnail frame from RTMP stream using FFmpeg
     */
    private async captureThumbnail(rtmpUrl: string, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-analyzeduration', '2000000',
                '-probesize', '2000000',
                '-i', rtmpUrl,
                '-ss', '00:00:03', // Seek 3 seconds in
                '-vframes', '1',
                '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '2',
                '-y',
                outputPath,
            ]);

            let errorOutput = '';

            ffmpeg.stderr.on('data', (data) => {
                const msg = data.toString();
                errorOutput += msg;
                if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('cannot')) {
                    this.logger.warn(`[FFmpeg Error Snippet] ${msg.trim()}`);
                }
            });

            ffmpeg.on('error', (error) => {
                this.logger.error(`FFmpeg spawn error: ${error.message}`);
                reject(error);
            });

            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    this.logger.log(`✅ Thumbnail captured successfully`);
                    resolve();
                } else {
                    this.logger.error(`❌ FFmpeg exited with code ${code}`);
                    this.logger.error(`Error output: ${errorOutput.slice(-500)}`);
                    reject(new Error(`Failed to capture thumbnail: FFmpeg exit code ${code}`));
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!ffmpeg.killed) {
                    ffmpeg.kill('SIGKILL');
                    reject(new Error('Thumbnail capture timeout'));
                }
            }, 30000);
        });
    }

    /**
     * Upload thumbnail to R2 storage
     */
    private async uploadThumbnail(thumbnailPath: string, r2Prefix: string): Promise<string> {
        try {
            const fileBuffer = fs.readFileSync(thumbnailPath);
            const r2Key = `${r2Prefix}/thumbnail.jpg`;

            this.logger.log(`⬆️ Uploading thumbnail to R2: ${r2Key}`);

            await this.r2UploadService.uploadBuffer(fileBuffer, r2Key, 'image/jpeg');

            // Construct public URL
            const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;

            return publicUrl;
        } catch (error) {
            this.logger.error(`Failed to upload thumbnail to R2: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate thumbnail from local video segment
     * (Alternative method if RTMP capture fails)
     */
    async generateThumbnailFromSegment(
        segmentPath: string,
        r2Prefix: string,
        streamKey: string,
    ): Promise<string> {
        const tempDir = path.resolve(process.cwd(), 'uploads', 'thumbnails', streamKey);
        const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');

        try {
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            this.logger.log(`📸 Generating thumbnail from segment: ${segmentPath}`);

            // Generate thumbnail from video segment
            await this.captureThumbnailFromFile(segmentPath, thumbnailPath);

            // Upload to R2
            const thumbnailUrl = await this.uploadThumbnail(thumbnailPath, r2Prefix);

            // Cleanup
            await this.cleanupThumbnailFiles(tempDir);

            this.logger.log(`✅ Thumbnail generated from segment: ${thumbnailUrl}`);

            return thumbnailUrl;
        } catch (error) {
            this.logger.error(`Failed to generate thumbnail from segment: ${error.message}`);
            await this.cleanupThumbnailFiles(tempDir);
            throw error;
        }
    }

    /**
     * Capture thumbnail from a local video file
     */
    private async captureThumbnailFromFile(
        videoPath: string,
        outputPath: string,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', videoPath,
                '-ss', '00:00:01',
                '-vframes', '1',
                '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '2',
                '-y',
                outputPath,
            ]);

            let errorOutput = '';

            ffmpeg.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            ffmpeg.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve();
                } else {
                    reject(new Error(`Failed to capture thumbnail from file: exit code ${code}`));
                }
            });

            ffmpeg.on('error', reject);

            setTimeout(() => {
                if (!ffmpeg.killed) {
                    ffmpeg.kill('SIGKILL');
                    reject(new Error('Thumbnail capture timeout'));
                }
            }, 30000);
        });
    }

    /**
     * Cleanup temporary thumbnail files
     */
    private async cleanupThumbnailFiles(dir: string): Promise<void> {
        try {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
                this.logger.debug(`🗑️ Cleaned up thumbnail directory: ${dir}`);
            }
        } catch (error) {
            this.logger.warn(`Failed to cleanup thumbnail files: ${error.message}`);
        }
    }
}
