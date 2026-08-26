import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ROOT, ensureWorkspace } from './store.js';
import { ChatConnection } from './agent.js';
import apiRouter from './routes.js';

const PORT = Number(process.env.SPORTCHAT_PORT || 3777);
const HOST = '127.0.0.1';

ensureWorkspace();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/api', apiRouter);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const conn = new ChatConnection(ws);
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg && typeof msg === 'object') conn.handleMessage(msg);
  });
  ws.on('close', () => conn.close());
  ws.on('error', () => conn.close());
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ⚡ SportChat — аналитика на реальном Claude Code');
  console.log(`  ▸ Интерфейс:  http://${HOST}:${PORT}`);
  console.log(`  ▸ Workspace:  ${path.join(ROOT, 'workspace')}`);
  console.log('');
});
