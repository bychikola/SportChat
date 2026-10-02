/* «Мои прогнозы» (PLAN-REDESIGN Фаза 9.3): принятые экспрессы/прогнозы
 * с автотрекингом итогов ног. Хранилище data/predictions.json (вне git);
 * при настроенном Supabase — зеркалируется в таблицы coupons/coupon_legs (К5).
 * Статус экспресса: одна нога lost → lost; все won → won; иначе pending. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiKey } from './sstats.js';
import { outcomeFor } from './signals.js';
import { fetchLiveMap, presumedFor, liveStage, fmtStart, publishIfChanged } from './live.js';
import { authUser } from './auth.js';
import { db, isConfigured } from './db.js';

const router = express.Router();
const BASE = 'https://api.sstats.net';
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'predictions.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { version: 1, seqNext: 1, predictions: [] }; }
}
function writeAll(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

/* ── Live-движок (PLAN-COUPONS К1): счёт/минута + досрочный расчёт ── */

/** Обогащение pending-купов live-слоем + досрочные статусы. */
async function enrichLive(list, apiKey) {
  const pending = list.predictions.filter((p) => p.status === 'pending' || p.status === 'live');
  if (!pending.length) return;
  let liveMap;
  try { liveMap = await fetchLiveMap(apiKey); } catch { return; }
  let changed = false;
  for (const p of pending) {
    for (const leg of p.legs || []) {
      const g = liveMap.get(String(leg.gameId));
      if (g) {
        leg.status = 'live';
        leg.live = liveStage(g);
        if (!leg.start) leg.start = fmtStart(g.date); // время начала (К-время)
        const presumed = presumedFor(leg.key, g);
        if (presumed) leg.presumed = presumed;
        changed = true;
      } else if (leg.status === 'live') {
        // матч ушёл из лайва (закончился или пауза) — финал посчитает outcomeFor ниже
        leg.live = null;
        changed = true;
      }
    }
    const legStatuses = (p.legs || []).map((l) => l.status);
    if (legStatuses.includes('lost')) p.status = 'lost';
    else if (legStatuses.length && legStatuses.every((s) => s === 'won')) p.status = 'won';
    else if (legStatuses.length && legStatuses.every((s) => s !== 'pending')) p.status = 'void';
    else if (legStatuses.includes('live')) p.status = 'live';
  }
  if (changed) writeAll(list);
}

/** Проверка завершённых матчей (финальный расчёт, как раньше). */
async function autoCheck(list, liveMap) {
  const apiKey = loadApiKey();
  if (!apiKey) return;
  const now = Date.now();
  const pending = list.predictions.filter((p) => p.status === 'pending' || p.status === 'live');
  const legIds = new Set();
  for (const p of pending) {
    for (const leg of p.legs || []) {
      if (leg.status === 'pending' || leg.status === 'live') legIds.add(String(leg.gameId));
    }
  }
  let checked = 0;
  console.error(`[coupons] autoCheck: legs=${legIds.size} liveMap=${liveMap ? liveMap.size : 'null'}`);
  for (const gid of legIds) {
    if (checked >= 10) break;
    const liveG = liveMap?.get(String(gid));
    if (liveG) continue; // идёт — финал не нужен
    checked++;
    let game = null;
    try {
      const r = await fetch(`${BASE}/Games/${gid}?apikey=${apiKey}`, { signal: AbortSignal.timeout(12_000) });
      const j = await r.json();
      // Games/{id} отдаёт {status:'OK', data:{game:{…}}}; статус 8-10 = завершён
      game = j?.data?.game ?? j?.data ?? j;
    } catch { /* сетевой сбой — попробуем в следующий раз */ }
    console.error(`[coupons] ${gid}: status=${game?.status} (${game?.statusName}) ${game?.homeResult}:${game?.awayResult}`);
    if (!game || !(Number(game.status) >= 8 || /finished|ended/i.test(String(game.statusName)))) continue;
    for (const p of list.predictions) {
      for (const leg of p.legs || []) {
        if (String(leg.gameId) !== String(gid) || (leg.status !== 'pending' && leg.status !== 'live')) continue;
        const res = outcomeFor(leg.key, game);
        if (res) { leg.status = res; leg.score = `${game.homeResult}:${game.awayResult}`; leg.live = null; }
        if (!leg.start) leg.start = fmtStart(game.date);
      }
    }
  }
}

