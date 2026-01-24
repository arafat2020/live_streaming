import { Injectable } from '@nestjs/common';

@Injectable()
export class StreamsService {
  // create(createStreamDto: CreateStreamDto) {
  //   return 'This action adds a new stream';
  // }

  findAll() {
    return `This action returns all streams`;
  }

  findOne(id: number) {
    return `This action returns a #${id} stream`;
  }

  // update(id: number, updateStreamDto: UpdateStreamDto) {
  //   return `This action updates a #${id} stream`;
  // }

  remove(id: number) {
    return `This action removes a #${id} stream`;
  }
}
