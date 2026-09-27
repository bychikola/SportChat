/* Страница «События»: карточки предстоящих матчей с sstats.net
 * и кнопки отправки матча в чат (в чат / быстрый анализ / полный разбор). */

import { $, esc, toast } from './util.js';
import { api } from './api.js';

const TZ = Math.round(-new Date().getTimezoneOffset() / 60);

/* ── русификация: страны, лиги, туры (только отображение, ключи не трогаем) ── */
const COUNTRY_RU = {
  England: 'Англия', Spain: 'Испания', Italy: 'Италия', Germany: 'Германия', France: 'Франция',
  Netherlands: 'Нидерланды', Portugal: 'Португалия', Turkey: 'Турция', Belgium: 'Бельгия',
  Scotland: 'Шотландия', Wales: 'Уэльс', Ireland: 'Ирландия', Austria: 'Австрия',
  Switzerland: 'Швейцария', Denmark: 'Дания', Sweden: 'Швеция', Norway: 'Норвегия',
  Finland: 'Финляндия', Iceland: 'Исландия', Greece: 'Греция', Croatia: 'Хорватия',
  Serbia: 'Сербия', Poland: 'Польша', Romania: 'Румыния', Bulgaria: 'Болгария',
  Hungary: 'Венгрия', 'Czech Republic': 'Чехия', Slovakia: 'Словакия', Slovenia: 'Словения',
  Ukraine: 'Украина', Russia: 'Россия', Belarus: 'Беларусь', Kazakhstan: 'Казахстан',
  Georgia: 'Грузия', Armenia: 'Армения', Azerbaijan: 'Азербайджан', Israel: 'Израиль',
  Cyprus: 'Кипр', Malta: 'Мальта', 'Bosnia and Herzegovina': 'Босния и Герцеговина',
  'North Macedonia': 'Северная Македония', Albania: 'Албания', Moldova: 'Молдова',
  'Saudi Arabia': 'Саудовская Аравия', Japan: 'Япония', 'South Korea': 'Южная Корея',
  China: 'Китай', Australia: 'Австралия', India: 'Индия', Indonesia: 'Индонезия',
  Thailand: 'Таиланд', Vietnam: 'Вьетнам', Malaysia: 'Малайзия', Singapore: 'Сингапур',
  'United Arab Emirates': 'ОАЭ', Qatar: 'Катар', Iran: 'Иран', Iraq: 'Ирак',
  Egypt: 'Египет', Morocco: 'Марокко',
  Algeria: 'Алжир', Tunisia: 'Тунис', Nigeria: 'Нигерия', Ghana: 'Гана',
  'South Africa': 'ЮАР', Kenya: 'Кения', Cameroon: 'Камерун', Senegal: 'Сенегал',
  'Ivory Coast': 'Кот-д’Ивуар', USA: 'США', Canada: 'Канада', Mexico: 'Мексика',
  Brazil: 'Бразилия', Argentina: 'Аргентина', Chile: 'Чили', Peru: 'Перу',
  Colombia: 'Колумбия', Paraguay: 'Парагвай', Uruguay: 'Уругвай', Venezuela: 'Венесуэла',
  Bolivia: 'Боливия', Ecuador: 'Эквадор', Jamaica: 'Ямайка', 'Costa Rica': 'Коста-Рика',
  Guatemala: 'Гватемала', Honduras: 'Гондурас', 'El Salvador': 'Сальвадор',
  Panama: 'Панама', Haiti: 'Гаити', Cuba: 'Куба', 'Dominican Republic': 'Доминикана',
  'Trinidad and Tobago': 'Тринидад и Тобаго', World: 'Мир', International: 'Международные',
};

function countryRu(name) {
  return COUNTRY_RU[name] || name || '';
}

