/**
 * SStats.net Football API — MCP-сервер для Claude Code / SportChat.
 *
 * Документация: sstats_mcp/v1.yaml (OpenAPI 3.1). Сервер: https://api.sstats.net
 * Авторизация: ?apikey=<ключ> в query-строке.
 *
 * Ключ читается из data/sstats-key.json (вне git) или env SSTATS_API_KEY.
 *
 * Запуск: node sstats_mcp/server.mjs
 * Регистрация: workspace/.mcp.json → { "type": "stdio", "command": "node",
 *   "args": ["../sstats_mcp/server.mjs"] }
 */
import dns from 'node:dns';
// api.sstats.net отдаёт IPv6 (AAAA), IPv6-маршрутизация у пользователей часто
// сломана → «fetch failed». v4 работает — резолвим v4 первым.
dns.setDefaultResultOrder('ipv4first');
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.sstats.net';
const MAX_BODY = 400_000;         // обрезка гигантских ответов (GameFull)
const MIN_GAP_MS = 120;           // мягкий троттлинг (лимиты API: 30/мин/IP без ключа)
const CACHE_TTL_MS = 10 * 60_000; // справочники (лиги, букмекеры) — 10 минут

/* ── ключ ── */
function loadApiKey() {
  if (process.env.SSTATS_API_KEY) return process.env.SSTATS_API_KEY.trim();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(here, '..', 'data', 'sstats-key.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.apikey) return String(j.apikey).trim();
  } catch { /* нет файла */ }
  return null;
}
const API_KEY = loadApiKey();
if (!API_KEY) {
  console.error('[sstats] ВАЖНО: API-ключ не найден. Положи его в data/sstats-key.json {"apikey":"…"} или задай env SSTATS_API_KEY');
}

/* ── кэш и троттлинг ── */
const cache = new Map();
const throttle = { last: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Маскируем ключ, где бы он ни встретился: в JSON-ответах, ошибках, URL. */
const SCRUB_KEY = /("apiKey"\s*:\s*")[^"]+(")/g;
const SCRUB_QUERY = /([?&]apikey=)[^&\s"]+/g;
function scrub(s) {
  return String(s ?? '')
    .replace(SCRUB_KEY, '$1***$2')
    .replace(SCRUB_QUERY, '$1***');
}

async function apiGet(p, params = {}, { cacheKey = null, ttl = 0 } = {}) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return hit.data;
  }
  const wait = MIN_GAP_MS - (Date.now() - throttle.last);
  if (wait > 0) await sleep(wait);
  throttle.last = Date.now();

  // SStats принимает ключ ТОЛЬКО в query-строке (OpenAPI: apiKey in query).
  // Сам URL нигде не логируется, а в ошибки ключ не попадает (scrub ниже).
  const q = new URLSearchParams({ ...params, apikey: API_KEY });
  const url = `${BASE}${p}?${q}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(`Сеть: не удалось обратиться к SStats (${scrub(e.message)})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || j.status || '';
    } catch { /* тело не JSON */ }
    throw new Error(`SStats HTTP ${res.status}${detail ? `: ${scrub(detail)}` : ''}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SStats: не-JSON ответ (${scrub(text.slice(0, 120))})`);
  }
  if (cacheKey && ttl > 0) cache.set(cacheKey, { expires: Date.now() + ttl, data });
  return data;
}

/** Ответы обёрнуты в ApiResponse {status, count, data}; часть эндпоинтов отдаёт сырой массив. */
function unwrap(raw) {
  if (raw && typeof raw === 'object' && 'data' in raw && 'status' in raw) {
    return { meta: { status: raw.status, count: raw.count }, data: raw.data };
  }
  return { meta: null, data: raw };
}

