import { ChannelState, DeleteChannelCommand, DeleteInputCommand, ListChannelsCommand, ListInputsCommand, MediaLiveClient, StopChannelCommand } from '@aws-sdk/client-medialive';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new MediaLiveClient({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
        },
      }
    : {}),
});

async function main() {
  console.log('Fetching channels...');
  const channelsResponse = await client.send(new ListChannelsCommand({}));
  const channels = channelsResponse.Channels || [];
  
  for (const channel of channels) {
    if (channel.State !== ChannelState.DELETED) {
      console.log(`Channel ${channel.Id} state is ${channel.State}`);
      if (channel.State === ChannelState.RUNNING || channel.State === ChannelState.STARTING || channel.State === ChannelState.STOPPING) {
        if (channel.State !== ChannelState.STOPPING) {
          console.log(`Stopping channel ${channel.Id}...`);
          try {
             await client.send(new StopChannelCommand({ ChannelId: channel.Id }));
          } catch(e: any) { console.error(e.message) }
        }
      } else {
        console.log(`Deleting channel ${channel.Id}...`);
        try {
          await client.send(new DeleteChannelCommand({ ChannelId: channel.Id }));
        } catch(e: any) { console.error(e.message) }
      }
    }
  }

  console.log('Fetching inputs...');
  const inputsResponse = await client.send(new ListInputsCommand({}));
  const inputs = inputsResponse.Inputs || [];
  
  for (const input of inputs) {
    if (input.State !== 'DELETED') {
      console.log(`Deleting input ${input.Id}...`);
      try {
        await client.send(new DeleteInputCommand({ InputId: input.Id }));
      } catch (e: any) {
        console.error(`Failed to delete input ${input.Id}:`, e.message);
      }
    }
  }
}

main().catch(console.error);


//npx ts-node scripts/cleanup_medialive.ts
