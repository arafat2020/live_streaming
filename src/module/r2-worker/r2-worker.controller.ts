import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { R2Service } from './r2-worker.service';
import { InitiateR2Dto } from './dto/initiate-r2.dto';
import { CompleteR2Dto } from './dto/complete-r2.dto';
import { AbortR2Dto } from './dto/abort-r2.dto';

@Controller('r2')
export class R2Controller {
  constructor(private readonly r2: R2Service) {}

  @Post('initiate')
  async initiate(@Body() body: InitiateR2Dto) {

    const filename = body.filename || `uploads/${Date.now()}-${uuidv4()}`;
    const partSize = Number(body.partSize) || 8 * 1024 * 1024; // default 8MiB

    if (partSize < 5 * 1024 * 1024) {
      throw new BadRequestException('partSize must be >= 5 MiB');
    }

    const partsCount = Number(body['partsCount'] || body['estimatedParts'] || 0);

    if (partsCount && partsCount > 10000) {
      throw new BadRequestException('too many parts');
    }


    if (!partsCount || partsCount < 1) {
      throw new BadRequestException('partsCount is required (client calculates based on fileSize / partSize)');
    }

    const res = await this.r2.createMultipartPresigned(filename, partSize, partsCount);
    return res; // { uploadId, key, urls: [...] }
  }

  @Post('complete')
  async complete(@Body() body: CompleteR2Dto) {
    const { uploadId, key, parts } = body;
    if (!uploadId || !key || !Array.isArray(parts)) throw new BadRequestException('uploadId, key and parts are required');
    return this.r2.completeMultipart(uploadId, key, parts);
  }

  @Post('abort')
  async abort(@Body() body: AbortR2Dto) {
    const { uploadId, key } = body;
    if (!uploadId || !key) throw new BadRequestException('uploadId and key required');
    return this.r2.abortMultipart(uploadId, key);
  }
}