function pack(raw) {
  const { meta, data } = unwrap(raw);
  let json;
  try {
    json = JSON.stringify(data ?? null);
  } catch {
    json = String(data).slice(0, MAX_BODY);
  }
  if (json.length > MAX_BODY) json = `${json.slice(0, MAX_BODY)}\n…(обрезано, было ${json.length} симв.)`;
  // ВАЖНО: /Account/Info возвращает сам apiKey — маскируем, чтобы ключ
  // не попадал в контекст модели и в чат
  json = scrub(json);
  const head = meta ? `status=${meta.status} count=${meta.count}\n` : '';
  return { content: [{ type: 'text', text: head + json }] };
}

const errMsg = (e) => ({ content: [{ type: 'text', text: `❌ ${scrub(e.message)}` }], isError: true });

/* ── сервер ── */
const server = new McpServer({ name: 'sstats-football', version: '1.0.0' });

/* 1. Поиск матчей — главный инструмент */
server.registerTool(
  'sstats_search_matches',
  {
    description: `Поиск футбольных матчей в SStats.net. Фильтры: leagueId, date (YYYY-MM-DD), from/to (интервал),
team (id команды), bothTeams (id двух команд через запятую — матчи между ними, H2H), status (2 — не начался,
3-7 — идёт, 8-10 — завершён), upcoming/live/ended (булево), today. Возвращает сокращённые данные матчей
(id, время, статус, счёт, команды, сезон, тур, кэфы 1X2/Total). Максимум 1000 матчей за запрос (limit, offset).`,
    inputSchema: z.object({
      leagueId: z.number().int().optional().describe('Id лиги (см. sstats_leagues)'),
      date: z.string().optional().describe('Дата: YYYY-MM-DD — все матчи за день'),
      from: z.string().optional().describe('Начало интервала: YYYY-MM-DD'),
      to: z.string().optional().describe('Конец интервала: YYYY-MM-DD (строго до этой даты)'),
      team: z.number().int().optional().describe('Id команды — все матчи команды'),
      bothTeams: z.string().optional().describe('Id двух команд через запятую: "529,541" — только их очные матчи'),
      status: z.number().int().optional().describe('Статус матча: 2 — не начался, 3-7 — идёт, 8-10 — завершён'),
      upcoming: z.boolean().optional().describe('Только предстоящие матчи'),
      live: z.boolean().optional().describe('Только live-матчи'),
      ended: z.boolean().optional().describe('Только завершённые матчи'),
      today: z.boolean().optional().describe('Матчи за сегодня'),
      limit: z.number().int().min(1).max(1000).optional().describe('Лимит (по умолчанию 50)'),
      offset: z.number().int().min(0).optional(),
    }),
  },
  async (args) => {
    try {
      const p = {};
      for (const [k, v] of Object.entries(args)) if (v !== undefined) p[k === 'leagueId' ? 'LeagueId' : k] = v;
      if (!p.Limit) p.Limit = 50;
      return pack(await apiGet('/Games/list', p));
    } catch (e) { return errMsg(e); }
  },
);

/* 2. Полные данные матча */
server.registerTool(
  'sstats_get_match',
  {
    description: `Полные данные матча SStats: статистика (удары, владение, угловые…), стартовые составы и схемы,
игроки с позициями, индивидуальная статистика, события (голы, карточки, замены), стадион, судья,
доматчевые кэфы закрытия. id = числовой SStats ID или строковый Flashscore ID.`,
    inputSchema: z.object({
      id: z.union([z.number().int(), z.string()]).describe('SStats ID (число) или Flashscore ID (строка)'),
    }),
  },
  async ({ id }) => {
    try { return pack(await apiGet(`/Games/${id}`)); } catch (e) { return errMsg(e); }
  },
);

