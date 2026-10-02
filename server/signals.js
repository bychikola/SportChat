/* Трекинг сигналов: прогнозы из полных разборов + честная статистика точности.
 * Хранилище data/signals.json (вне git). Исход сигнала вычисляется автоматически
 * по завершённому матчу (Games/{id}) при запросе списка. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadApiKey } from './sstats.js';
import { fetchLiveMap, presumedFor, liveStage } from './live.js';

const router = express.Router();
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'signals.json');
const SSTATS_BASE = 'https://api.sstats.net';

const KEY_RE = /^(1|x|2|tb\d+([.,]\d+)?|tm\d+([.,]\d+)?|btts_yes|btts_no)$/i;

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { version: 1, signals: [] };
  }
}
function writeAll(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function parseTs(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Исход ставки по финальному счёту. */
export function outcomeFor(key, g) {
  const h = Number(g.homeResult), a = Number(g.awayResult);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  const k = String(key).toLowerCase().replace(',', '.');
  const mTot = /^(tb|tm)(\d+(?:\.\d+)?)$/.exec(k);
  if (k === '1') return h > a ? 'won' : 'lost';
  if (k === '2') return a > h ? 'won' : 'lost';
  if (k === 'x') return h === a ? 'won' : 'lost';
  if (k === 'btts_yes') return (h > 0 && a > 0) ? 'won' : 'lost';
  if (k === 'btts_no') return (h === 0 || a === 0) ? 'won' : 'lost';
  if (mTot) {
    // ключ tb25 означает линию 2.5: целое число без точки делится на 10
    const line = mTot[2].includes('.') ? parseFloat(mTot[2]) : parseFloat(mTot[2]) / 10;
    const total = h + a;
    if (total === line) return 'void';
    return (mTot[1] === 'tb') === (total > line) ? 'won' : 'lost';
  }
  return null;
}

/** Проверяем «ожидающие» сигналы по завершённым матчам (не больше 8 за раз). */
async function autoCheck(list) {
  const apiKey = loadApiKey();
  if (!apiKey) return;
  const now = Date.now();
  let checked = 0;
  for (const sig of list.signals) {
    if (sig.status !== 'pending' || checked >= 8) continue;
    const dueMs = sig.matchTs ?? (parseTs(sig.createdAt) ?? 0) + 3 * 3600_000;
    if (now - dueMs < 2.5 * 3600_000) continue; // матч ещё не должен был закончиться
    checked++;
    try {
      const r = await fetch(`${SSTATS_BASE}/Games/${sig.gameId}?apikey=${apiKey}`, { signal: AbortSignal.timeout(12_000) });
      if (!r.ok) continue;
      const j = await r.json();
      const g = j.data?.game || j.data;
      if (!g) continue;
      if ([5, 14, 15].includes(Number(g.status))) { // отменён/перенесён
        sig.status = 'void';
        sig.result = { score: '—', checkedAt: new Date().toISOString() };
        continue;
      }
      const out = outcomeFor(sig.key, g);
      if (out) {
        sig.status = out;
        sig.result = { score: `${g.homeResult}:${g.awayResult}`, checkedAt: new Date().toISOString() };
      }
    } catch { /* сеть — проверим при следующем запросе */ }
  }
  if (checked) writeAll(list);
}

router.get('/', async (req, res) => {
  const list = readAll();
  try { await autoCheck(list); } catch { /* некритично */ }
  const s = list.signals;
  // live-слой (К1): счёт/минута для pending-сигналов по идущим матчам
  try {
    const apiKey = loadApiKey();
    if (apiKey) {
      const liveMap = await fetchLiveMap(apiKey);
      for (const x of s) {
        if (x.status !== 'pending') { x.live = null; continue; }
        const g = liveMap.get(String(x.gameId));
        x.live = g ? { ...liveStage(g), presumed: presumedFor(x.key, g) } : null;
      }
    }
  } catch { /* без live-слоя ответ всё равно валиден */ }
  const settled = s.filter((x) => x.status === 'won' || x.status === 'lost');
  const won = settled.filter((x) => x.status === 'won').length;
  const byMarket = {};
  for (const x of settled) {
    const m = x.market || 'прочее';
    byMarket[m] = byMarket[m] || { settled: 0, won: 0 };
    byMarket[m].settled++;
    if (x.status === 'won') byMarket[m].won++;
  }
  for (const m of Object.values(byMarket)) m.accuracy = Math.round(m.won / m.settled * 100);
  res.json({
    ok: true,
    stats: {
      total: s.length,
      pending: s.filter((x) => x.status === 'pending').length,
      settled: settled.length,
      won,
      lost: settled.length - won,
      void: s.filter((x) => x.status === 'void').length,
      accuracy: settled.length ? Math.round(won / settled.length * 100) : null,
      byMarket,
    },
    signals: [...s].reverse(), // свежие сверху
  });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const gameId = String(b.gameId || '').trim();
  if (!/^\d+$/.test(gameId)) return res.status(400).json({ error: 'Нужен числовой gameId' });
  const key = String(b.key || '').trim().toLowerCase().replace(',', '.');
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Недопустимый key рынка (1/X/2/tbXX/tmXX/btts_yes/btts_no)' });
  const pick = String(b.pick || '').trim().slice(0, 200);
  if (!pick) return res.status(400).json({ error: 'Нужна формулировка ставки (pick)' });
  const odds = Number(String(b.odds ?? '').replace(',', '.'));
  const list = readAll();
  if (list.signals.some((x) => String(x.gameId) === gameId && x.key === key)) {
    return res.status(409).json({ error: 'Сигнал по этому матчу и рынку уже сохранён' });
  }
  const dateStr = String(b.date || '').slice(0, 40);
  list.signals.push({
    id: crypto.randomUUID(),
    gameId, key,
    match: String(b.match || '').slice(0, 200),
    league: String(b.league || '').slice(0, 120),
    market: String(b.market || '').slice(0, 120),
    pick,
    odds: Number.isFinite(odds) && odds > 1 ? odds : null,
    confidence: String(b.confidence || '').slice(0, 40),
    date: dateStr,
    matchTs: parseTs(dateStr),
    userId: String(b.userId || '').slice(0, 60) || null,
    amount: Number(String(b.amount ?? '').replace(',', '.')) || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    result: null,
  });
  writeAll(list);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const list = readAll();
  const before = list.signals.length;
  list.signals = list.signals.filter((x) => x.id !== req.params.id);
  if (list.signals.length === before) return res.status(404).json({ error: 'Сигнал не найден' });
  writeAll(list);
  res.json({ ok: true });
});

export default router;
