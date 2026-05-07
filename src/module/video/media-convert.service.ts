import { Injectable, Logger } from '@nestjs/common';
import {
  MediaConvertClient,
  CreateJobCommand,
  GetJobCommand,
  DescribeEndpointsCommand,
} from '@aws-sdk/client-mediaconvert';

export interface MediaConvertJobResult {
  jobId: string;
  outputS3Path: string;
}

@Injectable()
export class MediaConvertService {
  private readonly logger = new Logger(MediaConvertService.name);
  private client: MediaConvertClient;
  private endpoint: string;

  private readonly roleArn = process.env.MEDIACONVERT_ROLE_ARN!;
  private readonly s3Bucket = process.env.S3_BUCKET!;
  private readonly awsRegion = process.env.AWS_REGION || 'us-east-1';

  constructor() {
    this.client = new MediaConvertClient({
      region: this.awsRegion,
    });
  }

  /**
   * Initialize endpoint on first use (MediaConvert requires this)
   */
  private async initializeEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint;

    try {
      const result = await this.client.send(new DescribeEndpointsCommand({}));
      this.endpoint = result.Endpoints?.[0]?.Url || '';
      this.logger.log(`MediaConvert endpoint: ${this.endpoint}`);
      return this.endpoint;
    } catch (err) {
      this.logger.error(`Failed to get MediaConvert endpoint: ${err.message}`);
      throw err;
    }
  }

  /**
   * Submit a VOD transcoding job to MediaConvert.
   * Outputs multi-bitrate HLS to S3.
   *
   * @param params - contentId, inputS3Path
   * @returns jobId and output path
   */
  async submitTranscodingJob(params: {
    contentId: string;
    inputS3Path: string; // e.g., s3://bucket/uploads/input.mp4
  }): Promise<MediaConvertJobResult> {
    const { contentId, inputS3Path } = params;

    await this.initializeEndpoint();

    const outputPrefix = `videos/${contentId}`;
    const outputS3Path = `s3://${this.s3Bucket}/${outputPrefix}/`;

    this.logger.log(
      `Submitting MediaConvert job: ${inputS3Path} → ${outputS3Path}`,
    );

    // Multi-bitrate HLS output (1080p, 720p, 480p)
    const jobSettings = {
      TimecodeConfig: {
        Source: 'ZEROBASED',
      },
      OutputGroups: [
        {
          Name: 'HLS Output Group',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: outputS3Path,
              SegmentLength: 10,
              MinSegmentLength: 0,
              SegmentsPerSubdirectory: 10000,
              DirectoryStructure: 'SINGLE_DIRECTORY',
              Outputs: [
                {
                  NameModifier: '_1080p',
                  VideoDescription: {
                    Width: 1920,
                    Height: 1080,
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 5000000,
                        RateControlMode: 'VBR',
                        MaxBitrate: 7000000,
                      },
                    },
                  },
                  AudioDescriptions: [
                    {
                      CodecSettings: {
                        Codec: 'AAC',
                        AacSettings: {
                          Bitrate: 128000,
                          SampleRate: 48000,
                        },
                      },
                    },
                  ],
                },
                {
                  NameModifier: '_720p',
                  VideoDescription: {
                    Width: 1280,
                    Height: 720,
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 2500000,
                        RateControlMode: 'VBR',
                        MaxBitrate: 3500000,
                      },
                    },
                  },
                  AudioDescriptions: [
                    {
                      CodecSettings: {
                        Codec: 'AAC',
                        AacSettings: {
                          Bitrate: 128000,
                          SampleRate: 48000,
                        },
                      },
                    },
                  ],
                },
                {
                  NameModifier: '_480p',
                  VideoDescription: {
                    Width: 854,
                    Height: 480,
                    CodecSettings: {
                      Codec: 'H_264',
                      H264Settings: {
                        Bitrate: 1200000,
                        RateControlMode: 'VBR',
                        MaxBitrate: 1800000,
                      },
                    },
                  },
                  AudioDescriptions: [
                    {
                      CodecSettings: {
                        Codec: 'AAC',
                        AacSettings: {
                          Bitrate: 96000,
                          SampleRate: 48000,
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      Inputs: [
        {
          FileInput: inputS3Path,
        },
      ],
    };

    try {
      const response = await this.client.send(
        new CreateJobCommand({
          Role: this.roleArn,
          Settings: jobSettings as any,
          UserMetadata: {
            contentId,
          },
        }),
      );

      const jobId = response.Job?.Id!;
      this.logger.log(
        `MediaConvert job submitted: ${jobId} (contentId: ${contentId})`,
      );

      return {
        jobId,
        outputS3Path,
      };
    } catch (err) {
      this.logger.error(
        `Failed to submit MediaConvert job: ${(err as any).message}`,
      );
      throw err;
    }
  }

  /**
   * Get job status (optional, for polling)
   */
  async getJobStatus(jobId: string): Promise<any> {
    try {
      const result = await this.client.send(
        new GetJobCommand({ Id: jobId }),
      );
      return result.Job;
    } catch (err) {
      this.logger.error(`Failed to get job ${jobId}: ${(err as any).message}`);
      throw err;
    }
  }
}