/* 3. Предматчевая статистика команд — для анализа формы */
server.registerTool(
  'sstats_match_preview_stats',
  {
    description: `Предматчевая статистика команд для конкретного матча (форма): рассчитывается по последним N матчам
каждой команды — забитые/пропущенные, победы/ничьи/поражения, тоталы, xG и т.п. Параметры: gameId — id матча,
limit — сколько последних матчей учитывать (5-100), sameLeague / sameSeason — только матчи той же лиги/сезона,
homeAway — для хозяев только домашние, для гостей только выездные.`,
    inputSchema: z.object({
      gameId: z.number().int().describe('Id матча, для которого считается статистика'),
      limit: z.number().int().min(5).max(100).optional().describe('Последних матчей для расчёта (по умолчанию 10)'),
      sameLeague: z.boolean().optional(),
      sameSeason: z.boolean().optional(),
      homeAway: z.boolean().optional(),
    }),
  },
  async (args) => {
    try { return pack(await apiGet('/Games/last-games-stats', args)); } catch (e) { return errMsg(e); }
  },
);

/* 4. Турнирная таблица сезона */
server.registerTool(
  'sstats_season_standings',
  {
    description: 'Турнирная таблица сезона лиги: место, очки, игры, В/Н/П, разница мячей. uid — id сезона (из sstats_leagues).',
    inputSchema: z.object({
      uid: z.string().describe('UUID сезона (SeasonUid), напр. B1D3B841-5716-11F0-9829-3CECEF730A49'),
    }),
  },
  async ({ uid }) => {
    try { return pack(await apiGet('/Seasons/standings', { uid })); } catch (e) { return errMsg(e); }
  },
);

/* 5. Рейтинговая таблица лиги */
server.registerTool(
  'sstats_league_table',
  {
    description: 'Рейтинговая таблица лиги за сезон (по параметрам лиги/сезона/команды).',
    inputSchema: z.object({
      leagueId: z.number().int().optional(),
      seasonUid: z.string().optional(),
      year: z.number().int().optional(),
      teamId: z.number().int().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    }),
  },
  async (args) => {
    try { return pack(await apiGet('/Games/season-table', args)); } catch (e) { return errMsg(e); }
  },
);

/* 6. Текстовая сводка матча */
server.registerTool(
  'sstats_match_text_summary',
  {
    description: 'Текстовая сводка матча: краткое описание хода игры, ключевые события (голы, карточки) в текстовом виде.',
    inputSchema: z.object({
      gameId: z.number().int().describe('Id матча'),
    }),
  },
  async ({ gameId }) => {
    try { return pack(await apiGet('/Games/text-summary', { gameId })); } catch (e) { return errMsg(e); }
  },
);

/* 7. Травмы и пропуски */
server.registerTool(
  'sstats_injuries',
  {
    description: 'Игроки, пропускающие матч (травмы, дисквалификации) для конкретного матча.',
    inputSchema: z.object({
      gameId: z.number().int().describe('Id матча'),
    }),
  },
  async ({ gameId }) => {
    try { return pack(await apiGet('/Games/injuries', { gameId })); } catch (e) { return errMsg(e); }
  },
);

/* 8. Доматчевые коэффициенты */
server.registerTool(
  'sstats_odds',
  {
    description: `Доматчевые коэффициенты матча: 1X2, тоталы, форы и другие рынки по букмекерам.
bookmakerId — id букмекера (один или несколько через запятую, из sstats_bookmakers), opening=true — коэффициенты открытия.`,
    inputSchema: z.object({
      gameId: z.number().int().describe('Id матча'),
      bookmakerId: z.string().optional().describe('Id букмекера(ов) через запятую'),
      opening: z.boolean().optional().describe('Коэффициенты открытия (вместо текущих)'),
    }),
  },
  async (args) => {
    try { return pack(await apiGet(`/Odds/${args.gameId}`, args)); } catch (e) { return errMsg(e); }
  },
);

/* 9. Live-коэффициенты */
server.registerTool(
  'sstats_live_odds',
  {
    description: 'Live-коэффициенты матча (в реальном времени).',
    inputSchema: z.object({
      gameId: z.number().int().describe('Id матча'),
    }),
  },
  async ({ gameId }) => {
    try { return pack(await apiGet(`/Odds/live/${gameId}`)); } catch (e) { return errMsg(e); }
  },
);