/** Дозаполнение времени начала у ожидающих ног: батчи Upcoming на 3 дня (кэш 10 мин). */
const startCache = new Map(); // date -> {at, map}
async function backfillStarts(list, apiKey) {
  const need = [];
  for (const p of list.predictions) {
    for (const leg of p.legs || []) if (!leg.start && leg.status === 'pending') need.push(leg);
  }
  if (!need.length) return;
  const byId = new Map();
  for (let off = 0; off <= 2; off++) {
    const date = new Date(Date.now() + off * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
    let hit = startCache.get(date);
    if (!hit || Date.now() - hit.at > 10 * 60_000) {
      try {
        const j = await (await fetch(`${BASE}/Games/list?Upcoming=true&Date=${date}&Limit=1000&Order=1&apikey=${apiKey}`, { signal: AbortSignal.timeout(15_000) })).json();
        const map = new Map((j.data || []).map((g) => [String(g.id), fmtStart(g.date)]));
        hit = { at: Date.now(), map };
        startCache.set(date, hit);
      } catch { continue; }
    }
    for (const [id, s] of hit.map) byId.set(id, s);
  }
  let changed = false;
  for (const leg of need) {
    const s = byId.get(String(leg.gameId));
    if (s) { leg.start = s; changed = true; }
  }
  return changed;
}

/** Общий тик: live + финал + статусы купонов (вызывается по таймеру и на GET). */
async function tick() {
  const list = readAll();
  const apiKey = loadApiKey();
  if (!apiKey) return;
  let liveMap = null;
  try { liveMap = await fetchLiveMap(apiKey); } catch { /* старые данные останутся */ }
  if (liveMap) await enrichLive(list, apiKey);
  await autoCheck(list, liveMap);
  await backfillStarts(list, apiKey);
  for (const p of list.predictions) {
    if (p.status === 'won' || p.status === 'lost') continue;
    const s = (p.legs || []).map((l) => l.status);
    if (s.includes('lost')) p.status = 'lost';
    else if (s.length && s.every((x) => x === 'won')) p.status = 'won';
    else if (s.length && s.every((x) => x !== 'pending' && x !== 'live')) p.status = 'void';
    else if (s.includes('live')) p.status = 'live';
    else p.status = 'pending';
  }
  await persist(list);
  // К4: пуш клиентам только при реальном изменении
  publishIfChanged({ predictions: [...list.predictions].reverse() });
}

/* ── К5: Supabase-зеркало купонов (coupons + coupon_legs) ── */
const useDb = isConfigured();

async function persist(list) {
  writeAll(list); // JSON — рабочий кэш и фолбэк
  if (!useDb) return;
  try {
    const rows = list.predictions.map((p) => ({
      id: p.id,
      user_id: p.userId || null,
      type: (p.legs || []).length > 1 ? 'express' : 'prediction',
      amount: p.amount ?? null,
      odds: p.odds ?? null,
      fair: p.fair ?? null,
      ev: p.ev ?? null,
      probability: p.probability ?? null,
      risk: p.risk || null,
      source: p.source || null,
      status: p.status || 'pending',
      created_at: p.createdAt || new Date().toISOString(),
    }));
    const legs = list.predictions.flatMap((p) => (p.legs || []).map((l) => ({
      coupon_id: p.id,
      game_id: String(l.gameId || ''),
      match: l.match || null,
      market: l.market || null,
      key: l.key || null,
      pick: l.pick || null,
      odds: l.odds ?? 1,
      start: l.start || null,
      status: l.status || 'pending',
      score: l.score || null,
      live_score: l.live?.score || null,
      live_minute: l.live?.minute ?? null,
      presumed: l.presumed || null,
    })));
    await db().from('coupons').upsert(rows);
    await db().from('coupon_legs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (legs.length) await db().from('coupon_legs').insert(legs);
    // удаляем купоны, исчезнувшие из JSON
    const { data: existing } = await db().from('coupons').select('id');
    const gone = (existing || []).map((x) => x.id).filter((id) => !rows.some((r) => r.id === id));
    if (gone.length) await db().from('coupons').delete().in('id', gone);
  } catch (e) {
    console.error('[coupons] supabase sync:', e?.message || e);
  }
}

/* ── сериализация мутаций: тикер/POST/DELETE не перетирают друг друга ── */
let storeChain = Promise.resolve();
function withStore(fn) {
  const p = storeChain.then(fn, fn);
  storeChain = p.catch(() => {});
  return p;
}

router.get('/', async (req, res) => {
  try { await withStore(tick); } catch { /* тикер не критичен для ответа */ }
  const list = readAll();
  res.json({ ok: true, predictions: [...list.predictions].reverse() });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const legs = Array.isArray(b.legs) ? b.legs : [];
  if (legs.length < 2) return res.status(400).json({ error: 'Экспресс — минимум 2 ноги' });
  // К5: user_id — серверно из Bearer-токена, клиентскому полю не верим
  let authedId = null;
  try { authedId = (await authUser(req))?.id || null; } catch { /* аноним */ }
  const clean = legs.slice(0, 12).map((l) => ({
    gameId: String(l.gameId || '').replace(/[^\d]/g, ''),
    match: String(l.match || '').slice(0, 160),
    market: String(l.market || '').slice(0, 60),
    key: String(l.key || '').trim().toLowerCase().slice(0, 12),
    pick: String(l.pick || '').slice(0, 200),
    odds: Number(String(l.odds ?? '').replace(',', '.')) || 1,
    start: String(l.start || '').slice(0, 40) || null,
    status: 'pending',
  }));
  if (clean.some((l) => !l.gameId || !l.key)) {
    return res.status(400).json({ error: 'Каждая нога требует gameId и key рынка' });
  }
  let newId = null;
  await withStore(async () => {
    const list = readAll();
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const id = `EXP-${day}-${String(list.seqNext || 1).padStart(3, '0')}`;
    list.seqNext = (list.seqNext || 1) + 1;
    newId = id;
    list.predictions.push({
      id,
      userId: authedId,                                          // из токена (К5)
      amount: Number(String(b.amount ?? '').replace(',', '.')) || null, // сумма ставки
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
    await persist(list);
  });
  res.json({ ok: true, id: newId });
});

router.delete('/:id', async (req, res) => {
  let ok = false;
  await withStore(async () => {
    const list = readAll();
    const before = list.predictions.length;
    list.predictions = list.predictions.filter((p) => p.id !== req.params.id);
    ok = list.predictions.length !== before;
    if (ok) await persist(list);
  });
  if (!ok) return res.status(404).json({ error: 'Прогноз не найден' });
  res.json({ ok: true });
});

// тикер в общей очереди: каждые 20 сек
let lastTick = 0;
setInterval(() => {
  if (Date.now() - lastTick < 18_000) return;
  lastTick = Date.now();
  withStore(tick).catch((e) => console.error('[coupons] tick:', e?.message || e));
}, 20_000);

export default router;
