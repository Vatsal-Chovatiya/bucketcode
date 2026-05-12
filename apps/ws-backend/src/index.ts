import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateUpgrade, AuthError, RetryableError } from './auth.js';
import { rateLimiter } from './rate-limiter.js';
import { startProxy } from './proxy.js';
import { connectionTracker } from './connection-tracker.js';

const PORT = process.env.PORT || 3003;

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
    const { userId, replId, podName } = authResult;

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

    // 4. Accept Upgrade
    wss.handleUpgrade(request, socket, head, async (ws) => {
      console.log(`[Upgrade] Client connected for ${replId}`);
      
      rateLimiter.incrementConcurrent(userId);
      await connectionTracker.addConnection(replId, ws);

      // Local dev usually uses svc-${replId}:3001, production uses K8s DNS
      const runnerAddr = `ws://svc-${replId}:3001`;

      // 5. Start Proxy
      startProxy(ws, runnerAddr, replId);

      // Cleanup on close
      ws.on('close', () => {
        rateLimiter.decrementConcurrent(userId);
      });
    });

  } catch (err: any) {
    if (err instanceof AuthError) {
      socket.write(`HTTP/1.1 ${err.statusCode} ${err.message}\r\n\r\n`);
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