/* 10. Справочник букмекеров */
server.registerTool(
  'sstats_bookmakers',
  {
    description: 'Справочник букмекеров SStats и их идентификаторов (для sstats_odds). Кэшируется на 10 минут.',
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Odds/bookmakers', {}, { cacheKey: 'bookmakers', ttl: CACHE_TTL_MS })); } catch (e) { return errMsg(e); }
  },
);

/* 11. Справочник лиг и сезонов */
server.registerTool(
  'sstats_leagues',
  {
    description: 'Список всех лиг и их сезонов: id лиги (LeagueId), названия, страны, сезоны с SeasonUid. Кэшируется на 10 минут.',
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Leagues', {}, { cacheKey: 'leagues', ttl: CACHE_TTL_MS })); } catch (e) { return errMsg(e); }
  },
);

/* 12. Команды */
server.registerTool(
  'sstats_teams',
  {
    description: 'Поиск команд SStats: по имени (name) или полные данные команды по id (состав, статистика, история).',
    inputSchema: z.object({
      name: z.string().optional().describe('Поиск по названию команды'),
      id: z.number().int().optional().describe('Полные данные команды по id'),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().optional(),
    }),
  },
  async ({ name, id, limit, offset }) => {
    try {
      if (id !== undefined) return pack(await apiGet(`/Teams/${id}`));
      return pack(await apiGet('/Teams/list', { name, limit, offset }));
    } catch (e) { return errMsg(e); }
  },
);

/* 13. Игроки */
server.registerTool(
  'sstats_players',
  {
    description: 'Поиск игрока по имени (name) или полные данные по id: текущая команда, история трансферов, статистика.',
    inputSchema: z.object({
      name: z.string().optional().describe('Поиск по имени игрока'),
      id: z.number().int().optional().describe('Данные игрока по id'),
      teamId: z.number().int().optional().describe('Список игроков команды'),
    }),
  },
  async ({ name, id, teamId }) => {
    try {
      if (id !== undefined) return pack(await apiGet(`/Players/${id}`));
      if (teamId !== undefined) return pack(await apiGet('/Players/list', { teamId }));
      if (name !== undefined) return pack(await apiGet('/Players/find', { name }));
      return errMsg(new Error('Укажи name, id или teamId'));
    } catch (e) { return errMsg(e); }
  },
);

/* 14. Аккаунт — проверка ключа */
server.registerTool(
  'sstats_account',
  {
    description: 'Информация об аккаунте SStats (проверка API-ключа).',
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Account/Info')); } catch (e) { return errMsg(e); }
  },
);

/* ═══════════ БУКМЕКЕР PARI (pari.ru) — линия, лайв, история кэфов ═══════════
   Отдельный источник: свои id (eventId) — НЕ путать с id матчей SStats.
   Коэффициенты удобнее и полнее, чем в sstats_matches, есть история движения. */

/* 15. Pari: страны */
server.registerTool(
  'pari_countries',
  {
    description: 'Букмекер Pari: список стран с id (для pari_leagues и pari_matches). Кэшируется.',
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Pari/countries', {}, { cacheKey: 'pari:countries', ttl: CACHE_TTL_MS })); }
    catch (e) { return errMsg(e); }
  },
);

/* 16. Pari: лиги */
server.registerTool(
  'pari_leagues',
  {
    description: 'Букмекер Pari: список лиг (как на pari.ru). countryId=0 — международные. Пагинация: totalCount/limit.',
    inputSchema: z.object({
      countryId: z.number().int().optional().describe('Id страны (0 — международные)'),
      offset: z.number().int().min(0).optional().describe('Смещение (пагинация)'),
      limit: z.number().int().min(1).max(1000).optional().describe('Лимит (по умолчанию 1000)'),
    }),
  },
  async (args) => {
    try {
      const p = { limit: 1000 };
      for (const [k, v] of Object.entries(args)) if (v !== undefined) p[k] = v;
      return pack(await apiGet('/Pari/leagues', p, { cacheKey: `pari:leagues:${JSON.stringify(p)}`, ttl: CACHE_TTL_MS }));
    } catch (e) { return errMsg(e); }
  },
);

