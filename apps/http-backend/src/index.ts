import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { replRouter } from './routes/repl.js';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());

app.route('/repl', replRouter);

app.get('/health', (c) => c.json({ status: 'ok' }));

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
console.log(`Starting http-backend server on port ${port}...`);

serve({
  fetch: app.fetch,
  port
});