/* ── русские названия команд АПЛ / Ла Лиги / Бундеслиги ── */
const TEAM_RU = [
  // АПЛ
  ['Арсенал', 'Arsenal', 'Arsenal FC'],
  ['Астон Вилла', 'Aston Villa'],
  ['Борнмут', 'Bournemouth', 'AFC Bournemouth', 'AFC Bournemouth*'],
  ['Брентфорд', 'Brentford', 'Brentford FC'],
  ['Брайтон', 'Brighton', 'Brighton & Hove Albion', 'Brighton and Hove Albion'],
  ['Бернли', 'Burnley'],
  ['Челси', 'Chelsea'],
  ['Кристал Пэлас', 'Crystal Palace'],
  ['Эвертон', 'Everton'],
  ['Фулхэм', 'Fulham'],
  ['Лидс', 'Leeds', 'Leeds United'],
  ['Ливерпуль', 'Liverpool'],
  ['Манчестер Сити', 'Manchester City', 'Man City'],
  ['Манчестер Юнайтед', 'Manchester United', 'Man United', 'Man Utd'],
  ['Ньюкасл Юнайтед', 'Newcastle United', 'Newcastle'],
  ['Ноттингем Форест', 'Nottingham Forest'],
  ['Сандерленд', 'Sunderland'],
  ['Тоттенхэм Хотспур', 'Tottenham Hotspur', 'Tottenham'],
  ['Вест Хэм Юнайтед', 'West Ham United', 'West Ham'],
  ['Вулверхэмптон Уондерерс', 'Wolverhampton Wanderers', 'Wolves', 'Wolverhampton'],
  // Ла Лига
  ['Реал Мадрид', 'Real Madrid'],
  ['Барселона', 'Barcelona', 'FC Barcelona'],
  ['Атлетико Мадрид', 'Atletico Madrid', 'Club Atletico de Madrid', 'Atletico de Madrid'],
  ['Атлетик Бильбао', 'Athletic Club', 'Athletic Bilbao'],
  ['Реал Сосьедад', 'Real Sociedad'],
  ['Реал Бетис', 'Real Betis', 'Real Betis Balompie'],
  ['Вильярреал', 'Villarreal'],
  ['Севилья', 'Sevilla', 'Sevilla FC'],
  ['Валенсия', 'Valencia', 'Valencia CF'],
  ['Хетафе', 'Getafe', 'Getafe CF'],
  ['Сельта', 'Celta Vigo', 'Real Celta Vigo', 'Celta'],
  ['Райо Вальекано', 'Rayo Vallecano'],
  ['Осасуна', 'Osasuna', 'CA Osasuna'],
  ['Мальорка', 'Mallorca', 'RCD Mallorca'],
  ['Жирона', 'Girona', 'Girona FC'],
  ['Алавес', 'Alaves', 'Deportivo Alaves'],
  ['Эспаньол', 'Espanyol', 'RCD Espanyol'],
  ['Эльче', 'Elche', 'Elche CF'],
  ['Леванте', 'Levante', 'Levante UD'],
  ['Реал Овьедо', 'Real Oviedo', 'Oviedo'],
  // Бундеслига
  ['Бавария', 'Bayern München', 'Bayern Munich', 'Bayern', 'FC Bayern München'],
  ['Боруссия Дортмунд', 'Borussia Dortmund', 'Dortmund'],
  ['Байер', 'Bayer Leverkusen', 'Bayer 04 Leverkusen'],
  ['РБ Лейпциг', 'RB Leipzig', 'Leipzig'],
  ['Айнтрахт Франкфурт', 'Eintracht Frankfurt', 'Frankfurt'],
  ['Штутгарт', 'VfB Stuttgart', 'Stuttgart'],
  ['Фрайбург', 'SC Freiburg', 'Freiburg'],
  ['Вердер', 'Werder Bremen', 'SV Werder Bremen'],
  ['Вольфсбург', 'VfL Wolfsburg', 'Wolfsburg'],
  ['Унион Берлин', 'Union Berlin', '1. FC Union Berlin'],
  ['Аугсбург', 'FC Augsburg', 'Augsburg'],
  ['Боруссия Мёнхенгладбах', 'Borussia Mönchengladbach', 'Borussia Monchengladbach', "Borussia M'gladbach"],
  ['Майнц 05', 'Mainz 05', 'FSV Mainz 05', '1. FSV Mainz 05'],
  ['Хоффенхайм', 'TSG Hoffenheim', 'Hoffenheim', '1899 Hoffenheim', 'TSG 1899 Hoffenheim'],
  ['Гамбург', 'Hamburger SV', 'Hamburg', 'HSV'],
  ['Кёльн', 'FC Koln', '1. FC Köln', 'FC Köln', 'Cologne'],
  ['Санкт-Паули', 'St. Pauli', 'FC St. Pauli'],
  ['Хайденхайм', 'Heidenheim', 'FC Heidenheim', '1. FC Heidenheim'],
  ['Эльверсберг', 'SV Elversberg', 'Elversberg'],
  ['Падерборн', 'SC Paderborn 07', 'Paderborn'],
  ['Шальке 04', 'FC Schalke 04', 'Schalke 04', 'Schalke'],
  ['Герта', 'Hertha BSC', 'Hertha Berlin'],
  // Серия А (Италия)
  ['Интер', 'Inter', 'Internazionale', 'FC Internazionale Milano', 'Inter Milan'],
  ['Ювентус', 'Juventus'],
  ['Милан', 'Milan', 'AC Milan'],
  ['Наполи', 'Napoli', 'SSC Napoli'],
  ['Рома', 'Roma', 'AS Roma'],
  ['Лацио', 'Lazio', 'SS Lazio'],
  ['Аталанта', 'Atalanta', 'Atalanta BC'],
  ['Фиорентина', 'Fiorentina', 'ACF Fiorentina'],
  ['Болонья', 'Bologna', 'Bologna FC'],
  ['Торино', 'Torino', 'Torino FC'],
  ['Удинезе', 'Udinese', 'Udinese Calcio'],
  ['Дженоа', 'Genoa', 'Genoa CFC'],
  ['Комо', 'Como', 'Como 1907'],
  ['Кальяри', 'Cagliari', 'Cagliari Calcio'],
  ['Верона', 'Verona', 'Hellas Verona'],
  ['Парма', 'Parma', 'Parma Calcio'],
  ['Лечче', 'Lecce'],
  ['Сассуоло', 'Sassuolo'],
  ['Пиза', 'Pisa', 'Pisa SC'],
  ['Кремонезе', 'Cremonese', 'US Cremonese'],
  // Лига 1 (Франция)
  ['ПСЖ', 'Paris Saint Germain', 'Paris Saint-Germain', 'PSG', 'Paris SG'],
  ['Марсель', 'Marseille', 'Olympique Marseille', 'Olympique de Marseille'],
  ['Монако', 'Monaco', 'AS Monaco'],
  ['Лилль', 'Lille', 'LOSC Lille'],
  ['Лион', 'Lyon', 'Olympique Lyonnais'],
  ['Ницца', 'Nice', 'OGC Nice'],
  ['Ланс', 'Lens', 'RC Lens'],
  ['Ренн', 'Rennes', 'Stade Rennais'],
  ['Страсбур', 'Strasbourg', 'RC Strasbourg'],
  ['Брест', 'Brest', 'Stade Brestois', 'Stade Brestois 29'],
  ['Тулуза', 'Toulouse', 'Toulouse FC'],
  ['Нант', 'Nantes', 'FC Nantes'],
  ['Осер', 'Auxerre', 'AJ Auxerre'],
  ['Гавр', 'Le Havre'],
  ['Анже', 'Angers', 'Angers SCO'],
  ['Мец', 'Metz', 'FC Metz'],
  ['Лорьян', 'Lorient', 'FC Lorient'],
  ['Пари ФК', 'Paris FC'],
];

