import { WebSocket } from 'ws';
import { client } from '@repo/db';

export class ConnectionTracker {
  // Map of replId -> Set of active client WebSockets
  private activeConnections: Map<string, Set<WebSocket>> = new Map();

  public async addConnection(replId: string, ws: WebSocket) {
    let connections = this.activeConnections.get(replId);
    if (!connections) {
      connections = new Set();
      this.activeConnections.set(replId, connections);
    }
    
    connections.add(ws);

    // Update DB lastActiveAt
    try {
      await client.repl.update({
        where: { id: replId },
        data: { lastActiveAt: new Date() }
      });
    } catch (err) {
      console.error(`[ConnectionTracker] Failed to update lastActiveAt for ${replId}`, err);
    }
  }

  public async removeConnection(replId: string, ws: WebSocket) {
    const connections = this.activeConnections.get(replId);
    if (!connections) return;

    connections.delete(ws);

    if (connections.size === 0) {
      this.activeConnections.delete(replId);
      
      // Update DB lastActiveAt
      try {
        await client.repl.update({
          where: { id: replId },
          data: { lastActiveAt: new Date() }
        });
      } catch (err) {
        console.error(`[ConnectionTracker] Failed to update lastActiveAt for ${replId}`, err);
      }
    }
  }

  public getConnectionCount(replId: string): number {
    const connections = this.activeConnections.get(replId);
    return connections ? connections.size : 0;
  }
}

export const connectionTracker = new ConnectionTracker();
