export class RateLimiter {
  // Upgrade Rate Limit: Map of userId -> array of timestamps
  private upgradeAttempts: Map<string, number[]> = new Map();
  // Concurrent Limit: Map of userId -> current connection count
  private concurrentConnections: Map<string, number> = new Map();

  private readonly MAX_UPGRADES_PER_MIN = 10;
  private readonly MAX_CONCURRENT_WS = 5;

  constructor() {
    // Clean up old upgrade attempts every minute
    setInterval(() => this.cleanupUpgrades(), 60000);
  }

  public checkUpgradeAllowed(userId: string): boolean {
    const now = Date.now();
    const oneMinAgo = now - 60000;

    let attempts = this.upgradeAttempts.get(userId) || [];
    // Filter attempts within the last minute
    attempts = attempts.filter((timestamp) => timestamp > oneMinAgo);
    
    if (attempts.length >= this.MAX_UPGRADES_PER_MIN) {
      return false;
    }

    attempts.push(now);
    this.upgradeAttempts.set(userId, attempts);
    return true;
  }

  public checkConcurrentAllowed(userId: string): boolean {
    const current = this.concurrentConnections.get(userId) || 0;
    return current < this.MAX_CONCURRENT_WS;
  }

  public incrementConcurrent(userId: string) {
    const current = this.concurrentConnections.get(userId) || 0;
    this.concurrentConnections.set(userId, current + 1);
  }

  public decrementConcurrent(userId: string) {
    const current = this.concurrentConnections.get(userId) || 0;
    if (current > 0) {
      this.concurrentConnections.set(userId, current - 1);
    }
  }

  private cleanupUpgrades() {
    const oneMinAgo = Date.now() - 60000;
    for (const [userId, attempts] of this.upgradeAttempts.entries()) {
      const validAttempts = attempts.filter((timestamp) => timestamp > oneMinAgo);
      if (validAttempts.length === 0) {
        this.upgradeAttempts.delete(userId);
      } else {
        this.upgradeAttempts.set(userId, validAttempts);
      }
    }
  }
}

// Global instance for the service
export const rateLimiter = new RateLimiter();
