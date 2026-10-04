/* Лента прогнозов (PLAN-REDESIGN Фаза 3): sstats upcoming + форма команд
 * → Poisson-модель → P1/X/P2, ТБ 2.5 → fair odds → value → confidence.
 * Классификация: Bankers / Express-кандидаты / AI-анализ.
 * Кэш ленты 60с, кэш формы 10 мин; запросы к API — через очередь с ретраями. */
import express from 'express';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import { loadApiKey } from './sstats.js';

const router = express.Router();
const BASE = 'https://api.sstats.net';

const FEED_TTL = 60_000;
const PREVIEW_TTL = 10 * 60_000;
const CANDIDATES = 26; // сколько матчей углубляем формой (лимит нагрузки на API)

const feedCache = new Map();    // date -> { at, payload }
const previewCache = new Map(); // gameId -> { at, data }

function scrub(s) {
  return String(s ?? '').replace(/([?&]apikey=)[^&\s"']+/g, '$1***');
}

/* ── очередь запросов к API: gap + ретраи (как в MCP) ── */
let chain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|HTTP 429|HTTP 5\d\d/i;

async function sget(path, params, apiKey) {
  const attempt = async () => {
    const q = new URLSearchParams({ ...params, apikey: apiKey });
    const r = await fetch(`${BASE}${path}?${q}`, { signal: AbortSignal.timeout(15_000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${scrub(t).slice(0, 120)}`);
    return JSON.parse(t);
  };
  const run = async () => {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        return await attempt();
      } catch (e) {
        lastErr = e;
        if (i < 2 && RETRYABLE.test(String(e?.message))) await sleep(350 * 2 ** i);
        else break;
      }
    }
    throw lastErr;
  };
  const queued = chain.then(async () => {
    const gap = 70 - (Date.now() - last);
    if (gap > 0) await sleep(gap);
    last = Date.now();
    return run();
  }, run);
  chain = queued.catch(() => {});
  return queued;
}
let last = 0;

/* ── Poisson ── */
const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

function marketProbs(lh, la) {
  let p1 = 0, px = 0, p2 = 0, under = 0, both = 0, total = 0;
  for (let h = 0; h <= 9; h++) {
    for (let a = 0; a <= 9; a++) {
      const p = pois(h, lh) * pois(a, la);
      total += p;
      if (h > a) p1 += p;
      else if (h === a) px += p;
      else p2 += p;
      if (h + a <= 2) under += p;
      if (h > 0 && a > 0) both += p;
    }
  }
  const s = total || 1;
  return { p1: p1 / s, px: px / s, p2: p2 / s, tb25: 1 - under / s, tm25: under / s, bttsYes: both / s, bttsNo: 1 - both / s };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Форма команды → λ голов: xG смешивается с фактическими голами (L1: xG-модель). */
function expectedGoals(homeStats, awayStats) {
  const mix = (ownXg, ownGoals, rivalConceded) =>
    ((ownXg ?? ownGoals) + ownGoals + rivalConceded) / 3;
  const lh = clamp(mix(homeStats.avgOddsXg, homeStats.avgScore, awayStats.avgConceded), 0.2, 4.2);
  const la = clamp(mix(awayStats.avgOddsXg, awayStats.avgScore, homeStats.avgConceded), 0.2, 4.2);
  const xg = Number.isFinite(homeStats.avgOddsXg) && Number.isFinite(awayStats.avgOddsXg);
  return { lh, la, xg };
}

/** Кэфы 1X2, DC, ТБ/ТМ 2.5, ОЗ из сокращённых данных Games/list (L1). */
function extractOdds(game) {
  const out = {
    h: null, x: null, a: null, over25: null, under25: null,
    dc1x: null, dc12: null, dcx2: null, bttsYes: null, bttsNo: null,
  };
  for (const m of Array.isArray(game.odds) ? game.odds : []) {
    for (const o of m.odds || []) {
      const n = o.name || '';
      const v = o.value;
      if (m.marketId === 1) {
        if (n === 'Home') out.h = v;
        if (n === 'Draw') out.x = v;
        if (n === 'Away') out.a = v;
      } else if (m.marketId === 12) {
        if (n === 'Home/Draw') out.dc1x = v;
        if (n === 'Home/Away') out.dc12 = v;
        if (n === 'Draw/Away') out.dcx2 = v;
      } else if (m.marketId === 5) {
        if (/over/i.test(n)) out.over25 = v;
        if (/under/i.test(n)) out.under25 = v;
      } else if (m.marketId === 8) {
        if (/yes/i.test(n)) out.bttsYes = v;
        if (/no/i.test(n)) out.bttsNo = v;
      }
    }
  }
  return out;
}

const LEAGUE_PRIORITY = /nations league|premier league|la liga|laliga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|afcon|world cup|world cup qual|qualifiers|mls|brasileir|liga profesional|j1 league|j-league|k league|saudi|eredivisie|liga mx|primeira liga|championship|super lig|superliga|leagues cup|asian cup|u21|u23|women/i;

/** Приоритет кандидата: топ-лиги и осмысленные кэфы важнее экзотики. */
function candidateScore(g, odds) {
  const league = g.season?.league?.name || '';
  let s = LEAGUE_PRIORITY.test(league) ? 10 : 0;
  const mid = [odds.h, odds.a].filter((v) => v >= 1.25 && v <= 3.4).length;
  s += mid * 2;
  if (odds.over25 || odds.under25) s += 1;
  return s;
}

async function buildFeed(date, apiKey) {
  // 1. предстоящие матчи дня
  const list = await sget('/Games/list', { Upcoming: 'true', Date: date, Limit: 1000, Order: '1', TimeZone: 3 }, apiKey);
  const games = Array.isArray(list.data) ? list.data : [];

  // 2. кандидаты с кэфами
  const withOdds = games
    .map((g) => ({ g, odds: extractOdds(g) }))
    .filter((x) => x.odds.h && x.odds.a && x.odds.x);
  withOdds.sort((a, b) => candidateScore(b.g, b.odds) - candidateScore(a.g, a.odds));
  const candidates = withOdds.slice(0, CANDIDATES);

  // 3. форма команд → рынки (пул по 4, кэш 10 мин)
  const enriched = [];
  let idx = 0;
  async function worker() {
    while (idx < candidates.length) {
      const cur = candidates[idx++];
      const gid = cur.g.id;
      let stats = previewCache.get(gid);
      if (!stats || Date.now() - stats.at > PREVIEW_TTL) {
        try {
          const j = await sget('/Games/last-games-stats', { gameId: gid, limit: 10, homeAway: 'true' }, apiKey);
          // last-games-stats отдаёт {home, away} без обёртки ApiResponse
          const d = j?.data ?? j;
          stats = { at: Date.now(), data: d && (d.home || d.away) ? d : null };
        } catch (e) {
          if (previewCache.size < 3) console.error(`[feed] preview ${gid} FAIL:`, scrub(e.message).slice(0, 160));
          stats = { at: Date.now(), data: null };
        }
        previewCache.set(gid, stats);
        if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
      }
      enriched.push({ ...cur, stats: stats.data });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);

  // 4. Poisson → рынки → value → confidence (L1: честный confidence от полноты данных)
  const matches = [];
  const legsPool = [];
  for (const { g, odds, stats } of enriched) {
    if (!stats?.home || !stats?.away) continue;
    const { lh, la, xg } = expectedGoals(stats.home, stats.away);
    const p = marketProbs(lh, la);
    const start = new Date(g.date);
    const time = start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const dayLabel = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });

    // L1: confidence = полнота данных (форма/xG/линия) + запас на value; без иллюзии точности
    const hasForm = Number.isFinite(stats.home.avgScore) && Number.isFinite(stats.away.avgScore);
    const hasOdds = !!(odds.h && odds.a);
    const conf = Math.round(clamp(
      40 + (hasForm ? 20 : 0) + (xg ? 15 : 0) + (hasOdds ? 10 : 0),
      40, 92,
    ));

    const mk = (key, nameRu, prob, odd) => {
      if (!odd || !Number.isFinite(prob)) return null;
      const value = prob * odd - 1;
      return { market: key, name: nameRu, p: prob, odds: odd, fair: +(1 / prob).toFixed(2), value, conf };
    };
    const variants = [
      mk('1', 'Исход 1', p.p1, odds.h),
      mk('X', 'Ничья', p.px, odds.x),
      mk('2', 'Исход 2', p.p2, odds.a),
      mk('tb25', 'Тотал больше 2.5', p.tb25, odds.over25),
      mk('tm25', 'Тотал меньше 2.5', p.tm25, odds.under25),
      mk('btts_yes', 'Обе забьют — да', p.bttsYes, odds.bttsYes),
      mk('btts_no', 'Обе забьют — нет', p.bttsNo, odds.bttsNo),
      mk('1x', 'Двойной шанс 1X', p.p1 + p.px, odds.dc1x),
      mk('12', 'Двойной шанс 12', p.p1 + p.p2, odds.dc12),
      mk('x2', 'Двойной шанс X2', p.px + p.p2, odds.dcx2),
    ].filter(Boolean).filter((v) => v.odds >= 1.15 && v.p >= 0.18);

    if (!variants.length) continue;
    variants.sort((a, b) => b.value - a.value);
    const best = variants[0];
    // Banker — редкий знак качества, а не каждая вторая нога
    const tag = best.value >= 0.05 && best.conf >= 75 && best.odds <= 2.6 ? 'banker' : 'ai';

    const match = {
      id: g.id,
      time,
      day: dayLabel,
      home: g.homeTeam?.name || '',
      away: g.awayTeam?.name || '',
      league: g.season?.league?.name || '',
      country: g.season?.league?.country?.name || '',
      p1: Math.round(p.p1 * 100),
      px: Math.round(p.px * 100),
      p2: Math.round(p.p2 * 100),
      market: best.name,
      marketKey: best.market,
      odds: best.odds,
      fair: best.fair,
      value: Math.round(best.value * 100),
      confidence: best.conf,
      tag,
    };
    matches.push(match);
    for (const v of variants.slice(0, 3)) {
      if (v.value > 0.02) legsPool.push({ match: `${match.home} — ${match.away}`, gameId: match.id, market: v.name, key: v.market, start: `${match.time} · ${match.day}`, p: v.p, odds: v.odds, value: v.value });
    }
  }

  matches.sort((a, b) => (a.time < b.time ? -1 : 1));
  console.error(`[feed] ${date}: games=${games.length} withOdds=${withOdds.length} candidates=${candidates.length} enriched=${enriched.length} matches=${matches.length}`);

  // 5. экспресс дня: жадный набор топ-ног по value, по одной на матч, итог ≤ 8
  console.error(`[feed] legsPool=${legsPool.length} legs-ready=${matches.length}`);
  legsPool.sort((a, b) => b.value - a.value);
  const used = new Set();
  const legs = [];
  let oddsAcc = 1, pAcc = 1;
  for (const leg of legsPool) {
    if (legs.length >= 3) break;
    if (used.has(leg.gameId)) continue;
    const nextOdds = oddsAcc * leg.odds;
    if (leg.odds > 4.5 || nextOdds > 8 || leg.p < 0.25) continue; // монстры-кэфы блокируют набор
    used.add(leg.gameId);
    legs.push(leg);
    oddsAcc = nextOdds;
    pAcc = pAcc * leg.p;
  }
  console.error(`[feed] legs собрано=${legs.length} oddsAcc=${oddsAcc.toFixed(2)}`);
  const express = legs.length >= 2 ? {    legs,
    odds: +oddsAcc.toFixed(2),
    fair: +(1 / pAcc).toFixed(2),
    ev: Math.round((pAcc * oddsAcc - 1) * 100),
    probability: Math.round(pAcc * 100),
    risk: (() => {
      const weakest = [...legs].sort((a, b) => a.p - b.p)[0];
      return `Самая слабая нога — ${weakest.match} (${weakest.market}, P ${Math.round(weakest.p * 100)}%). Проверь стартовые составы перед матчем.`;
    })(),
  } : null;

  // 6. hero-агрегаты
  const bankers = matches.filter((m) => m.tag === 'banker').length;
  const topConf = [...matches].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  const confidence = topConf.length ? Math.round(topConf.reduce((a, m) => a + m.confidence, 0) / topConf.length) : 0;

  return {
    status: 'OK',
    date,
    generatedAt: new Date().toISOString(),
    total: games.length,
    hero: { bankers, expressOdds: express?.odds ?? 0, expressEv: express?.ev ?? 0, confidence },
    express,
    matches,
  };
}

const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);

router.get('/', async (req, res) => {
  const apiKey = loadApiKey();
  if (!apiKey) return res.status(501).json({ error: 'Ключ SStats не настроен' });
  const date = validDate(req.query.date) || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  const hit = feedCache.get(date);
  if (hit && Date.now() - hit.at < FEED_TTL) return res.json(hit.payload);
  try {
    const payload = await buildFeed(date, apiKey);
    feedCache.set(date, { at: Date.now(), payload });
    if (feedCache.size > 20) feedCache.delete(feedCache.keys().next().value);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: scrub(e.message) });
  }
});

export default router;
