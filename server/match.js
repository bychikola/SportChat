/* Live Prediction Engine (PLAN-LIVE L2/L3): вероятности матча в моменте.
 * GET /api/match/:id/live → {live, model, history, scenarios, odds, value}
 * Poisson на остаток времени: λ_остаток = λ90 × (1 − T), T = elapsed/90.
 * История вероятностей копится в data/live-history/{id}.json для графика. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { loadApiKey } from './sstats.js';
import { fmtStart } from './live.js';

const router = express.Router();
const BASE = 'https://api.sstats.net';
const HIST_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'live-history');
const CACHE_TTL = 15_000;

const cache = new Map(); // id -> {at, payload}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sget(path, params, apiKey) {
  for (let i = 0; i < 2; i++) {
    try {
      const q = new URLSearchParams({ ...params, apikey: apiKey });
      const r = await fetch(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === 1) throw e;
      await sleep(700);
    }
  }
}

const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Итоговые вероятности при текущем счёте и λ на остаток времени. */
function liveProbs(hNow, aNow, lRemH, lRemA) {
  let p1 = 0, px = 0, p2 = 0, under25 = 0, total = 0;
  for (let h = 0; h <= 7; h++) {
    for (let a = 0; a <= 7; a++) {
      const p = pois(h, lRemH) * pois(a, lRemA);
      total += p;
      const fh = hNow + h, fa = aNow + a;
      if (fh > fa) p1 += p;
      else if (fh === fa) px += p;
      else p2 += p;
      if (fh + fa <= 2) under25 += p;
    }
  }
  const s = total || 1;
  return { p1: p1 / s, px: px / s, p2: p2 / s, tb25: 1 - under25 / s, tm25: under25 / s };
}

/** λ90 из формы (xG-микс, как в feed.js). */
function expectedGoals(stats) {
  if (!stats?.home || !stats?.away) return null;
  const mix = (xg, goals, rivalConc) => ((xg ?? goals) + goals + rivalConc) / 3;
  return {
    lh: clamp(mix(stats.home.avgOddsXg, stats.home.avgScore, stats.away.avgConceded), 0.2, 4.2),
    la: clamp(mix(stats.away.avgOddsXg, stats.away.avgScore, stats.home.avgConceded), 0.2, 4.2),
  };
}

/** L3: сценарии «что должно произойти» — честная аналитика из Poisson-остатка. */
function scenarios(minute, hNow, aNow, lRemH, lRemA, probs) {
  const out = [];
  const nowTotal = hNow + aNow;
  const lRemTotal = lRemH + lRemA;
  if (nowTotal > 2.5) {
    out.push('🎯 Тотал больше 2.5 — рассчитан досрочно: текущий счёт уже даёт 3+ гола.');
    return out;
  }
  const pAnyGoal = 1 - Math.exp(-lRemTotal);
  const needTB = Math.max(0, Math.ceil(2.5 - nowTotal)); // сколько голов нужно
  if (needTB === 1) {
    out.push(`🎯 Условия для ТБ 2.5: нужен 1 гол за оставшееся время. P(гол будет) ≈ ${Math.round(pAnyGoal * 100)}%.`);
  } else {
    out.push(`🎯 Условия для ТБ 2.5: нужно ещё ${needTB} гола, P ≈ ${Math.round(probs.tb25 * 100)}%.`);
  }
  // «если счёт не изменится к 60-й» — только λ после 60-й минуты
  if (minute < 60 && nowTotal <= 2) {
    const lAfter60 = (lRemH + lRemA) * ((90 - 60) / Math.max(1, 90 - minute));
    const needAfter60 = Math.max(0, Math.ceil(2.5 - nowTotal));
    const tail = needAfter60 === 1 ? 1 - Math.exp(-lAfter60) : poisSum(lAfter60, needAfter60);
    out.push(`📉 Если к 60-й минуте счёт останется ${hNow}:${aNow}, вероятность ТБ 2.5 снижается до ~${Math.round(tail * 100)}%.`);
  }
  return out;
}

