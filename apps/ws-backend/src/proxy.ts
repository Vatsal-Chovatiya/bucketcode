import { WebSocket } from 'ws';
import { connectionTracker } from './connection-tracker.js';
import { pollForRunner } from './reconnect.js';

const MAX_BUFFERED_AMOUNT = 1 * 1024 * 1024; // 1MB
const MAX_FRAME_SIZE = 10 * 1024 * 1024; // 10MB

export function startProxy(clientWs: WebSocket, initialRunnerAddr: string, replId: string) {
  let runnerWs: WebSocket | null = null;
  let isReconnecting = false;
  let isClientClosed = false;
  // Buffer client messages that arrive before the upstream runner WS opens
  // (e.g. the client's initial fetchDir sent immediately on open).
  const pendingFromClient: Array<{ data: WebSocket.Data; isBinary: boolean }> = [];

  const flushPending = () => {
    if (!runnerWs || runnerWs.readyState !== WebSocket.OPEN) return;
    while (pendingFromClient.length > 0) {
      const { data, isBinary } = pendingFromClient.shift()!;
      runnerWs.send(data, { binary: isBinary });
    }
  };

  const connectToRunner = (runnerAddr: string) => {
    runnerWs = new WebSocket(runnerAddr);

    runnerWs.on('open', () => {
      console.log(`[Proxy] Connected to runner for ${replId} at ${runnerAddr}`);
      flushPending();
      if (isReconnecting) {
        // Send a custom app-level event to let the frontend know we're back
        clientWs.send(JSON.stringify({ type: 'system', event: 'podReady' }));
        isReconnecting = false;
      }
    });

    runnerWs.on('message', (data: WebSocket.Data) => {
      if (isClientClosed) return;

      // Backpressure on the client socket
      if (clientWs.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        console.warn(`[Proxy] Client WS bufferedAmount > 1MB for ${replId}, dropping message from runner`);
        return;
      }

      // Relay to client
      clientWs.send(data);
    });

    runnerWs.on('close', async () => {
      console.log(`[Proxy] Runner WS closed for ${replId}`);
      if (isClientClosed) return;

      // Trigger reconnect flow
      isReconnecting = true;
      runnerWs = null;
      clientWs.send(JSON.stringify({ type: 'system', event: 'podRestarting', message: 'Workspace rebooting...' }));

      try {
        const newRunnerAddr = await pollForRunner(replId);
        if (!isClientClosed) {
          connectToRunner(newRunnerAddr);
        }
      } catch (err) {
        console.error(`[Proxy] Failed to reconnect to runner for ${replId}`, err);
        clientWs.close(1011, 'Failed to reconnect to runner pod');
      }
    });

    runnerWs.on('error', (err) => {
      console.error(`[Proxy] Runner WS error for ${replId}:`, err);
      // Let 'close' handler do the reconnect
      runnerWs?.close();
    });
  };

  // Initial connection
  connectToRunner(initialRunnerAddr);

  // Handle messages from client
  clientWs.on('message', (data: WebSocket.Data, isBinary: boolean) => {
    // Validate max frame size
    const length = Buffer.isBuffer(data) ? data.length : (data as string).length;
    if (length > MAX_FRAME_SIZE) {
      console.warn(`[Proxy] Client WS message > 10MB for ${replId}, dropping`);
      return;
    }

    if (runnerWs && runnerWs.readyState === WebSocket.OPEN) {
      // Backpressure on the runner socket
      if (runnerWs.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        console.warn(`[Proxy] Runner WS bufferedAmount > 1MB for ${replId}, dropping message from client`);
        return;
      }
      runnerWs.send(data, { binary: isBinary });
    } else {
      // Upstream not ready (still CONNECTING) — queue and flush on open.
      pendingFromClient.push({ data, isBinary });
    }
  });

  clientWs.on('close', () => {
    console.log(`[Proxy] Client WS closed for ${replId}`);
    isClientClosed = true;
    if (runnerWs) {
      runnerWs.close();
      runnerWs = null;
    }
    connectionTracker.removeConnection(replId, clientWs);
  });

  clientWs.on('error', (err) => {
    console.error(`[Proxy] Client WS error for ${replId}:`, err);
    clientWs.close();
  });
}
