import { RunnerServer } from './ws-server.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const REPL_ID = process.env.REPL_ID;

if (!REPL_ID) {
  console.error('[FATAL] REPL_ID environment variable is missing.');
  process.exit(1);
}

console.log(`[Runner] Starting Runner Service for REPL: ${REPL_ID}`);

// Ensure /workspace exists
import fs from 'fs';
if (!fs.existsSync('/workspace')) {
  try {
    fs.mkdirSync('/workspace', { recursive: true });
    console.log('[Runner] Created /workspace directory');
  } catch (err) {
    console.error('[Runner] Failed to create /workspace directory', err);
  }
}

// Start WebSocket server
const server = new RunnerServer(PORT, REPL_ID);

// Signal handling
process.on('SIGTERM', () => {
  console.log('[Runner] Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Runner] Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});
