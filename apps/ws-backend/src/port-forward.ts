import { spawn, type ChildProcess } from 'child_process';

// In local dev the ws-backend runs on the host while runner pods live inside
// the k8s cluster. The orchestrator writes a runnerAddr like
// "ws://svc-repl-xxx:3001" which only resolves from inside the cluster. To
// bridge that, we spawn `kubectl port-forward` on demand and hand the proxy a
// host-reachable "ws://127.0.0.1:<port>" address instead.
//
// One forward per replId, kept alive while the proxy is using it; we kill it
// when the last client for that repl disconnects.

interface ForwardEntry {
  port: number;
  proc: ChildProcess;
  refCount: number;
  ready: Promise<number>;
}

const READY_LINE_RE = /Forwarding from 127\.0\.0\.1:(\d+) ->/;

const forwards = new Map<string, ForwardEntry>();

const NAMESPACE = process.env.K8S_NAMESPACE || 'default';
const KUBECTL = process.env.KUBECTL_BIN || 'kubectl';
const READY_TIMEOUT_MS = 10_000;

function spawnForward(replId: string): ForwardEntry {
  const svc = `svc/svc-${replId}`;
  const proc = spawn(
    KUBECTL,
    ['port-forward', '-n', NAMESPACE, svc, ':3001'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const ready = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`kubectl port-forward timeout for ${replId}`));
      try {
        proc.kill('SIGTERM');
      } catch {}
    }, READY_TIMEOUT_MS);

    let buf = '';
    proc.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
      const match = buf.match(READY_LINE_RE);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1]!, 10);
        resolve(port);
      }
    });
    proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      console.warn(`[port-forward ${replId}] stderr: ${msg.trim()}`);
    });
    proc.on('exit', (code, signal) => {
      clearTimeout(timeout);
      console.warn(`[port-forward ${replId}] exited code=${code} signal=${signal}`);
      forwards.delete(replId);
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      console.error(`[port-forward ${replId}] spawn error:`, err);
      forwards.delete(replId);
      reject(err);
    });
  });

  const entry: ForwardEntry = {
    port: 0,
    proc,
    refCount: 0,
    ready,
  };
  ready.then((port) => {
    entry.port = port;
    console.log(`[port-forward ${replId}] ready on 127.0.0.1:${port}`);
  }).catch(() => {});

  forwards.set(replId, entry);
  return entry;
}

export async function acquireRunnerUrl(replId: string): Promise<string> {
  let entry = forwards.get(replId);
  if (!entry) {
    entry = spawnForward(replId);
  }
  entry.refCount++;
  const port = await entry.ready;
  return `ws://127.0.0.1:${port}`;
}

export function releaseRunnerUrl(replId: string): void {
  const entry = forwards.get(replId);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0) {
    try {
      entry.proc.kill('SIGTERM');
    } catch {}
    forwards.delete(replId);
  }
}

export function shutdownAllForwards(): void {
  for (const [replId, entry] of forwards.entries()) {
    try {
      entry.proc.kill('SIGTERM');
    } catch {}
    forwards.delete(replId);
  }
}
