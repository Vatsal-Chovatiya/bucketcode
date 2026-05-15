#!/usr/bin/env node
// =============================================================================
// BucketCode — Template Seeder
// =============================================================================
// Uploads the starter templates under scripts/seed/templates/<lang>/ into MinIO
// at s3://${S3_BUCKET}/templates/<lang>/. The http-backend's repl creation
// copies these into per-repl prefixes when a workspace is created.
// =============================================================================

import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Templates live at repo-root/scripts/seed/templates/<lang>/...
const SEED_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts', 'seed', 'templates');
const BUCKET = process.env.S3_BUCKET || 'bucketcode-repls';
const ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const REGION = process.env.S3_REGION || 'us-east-1';
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';

const client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

const CONTENT_TYPES = {
  '.js': 'application/javascript',
  '.jsx': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.md': 'text/markdown',
};

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'text/plain';
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function seedLanguage(lang) {
  const langDir = path.join(SEED_DIR, lang);
  let exists = false;
  try {
    const stat = await fs.stat(langDir);
    exists = stat.isDirectory();
  } catch {}
  if (!exists) {
    console.warn(`[seed] Skipping ${lang} — directory ${langDir} not found`);
    return;
  }

  let uploaded = 0;
  for await (const file of walk(langDir)) {
    const relative = path.relative(langDir, file).split(path.sep).join('/');
    const key = `templates/${lang}/${relative}`;
    const body = await fs.readFile(file);
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentTypeFor(file),
      }),
    );
    uploaded++;
  }
  console.log(`[seed] ${lang}: uploaded ${uploaded} file(s) to s3://${BUCKET}/templates/${lang}/`);
}

async function listLanguages() {
  const entries = await fs.readdir(SEED_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function main() {
  // Ensure bucket reachable (fail fast with a friendly message).
  try {
    await client.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
  } catch (err) {
    console.error(`[seed] Cannot reach MinIO bucket '${BUCKET}' at ${ENDPOINT}:`, err.message);
    process.exit(1);
  }

  const languages = await listLanguages();
  if (languages.length === 0) {
    console.warn(`[seed] No template directories found under ${SEED_DIR}`);
    return;
  }

  for (const lang of languages) {
    await seedLanguage(lang);
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
