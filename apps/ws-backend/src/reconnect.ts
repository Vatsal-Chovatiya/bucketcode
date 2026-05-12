const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3002';
const MAX_RETRIES = 30;
const POLL_INTERVAL_MS = 2000;

export async function pollForRunner(replId: string): Promise<string> {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/status/${replId}`);
      if (res.ok) {
        const data = await res.json() as any;
        
        if (data.status === 'RUNNING' && data.runnerAddr) {
          return data.runnerAddr;
        }
        
        if (data.status === 'TERMINATED') {
          throw new Error('Pod was terminated');
        }
      }
    } catch (err) {
      console.warn(`[Reconnect] Polling failed for ${replId}, retrying...`, err);
    }

    retries++;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Pod did not become ready after ${MAX_RETRIES} attempts`);
}
