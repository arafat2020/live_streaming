import { S3Client } from '@aws-sdk/client-s3';

// Validate environment variables
const validateEnvVar = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: validateEnvVar('R2_ENDPOINT', process.env.R2_ENDPOINT),
  credentials: {
    accessKeyId: validateEnvVar('R2_ACCESS_KEY_ID', process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: validateEnvVar('R2_SECRET_ACCESS_KEY', process.env.R2_SECRET_ACCESS_KEY),
  },
});

// export const R2_BUCKET = validateEnvVar('R2_BUCKET_NAME', process.env.R2_BUCKET_NAME); 
// export const R2_PUBLIC_URL = validateEnvVar('R2_PUBLIC_URL', process.env.R2_PUBLIC_URL);
export const R2_PUBLIC_URL =process.env.R2_PUBLIC_BUCKET_URL;
export const R2_BUCKET = 'videos';