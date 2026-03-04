/**
 * @fileoverview R2 Upload Service
 *
 * Provides S3-compatible multipart upload functionality for Cloudflare R2.
 * Supports creating presigned URLs for client-side uploads, completing
 * multipart uploads, and aborting failed uploads.
 *
 * @module R2Service
 */

import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class R2Service {
  private s3: S3Client;
  private bucket: string;
  private logger = new Logger(R2Service.name);
  private presignExpires: number;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID!;
    const accessKey = process.env.R2_ACCESS_KEY_ID!;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY!;
    this.bucket = process.env.R2_BUCKET!;
    this.presignExpires = Number(process.env.PRESIGN_EXPIRES ?? 3600);

    const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

    this.s3 = new S3Client({
      region: process.env.R2_REGION ?? 'auto',
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: false,
    });
  }

  /**
   * Creates a multipart upload and generates presigned URLs for each part.
   *
   * @param key        - R2 object key (file path in bucket).
   * @param partSize   - Size of each upload part in bytes.
   * @param partsCount - Number of parts the client will upload.
   * @returns Upload ID, key, and array of presigned URLs.
   */
  async createMultipartPresigned(
    key: string,
    partSize: number,
    partsCount: number,
  ) {
    const createCmd = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const createRes = await this.s3.send(createCmd);
    const uploadId = createRes.UploadId;
    if (!uploadId) throw new Error('Failed to create multipart upload');

    const urls: string[] = [];
    for (let partNumber = 1; partNumber <= partsCount; partNumber++) {
      const uploadPartCmd = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const signed = await getSignedUrl(this.s3, uploadPartCmd, {
        expiresIn: this.presignExpires,
      });
      urls.push(signed);
    }

    return { uploadId, key, urls };
  }

  /**
   * Completes a multipart upload by assembling all uploaded parts.
   *
   * @param uploadId - Upload session ID from `createMultipartPresigned`.
   * @param key      - R2 object key.
   * @param parts    - Array of part numbers and ETags from client uploads.
   * @returns R2 completion response.
   */
  async completeMultipart(
    uploadId: string,
    key: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
  ) {
    const cmd = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });
    return this.s3.send(cmd);
  }

  /**
   * Aborts a multipart upload, cleaning up any uploaded parts.
   *
   * @param uploadId - Upload session ID to abort.
   * @param key      - R2 object key.
   * @returns R2 abort response.
   */
  async abortMultipart(uploadId: string, key: string) {
    const cmd = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    });
    return this.s3.send(cmd);
  }
}
