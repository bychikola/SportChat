/* Общий live-слой для купонов и сигналов (PLAN-COUPONS К1):
 * один батч-запрос Live-матчей sstats с кэшем 15 секунд.
 * К4: шина обновлений купонов — index.js рассылает по WS. */
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
dns.setDefaultResultOrder('ipv4first');

const BASE = 'https://api.sstats.net';
const cache = { at: 0, map: new Map() };

export const couponBus = new EventEmitter();
let lastHash = '';

/** Пуш только при реальном изменении статусов/счётов (дифф по хэшу). */
export function publishIfChanged(payload) {
  const hash = JSON.stringify((payload.predictions || []).map((p) => [
    p.id, p.status, (p.legs || []).map((l) => [l.status, l.score, l.live?.score || null, l.live?.minute || null, l.presumed || null]),
  ]));
  if (hash === lastHash) return false;
  lastHash = hash;
  couponBus.emit('update', payload);
  return true;
}

export async function fetchLiveMap(apiKey) {
  if (Date.now() - cache.at < 15_000) return cache.map;
  const r = await fetch(`${BASE}/Games/list?Live=true&Limit=1000&apikey=${apiKey}`, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json();
  const map = new Map();
  for (const g of Array.isArray(j.data) ? j.data : []) map.set(String(g.id), g);
  cache.at = Date.now();
  cache.map = map;
  return map;
}

/** Математически досрочный исход по текущему счёту (как «рассчитано» в БК). */
export function presumedFor(key, g) {
  const h = Number(g.homeResult), a = Number(g.awayResult);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  const k = String(key).toLowerCase();
  const mTot = /^(tb|tm)(\d+(?:\.\d+)?)$/.exec(k);
  if (mTot) {
    const line = mTot[2].includes('.') ? parseFloat(mTot[2]) : parseFloat(mTot[2]) / 10;
    const total = h + a;
    if (mTot[1] === 'tb') return total > line ? 'won' : null; // голы не отнимаются
    return total > line ? 'lost' : null;
  }
  if (k === 'btts_yes') return (h > 0 && a > 0) ? 'won' : null;
  if (k === 'btts_no') return (h > 0 && a > 0) ? 'lost' : null;
  return null; // исходы — только по финальному свистку
}

export function liveStage(g) {
  const m = Number(g.elapsed || 0);
  const extra = Number(g.extraMinutes || 0);
  return { score: `${g.homeResult}:${g.awayResult}`, minute: m + extra, stage: g.statusName || 'Live' };
}

/** «13:30 · 1 окт» — время начала матча в МСК (для купонов). */
export function fmtStart(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })} · ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).replace('.', '')}`;
}
