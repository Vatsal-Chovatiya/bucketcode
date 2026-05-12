import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { client } from '@repo/db';
import { s3Client, s3Paths, s3Config } from '@repo/shared';
import { CopyObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import cuid from 'cuid';

export const replRouter = new Hono();

const replSchema = z.object({
  language: z.enum(['node-js', 'python']),
  name: z.string().optional().default('Untitled Repl'),
  ownerId: z.string(),
});

replRouter.post('/', zValidator('json', replSchema), async (c) => {
  const { language, name, ownerId } = c.req.valid('json');
  
  const replId = `repl-${cuid.slug()}`;
  const s3Path = s3Paths.getUserCodePath(replId);

  // Check if replId code path already exists (Idempotency)
  try {
    const listResponse = await s3Client.send(new ListObjectsV2Command({
      Bucket: s3Config.bucket,
      Prefix: s3Path,
      MaxKeys: 1
    }));
    
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      return c.json({ replId, s3Path, status: 'STARTING' }, 200);
    }
  } catch (err) {
    console.error('Error checking S3 path:', err);
    return c.json({ error: 'Failed to check S3 state' }, 500);
  }

  // Seed from templates
  try {
    const templatePath = s3Paths.getTemplatePath(language);
    
    let isTruncated = true;
    let continuationToken: string | undefined = undefined;

    while (isTruncated) {
      const listRes: ListObjectsV2CommandOutput = await s3Client.send(new ListObjectsV2Command({
        Bucket: s3Config.bucket,
        Prefix: templatePath,
        ContinuationToken: continuationToken
      }));

      const contents = listRes.Contents || [];
      
      const copyPromises = contents
        .filter((obj) => obj.Key && !obj.Key.endsWith('/')) // skip directories
        .filter((obj) => {
          // skip node_modules and .git
          const key = obj.Key!;
          return !key.includes('/node_modules/') && !key.includes('/.git/');
        })
        .map((obj) => {
          const key = obj.Key!;
          const relativePath = key.replace(templatePath, '');
          const destinationKey = `${s3Path}${relativePath}`;
          
          return s3Client.send(new CopyObjectCommand({
            Bucket: s3Config.bucket,
            CopySource: `${s3Config.bucket}/${key}`,
            Key: destinationKey,
          }));
        });

      await Promise.all(copyPromises);

      isTruncated = listRes.IsTruncated ?? false;
      continuationToken = listRes.NextContinuationToken;
    }
  } catch (err) {
    console.error('Error copying S3 templates:', err);
    return c.json({ error: 'Failed to copy templates' }, 500);
  }

  // DB Insert
  try {
    await client.user.upsert({
      where: { id: ownerId },
      create: {
        id: ownerId,
        email: `${ownerId}@dev.local`,
        username: ownerId,
      },
      update: {},
    });

    await client.repl.create({
      data: {
        id: replId,
        name,
        language: language === 'node-js' ? 'NODE_JS' : 'PYTHON',
        s3Path,
        ownerId,
        status: 'STARTING'
      }
    });
  } catch (err) {
    console.error('Error inserting Repl to DB:', err);
    // If it fails, S3 is seeded but no DB entry.
    // We could clean up S3 here, but since this is an ephemeral repl, it might be fine to leave it.
    return c.json({ error: 'Failed to insert into database' }, 500);
  }

  return c.json({ replId, s3Path, status: 'STARTING' }, 201);
});

replRouter.get('/:replId', async (c) => {
  const replId = c.req.param('replId');
  
  try {
    const repl = await client.repl.findUnique({
      where: { id: replId }
    });
    
    if (!repl) {
      return c.json({ error: 'Repl not found' }, 404);
    }
    
    return c.json(repl, 200);
  } catch (err) {
    console.error('Error fetching Repl:', err);
    return c.json({ error: 'Failed to fetch repl metadata' }, 500);
  }
});

replRouter.post('/:replId/keepalive', async (c) => {
  const replId = c.req.param('replId');
  
  try {
    await client.repl.update({
      where: { id: replId },
      data: {
        lastActiveAt: new Date()
      }
    });
    
    return c.json({ status: 'ok' }, 200);
  } catch (err) {
    console.error('Error updating keepalive:', err);
    return c.json({ error: 'Failed to update keepalive' }, 500);
  }
});
