import { WebSocketServer, WebSocket } from 'ws';
import { 
  ClientMessageSchema, 
  ServerMessageSchema,
  SyncEventEmitter
} from '@repo/shared';
import { FileManager } from './file-manager.js';
import { PtyManager } from './pty-manager.js';
import { IdleTracker } from './idle-tracker.js';

export class RunnerServer {
  private wss: WebSocketServer;
  private fileManager: FileManager;
  private ptyManager: PtyManager | null = null;
  private idleTracker: IdleTracker;
  private replId: string;

  constructor(port: number, replId: string) {
    this.replId = replId;
    this.wss = new WebSocketServer({ port });
    
    // SyncEventEmitter implementation
    const emitSyncEvent: SyncEventEmitter = (event, payload) => {
      this.broadcast(event, payload as any);
    };

    this.fileManager = new FileManager(replId, emitSyncEvent);
    
    this.idleTracker = new IdleTracker(replId, async () => {
      await this.handleIdleTimeout();
    });

    this.setupWss();
    this.idleTracker.start();
    console.log(`[RunnerServer] Listening on port ${port} for replId: ${replId}`);
  }

  private setupWss() {
    this.wss.on('connection', (ws) => {
      this.idleTracker.incrementWs();

      ws.on('message', async (data) => {
        this.idleTracker.markActivity();
        
        try {
          const parsed = JSON.parse(data.toString());
          const validation = ClientMessageSchema.safeParse(parsed);
          
          if (!validation.success) {
            console.warn('[RunnerServer] Dropping malformed message:', validation.error);
            return;
          }

          await this.handleMessage(ws, validation.data);
        } catch (err) {
          console.warn('[RunnerServer] Failed to process message:', err);
        }
      });

      ws.on('close', () => {
        this.idleTracker.decrementWs();
      });
      
      ws.on('error', (err) => {
        console.error('[RunnerServer] WebSocket error:', err);
      });
    });
  }

  private async handleMessage(ws: WebSocket, message: any) {
    const { event, payload } = message;

    switch (event) {
      case 'ping':
        this.send(ws, 'pong', {});
        break;
      
      case 'fetchDir':
        try {
          const tree = await this.fileManager.fetchDir(payload.path);
          this.send(ws, 'loaded', { tree });
        } catch (err: any) {
          this.send(ws, 'error', { code: 'FILE_READ_ERROR', message: err.message });
        }
        break;

      case 'fetchContent':
        try {
          const content = await this.fileManager.fetchContent(payload.path);
          this.send(ws, 'fileContent', { path: payload.path, content });
        } catch (err: any) {
          this.send(ws, 'error', { code: 'FILE_READ_ERROR', message: err.message });
        }
        break;

      case 'updateContent':
        const result = await this.fileManager.updateContent(payload.path, payload.content);
        if (!result.success) {
          this.send(ws, 'validationError', { path: payload.path, reason: result.reason || 'Validation failed' });
        }
        break;

      case 'requestTerminal':
        if (this.ptyManager) {
          this.ptyManager.kill();
        }
        this.ptyManager = new PtyManager(
          this.replId,
          payload.cols,
          payload.rows,
          {
            onData: (data) => this.broadcast('terminalData', data),
            onExit: (code, signal) => {
              this.broadcast('terminalExit', { code, signal: signal ? signal.toString() : undefined });
              this.ptyManager = null;
            }
          }
        );
        this.ptyManager.start();
        break;

      case 'terminalData':
        if (this.ptyManager) {
          this.ptyManager.write(payload);
        }
        break;
    }
  }

  private send(ws: WebSocket, event: string, payload: any) {
    const msg = { event, payload };
    const validation = ServerMessageSchema.safeParse(msg);
    if (validation.success) {
      ws.send(JSON.stringify(msg));
    } else {
      console.error('[RunnerServer] Attempted to send invalid message:', validation.error);
    }
  }

  private broadcast(event: string, payload: any) {
    const msg = { event, payload };
    const validation = ServerMessageSchema.safeParse(msg);
    if (!validation.success) {
      console.error('[RunnerServer] Attempted to broadcast invalid message:', validation.error);
      return;
    }
    
    const strMsg = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(strMsg);
      }
    }
  }

  private async handleIdleTimeout() {
    // 1. Send terminating event to connected websockets (even though count is 0, late reconnects might catch it)
    this.broadcast('podTerminating', { message: 'Pod is shutting down due to inactivity.' });

    // 2. We don't have to synchronously wait for S3 if we don't track the queue, but FileManager/S3SyncManager 
    // handles debounced writes. Ideally we'd drain the queue, but we'll assume S3SyncManager processes fast.
    
    // 3. Call Orchestrator POST /stop
    const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://orchestrator:3000';
    try {
      await fetch(`${orchestratorUrl}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replId: this.replId }),
      });
      console.log(`[RunnerServer] Successfully notified orchestrator to stop repl: ${this.replId}`);
    } catch (err) {
      console.error(`[RunnerServer] Failed to notify orchestrator:`, err);
    }

    // 4. Exit gracefully
    process.exit(0);
  }
}
