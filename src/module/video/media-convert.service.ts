import {
  CreateJobCommand,
  GetJobCommand,
  MediaConvertClient,
} from '@aws-sdk/client-mediaconvert';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';

export interface MediaConvertJobResult {
  jobId: string;
  status: string;
}

@Injectable()
export class MediaConvertService {
  private readonly logger = new Logger(MediaConvertService.name);
  private client: MediaConvertClient;
  private s3Client: S3Client;

  private readonly roleArn = process.env.MEDIACONVERT_ROLE_ARN!;
  private readonly awsRegion = process.env.AWS_REGION || 'us-east-1';
  private readonly s3Bucket = process.env.S3_BUCKET!;

  constructor() {
    const awsCredentials =
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            ...(process.env.AWS_SESSION_TOKEN
              ? { sessionToken: process.env.AWS_SESSION_TOKEN }
              : {}),
          }
        : undefined;

    this.client = new MediaConvertClient({
      region: this.awsRegion,
      ...(awsCredentials ? { credentials: awsCredentials } : {}),
    });
    this.s3Client = new S3Client({
      region: this.awsRegion,
      ...(awsCredentials ? { credentials: awsCredentials } : {}),
    });

    if (awsCredentials) {
      this.logger.log('Using AWS credentials from environment variables');
    } else {
      this.logger.log(
        'Using AWS default credential provider chain for MediaConvert',
      );
    }
  }

  /**
   * Upload a local file to S3 so MediaConvert can access it.
   */
  async uploadFileToS3(localPath: string, s3Key: string): Promise<string> {
    try {
      const fileBuffer = fs.readFileSync(localPath);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
          Body: fileBuffer,
        }),
      );
      const s3Path = `s3://${this.s3Bucket}/${s3Key}`;
      this.logger.log(`Uploaded to S3: ${s3Path}`);
      return s3Path;
    } catch (err) {
      this.logger.error(`Failed to upload to S3: ${err.message}`);
      throw err;
    }
  }

  /**
   * Submit a transcoding job to AWS MediaConvert.
   * This creates a multi-bitrate HLS output (ABR).
   */
  async submitTranscodingJob(params: {
    contentId: string;
    inputS3Path: string;
  }): Promise<MediaConvertJobResult> {
    const { contentId, inputS3Path } = params;
    const outputS3Path = `s3://${this.s3Bucket}/videos/${contentId}/`;

    this.logger.log(`Submitting MediaConvert job for content ${contentId}...`);

    try {
      const jobSettings: any = {
        Role: this.roleArn,
        Settings: {
          TimecodeConfig: { Source: 'ZEROBASED' },
          OutputGroups: [
            {
              Name: 'Apple HLS',
              Outputs: [
                this.createHlsOutput('1080p', 1920, 1080, 5000000),
                this.createHlsOutput('720p', 1280, 720, 3000000),
                this.createHlsOutput('480p', 854, 480, 1500000),
              ],
              OutputGroupSettings: {
                Type: 'HLS_GROUP_SETTINGS',
                HlsGroupSettings: {
                  SegmentLength: 4,
                  MinSegmentLength: 0,
                  Destination: outputS3Path,
                },
              },
            },
          ],
          Inputs: [
            {
              AudioSelectors: {
                'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
              },
              VideoSelector: {},
              TimecodeSource: 'ZEROBASED',
              FileInput: inputS3Path,
            },
          ],
        },
        UserMetadata: {
          contentId: contentId,
        },
      };

      const response = await this.client.send(
        new CreateJobCommand(jobSettings),
      );

      if (!response.Job || !response.Job.Id) {
        throw new Error('Failed to create MediaConvert job');
      }

      return {
        jobId: response.Job.Id,
        status: response.Job.Status || 'SUBMITTED',
      };
    } catch (err) {
      this.logger.error(`MediaConvert job submission failed: ${err.message}`);
      throw err;
    }
  }

  private createHlsOutput(
    name: string,
    width: number,
    height: number,
    bitrate: number,
  ) {
    return {
      VideoDescription: {
        Width: width,
        Height: height,
        CodecSettings: {
          Codec: 'H_264',
          H264Settings: {
            Bitrate: bitrate,
            RateControlMode: 'CBR',
            SceneChangeDetect: 'ENABLED',
          },
        },
      },
      AudioDescriptions: [
        {
          CodecSettings: {
            Codec: 'AAC',
            AacSettings: {
              Bitrate: 96000,
              CodingMode: 'CODING_MODE_2_0',
              SampleRate: 48000,
            },
          },
        },
      ],
      OutputSettings: {
        HlsSettings: {
          AudioGroupId: 'program_audio',
          IFrameOnlyManifest: 'EXCLUDE',
        },
      },
      NameModifier: `_${name}`,
    };
  }

  async getJobStatus(jobId: string): Promise<string> {
    try {
      const response = await this.client.send(new GetJobCommand({ Id: jobId }));
      return response.Job?.Status || 'UNKNOWN';
    } catch (err) {
      this.logger.error(
        `Failed to get job status for ${jobId}: ${err.message}`,
      );
      throw err;
    }
  }
}