/* 17. Pari: лига по id */
server.registerTool(
  'pari_league',
  {
    description: 'Букмекер Pari: данные конкретной лиги по id.',
    inputSchema: z.object({ id: z.number().int().describe('Id лиги (pari_leagues или сайт pari.ru)') }),
  },
  async ({ id }) => {
    try { return pack(await apiGet(`/Pari/league/${id}`)); } catch (e) { return errMsg(e); }
  },
);

/* 18. Pari: матчи */
server.registerTool(
  'pari_matches',
  {
    description: `Букмекер Pari: список матчей с коэффициентами. Обязателен хотя бы один фильтр
(date/dateFrom/dateTo/live/upcoming/leagueId/countryId/teamId). date имеет приоритет над dateFrom/dateTo;
live+upcoming можно комбинировать. Возвращает totalCount — продолжай пагинацию offset+=limit, пока offset < totalCount
(максимум limit=1000, но при includeOdds=true максимум 200). Коэффициенты в лёгком формате {id, value} —
названия исходов расшифровываются через pari_market_types. timezone — UTC-offset в часах (3 = Москва, по умолчанию 3).`,
    inputSchema: z.object({
      countryId: z.number().int().optional().describe('Id страны (pari_countries)'),
      leagueId: z.number().int().optional().describe('Id лиги (pari_leagues)'),
      date: z.string().optional().describe('Конкретный день YYYY-MM-DD (фильтр по дню UTC, timezone сдвигает границы)'),
      dateFrom: z.string().optional().describe('Начало диапазона YYYY-MM-DD включительно'),
      dateTo: z.string().optional().describe('Конец диапазона YYYY-MM-DD включительно'),
      teamId: z.number().int().optional().describe('Id команды (pari_teams)'),
      live: z.boolean().optional().describe('Только лайв (статус Live и WillStartSoon)'),
      upcoming: z.boolean().optional().describe('Только предстоящие (статус NotStarted)'),
      sortDesc: z.boolean().optional().describe('true — по убыванию времени старта, false — по возрастанию'),
      includeOdds: z.boolean().optional().describe('Включить актуальные коэффициенты {id, value} (limit ≤ 200)'),
      showDeleted: z.boolean().optional().describe('Показывать матчи, снятые с линии до начала'),
      timezone: z.number().int().min(-12).max(12).optional().describe('UTC offset в часах (3 = Москва)'),
      offset: z.number().int().min(0).optional().describe('Смещение (пагинация)'),
      limit: z.number().int().min(1).max(1000).optional().describe('Лимит (по умолчанию 100; max 200 при includeOdds)'),
    }),
  },
  async (args) => {
    try {
      const p = {};
      for (const [k, v] of Object.entries(args)) if (v !== undefined) p[k] = v;
      if (!Object.keys(p).length) return errMsg(new Error('Укажи хотя бы один фильтр: date, live, upcoming, leagueId…'));
      return pack(await apiGet('/Pari/matches', p));
    } catch (e) { return errMsg(e); }
  },
);

/* 19. Pari: матч по eventId */
server.registerTool(
  'pari_match',
  {
    description: `Букмекер Pari: самые актуальные данные матча (обновление раз в 3 сек).
Матч не начался → currentOdds = доматчевые кэфы; идёт → currentOdds = лайв, prematchOdds = последние доматчевые;
завершён → currentOdds пустое, prematchOdds содержит последние доматчевые. eventId ≠ id матчей SStats!`,
    inputSchema: z.object({ eventId: z.number().int().describe('Id события на pari.ru (из pari_matches)') }),
  },
  async ({ eventId }) => {
    try { return pack(await apiGet(`/Pari/match/${eventId}`)); } catch (e) { return errMsg(e); }
  },
);