// нормализация: нижний регистр, умлауты в латиницу, пунктуация в пробел
const normName = (s) => String(s).toLowerCase()
  .replace(/[äàáâã]/g, 'a').replace(/[öòóôõ]/g, 'o').replace(/[üùúû]/g, 'u')
  .replace(/ß/g, 'ss').replace(/[éèêë]/g, 'e').replace(/ñ/g, 'n').replace(/í/g, 'i')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const teamRuMap = new Map();
for (const [ru, ...names] of TEAM_RU) {
  for (const n of names) teamRuMap.set(normName(n), ru);
}

function teamRu(name) {
  if (!name) return name;
  return teamRuMap.get(normName(name)) || name;
}

/* Известные лиги → русские названия/аббревиатуры. Страна обязательна
 * для неоднозначных имён (английская Premier League ≠ ямайская). */
const LEAGUE_RU = [
  [/^premier league$/i, 'АПЛ', /^england$/i],
  [/^laliga$|^la liga$/i, 'Ла Лига', /^spain$/i],
  [/^segunda divisi[oó]n$/i, 'Сегунда', /^spain$/i],
  [/^serie a$/i, 'Серия А', /^italy$/i],
  [/^serie b$/i, 'Серия B', /^italy$/i],
  [/^bundesliga$/i, 'Бундеслига', /^germany$/i],
  [/^2\. bundesliga/i, 'Вторая Бундеслига', /^germany$/i],
  [/^3\. liga$/i, 'Третья Лига', /^germany$/i],
  [/^ligue 1$/i, 'Лига 1', /^france$/i],
  [/^ligue 2$/i, 'Лига 2', /^france$/i],
  [/champions league/i, 'Лига чемпионов'],
  [/europa league/i, 'Лига Европы'],
  [/conference league/i, 'Лига конференций'],
  [/uefa nations league/i, 'Лига наций УЕФА'],
  [/concacaf nations league/i, 'Лига наций КОНКАКАФ'],
  [/libertadores/i, 'Кубок Либертадорес'],
  [/sudamericana/i, 'Южноамериканский кубок'],
  [/^brasileir/i, 'Бразилейрау', /^brazil$/i],
  [/^serie a$/i, 'Серия A', /^brazil$/i],
  [/^serie b$/i, 'Серия B', /^brazil$/i],
  [/^copa do brasil/i, 'Кубок Бразилии', /^brazil$/i],
  [/^liga profesional/i, 'Профессиональная лига', /^argentina$/i],
  [/^copa de la liga/i, 'Кубок лиги', /^argentina$/i],
  [/^mls$|^major league soccer$/i, 'MLS', /^usa$/i],
  [/^liga mx$/i, 'Лига MX', /^mexico$/i],
  [/^eredivisie/i, 'Эредивизи'],
  [/^primeira liga/i, 'Премьер-лига Португалии', /^portugal$/i],
  [/^süper lig$|^super lig$/i, 'Суперлига', /^turkey$/i],
  [/^pro league/i, 'Про-лига', /^belgium$/i],
  [/^scottish premiership/i, 'Премьершип'],
  [/saudi pro league/i, 'Саудовская Про-лига'],
  [/^championship$/i, 'Чемпионшип', /^england$/i],
  [/^super league$/i, 'Суперлига', /^switzerland$/i],
  [/^friendlies$/i, 'Товарищеские матчи'],
  [/club friendly/i, 'Клубные товарищеские'],
];

