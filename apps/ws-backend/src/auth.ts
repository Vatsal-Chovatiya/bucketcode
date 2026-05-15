import jwt from 'jsonwebtoken';
import { client } from '@repo/db';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';

// Local dev convenience: the web client uses this literal token when no real
// auth is wired up (apps/web/lib/ws-client.ts:getAuthToken). Treating it as a
// valid identity lets the IDE connect end-to-end without standing up a
// signing service. Disabled when AUTH_DEV_STUB=0 or NODE_ENV=production.
const DEV_STUB_TOKEN = 'dev-token-stub';
const DEV_STUB_ENABLED =
  process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_STUB !== '0';

export interface AuthResult {
  userId: string;
  replId: string;
  podName: string;
  runnerAddr: string;
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RetryableError extends Error {
  constructor(public statusCode: number, message: string, public retryAfter: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

export async function authenticateUpgrade(url: string | undefined): Promise<AuthResult> {
  if (!url) {
    throw new AuthError(400, 'Missing URL');
  }

  const parsedUrl = new URL(url, 'http://localhost');
  const token = parsedUrl.searchParams.get('token');
  const replId = parsedUrl.searchParams.get('replId');

  if (!token) {
    throw new AuthError(400, 'Missing token parameter');
  }
  if (!replId) {
    throw new AuthError(400, 'Missing replId parameter');
  }

  const isDevStub = DEV_STUB_ENABLED && token === DEV_STUB_TOKEN;

  let userId: string | undefined;
  if (!isDevStub) {
    let decodedToken: any;
    try {
      decodedToken = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      throw new AuthError(401, 'Invalid or expired token');
    }

    userId = decodedToken.userId;
    if (!userId) {
      throw new AuthError(401, 'Invalid token payload: missing userId');
    }
  }

  // Check ownership and status in DB
  const repl = await client.repl.findUnique({
    where: { id: replId },
    select: { ownerId: true, status: true, podName: true, runnerAddr: true },
  });

  if (!repl) {
    throw new AuthError(404, 'Repl not found');
  }

  if (isDevStub) {
    userId = repl.ownerId;
  } else if (repl.ownerId !== userId) {
    throw new AuthError(403, 'Forbidden: You do not own this Repl');
  }

  if (repl.status === 'TERMINATED') {
    throw new AuthError(410, 'Repl is terminated');
  }

  if (repl.status === 'STARTING' || !repl.podName) {
    // 503 Service Unavailable + Retry-After 2s
    throw new RetryableError(503, 'Pod is starting', 2);
  }

  if (!repl.runnerAddr) {
    // Pod exists but orchestrator hasn't written runnerAddr yet — retry shortly
    throw new RetryableError(503, 'Runner address not yet available', 2);
  }

  return {
    userId: userId!,
    replId,
    podName: repl.podName,
    runnerAddr: repl.runnerAddr,
  };
}
