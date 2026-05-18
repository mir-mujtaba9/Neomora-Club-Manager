import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucketName: process.env.AWS_BUCKET_NAME,
  endpoint: process.env.AWS_ENDPOINT, // Optional for R2/LocalStack
}));
