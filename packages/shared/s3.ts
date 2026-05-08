import { S3Client } from '@aws-sdk/client-s3';
import type { S3Config } from './types.js';


export const s3Config: S3Config = {
  endpoint: process.env.S3_ENDPOINT || '',
  region: process.env.S3_REGION || 'us-east-1',
  bucket: process.env.S3_BUCKET || '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  forcePathStyle: true, // required for MinIO
};

export const s3Client = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
  },
  forcePathStyle: s3Config.forcePathStyle,
});

export const s3Paths = {
  getTemplatePath: (language: string) => `templates/${language}/`,
  getUserCodePath: (replId: string) => `code/${replId}/`,
};

export type { 
  GetObjectCommandInput, 
  PutObjectCommandInput, 
  CopyObjectCommandInput, 
  ListObjectsV2CommandInput 
} from '@aws-sdk/client-s3';
