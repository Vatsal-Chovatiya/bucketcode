#!/usr/bin/env node
import { spawn } from 'child_process';

const MAX_RESTARTS = 3;
let restartCount = 0;
let runnerProcess = null;

function startRunner() {
  console.log(`[Guard] Starting runner process (Attempt ${restartCount + 1}/${MAX_RESTARTS + 1})`);

  // Run under Node (not Bun) so node-pty's native PTY allocation works.
  // Bun's child-process handling sends SIGHUP to the spawned PTY shell
  // immediately, breaking the in-browser terminal.
  const cmd = 'node';
  const args = ['dist/bundle.mjs'];

  runnerProcess = spawn(cmd, args, {
    stdio: 'inherit',
    env: process.env
  });

  runnerProcess.on('close', (code, signal) => {
    console.log(`[Guard] Runner exited with code ${code} and signal ${signal}`);
    
    // If it was deliberately killed, exit guard as well
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      process.exit(code || 0);
    }

    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      setTimeout(startRunner, 1000); // 1 sec delay before restart
    } else {
      console.error('[Guard] Max restarts reached. Exiting.');
      process.exit(1);
    }
  });
}

// Graceful shutdown forwarding
function handleSignal(signal) {
  console.log(`\n[Guard] Received ${signal}. Forwarding to Runner...`);
  if (runnerProcess && !runnerProcess.killed) {
    runnerProcess.kill(signal);
  }
}

process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

// Start the runner for the first time
startRunner();
