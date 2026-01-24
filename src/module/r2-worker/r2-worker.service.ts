// import { Injectable, Logger } from '@nestjs/common';
// import fetch from 'node-fetch';
//
// @Injectable()
// export class R2WorkerService {
//   private readonly logger = new Logger(R2WorkerService.name);
//   private workerBase: string;
//   private workerSecret: string;
//
//   constructor() {
//     this.workerBase = process.env.R2_WORKER_URL || '';
//     this.workerSecret = process.env.R2_WORKER_SECRET || '';
//     if (!this.workerBase) {
//       this.logger.warn('R2_WORKER_URL is not set. R2 Worker calls will fail.');
//     }
//     if (!this.workerSecret) {
//       this.logger.warn('R2_WORKER_SECRET is not set. R2 Worker calls will fail.');
//     }
//   }
//
//   private authHeaders(json = true) {
//     return {
//       Authorization: `Bearer ${this.workerSecret}`,
//       ...(json ? { 'Content-Type': 'application/json' } : {}),
//     };
//   }
//
//   async initiate(key: string) {
//     const url = `${this.workerBase.replace(/\/$/, '')}/multipart/initiate`;
//     const res = await fetch(url, {
//       method: 'POST',
//       headers: this.authHeaders(),
//       body: JSON.stringify({ key }),
//     });
//     if (!res.ok) {
//       const txt = await res.text();
//       throw new Error(`Worker initiate failed ${res.status} ${txt}`);
//     }
//     return res.json(); // { uploadId, key }
//   }
//
//   // Proxy chunk to worker - chunk is Buffer
//   async uploadPart(uploadId: string, partNumber: number, chunk: Buffer) {
//     const urlObj = new URL(`${this.workerBase.replace(/\/$/, '')}/multipart/part`);
//     urlObj.searchParams.set('uploadId', uploadId);
//     urlObj.searchParams.set('partNumber', String(partNumber));
//
//     const res = await fetch(urlObj.toString(), {
//       method: 'PUT',
//       headers: { Authorization: `Bearer ${this.workerSecret}` },
//       body: chunk,
//     });
//
//     if (!res.ok) {
//       const txt = await res.text();
//       throw new Error(`Worker uploadPart failed ${res.status} ${txt}`);
//     }
//     return res.json(); // { etag }
//   }
//
//   async complete(uploadId: string, key: string, parts: Array<{ PartNumber: number; ETag: string }>) {
//     const url = `${this.workerBase.replace(/\/$/, '')}/multipart/complete`;
//     const res = await fetch(url, {
//       method: 'POST',
//       headers: this.authHeaders(),
//       body: JSON.stringify({ uploadId, key, parts }),
//     });
//     if (!res.ok) {
//       const txt = await res.text();
//       throw new Error(`Worker complete failed ${res.status} ${txt}`);
//     }
//     return res.json();
//   }
// }
// src/r2/r2.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

  // create multipart upload and generate presigned urls for `partsCount` parts
  async createMultipartPresigned(
    key: string,
    partSize: number,
    partsCount: number,
  ) {
    // 1) create multipart upload
    const createCmd = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const createRes = await this.s3.send(createCmd);
    const uploadId = createRes.UploadId;
    if (!uploadId) throw new Error('Failed to create multipart upload');

    // 2) generate presigned URLs for each part (1..partsCount)
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

  // complete multipart
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
    const res = await this.s3.send(cmd);
    return res;
  }

  // abort multipart
  async abortMultipart(uploadId: string, key: string) {
    const cmd = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    });
    return this.s3.send(cmd);
  }
}
