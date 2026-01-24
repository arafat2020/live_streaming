import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import Cloudflare from 'cloudflare';

// import Cloudflare from 'cloudflare';
@Injectable()
export class CloudflareService {
  private readonly accountId: string;
  private readonly token: string;
  constructor() {
    // 1. Validate and assert the types of environment variables
    if (!process.env.CF_ACCOUNT_ID) {
      throw new InternalServerErrorException(
        'Cloudflare account ID is not configured.',
      );
    }
    if (!process.env.CF_API_TOKEN) {
      throw new InternalServerErrorException(
        'Cloudflare API token is not configured.',
      );
    }

    // Assign the validated values, asserting they are strings
    this.accountId = process.env.CF_ACCOUNT_ID;
    this.token = process.env.CF_API_TOKEN;
  }
  async createLiveInput(userId: string, name?: string) {
    console.log(`Creating Live Input for :${userId}`);
    const client = new Cloudflare({
      apiToken: this.token, // Use the validated token
    });

    const streamName = name || `user_${userId}_live`;

    // Now this.accountId is guaranteed to be a string
    const liveInput = await client.stream.liveInputs.create({
      account_id: this.accountId,
      meta: {
        name: streamName,
      },
    });

    console.log('liveInput------------------>', liveInput);

    console.log('accountId---------------->', this.accountId);
    console.log('token---------------->', this.token);
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/live_inputs`;
    console.log('url---------------------->', url);
    const payload = { meta: { name: name || `user_${userId}_live` } };
    console.log('payload---------------------->', payload);
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    console.log('response---------------------->', response);
    return response.data.result;
  }

  async getLiveInput(inputId: string) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/live_inputs/${inputId}`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    return response.data.result;
  }

  async deleteLiveInput(inputId: string) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/live_inputs/${inputId}`;

    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    return response.data;
  }

  async getLiveInputHealth(inputId: string) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/live_inputs/${inputId}/health`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    return response.data.result;
  }
}

// async createLiveInput(userId: string) {
//   const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/live_inputs`;
//
//   const payload = {
//     meta: { name: `user_${userId}_live` }
//   };
//
//   const response = await axios.post(url, payload, {
//     headers: {
//       Authorization: `Bearer ${this.token}`,
//       'Content-Type': 'application/json',
//     },
//   });
//
//   return response.data.result;
// }
