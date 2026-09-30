/* «Мои прогнозы» (PLAN-REDESIGN Фаза 9.3): принятые экспрессы/прогнозы
 * с автотрекингом итогов ног. Хранилище data/predictions.json (вне git).
 * Статус экспресса: одна нога lost → lost; все won → won; иначе pending. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey } from './sstats.js';
import { outcomeFor } from './signals.js';

const router = express.Router();
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'predictions.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { version: 1, predictions: [] }; }
}
function writeAll(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

/** Проверка ног по завершённым матчам (как autoCheck в signals.js). */
async function autoCheck(list) {
  const apiKey = loadApiKey();
  if (!apiKey) return;
  const now = Date.now();
  const pending = list.predictions.filter((p) => p.status === 'pending');
  const legIds = new Set();
  for (const p of pending) {
    for (const leg of p.legs || []) {
      if (leg.status === 'pending') legIds.add(String(leg.gameId));
    }
  }
  let checked = 0;
  for (const gid of legIds) {
    if (checked >= 8) break;
    checked++;
    let game = null;
    try {
      const r = await fetch(`https://api.sstats.net/Games/${gid}?apikey=${apiKey}`, { signal: AbortSignal.timeout(12_000) });
      const j = await r.json();
      game = j?.data ?? j;
    } catch { /* сетевой сбой — попробуем в следующий раз */ }
    if (!game || game.statusName !== 'Ended') continue;
    for (const p of list.predictions) {
      for (const leg of p.legs || []) {
        if (String(leg.gameId) !== String(gid) || leg.status !== 'pending') continue;
        const res = outcomeFor(leg.key, game);
        if (res) { leg.status = res; leg.score = `${game.homeResult}:${game.awayResult}`; }
      }
    }
  }
  // статусы экспрессов по ногам
  for (const p of list.predictions) {
    if (p.status !== 'pending') continue;
    const legStatuses = (p.legs || []).map((l) => l.status);
    if (legStatuses.includes('lost')) p.status = 'lost';
    else if (legStatuses.length && legStatuses.every((s) => s === 'won')) p.status = 'won';
    else if (legStatuses.length && legStatuses.every((s) => s !== 'pending')) p.status = 'void';
  }
  writeAll(list);
}

router.get('/', async (req, res) => {
  const list = readAll();
  try { await autoCheck(list); } catch { /* некритично */ }
  res.json({ ok: true, predictions: [...list.predictions].reverse() });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const legs = Array.isArray(b.legs) ? b.legs : [];
  if (legs.length < 2) return res.status(400).json({ error: 'Экспресс — минимум 2 ноги' });
  const clean = legs.slice(0, 12).map((l) => ({
    gameId: String(l.gameId || '').replace(/[^\d]/g, ''),
    match: String(l.match || '').slice(0, 160),
    market: String(l.market || '').slice(0, 60),
    key: String(l.key || '').trim().toLowerCase().slice(0, 12),
    pick: String(l.pick || '').slice(0, 200),
    odds: Number(String(l.odds ?? '').replace(',', '.')) || 1,
    status: 'pending',
  }));
  if (clean.some((l) => !l.gameId || !l.key)) {
    return res.status(400).json({ error: 'Каждая нога требует gameId и key рынка' });
  }
  const list = readAll();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const id = `EXP-${day}-${String(list.seqNext || 1).padStart(3, '0')}`;
  list.seqNext = (list.seqNext || 1) + 1;
  list.predictions.push({
    id,
    legs: clean,
    odds: Number(String(b.odds ?? '').replace(',', '.')) || +clean.reduce((a, l) => a * l.odds, 1).toFixed(2),
    fair: Number(String(b.fair ?? '').replace(',', '.')) || null,
    ev: Number(String(b.ev ?? '').replace(',', '.')) || null,
    probability: Number(String(b.probability ?? '').replace(',', '.')) || null,
    risk: String(b.risk || '').slice(0, 300),
    source: String(b.source || 'feed').slice(0, 20),
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  writeAll(list);
  res.json({ ok: true, id });
});

router.delete('/:id', (req, res) => {
  const list = readAll();
  const before = list.predictions.length;
  list.predictions = list.predictions.filter((p) => p.id !== req.params.id);
  if (list.predictions.length === before) return res.status(404).json({ error: 'Прогноз не найден' });
  writeAll(list);
  res.json({ ok: true });
});

export default router;