function leagueRuName(L) {
  if (!L?.name) return '';
  for (const [re, ru, cRe] of LEAGUE_RU) {
    if (re.test(L.name) && (!cRe || cRe.test(L.country?.name || ''))) return ru;
  }
  return L.name;
}

function roundRu(v) {
  if (!v) return '';
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^regular season - (\d+)$/i))) return `Тур ${m[1]}`;
  if (/^regular season$/i.test(s)) return 'Регулярный сезон';
  if ((m = s.match(/^group stage - (\d+)$/i))) return `Групповой этап, тур ${m[1]}`;
  if (/^group stage$/i.test(s)) return 'Групповой этап';
  if ((m = s.match(/^group ([a-z]) - (\d+)$/i))) return `Группа ${m[1].toUpperCase()}, тур ${m[2]}`;
  if ((m = s.match(/^league ([a-z]) - (\d+)$/i))) return `Лига ${m[1].toUpperCase()}, тур ${m[2]}`;
  if ((m = s.match(/^round of (\d+)$/i))) return `1/${Math.round(+m[1] / 2)} финала`;
  if (/^quarter[- ]?finals?$/i.test(s)) return '1/4 финала';
  if (/^semi[- ]?finals?$/i.test(s)) return '1/2 финала';
  if (/^finals?$/i.test(s)) return 'Финал';
  if (/^3rd place/i.test(s)) return 'Матч за 3-е место';
  if ((m = s.match(/^promotion group - (\d+)$/i))) return `Группа за повышение, тур ${m[1]}`;
  if (/^promotion group$/i.test(s)) return 'Группа за повышение';
  if ((m = s.match(/^relegation group - (\d+)$/i))) return `Группа на вылет, тур ${m[1]}`;
  if (/^relegation group$/i.test(s)) return 'Группа на вылет';
  if ((m = s.match(/^championship (?:group|round) - (\d+)$/i))) return `Чемпионский раунд, тур ${m[1]}`;
  if (/^championship (?:group|round)$/i.test(s)) return 'Чемпионский раунд';
  if ((m = s.match(/^apertura - (\d+)$/i))) return `Апертура, тур ${m[1]}`;
  if (/^apertura$/i.test(s)) return 'Апертура';
  if ((m = s.match(/^clausura - (\d+)$/i))) return `Клаусура, тур ${m[1]}`;
  if (/^clausura$/i.test(s)) return 'Клаусура';
  if (/^qualifications?$/i.test(s)) return 'Квалификация';
  if ((m = s.match(/^qualification(?:s)? - (\d+)$/i))) return `Квалификация, тур ${m[1]}`;
  if (/^play-?offs?$/i.test(s)) return 'Плей-офф';
  if ((m = s.match(/^play-?offs? - (\d+)$/i))) return `Плей-офф, тур ${m[1]}`;
  if (/^friendly (international|club)/i.test(s)) return '';
  if ((m = s.match(/^cup - (\d+)$/i))) return `Кубок, тур ${m[1]}`;
  return s;
}

