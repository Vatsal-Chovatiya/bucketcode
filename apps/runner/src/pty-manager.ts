import * as pty from 'node-pty';
import os from 'os';

export interface PtyEventCallbacks {
  onData: (data: string) => void;
  onExit: (code: number, signal?: number) => void;
}

export class PtyManager {
  private ptyProcess: pty.IPty | null = null;

  constructor(
    private replId: string,
    private cols: number,
    private rows: number,
    private callbacks: PtyEventCallbacks
  ) {}

  start() {
    // Strip sensitive environment variables
    const env = { ...process.env };
    const varsToStrip = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'DATABASE_URL', 'KUBECONFIG', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION'];
    
    for (const key of Object.keys(env)) {
      if (varsToStrip.includes(key) || key.startsWith('AWS_') || key.startsWith('S3_')) {
        delete env[key];
      }
    }

    // Set safe terminal environment
    env['TERM'] = 'xterm-256color';
    env['HOME'] = '/workspace';
    env['PATH'] = '/usr/local/bin:/usr/bin:/bin';
    env['REPL_ID'] = this.replId;

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';

    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: this.cols,
      rows: this.rows,
      cwd: '/workspace',
      env: env as Record<string, string>,
    });

    this.ptyProcess.onData((data) => {
      this.callbacks.onData(data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.callbacks.onExit(exitCode, signal);
      this.ptyProcess = null;
    });
  }

  write(data: string) {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  resize(cols: number, rows: number) {
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
  }

  kill() {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
    }
  }
}
