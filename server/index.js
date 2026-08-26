import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ROOT, ensureWorkspace } from './store.js';
import { ChatConnection } from './agent.js';
import apiRouter from './routes.js';

const PORT = Number(process.env.SPORTCHAT_PORT || 3777);
// в Docker контейнер обязан слушать 0.0.0.0; локально по умолчанию — только localhost
const HOST = process.env.HOST || '127.0.0.1';

ensureWorkspace();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// лог каждого HTTP-запроса — чтобы docker logs показывал активность
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms)`);
    if (res.statusCode >= 500) console.error(`[http-5xx] ${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

app.use(express.static(path.join(ROOT, 'public')));
app.use('/api', apiRouter);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log(`[ws] соединение открыто (всего: ${wss.clients.size})`);
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
  ws.on('close', () => {
    console.log(`[ws] соединение закрыто (осталось: ${wss.clients.size - 1})`);
    conn.close();
  });
  ws.on('error', (e) => console.error('[ws] ошибка:', e.message));
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log('');
  console.log('  ⚡ SportChat — аналитика на реальном Claude Code');
  console.log(`  ▸ Интерфейс:  http://${shown}:${PORT}`);
  console.log(`  ▸ Workspace:  ${path.join(ROOT, 'workspace')}`);
  console.log('');
});