/* Топовые турниры: whitelist по имени лиги (флага важности в API нет).
 * Страна обязательна для неоднозначных названий — иначе Premier League
 * Ямайки равнялась бы с английской.
 * t:1 — элита (во главе списка), t:2 (по умолчанию) — просто топовые. */
const TOP_RULES = [
  { re: /^premier league$/i, country: /^england$/i, t: 1 },
  { re: /^laliga$|^la liga$/i, country: /^spain$/i, t: 1 },
  { re: /^segunda divisi[oó]n$/i, country: /^spain$/i },
  { re: /^serie a$/i, country: /^italy$/i, t: 1 },
  { re: /^bundesliga$/i, country: /^germany$/i, t: 1 },
  { re: /^ligue 1$/i, country: /^france$/i, t: 1 },
  { re: /champions league/i, t: 1 },
  { re: /europa league/i, t: 1 },
  { re: /libertadores/i, t: 1 },
  { re: /conference league/i },
  { re: /sudamericana/i },
  { re: /^brasileir/i, country: /^brazil$/i },
  { re: /^serie [ab]$/i, country: /^brazil$/i },
  { re: /^copa do brasil/i, country: /^brazil$/i },
  { re: /^liga profesional/i, country: /^argentina$/i },
  { re: /^copa de la liga/i, country: /^argentina$/i },
  { re: /^mls$|^major league soccer$/i, country: /^usa$/i },
  { re: /^liga mx$/i, country: /^mexico$/i },
  { re: /^eredivisie/i },
  { re: /^primeira liga/i, country: /^portugal$/i },
  { re: /süper lig|super lig/i, country: /^turkey$/i },
  { re: /^pro league/i, country: /^belgium$/i },
  { re: /^scottish premiership/i },
  { re: /saudi pro league/i },
  { re: /^championship$/i, country: /^england$/i },
  { re: /nations league/i },
  { re: /africa cup of nations/i },
  { re: /world cup/i },
  { re: /copa america/i },
  { re: /euro championship|^euro\b/i },
  { re: /copa del rey/i },
  { re: /^fa cup/i },
  { re: /dfb pokal/i },
  { re: /coppa italia/i },
  { re: /coupe de france/i },
];

function topTier(g) {
  const L = g.season?.league;
  if (!L?.name) return 0;
  // женские и молодёжные турниры не считаем топовыми
  if (/women|femenil|feminino|femminile|u23|u21|u19|youth/i.test(L.name)) return 0;
  for (const r of TOP_RULES) {
    if (r.re.test(L.name) && (!r.country || r.country.test(L.country?.name || ''))) return r.t || 2;
  }
  return 0;
}

const isTopGame = (g) => topTier(g) > 0;

