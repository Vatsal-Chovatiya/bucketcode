import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateUpgrade, AuthError, RetryableError } from './auth.js';
import { rateLimiter } from './rate-limiter.js';
import { startProxy } from './proxy.js';
import { connectionTracker } from './connection-tracker.js';
import { acquireRunnerUrl, releaseRunnerUrl, shutdownAllForwards } from './port-forward.js';

const PORT = process.env.PORT || 3003;

// In dev the orchestrator stores runnerAddr as cluster DNS (ws://svc-<replId>:3001).
// That DNS only resolves inside the cluster, so on the host we transparently
// route through `kubectl port-forward` to a local 127.0.0.1 port.
function needsPortForward(runnerAddr: string): boolean {
  if (process.env.WS_BACKEND_NO_PORT_FORWARD === '1') return false;
  try {
    const u = new URL(runnerAddr);
    return u.hostname.startsWith('svc-');
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ws-backend' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (request, socket, head) => {
  try {
    // 1. Authenticate & validate
    const authResult = await authenticateUpgrade(request.url);
    const { userId, replId, runnerAddr } = authResult;

    // 2. Rate limiting (Upgrade Limit)
    if (!rateLimiter.checkUpgradeAllowed(userId)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    // 3. Rate limiting (Concurrent WS Limit)
    if (!rateLimiter.checkConcurrentAllowed(userId)) {
      socket.write('HTTP/1.1 429 Too Many Requests (Concurrent Limit)\r\n\r\n');
      socket.destroy();
      return;
    }

    // 4. Resolve runner URL — rewrite cluster DNS to a local port-forward in dev
    let resolvedRunnerAddr = runnerAddr;
    let usingPortForward = false;
    if (needsPortForward(runnerAddr)) {
      try {
        resolvedRunnerAddr = await acquireRunnerUrl(replId);
        usingPortForward = true;
        console.log(`[Upgrade] Routing ${replId} via port-forward → ${resolvedRunnerAddr}`);
      } catch (pfErr) {
        console.error(`[Upgrade] Port-forward failed for ${replId}:`, pfErr);
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // 5. Accept Upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log(`[Upgrade] Client connected for ${replId}`);

      // Attach handlers synchronously so we don't drop messages that arrive
      // between the upgrade and any async setup work.
      rateLimiter.incrementConcurrent(userId);
      startProxy(ws, resolvedRunnerAddr, replId);

      ws.on('close', () => {
        rateLimiter.decrementConcurrent(userId);
        if (usingPortForward) releaseRunnerUrl(replId);
      });

      // Track the connection in the background — failure here is non-fatal.
      connectionTracker.addConnection(replId, ws).catch((err) => {
        console.warn(`[Upgrade] connectionTracker.addConnection failed for ${replId}:`, err);
      });
    });

  } catch (err: any) {
    if (err instanceof AuthError) {
      if (err.statusCode === 410) {
        // Repl is terminated — send a proper WS upgrade rejection
        // We can't send WS close frames before the upgrade, so reject at HTTP level
        socket.write(`HTTP/1.1 410 Gone\r\n\r\n`);
      } else {
        socket.write(`HTTP/1.1 ${err.statusCode} ${err.message}\r\n\r\n`);
      }
    } else if (err instanceof RetryableError) {
      socket.write(`HTTP/1.1 ${err.statusCode} ${err.message}\r\nRetry-After: ${err.retryAfter}\r\n\r\n`);
    } else {
      console.error('[Upgrade Error]', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[ws-backend] Server listening on port ${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdownAllForwards();
    process.exit(0);
  });
}
