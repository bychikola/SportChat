/* Страница «События»: карточки предстоящих матчей с sstats.net
 * и кнопки отправки матча в чат (в чат / быстрый анализ / полный разбор). */

import { $, esc, toast, openModal } from './util.js';
import { api } from './api.js';

const TZ = Math.round(-new Date().getTimezoneOffset() / 60);

/* ── пресеты анализа по рынкам (аналог «продуктов» Fatum) ──
 * marketId из /Odds/prematch-markets: 1=1X2, 5=Тотал 2.5, 8=Обе забьют,
 * 10=Точный счёт, 16/17=индивидуальные тоталы, 45=Тотал угловых, 55=Угловые 1X2 */
const PRESETS = [
  { id: 'all', label: 'Обзор всех рынков' },
  { id: 'score', label: 'Исходы и точный счёт' },
  { id: 'totals', label: 'Тоталы' },
  { id: 'corners', label: 'Угловые' },
  { id: 'btts', label: 'Голы: обе забьют' },
];

function presetPrompt(id, m) {
  const head = (title) => `⚡ ${title}: «${m.home} — ${m.away}»${m.origPair} (${m.league}, ${m.time}, gameId ${m.id} в sstats). `;
  const tail = ' Без преамбулы — сразу таблицы и вывод.';
  switch (id) {
    case 'score':
      return head('Анализ рынка «Исходы и точный счёт»') +
        'Разбери исходы 1 / ничья / 2 и точный счёт: вероятности, топ-5 наиболее вероятных счётов. ' +
        'Сравни кэфы букмекеров по рынкам 1 и 10 (sstats_odds) с fair odds, покажи маржу. ' +
        'Формат: таблица исходов + таблица топ-счётов + вывод, где value (процент отклонения и решение).' + tail;
    case 'totals':
      return head('Анализ рынка «Тоталы»') +
        'Разбери Тотал больше/меньше 1.5, 2.5, 3.5 и индивидуальные тоталы команд (рынки 5 и 16/17 в sstats_odds). ' +
        'Опора — средние тоталы и xG обеих команд за последние матчи (match_preview_stats). ' +
        'Формат: таблица «рынок — лучшая цена — fair — вердикт (процент и решение)».' + tail;
    case 'corners':
      return head('Анализ рынка «Угловые»') +
        'Собери статистику угловых обеих команд за последние матчи (статистика матчей в sstats), ' +
        'сравни с линией угловых — рынки 45 (тотал), 55 (1X2), 57/58 (индивидуальные) в sstats_odds, если лига покрыта. ' +
        'Дай прогноз по тоталу угловых и лучшие рынки. Формат: таблица + вывод (процент и решение).' + tail;
    case 'btts':
      return head('Анализ рынка «Голы: обе забьют»') +
        'Оцени «Обе забьют — да» и «нет» (рынок 8 в sstats_odds): пропущенные и забитые за последние матчи, ' +
        'качество атаки и обороны, H2H — в скольких матчах обе забили. Сравни кэфы с fair. ' +
        'Формат: таблица + вывод (процент и решение).' + tail;
    default:
      return head('Обзор всех рынков') +
        'Прогони через sstats-инструменты основные маркеты: 1X2, двойной шанс, тоталы 1.5/2.5/3.5, обе забьют. ' +
        'Сравни линии букмекеров между собой, покажи таблицу кэфов и короткий вывод по каждому рынку. ' +
        'Рынки называй по-русски («Тотал больше 2.5», «Обе забьют — да»); в «Выводе» каждой строки — ' +
        'процент отклонения цены от fair и решение, а не просто «минус». ' +
        'Отметь, где линия выглядит подозрительной или завышенной.' + tail;
  }
}

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
  // сборные (Лига наций, отбор, ЧМ)
  ['Россия', 'Russia'],
  ['Бразилия', 'Brazil'],
  ['Аргентина', 'Argentina'],
  ['Франция', 'France'],
  ['Англия', 'England'],
  ['Испания', 'Spain'],
  ['Италия', 'Italy'],
  ['Германия', 'Germany'],
  ['Португалия', 'Portugal'],
  ['Нидерланды', 'Netherlands'],
  ['Бельгия', 'Belgium'],
  ['Хорватия', 'Croatia'],
  ['Дания', 'Denmark'],
  ['Швейцария', 'Switzerland'],
  ['Австрия', 'Austria'],
  ['Польша', 'Poland'],
  ['Швеция', 'Sweden'],
  ['Норвегия', 'Norway'],
  ['Турция', 'Turkey', 'Türkiye'],
  ['Украина', 'Ukraine'],
  ['Сербия', 'Serbia'],
  ['Чехия', 'Czechia', 'Czech Republic'],
  ['Словакия', 'Slovakia'],
  ['Венгрия', 'Hungary'],
  ['Румыния', 'Romania'],
  ['Греция', 'Greece'],
  ['Шотландия', 'Scotland'],
  ['Уэльс', 'Wales'],
  ['Ирландия', 'Ireland', 'Republic of Ireland'],
  ['Северная Ирландия', 'Northern Ireland'],
  ['Финляндия', 'Finland'],
  ['Исландия', 'Iceland'],
  ['Грузия', 'Georgia'],
  ['Армения', 'Armenia'],
  ['Азербайджан', 'Azerbaijan'],
  ['Казахстан', 'Kazakhstan'],
  ['Израиль', 'Israel'],
  ['США', 'USA', 'United States'],
  ['Мексика', 'Mexico'],
  ['Канада', 'Canada'],
  ['Коста-Рика', 'Costa Rica'],
  ['Панама', 'Panama'],
  ['Гондурас', 'Honduras'],
  ['Ямайка', 'Jamaica'],
  ['Гаити', 'Haiti'],
  ['Кюрасао', 'Curaçao', 'Curacao'],
  ['Никарагуа', 'Nicaragua'],
  ['Доминика', 'Dominica'],
  ['Пуэрто-Рико', 'Puerto Rico'],
  ['Суринам', 'Suriname'],
  ['Япония', 'Japan'],
  ['Южная Корея', 'South Korea', 'Korea Republic'],
  ['Австралия', 'Australia'],
  ['Саудовская Аравия', 'Saudi Arabia'],
  ['Египет', 'Egypt'],
  ['Марокко', 'Morocco'],
  ['Нигерия', 'Nigeria'],
  ['Сенегал', 'Senegal'],
  ['Гана', 'Ghana'],
  ["Кот-д'Ивуар", "Ivory Coast", "Cote d'Ivoire"],
  ['Алжир', 'Algeria'],
  ['Тунис', 'Tunisia'],
  ['Уругвай', 'Uruguay'],
  ['Колумбия', 'Colombia'],
  ['Чили', 'Chile'],
  ['Перу', 'Peru'],
  ['Эквадор', 'Ecuador'],
  ['Парагвай', 'Paraguay'],
  ['Венесуэла', 'Venezuela'],
  ['Боливия', 'Bolivia'],
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
  if (/women|femeni|femini|femminile|u23|u21|u19|youth/i.test(L.name)) return 0;
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
  let lastGames = [];      // предстоящие матчи выбранной даты
  let liveGames = [];      // идущие сейчас
  let doneGames = [];      // завершённые выбранной даты
  let yestGames = [];      // завершённые вчера (для инсайтов)
  let yestExpanded = false;
  let leagueFilter = null; // ключ лиги (id) или null = все
  let groupFilter = 'soon';// 'live' | 'soon' | 'done'
  let autoTimer = null;
  let accStats = null; // статистика сигналов из /api/signals

  /* избранное: команда и лига (Фаза A плана профилей) */
  const fromLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  let favTeam = fromLS('sc_favTeam');      // {id, name}
  let favLeague = fromLS('sc_favLeague');  // {key, name}
  let favOnly = localStorage.getItem('sc_favOnly') === '1';

  function isFavGame(g) {
    if (favTeam && (g.homeTeam?.id === favTeam.id || g.awayTeam?.id === favTeam.id)) return true;
    if (favLeague && leagueKeyOf(g) === favLeague.key) return true;
    return false;
  }

  /** Сортировка группы: избранное → элита → топовые → обычные, внутри по времени. */
  function sortWithFav(games) {
    return [...games].sort((a, b) => {
      const fa = isFavGame(a) ? 0 : 1, fb = isFavGame(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ta = topTier(a), tb = topTier(b);
      const ra = ta === 1 ? 0 : ta === 2 ? 1 : 2, rb = tb === 1 ? 0 : tb === 2 ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return new Date(a.date) - new Date(b.date);
    });
  }

  function isOpen() {
    return document.body.classList.contains('events-open');
  }

  function open() {
    document.body.classList.add('events-open');
    view.hidden = false;
    toggleBtn.classList.add('is-open');
    load();
    // авто-обновление, пока вкладка открыта (live у sstats обновляется каждую минуту)
    if (!autoTimer) {
      autoTimer = setInterval(() => { if (isOpen()) load(); }, 75_000);
    }
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

  function renderSkeleton() {
    grid.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'event-card skel';
      d.innerHTML = `
        <span class="sk-line w25"></span>
        <span class="sk-line w70"></span>
        <span class="sk-line w45"></span>
        <div class="sk-row"><span class="sk-line"></span><span class="sk-line"></span></div>`;
      grid.appendChild(d);
    }
  }

  function retryBtn() {
    const b = document.createElement('button');
    b.className = 'btn-secondary notch-sm';
    b.textContent = 'Повторить';
    b.addEventListener('click', () => load());
    return b;
  }

  async function load(refresh = false) {
    setNotice('Загружаю матчи…', 'info');
    renderSkeleton();
    const date = dateStr(dayOffset);
    const r = refresh ? '&refresh=1' : '';
    const [up, lv, fin, yest, sig] = await Promise.allSettled([
      api(`/sstats/upcoming?date=${date}&limit=1000&tz=${TZ}${r}`),
      api(`/sstats/live?tz=${TZ}${r}`),
      api(`/sstats/finished?date=${date}&tz=${TZ}${r}`),
      api(`/sstats/finished?date=${dateStr(-1)}&tz=${TZ}${r}`),
      api('/signals'),
    ]);
    const take = (p) => (p.status === 'fulfilled' && p.value?.status === 'OK' && Array.isArray(p.value.data)) ? p.value.data : null;
    // сервер может ответить 200 с {error} — это тоже неудача загрузки
    const reason = (p) => p.status === 'rejected'
      ? (p.reason?.message || 'нет связи с сервером')
      : (p.value?.error || (p.value?.status === 'OK' ? '' : 'нет данных от SStats'));
    if (!take(up) && !take(lv) && !take(fin)) {
      const why = [reason(up), reason(lv), reason(fin)].find(Boolean) || 'нет данных от SStats';
      grid.replaceChildren();
      setNotice(`Не удалось загрузить матчи — ${why}. Проверь связь и попробуй ещё раз.`, 'error');
      notice.appendChild(retryBtn());
      return;
    }
    const errs = [up, lv, fin].filter((p) => p.status === 'rejected').map((p) => p.reason?.message);
    if (errs.length) toast(`Часть данных не загрузилась: ${errs[0]}`, 'warn', 4000);
    const upD = take(up), lvD = take(lv), finD = take(fin), yD = take(yest);
    if (sig.status === 'fulfilled' && sig.value?.ok) accStats = sig.value.stats ?? null;
    if (upD) lastGames = upD;
    if (lvD) liveGames = lvD;
    if (finD) doneGames = finD;
    if (yD) yestGames = yD;
    updateLeagueBtn();
    render();
    renderInsights();
    renderFavCard();
  }


  /* ---------- модалка сигналов (трекер точности) ---------- */
  async function openAccModal() {
    const body = document.createElement('div');
    body.innerHTML = '<div class="mm-loading">Загружаю сигналы…</div>';
    const modal = openModal({ title: 'Трекер точности сигналов', body });
    try {
      const j = await api('/signals');
      const st = j.stats || {};
      const stLine = `Всего: <b>${st.total ?? 0}</b> · в работе: <b>${st.pending ?? 0}</b> · завершено: <b>${st.settled ?? 0}</b> (зашло <b style="color:var(--mint)">${st.won ?? 0}</b> / не зашло <b style="color:var(--live)">${st.lost ?? 0}</b>)`;
      const byMarket = Object.entries(st.byMarket || {}).map(([m, v]) =>
        `<span><b>${esc(m)}</b> — ${v.accuracy}% (${v.won}/${v.settled})</span>`).join('');
      const rows = (j.signals || []).map((x) => {
        const cls = x.status === 'won' ? 'ok' : x.status === 'lost' ? 'err' : x.status === 'void' ? '' : 'run';
        const label = x.status === 'won' ? 'зашло' : x.status === 'lost' ? 'не зашло' : x.status === 'void' ? 'возврат' : 'в работе';
        return `<div class="evi-row"><span class="evi-lg">${esc(x.league || '')}</span>
          <span class="evi-t">${esc(x.pick)} <span class="mm-hint">@${esc(x.odds ? String(x.odds) : '—')} · ${esc(x.match || '')}</span></span>
          <span class="st st-${cls || 'ok'}">${label}${x.result?.score ? ' ' + esc(x.result.score) : ''}</span>
          <button class="card-x" title="Удалить" data-id="${esc(x.id)}">✕</button></div>`;
      }).join('');
      body.innerHTML = `
        <div class="field"><label>Сводка</label><div class="hint">${stLine}</div></div>
        ${byMarket ? `<div class="field"><label>По рынкам</label><div class="evi-stats">${byMarket}</div></div>` : ''}
        <div class="field"><label>Сигналы</label><div class="signals-list">${rows || '<div class="evi-empty">Сигналов ещё нет — сохрани их из полных разборов в чате</div>'}</div></div>`;
      body.querySelectorAll('.card-x').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api('/signals/' + btn.dataset.id, { method: 'DELETE' });
            modal.close();
            openAccModal();
          } catch (e) { toast(e.message, 'err'); }
        });
      });
    } catch (e) {
      body.innerHTML = `<div class="evi-empty">Не удалось загрузить: ${esc(e.message)}</div>`;
    }
  }

  /* ---------- инсайты: лига дня + итоги вчера ---------- */
  function renderInsights() {
    const dayEl = $('#evLeagueDay');
    const yestEl = $('#evYest');

    // лига дня: группируем вчерашние завершённые матчи по лигам
    const byLeague = new Map();
    for (const g of yestGames) {
      if (g.homeResult == null || g.awayResult == null) continue;
      const L = g.season?.league;
      // женские и молодёжные лиги — слишком шумная выборка для «лиги дня»
      if (/women|femeni|femini|femminile|u23|u21|u19|youth/i.test(L?.name || '')) continue;
      const key = leagueKeyOf(g);
      const cur = byLeague.get(key) || {
        key,
        name: leagueRuName(L) || L?.name || '—',
        country: countryRu(L?.country?.name),
        count: 0, goals: 0, over25: 0,
      };
      cur.count++;
      cur.goals += (g.homeResult + g.awayResult);
      if (g.homeResult + g.awayResult > 2.5) cur.over25++;
      byLeague.set(key, cur);
    }
    const best = [...byLeague.values()]
      .filter((l) => l.count >= 3)
      .map((l) => ({ ...l, avg: l.goals / l.count, overPct: Math.round(l.over25 / l.count * 100) }))
      .sort((a, b) => b.avg - a.avg)[0];

    dayEl.innerHTML = best ? `
      <div class="evi-cap">Лучшая лига дня · вчера</div>
      <div class="evi-league">${esc(best.name)}<span class="evi-country">✦ ${esc(best.country)}</span></div>
      <div class="evi-stats">
        <span><b>${best.count}</b> ${best.count === 1 ? 'матч' : best.count < 5 ? 'матча' : 'матчей'}</span>
        <span>ср. тотал <b>${best.avg.toFixed(2)}</b></span>
        <span>верх 2.5 — <b>${best.overPct}%</b></span>
      </div>` : `
      <div class="evi-cap">Лучшая лига дня · вчера</div>
      <div class="evi-empty">Данных пока мало</div>`;

    // итоги вчера: сначала матчи топ-лиг, при пустоте — любые
    const topYest = yestGames.filter((g) => topTier(g) > 0);
    const pool = topYest.length ? topYest : yestGames;
    const list = (yestExpanded ? pool : pool.slice(0, 6));
    const rows = list.map((g) => {
      const hr = g.homeResult, ar = g.awayResult;
      const homeBold = hr != null && ar != null && hr > ar;
      const awayBold = hr != null && ar != null && ar > hr;
      const lg = leagueRuName(g.season?.league) || g.season?.league?.name || '';
      return `<div class="evi-row">
        <span class="evi-lg">${esc(lg)}</span>
        <span class="evi-t">${homeBold ? `<strong>${esc(teamRu(g.homeTeam?.name))}</strong>` : esc(teamRu(g.homeTeam?.name))} — ${awayBold ? `<strong>${esc(teamRu(g.awayTeam?.name))}</strong>` : esc(teamRu(g.awayTeam?.name))}</span>
        <span class="evi-sc">${hr != null ? `${hr}:${ar}` : '—'}</span>
      </div>`;
    }).join('');
    const cap = `Итоги вчера · ${fmtDateHuman(-1)}`;
    yestEl.innerHTML = `
      <div class="evi-cap">${cap}${topYest.length ? ' · топ-лиги' : ''}</div>
      ${rows || '<div class="evi-empty">Нет данных</div>'}
      ${pool.length > 6 ? `<button class="evi-more" id="eviMore">${yestExpanded ? 'свернуть ↑' : `все матчи → (${pool.length})`}</button>` : ''}`;
    yestEl.querySelector('#eviMore')?.addEventListener('click', () => {
      yestExpanded = !yestExpanded;
      renderInsights();
    });
  }

  // на насыщенный день матчей сотни — рисуем топы и первые N, остальное через фильтр лиг
  const MAX_CARDS = 300;

  function render() {
    const leagueMatch = (g) => leagueFilter == null || leagueKeyOf(g) === leagueFilter;
    const favMatch = (g) => !favOnly || isFavGame(g);
    const groups = {
      live: sortWithFav(liveGames.filter(leagueMatch).filter(favMatch)),
      soon: sortWithFav(lastGames.filter(leagueMatch).filter(favMatch)),
      done: sortWithFav(doneGames.filter(leagueMatch).filter(favMatch)),
    };
    // плитки-счётчики + точность
    for (const b of document.querySelectorAll('.ev-tile')) {
      if (b.dataset.group === 'acc') {
        b.querySelector('b').textContent = accStats?.accuracy != null ? `${accStats.accuracy}%` : '—';
        continue;
      }
      const n = groups[b.dataset.group]?.length ?? 0;
      b.querySelector('b').textContent = String(n);
      b.classList.toggle('active', b.dataset.group === groupFilter);
    }
    const list = groups[groupFilter] ?? groups.soon;
    const shown = list.slice(0, MAX_CARDS);
    const frag = document.createDocumentFragment();
    for (const g of shown) {
      frag.appendChild(renderCard(g, groupFilter));
    }
    grid.replaceChildren(frag);
    if (!liveGames.length && !lastGames.length && !doneGames.length) {
      setNotice(`Нет матчей на ${fmtDateHuman(dayOffset)}`, 'info');
    } else if (!shown.length) {
      setNotice('В этой группе матчей нет — переключи плитку выше или фильтр лиг', 'info');
    } else if (shown.length < list.length) {
      setNotice(`Показаны первые ${shown.length} из ${list.length} матчей — сузь выбор фильтром лиг или датой`, 'info');
    } else {
      setNotice('');
    }
  }

  /* ---------- фильтр по лигам ---------- */
  function leagueKeyOf(g) {
    const L = g.season?.league;
    return L ? (L.id ?? L.name) : '__noleague__';
  }

  const allGames = () => [...liveGames, ...lastGames, ...doneGames];

  function buildLeagues() {
    const map = new Map();
    for (const g of allGames()) {
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

  function renderCard(g, group) {
    const top = isTopGame(g);
    const fav = isFavGame(g);
    const el = document.createElement('article');
    el.className = `event-card notch${top ? ' is-top' : ''}${group === 'done' ? ' is-done' : ''}${fav ? ' is-fav' : ''}`;
    const L = g.season?.league;
    const league = [leagueRuName(L), roundRu(g.roundName)].filter(Boolean).join(' · ');
    const o1x2 = odds1x2(g);
    const total = oddsTotal(g);
    const cc = g.homeTeam?.country?.code || '';

    // шапка карточки зависит от группы
    const score = (g.homeResult != null || g.awayResult != null)
      ? `${g.homeResult ?? 0}:${g.awayResult ?? 0}` : null;
    let headLeft = `${fav ? '<span class="ev-star">★</span>' : ''}${top ? '<span class="ev-top">топ</span>' : ''}`;
    let headRight;
    if (group === 'live') {
      const liveLabel = g.status === 4 ? 'ПЕРЕРЫВ' : (g.elapsed != null ? `LIVE ${g.elapsed}′` : 'LIVE');
      headLeft = `<span class="ev-badge-live">${liveLabel}</span>` + headLeft;
      headRight = score
        ? `<span class="ev-score">${score}</span>`
        : `<span class="ev-time">${fmtTime(g.date)}</span>`;
    } else if (group === 'done') {
      headRight = score
        ? `<span class="ev-score"><span class="ev-fin-label">ИТОГ</span>${score}</span>`
        : `<span class="ev-time">${fmtTime(g.date)}</span>`;
    } else {
      headRight = `<span class="ev-time">${fmtTime(g.date)}</span>`;
    }

    const odd = (label, value) => (value
      ? `<span class="ev-odd"><i>${esc(label)}</i><b>${esc(String(value))}</b></span>` : '');

    el.innerHTML = `
      <div class="ev-head">
        ${headLeft}
        <span class="ev-league" title="${esc(league)}">${esc(league || 'Футбол')}</span>
        ${headRight}
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
        <button class="ev-btn" data-act="preset" title="Быстрый анализ по выбранному рынку">Анализ ▾</button>
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
    el.querySelector('[data-act="preset"]').addEventListener('click', (e) => {
      e.stopPropagation();
      openPresetMenu(e.currentTarget, meta);
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

  /* ---------- меню пресетов анализа ---------- */
  const presetMenu = $('#evPresetMenu');
  const presetList = $('#evPresetList');
  let presetMeta = null;

  function openPresetMenu(btn, meta) {
    presetMeta = meta;
    paintPresetMenu();
    presetMenu.hidden = false;
    const r = btn.getBoundingClientRect();
    presetMenu.hidden = false;
    const w = presetMenu.offsetWidth;
    presetMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    presetMenu.style.top = `${Math.max(8, r.top - presetMenu.offsetHeight - 8)}px`;
  }

  function hidePresetMenu() {
    presetMenu.hidden = true;
    presetMeta = null;
  }

  function paintPresetMenu() {
    presetList.replaceChildren(...PRESETS.map((p) => {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.addEventListener('click', () => {
        const meta = presetMeta;
        hidePresetMenu();
        if (!meta) return;
        close();
        chat.send(presetPrompt(p.id, meta));
      });
      return b;
    }));
  }

  function fullPrompt(m) {
    return `🎯 Полный разбор и решение по ставке: «${m.home} — ${m.away}»${m.origPair} (${m.league}, ${m.time}, gameId ${m.id} в sstats). ` +
      'По полной методологии: 1) собери данные — форма последних матчей, xG, травмы и дисквалификации, H2H, мотивация и турнирное положение, домашние/выездные сплиты; ' +
      '2) построй вероятности по основным маркетам (1X2, тоталы, обе забьют, форы); ' +
      '3) сравни с линиями букмекеров — fair odds, маржа, value; ' +
      '4) итог: сценарии матча, чёткое решение — какую ставку брать или пропустить, размер позиции (≤1–3% банка) и уровень уверенности. ' +
      'Если в итоге есть ставка — заверши ответ служебной строкой СИГНАЛ в формате из системного промпта. ' +
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


  /* ---------- избранное: команда и лига (Фаза A) ---------- */
  const favTeamInput = $('#favTeamInput');
  const favLeagueSel = $('#favLeagueSel');

  function renderFavCard() {
    // подсказки команд — уникальные команды из загруженных матчей
    const teams = new Map();
    for (const g of allGames()) {
      for (const t of [g.homeTeam, g.awayTeam]) {
        if (t?.name && t.id != null && !teams.has(t.name)) teams.set(t.name, t.id);
      }
    }
    $('#favTeamList').innerHTML = [...teams.keys()].sort()
      .map((n) => `<option value="${esc(n)}"></option>`).join('');
    favLeagueSel.innerHTML = '<option value="">Любимая лига — не выбрана</option>' +
      buildLeagues().map((l) => `<option value="${esc(String(l.key))}">${esc(l.name)}${l.country ? ' — ' + esc(l.country) : ''}</option>`).join('');
    favTeamInput.value = favTeam?.name || '';
    favLeagueSel.value = favLeague ? String(favLeague.key) : '';
    $('#favOnlyBtn').classList.toggle('active', favOnly);
  }

  favTeamInput.addEventListener('change', () => {
    const name = favTeamInput.value.trim();
    if (!name) { favTeam = null; localStorage.removeItem('sc_favTeam'); render(); return; }
    // точное совпадение с командой из загруженных матчей
    for (const g of allGames()) {
      for (const t of [g.homeTeam, g.awayTeam]) {
        if (t?.name === name && t.id != null) {
          favTeam = { id: t.id, name };
          localStorage.setItem('sc_favTeam', JSON.stringify(favTeam));
          toast(`Избранная команда: ${name}`, 'ok', 2400);
          render();
          return;
        }
      }
    }
    toast('Команда не найдена в текущих матчах — выбери из подсказок', 'warn', 3200);
    favTeamInput.value = favTeam?.name || '';
  });

  favLeagueSel.addEventListener('change', () => {
    const v = favLeagueSel.value;
    if (!v) {
      favLeague = null;
      localStorage.removeItem('sc_favLeague');
      render();
      return;
    }
    const l = buildLeagues().find((x) => String(x.key) === v);
    if (!l) return;
    favLeague = { key: l.key, name: l.name };
    localStorage.setItem('sc_favLeague', JSON.stringify(favLeague));
    toast(`Избранная лига: ${l.name}`, 'ok', 2400);
    render();
  });

  $('#favOnlyBtn').addEventListener('click', () => {
    favOnly = !favOnly;
    localStorage.setItem('sc_favOnly', favOnly ? '1' : '0');
    renderFavCard();
    render();
  });

  $('#favClear').addEventListener('click', () => {
    favTeam = null;
    favLeague = null;
    favOnly = false;
    localStorage.removeItem('sc_favTeam');
    localStorage.removeItem('sc_favLeague');
    localStorage.removeItem('sc_favOnly');
    renderFavCard();
    render();
    toast('Избранное сброшено', 'ok', 2000);
  });

  /* ---------- плитки статусов: переключение групп ---------- */
  document.querySelectorAll('.ev-tile').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.group === 'acc') { openAccModal(); return; }
      groupFilter = b.dataset.group;
      render();
    });
  });

  /* ---------- меню пресетов: закрытие ---------- */
  document.addEventListener('click', (e) => {
    if (!presetMenu.hidden && !presetMenu.contains(e.target)) hidePresetMenu();
  });
  $('#eventsScroll').addEventListener('scroll', () => {
    if (!presetMenu.hidden) hidePresetMenu();
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !presetMenu.hidden) hidePresetMenu();
  });

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

  return { toggle, open, close, isOpen, openTracker: openAccModal };
}
