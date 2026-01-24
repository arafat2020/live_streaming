import { S3Client } from '@aws-sdk/client-s3';

/**
 * Validate environment variables with helpful error messages
 */
const validateEnvVar = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(
      `❌ Missing required environment variable: ${name}\n` +
        `Please set it in your .env file or environment.`,
    );
  }
  return value;
};

/**
 * R2 Configuration
 * Cloudflare R2 is S3-compatible object storage
 */
export const r2Client = new S3Client({
  region: 'auto', // R2 uses 'auto' for region
  endpoint: validateEnvVar('R2_ENDPOINT', process.env.R2_ENDPOINT),
  credentials: {
    accessKeyId: validateEnvVar(
      'R2_ACCESS_KEY_ID',
      process.env.R2_ACCESS_KEY_ID,
    ),
    secretAccessKey: validateEnvVar(
      'R2_SECRET_ACCESS_KEY',
      process.env.R2_SECRET_ACCESS_KEY,
    ),
  },
  // ✅ Production optimizations
  maxAttempts: 3, // Retry failed requests
  requestHandler: {
    connectionTimeout: 30000, // 30 seconds
    socketTimeout: 30000,
  },
});

/**
 * R2 Bucket Configuration
 */
export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'videos';

/**
 * R2 Public URL
 * This is the public URL where your videos will be accessible
 * Format: https://pub-xxxxx.r2.dev or your custom domain
 */
export const R2_PUBLIC_URL = validateEnvVar(
  'R2_PUBLIC_BUCKET_URL',
  process.env.R2_PUBLIC_BUCKET_URL,
);

/**
 * Log configuration on startup (helpful for debugging)
 */
console.log('📦 R2 Configuration:');
console.log(`   Bucket: ${R2_BUCKET}`);
console.log(`   Public URL: ${R2_PUBLIC_URL}`);
console.log(`   Endpoint: ${process.env.R2_ENDPOINT}`);
console.log('   ✅ R2 Client initialized successfully');

/**
 * Test R2 connection (optional but recommended for production)
 */
export const testR2Connection = async (): Promise<boolean> => {
  try {
    const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
    await r2Client.send(new ListBucketsCommand({}));
    console.log('✅ R2 connection test successful');
    return true;
  } catch (error) {
    console.error('❌ R2 connection test failed:', error.message);
    return false;
  }
};