/* 20. Pari: история коэффициентов */
server.registerTool(
  'pari_odds_history',
  {
    description: `Букмекер Pari: история изменения коэффициентов матча (доматчевые и лайв) — движение линии.
IsBlocked — кэф заблокирован; IsSuspended — заблокирована вся линия (VAR, пенальти, пересчёт); значение 0 — кэф снят с линии.
Расшифровка outcomeId — через pari_market_types (для каждого периода id свои!).`,
    inputSchema: z.object({
      eventId: z.number().int().describe('Id события на pari.ru (из pari_matches)'),
      oddsType: z.enum(['live', 'prematch']).optional().describe('Тип коэффициентов (по умолчанию оба/все)'),
    }),
  },
  async ({ eventId, oddsType }) => {
    try {
      const p = oddsType ? { oddsType } : {};
      return pack(await apiGet(`/Pari/odds/history/${eventId}`, p));
    } catch (e) { return errMsg(e); }
  },
);

/* 21. Pari: игровые события и статистика матча */
server.registerTool(
  'pari_events',
  {
    description: `Букмекер Pari: игровые события матча (голы, карточки, замены…) и накопленная статистика
из потока pari.ru. Обновление раз в 10 сек. Типы событий — справочник pari_event_types.`,
    inputSchema: z.object({ matchId: z.number().int().describe('Id матча на pari.ru (из pari_matches)') }),
  },
  async ({ matchId }) => {
    try { return pack(await apiGet(`/Pari/events/${matchId}`)); } catch (e) { return errMsg(e); }
  },
);

/* 22. Pari: команды */
server.registerTool(
  'pari_teams',
  {
    description: 'Букмекер Pari: список команд. Укажи id конкретной команды или countryId для списка по стране.',
    inputSchema: z.object({
      id: z.number().int().optional().describe('Id конкретной команды'),
      countryId: z.number().int().optional().describe('Список команд страны'),
    }),
  },
  async (args) => {
    try {
      const p = {};
      for (const [k, v] of Object.entries(args)) if (v !== undefined) p[k] = v;
      if (!Object.keys(p).length) return errMsg(new Error('Укажи id или countryId'));
      return pack(await apiGet('/Pari/teams', p));
    } catch (e) { return errMsg(e); }
  },
);

/* 23. Pari: справочник маркетов и исходов */
server.registerTool(
  'pari_market_types',
  {
    description: `Букмекер Pari: полный справочник маркетов и исходов — расшифровка outcomeId из коэффициентов
и истории. Для каждого периода (1-й тайм, 2-й тайм) outcomeId свои. Кэшируется надолго.`,
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Pari/odds/market-types', {}, { cacheKey: 'pari:market-types', ttl: 60 * 60_000 })); }
    catch (e) { return errMsg(e); }
  },
);

/* 24. Pari: справочник типов игровых событий */
server.registerTool(
  'pari_event_types',
  {
    description: 'Букмекер Pari: справочник типов игровых событий (для pari_events). Кэшируется надолго.',
    inputSchema: z.object({}),
  },
  async () => {
    try { return pack(await apiGet('/Pari/events/types', {}, { cacheKey: 'pari:event-types', ttl: 60 * 60_000 })); }
    catch (e) { return errMsg(e); }
  },
);

process.on('uncaughtException', (e) => console.error('[sstats] uncaught:', e?.stack || e));
process.on('unhandledRejection', (e) => console.error('[sstats] unhandled:', e?.stack || e));

await server.connect(new StdioServerTransport());
console.error('[sstats] MCP-сервер SStats запущен' + (API_KEY ? '' : ' (БЕЗ КЛЮЧА)'));