function poisSum(l, need) {
  // P(X >= need) для Poisson(l)
  if (need <= 0) return 1;
  let acc = 0;
  for (let k = 0; k < need; k++) acc += pois(k, l);
  return Math.max(0, 1 - acc);
}

/** История вероятностей для графика. */
function histPath(id) { return path.join(HIST_DIR, `${id}.json`); }
function readHist(id) {
  try { return JSON.parse(fs.readFileSync(histPath(id), 'utf8')); } catch { return []; }
}
function appendHist(id, point) {
  fs.mkdirSync(HIST_DIR, { recursive: true });
  const arr = readHist(id);
  const last = arr[arr.length - 1];
  if (!last || last.m !== point.m) {
    arr.push(point);
    fs.writeFileSync(histPath(id), JSON.stringify(arr.slice(-120)), 'utf8');
  }
  return arr;
}

async function buildLive(id, apiKey) {
  const game = await sget(`/Games/${id}`, {}, apiKey);
  const g = game?.data?.game ?? game?.data ?? game;
  if (!g) throw new Error('Матч не найден в SStats');
  const status = Number(g.status || 0);
  const minute = Number(g.elapsed || 0) + Number(g.extraMinutes || 0);
  const hNow = Number(g.homeResult ?? 0), aNow = Number(g.awayResult ?? 0);
  const isLive = status >= 3 && status <= 7;

  // форма → λ90
  let lh90 = null, la90 = null, hasForm = false;
  try {
    const pv = await sget('/Games/last-games-stats', { gameId: id, limit: 10, homeAway: 'true' }, apiKey);
    const eg = expectedGoals(pv?.data ?? pv);
    if (eg) { lh90 = eg.lh; la90 = eg.la; hasForm = true; }
  } catch { /* без формы — деградация */ }
  if (lh90 == null) { lh90 = 1.3; la90 = 1.1; } // консервативный дефолт

  // давление по ударам (если статистика матча пришла)
  const st = g.statistics || null;
  let boostH = 1, boostA = 1;
  if (st) {
    const sh = Number(st.shots ?? st.shotsHome ?? 0);
    const sa = Number(st.shotsOpp ?? st.shotsAway ?? 0);
    const tot = sh + sa;
    if (tot >= 6) { boostH = clamp((sh / tot) / 0.5, 0.6, 1.5); boostA = clamp((sa / tot) / 0.5, 0.6, 1.5); }
  }

  const T = clamp(minute / 90, 0, 0.97);
  const lRemH = clamp(lh90 * (1 - T) * (isLive ? boostH : 1), 0.02, 3.5);
  const lRemA = clamp(la90 * (1 - T) * (isLive ? boostA : 1), 0.02, 3.5);
  const probs = isLive
    ? liveProbs(hNow, aNow, lRemH, lRemA)
    : (() => { // ещё не начался — предматчевые вероятности на 90 минут
      let p1 = 0, px = 0, p2 = 0, under = 0, both = 0, tot = 0;
      for (let h = 0; h <= 9; h++) for (let a = 0; a <= 9; a++) {
        const p = pois(h, lh90) * pois(a, la90);
        tot += p;
        if (h > a) p1 += p; else if (h === a) px += p; else p2 += p;
        if (h + a <= 2) under += p;
        if (h > 0 && a > 0) both += p;
      }
      const s = tot || 1;
      return { p1: p1 / s, px: px / s, p2: p2 / s, tb25: 1 - under / s, tm25: under / s, bttsYes: both / s, bttsNo: 1 - both / s };
    })();

  // live-кэфы из Games/{id} → live-value
  const odds = { h: null, x: null, a: null, over25: null, under25: null };
  for (const m of Array.isArray(g.odds) ? g.odds : []) {
    for (const o of m.odds || []) {
      const n = o.name || '';
      if (m.marketId === 1) { if (n === 'Home') odds.h = o.value; if (n === 'Draw') odds.x = o.value; if (n === 'Away') odds.a = o.value; }
      if (m.marketId === 5) { if (/over/i.test(n)) odds.over25 = o.value; if (/under/i.test(n)) odds.under25 = o.value; }
    }
  }
  const value = [];
  const pushV = (market, name, prob, odd) => {
    if (!odd || !Number.isFinite(prob)) return;
    value.push({ market, name, p: prob, odds: odd, value: prob * odd - 1 });
  };
  pushV('1', 'Исход 1', probs.p1, odds.h);
  pushV('X', 'Ничья', probs.px, odds.x);
  pushV('2', 'Исход 2', probs.p2, odds.a);
  pushV('tb25', 'Тотал больше 2.5', probs.tb25, odds.over25);
  pushV('tm25', 'Тотал меньше 2.5', probs.tm25, odds.under25);
  value.sort((a, b) => b.value - a.value);

  // история + сценарии
  const point = { m: minute, p1: +probs.p1.toFixed(3), px: +probs.px.toFixed(3), p2: +probs.p2.toFixed(3), tb25: +probs.tb25.toFixed(3) };
  const history = appendHist(id, point);
  const scen = isLive ? scenarios(minute, hNow, aNow, lRemH, lRemA, probs) : [];

  return {
    status: 'OK',
    match: {
      id: g.id,
      home: g.homeTeam?.name || '', away: g.awayTeam?.name || '',
      league: g.season?.league?.name || '',
      start: fmtStart(g.date),
      stage: g.statusName || '', status,
      score: `${hNow}:${aNow}`,
      minute,
    },
    live: isLive,
    model: {
      p1: Math.round(probs.p1 * 100), px: Math.round(probs.px * 100), p2: Math.round(probs.p2 * 100),
      tb25: Math.round(probs.tb25 * 100), tm25: Math.round(probs.tm25 * 100),
      lambda: { remH: +lRemH.toFixed(2), remA: +lRemA.toFixed(2) },
      hasForm,
    },
    confidence: Math.round(clamp(40 + (hasForm ? 25 : 0) + (isLive ? 15 : 5) + (odds.h ? 10 : 0), 40, 92)),
    odds,
    value: value.filter((v) => v.odds >= 1.15).slice(0, 4).map((v) => ({
      market: v.market, name: v.name, p: Math.round(v.p * 100), odds: v.odds, value: Math.round(v.value * 100),
    })),
    scenarios: scen,
    history: history.slice(-40),
    pressure: st ? { shots: `${st.shots ?? '?'}:${st.shotsOpp ?? '?'}`, source: 'матч-статистика' } : null,
  };
}

