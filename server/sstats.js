/* Прокси к SStats.net API для страницы «События».
 * Ключ не покидает сервер: браузер ходит на /api/sstats/*, сервер добавляет
 * apikey и кэширует ответы, чтобы не упереться в лимиты API.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = express.Router();

const SSTATS_BASE = 'https://api.sstats.net';
const CACHE_TTL_MS = 60_000;

function loadApiKey() {
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

router.get('/upcoming', async (req, res) => {
  const apiKey = loadApiKey();
  if (!apiKey) {
    return res.status(501).json({ error: 'Ключ SStats не настроен: положи data/sstats-key.json {"apikey":"…"} или задай SSTATS_API_KEY' });
  }

  const date = String(req.query.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : null;
  // лимит на одну страницу API — максимум 1000 матчей
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 1000, 1), 1000);
  const tz = Math.min(Math.max(parseInt(req.query.tz, 10) || 0, -12), 12);
  const refresh = req.query.refresh === '1';
  const MAX_GAMES = 2000; // на насыщенный день (суббота) может быть >1000 — тянем вторую страницу

  const buildUrl = (offset) => {
    const u = new URL('/Games/list', SSTATS_BASE);
    u.searchParams.set('Upcoming', 'true');
    u.searchParams.set('Order', '1');
    u.searchParams.set('Limit', String(limit));
    u.searchParams.set('TimeZone', String(tz));
    if (date) u.searchParams.set('Date', date);
    u.searchParams.set('Offset', String(offset));
    u.searchParams.set('apikey', apiKey);
    return u;
  };

  try {
    let all = [];
    for (let offset = 0; offset < MAX_GAMES; offset += limit) {
      const url = buildUrl(offset);
      const cacheKey = url.toString();
      const hit = cache.get(cacheKey);
      let page;
      if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) {
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
      if (rows.length < limit) break; // страница неполная — выборка исчерпана
    }

    // дедупликация по id (страницы могут нахлёстываться при обновлениях данных)
    const seen = new Set();
    const data = all.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
    res.json({ status: 'OK', count: data.length, data });
  } catch (e) {
    res.status(502).json({ error: scrub(e.message) });
  }
});

export default router;