/** Топ-матчи — в начале (элита t1 раньше прочих топов t2), внутри — по времени. */
function sortGames(games) {
  const rank = (g) => { const t = topTier(g); return t === 1 ? 0 : t === 2 ? 1 : 2; };
  return [...games].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return new Date(a.date) - new Date(b.date);
  });
}

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—:—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateHuman(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400_000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** 1X2 — marketId 1 (Home / Draw / Away) */
function odds1x2(g) {
  const m = (g.odds || []).find((o) => o.marketId === 1);
  if (!m) return null;
  const get = (n) => m.odds.find((p) => p.name === n)?.value;
  const out = { home: get('Home'), draw: get('Draw'), away: get('Away') };
  return (out.home || out.draw || out.away) ? out : null;
}

/** Тотал 2.5 — marketId 5 (Over 2.5 / Under 2.5) */
function oddsTotal(g) {
  const m = (g.odds || []).find((o) => o.marketId === 5);
  if (!m) return null;
  const over = m.odds.find((p) => /over/i.test(p.name))?.value;
  const under = m.odds.find((p) => /under/i.test(p.name))?.value;
  return (over || under) ? { over, under } : null;
}

export function createEvents({ chat }) {
  const view = $('#eventsView');
  const grid = $('#eventsGrid');
  const notice = $('#eventsNotice');
  const dateInput = $('#evDate');
  const toggleBtn = $('#eventsToggle');
  const leagueBtn = $('#evLeagueBtn');
  const leagueMenu = $('#evLeagueMenu');
  const leagueList = $('#evLeagueList');
  const leagueSearch = $('#evLeagueSearch');

  let dayOffset = 0;       // 0 = сегодня
  let lastGames = [];
  let leagueFilter = null; // ключ лиги (id) или null = все

  function isOpen() {
    return document.body.classList.contains('events-open');
  }

  function open() {
    document.body.classList.add('events-open');
    view.hidden = false;
    toggleBtn.classList.add('is-open');
    if (!grid.children.length && !notice.textContent) load();
  }

  function close() {
    document.body.classList.remove('events-open');
    toggleBtn.classList.remove('is-open');
  }

  function toggle() {
    isOpen() ? close() : open();
  }

  function setNotice(text, kind = 'info') {
    notice.textContent = text;
    notice.className = `events-notice${kind === 'error' ? '' : ' info'}`;
    notice.hidden = !text;
  }

  function markActiveDay() {
    const key = dayOffset === 0 ? 'today' : dayOffset === 1 ? 'tomorrow' : String(dayOffset);
    document.querySelectorAll('.ev-day[data-date]').forEach((b) => {
      b.classList.toggle('active', b.dataset.date === key);
    });
    dateInput.value = dateStr(dayOffset);
  }

  async function load(refresh = false) {
    setNotice('Загружаю матчи…', 'info');
    grid.replaceChildren();
    try {
      const q = new URLSearchParams({ date: dateStr(dayOffset), limit: '1000', tz: String(TZ) });
      if (refresh) q.set('refresh', '1');
      const j = await api(`/sstats/upcoming?${q}`);
      if (j.status !== 'OK' || !Array.isArray(j.data)) {
        throw new Error(j.message || 'SStats вернул неожиданный ответ');
      }
      lastGames = j.data;
      updateLeagueBtn();
      render();
    } catch (e) {
      setNotice(`Не удалось загрузить матчи: ${e.message}`, 'error');
    }
  }

  // на насыщенный день матчей сотни — рисуем топы и первые N, остальное через фильтр лиг
  const MAX_CARDS = 300;

  function render() {
    const games = leagueFilter == null
      ? lastGames
      : lastGames.filter((g) => leagueKeyOf(g) === leagueFilter);
    const sorted = sortGames(games);
    const shown = sorted.slice(0, MAX_CARDS);
    const frag = document.createDocumentFragment();
    for (const g of shown) {
      frag.appendChild(renderCard(g));
    }
    grid.replaceChildren(frag);
    if (!lastGames.length) {
      setNotice(`Нет предстоящих матчей на ${fmtDateHuman(dayOffset)}`, 'info');
    } else if (shown.length < sorted.length) {
      setNotice(`Показаны первые ${shown.length} из ${sorted.length} матчей — сузь выбор фильтром лиг или датой`, 'info');
    } else {
      setNotice('');
    }
  }

  /* ---------- фильтр по лигам ---------- */
  function leagueKeyOf(g) {
    const L = g.season?.league;
    return L ? (L.id ?? L.name) : '__noleague__';
  }

  function buildLeagues() {
    const map = new Map();
    for (const g of lastGames) {
      const L = g.season?.league;
      const key = leagueKeyOf(g);
      const cur = map.get(key) || {
        key,
        name: L?.name ? leagueRuName(L) : 'Лига не указана',
        orig: L?.name || '',
        country: countryRu(L?.country?.name) || (key === '__noleague__' ? '' : 'Международные'),
        count: 0,
      };
      cur.count++;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function updateLeagueBtn() {
    const leagues = buildLeagues();
    const cur = leagueFilter == null ? null : leagues.find((l) => l.key === leagueFilter);
    if (leagueFilter != null && !cur) leagueFilter = null; // лига пропала после смены даты
    leagueBtn.textContent = cur
      ? `${cur.name} ▾`
      : 'Все лиги ▾';
    leagueBtn.classList.toggle('has-filter', !!cur);
    leagueBtn.title = cur
      ? `Фильтр: ${cur.name} · ${cur.country} — нажми, чтобы сменить`
      : 'Фильтр по лигам';
  }

  function paintLeagueMenu(query = '') {
    const q = query.trim().toLowerCase();
    // поиск работает и по русскому названию, и по оригинальному английскому
    const leagues = buildLeagues().filter((l) =>
      !q || `${l.name} ${l.country} ${l.orig}`.toLowerCase().includes(q));
    const item = (key, name, country, count, cls = '') => `
      <button data-league="${esc(String(key))}" class="${cls}">
        <span class="ev-mi-name">${esc(name)}</span>
        ${country ? `<span class="ev-mi-country">✦ ${esc(country)}</span>` : ''}
        ${count != null ? `<span class="ev-mi-count">${count}</span>` : ''}
      </button>`;
    leagueList.innerHTML = item('__all__', 'Все лиги', '', lastGames.length, 'ev-menu-all') +
      (leagues.length
        ? leagues.map((l) => item(l.key, l.name, l.country, l.count, l.key === leagueFilter ? 'active' : '')).join('')
        : '<div class="ev-menu-empty">Ничего не найдено</div>');
    leagueList.querySelectorAll('button[data-league]').forEach((b) => {
      b.addEventListener('click', () => {
        leagueFilter = b.dataset.league === '__all__' ? null : /^-?\d+$/.test(b.dataset.league)
          ? Number(b.dataset.league)
          : b.dataset.league;
        closeLeagueMenu();
        updateLeagueBtn();
        render();
      });
    });
  }

  function openLeagueMenu() {
    leagueMenu.hidden = false;
    leagueSearch.value = '';
    paintLeagueMenu();
    leagueSearch.focus();
  }

  function closeLeagueMenu() {
    leagueMenu.hidden = true;
  }

  function leagueMenuOpen() {
    return !leagueMenu.hidden;
  }

  function renderCard(g) {
    const top = isTopGame(g);
    const el = document.createElement('article');
    el.className = `event-card notch${top ? ' is-top' : ''}`;
    const L = g.season?.league;
    const league = [leagueRuName(L), roundRu(g.roundName)].filter(Boolean).join(' · ');
    const o1x2 = odds1x2(g);
    const total = oddsTotal(g);
    const cc = g.homeTeam?.country?.code || '';

    const odd = (label, value) => (value
      ? `<span class="ev-odd"><i>${esc(label)}</i><b>${esc(String(value))}</b></span>` : '');

    el.innerHTML = `
      <div class="ev-head">
        ${top ? '<span class="ev-top">топ</span>' : ''}
        <span class="ev-league" title="${esc(league)}">${esc(league || 'Футбол')}</span>
        <span class="ev-time">${fmtTime(g.date)}</span>
      </div>
      <div class="ev-teams">
        <div class="ev-team">
          ${cc ? `<span class="ev-country">${esc(cc)}</span>` : ''}
          <span class="ev-name" title="${esc(g.homeTeam?.name || '')}">${esc(teamRu(g.homeTeam?.name))}</span>
        </div>
        <div class="ev-vs">матч</div>
        <div class="ev-team">
          ${g.awayTeam?.country?.code ? `<span class="ev-country">${esc(g.awayTeam.country.code)}</span>` : ''}
          <span class="ev-name" title="${esc(g.awayTeam?.name || '')}">${esc(teamRu(g.awayTeam?.name))}</span>
        </div>
      </div>
      ${(o1x2 || total) ? `
      <div class="ev-odds">
        ${o1x2 ? odd('1', o1x2.home) + odd('X', o1x2.draw) + odd('2', o1x2.away) : ''}
        ${total ? odd('Б 2.5', total.over) + odd('М 2.5', total.under) : ''}
      </div>` : ''}
      <div class="ev-actions">
        <button class="ev-btn" data-act="chat" title="Добавить матч в чат — продолжишь формулировку сам">＋ В чат</button>
        <button class="ev-btn" data-act="quick" title="Быстрый прогон основных маркетов и линий">⚡ Быстро</button>
        <button class="ev-btn ev-primary" data-act="full" title="Полный анализ по методологии и решение по ставке">🎯 Полный разбор</button>
      </div>`;

    const home = g.homeTeam?.name || '—';
    const away = g.awayTeam?.name || '—';
    const homeRu = teamRu(home), awayRu = teamRu(away);
    // если русское название отличается — добавим оригинал агенту в подсказку
    const pairRu = `${homeRu} — ${awayRu}`;
    const pairOrig = (homeRu !== home || awayRu !== away) ? ` (${home} — ${away})` : '';

    const meta = {
      id: g.id,
      home: homeRu,
      away: awayRu,
      origPair: pairOrig,
      league: league || 'футбол',
      time: `${fmtDateHuman(dayOffset)} ${fmtTime(g.date)}`,
    };

    el.querySelector('[data-act="chat"]').addEventListener('click', () => {
      close();
      $('#input').value = chatPrompt(meta);
      $('#input').focus();
      $('#input').dispatchEvent(new Event('input'));
      toast('Матч добавлен в чат — допиши, что именно разобрать', 'ok', 3200);
    });
    el.querySelector('[data-act="quick"]').addEventListener('click', () => {
      close();
      chat.send(quickPrompt(meta));
    });
    el.querySelector('[data-act="full"]').addEventListener('click', () => {
      close();
      chat.send(fullPrompt(meta));
    });

    return el;
  }

  /* ---------- промпты ---------- */
  function chatPrompt(m) {
    return `Матч «${m.home} — ${m.away}»${m.origPair} (${m.league}, ${m.time}, gameId ${m.id} в sstats). Добавь его в разбор: собери свежие данные по обеим командам и оцени ситуацию перед игрой. Что именно разобрать подробнее — напишу ниже: `;
  }

  function quickPrompt(m) {
    return `⚡ Быстрый анализ: «${m.home} — ${m.away}»${m.origPair} (${m.league}, ${m.time}, gameId ${m.id} в sstats). ` +
      'Прогони через sstats-инструменты основные маркеты: 1X2, двойной шанс, тоталы 1.5/2.5, обе забьют. ' +
      'Сравни линии букмекеров между собой, покажи таблицу кэфов и короткий вывод по каждому рынку. ' +
      'Рынки называй по-русски («Тотал больше 2.5», «Обе забьют — да»); в «Выводе» каждой строки — ' +
      'процент отклонения цены от fair и решение, а не просто «минус». ' +
      'Отметь, где линия выглядит подозрительной или завышенной. Без длинной преамбулы — таблицы и вывод.';
  }

  function fullPrompt(m) {
    return `🎯 Полный разбор и решение по ставке: «${m.home} — ${m.away}»${m.origPair} (${m.league}, ${m.time}, gameId ${m.id} в sstats). ` +
      'По полной методологии: 1) собери данные — форма последних матчей, xG, травмы и дисквалификации, H2H, мотивация и турнирное положение, домашние/выездные сплиты; ' +
      '2) построй вероятности по основным маркетам (1X2, тоталы, обе забьют, форы); ' +
      '3) сравни с линиями букмекеров — fair odds, маржа, value; ' +
      '4) итог: сценарии матча, чёткое решение — какую ставку брать или пропустить, размер позиции (≤1–3% банка) и уровень уверенности. ' +
      'Рынки в таблицах называй по-русски («Тотал больше 2.5», «Обе забьют — да»), в колонке «Вывод» — ' +
      'процент отклонения цены от fair и решение, без голых «минус»/«≈0».';
  }

  /* ---------- события UI ---------- */
  toggleBtn.addEventListener('click', toggle);
  // только чипы дат с data-date — кнопка фильтра лиг тоже .ev-day, но дату не меняет
  document.querySelectorAll('.ev-day[data-date]').forEach((b) => {
    b.addEventListener('click', () => {
      dayOffset = b.dataset.date === 'today' ? 0 : b.dataset.date === 'tomorrow' ? 1 : Number(b.dataset.date) || 0;
      markActiveDay();
      load();
    });
  });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const diff = Math.round((new Date(`${dateInput.value}T12:00`) - new Date(new Date().setHours(12, 0, 0, 0))) / 86400_000);
    dayOffset = diff;
    markActiveDay();
    load();
  });
  $('#evRefresh').addEventListener('click', () => load(true));

  /* ---------- фильтр лиг: события UI ---------- */
  leagueBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    leagueMenuOpen() ? closeLeagueMenu() : openLeagueMenu();
  });
  leagueMenu.addEventListener('click', (e) => e.stopPropagation());
  leagueSearch.addEventListener('input', () => paintLeagueMenu(leagueSearch.value));
  document.addEventListener('click', () => {
    if (leagueMenuOpen()) closeLeagueMenu();
  });

  markActiveDay();

  return { toggle, open, close, isOpen };
}
