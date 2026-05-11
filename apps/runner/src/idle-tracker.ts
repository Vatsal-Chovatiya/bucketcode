export class IdleTracker {
  private activeWsCount = 0;
  private lastActivityAt = Date.now();
  private ticker: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private replId: string,
    private onIdleTimeout: () => Promise<void>
  ) {}

  start() {
    this.ticker = setInterval(() => {
      this.checkIdle();
    }, 30000); // Check every 30 seconds
  }

  stop() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  incrementWs() {
    this.activeWsCount++;
    this.markActivity();
  }

  decrementWs() {
    this.activeWsCount = Math.max(0, this.activeWsCount - 1);
    this.markActivity();
  }

  markActivity() {
    this.lastActivityAt = Date.now();
  }

  private async checkIdle() {
    if (this.activeWsCount === 0 && (Date.now() - this.lastActivityAt) > this.IDLE_TIMEOUT_MS) {
      console.log(`[IdleTracker] No active connections for 5 minutes. Triggering idle timeout.`);
      this.stop();
      await this.onIdleTimeout();
    }
  }
}
