/* Прокси к SStats.net API для страницы «События».
 * Ключ не покидает сервер: браузер ходит на /api/sstats/*, сервер добавляет
 * apikey и кэширует ответы, чтобы не упереться в лимиты API.
 * Эндпоинты: /upcoming (на дату), /live (идущие), /finished (на дату). */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();

const SSTATS_BASE = 'https://api.sstats.net';
const PAGE = 1000; // лимит одной страницы API

export function loadApiKey() {
  if (process.env.SSTATS_API_KEY) return process.env.SSTATS_API_KEY.trim();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const j = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'sstats-key.json'), 'utf8'));
    if (j.apikey) return String(j.apikey).trim();
  } catch { /* нет файла */ }
  return null;
}

/** Ключ не должен попасть ни в логи, ни в текст ошибки. */
function scrub(s) {
  return String(s ?? '').replace(/([?&]apikey=)[^&\s"']+/g, '$1***');
}

const cache = new Map(); // url -> { at, payload }

/** Пагинированная выборка Games/list с постраничным кэшем и дедупликацией. */
async function fetchGames(filters, { tz, refresh, maxGames, ttlMs, apiKey }) {
  const buildUrl = (offset) => {
    const u = new URL('/Games/list', SSTATS_BASE);
    for (const [k, v] of Object.entries(filters)) u.searchParams.set(k, v);
    u.searchParams.set('Order', '1');
    u.searchParams.set('Limit', String(PAGE));
    u.searchParams.set('TimeZone', String(tz));
    u.searchParams.set('Offset', String(offset));
    u.searchParams.set('apikey', apiKey);
    return u;
  };

  let all = [];
  for (let offset = 0; offset < maxGames; offset += PAGE) {
    const url = buildUrl(offset);
    const cacheKey = url.toString();
    const hit = cache.get(cacheKey);
    let page;
    if (!refresh && hit && Date.now() - hit.at < ttlMs) {
      page = hit.payload;
    } else {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const text = await r.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`SStats вернул не-JSON (HTTP ${r.status}): ${scrub(text).slice(0, 160)}`);
      }
      if (!r.ok) {
        const msg = payload?.message || payload?.errors?.join('; ') || `HTTP ${r.status}`;
        throw new Error(scrub(msg));
      }
      page = payload;
      cache.set(cacheKey, { at: Date.now(), payload: page });
      if (cache.size > 60) cache.delete(cache.keys().next().value);
    }
    const rows = Array.isArray(page.data) ? page.data : [];
    all = all.concat(rows);
    if (rows.length < PAGE) break; // страница неполная — выборка исчерпана
  }

  // дедупликация по id (страницы могут нахлёстываться при обновлениях данных)
  const seen = new Set();
  return all.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

/** Общий обработчик: фильтры → выборка → ответ в формате ApiResponse. */
function listRoute(filters, { maxGames = 2000, ttlMs = 60_000 }) {
  return async (req, res) => {
    const apiKey = loadApiKey();
    if (!apiKey) {
      return res.status(501).json({ error: 'Ключ SStats не настроен: положи data/sstats-key.json {"apikey":"…"} или задай SSTATS_API_KEY' });
    }
    const tz = Math.min(Math.max(parseInt(req.query.tz, 10) || 3, -12), 12);
    const refresh = req.query.refresh === '1';
    try {
      const data = await fetchGames(filters, { tz, refresh, maxGames, ttlMs, apiKey });
      res.json({ status: 'OK', count: data.length, data });
    } catch (e) {
      res.status(502).json({ error: scrub(e.message) });
    }
  };
}

const validDate = (req) => (String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : null);

// предстоящие матчи выбранного дня
router.get('/upcoming', (req, res) => {
  const date = validDate(req);
  listRoute({ Upcoming: 'true', ...(date ? { Date: date } : {}) }, { maxGames: 2000 })(req, res);
});

// идущие сейчас матчи (дата не важна — «сейчас»)
router.get('/live', listRoute({ Live: 'true' }, { maxGames: 500 }));

// завершённые матчи выбранного дня (обновляются раз в 15 минут)
router.get('/finished', (req, res) => {
  const date = validDate(req);
  listRoute({ Ended: 'true', ...(date ? { Date: date } : {}) }, { maxGames: 2000, ttlMs: 300_000 })(req, res);
});

export default router;