router.get('/:id/live', async (req, res) => {
  const apiKey = loadApiKey();
  if (!apiKey) return res.status(501).json({ error: 'Ключ SStats не настроен' });
  const id = String(req.params.id || '').replace(/[^\d]/g, '');
  if (!id) return res.status(400).json({ error: 'Нужен числовой id матча' });
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL) return res.json(hit.payload);
  try {
    const payload = await buildLive(id, apiKey);
    cache.set(id, { at: Date.now(), payload });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e).slice(0, 200) });
  }
});

/** Краткий список live-матчей для блока «🔴 Live сейчас» в ленте. */
router.get('/now/list', async (req, res) => {
  const apiKey = loadApiKey();
  if (!apiKey) return res.status(501).json({ error: 'Ключ SStats не настроен' });
  try {
    const j = await sget('/Games/list', { Live: 'true', Limit: 1000, Order: '1' }, apiKey);
    const games = (j.data || []).map((g) => ({
      id: g.id,
      minute: Number(g.elapsed || 0) + Number(g.extraMinutes || 0),
      stage: g.statusName || '',
      score: `${g.homeResult}:${g.awayResult}`,
      home: g.homeTeam?.name || '', away: g.awayTeam?.name || '',
      league: g.season?.league?.name || '',
      odds1: (g.odds || []).find((m) => m.marketId === 1)?.odds?.find((o) => o.name === 'Home')?.value ?? null,
      odds2: (g.odds || []).find((m) => m.marketId === 1)?.odds?.find((o) => o.name === 'Away')?.value ?? null,
    }));
    res.json({ status: 'OK', count: games.length, games });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e).slice(0, 160) });
  }
});

export default router;
