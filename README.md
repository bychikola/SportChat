# ⚡ SportChat — аналитика спортивных событий на реальном Claude Code

Веб-чат для разбора матчей, внутри которого работает **настоящий Claude Code CLI**
(через официальный `@anthropic-ai/claude-agent-sdk`): поиск в интернете, файлы,
MCP-серверы, навыки (Skills), права доступа и консоль — всё как в терминале.

## Запуск

```bash
npm install
npm start          # → http://127.0.0.1:3777
```

Требуется Node 18+ и установленный/авторизованный Claude Code
(`claude` в PATH; токен и BASE_URL берутся из окружения или `~/.claude/settings.json`).

## 🚀 Деплой на VPS (Docker, одна команда)

Свежие Ubuntu/Debian, root:

```bash
curl -fsSL https://raw.githubusercontent.com/bychikola/SportChat/main/install.sh -o install.sh
sudo bash install.sh            # спросит ключ OpenRouter и (опционально) домен
```

Установщик сам поставит Docker, склонирует репозиторий в `/opt/sportchat`,
создаст `.env`, соберёт образ, запустит контейнер и дождётся готовности.
Неинтерактивно: `sudo bash install.sh --token sk-or-v1-… --domain chat.example.com`

**Что внутри:**
- контейнер `node:22-slim` + git, приложение слушает `0.0.0.0:3777`;
- авторизация модели — через env (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` из `.env`),
  маршрутизация моделей — в `workspace/.claude/settings.json`;
- персистентность: `./workspace` (конфиг агента), `./data` (история разборов),
  том `claude_home` (сессии Claude Code, плагины — переживают пересоздание контейнера);
- опциональный **Caddy** с автоматическим Let's Encrypt HTTPS:
  `sudo bash install.sh --domain chat.example.com` (нужна A-запись домена на сервер).

**Обновление до последней версии:** `sudo bash update.sh`
**Логи:** `docker compose logs -f` · **Рестарт:** `docker compose restart`

**Подключить домен к работающему серверу** (авто-HTTPS от Let's Encrypt):

```bash
sudo bash domain.sh chat.example.com
```

Скрипт сам проверит A-запись домена, поднимет Caddy и дождётся сертификата.
Нужно лишь одно: у регистратора домена A-запись `chat.example.com` → IP твоего VPS.
Кириллические домены (.рф) поддерживаются — скрипт сам переведёт их в punycode
(требуется python3 или idn2 на сервере).

**Если порты 80/443 уже заняты другим сайтом:**

- на **nginx/apache** — SportChat добавится отдельным виртуальным хостом
  (твой сайт не пострадает): `sudo bash proxy-nginx.sh спортчат.рф`;
- на **Caddy** (systemd или Docker) — сайт допишется в твой Caddyfile с бэкапом,
  WebSocket и HTTPS из коробки: `sudo bash caddy-add-site.sh спортчат.рф`.

> Безопасность: без домена порт привязывается к `127.0.0.1` — доступ снаружи
> только через SSH-туннель (`ssh -L 3777:127.0.0.1:3777 user@server`).
> Ключ хранится в `.env` с правами 600 и не попадает в git.

## Что внутри

| Панель | Что делает |
|---|---|
| **Чат** | Стриминговые ответы, markdown, блоки «Размышление», карточки инструментов с результатами |
| **Табло** (верх) | Живой статус, **источники моделей**: конфиг workspace, OpenRouter (ключ → живой список всех моделей), DeepSeek, свой источник в JSON; токены, стоимость, ходы |
| **Эпизоды** | Каждое действие агента вживую: WebSearch, Read, Bash, вызовы MCP |
| **MCP** | Подключение серверов (stdio / http / sse) → `workspace/.mcp.json`. В комплекте: **SStats.net Football API** — 14 инструментов для реальной футбольной статистики |
| **Skills** | Создание и редактирование навыков → `workspace/.claude/skills/<имя>/SKILL.md` |
| **Плагины** | Магазин маркетплейсов Claude Code, установка и подключение плагинов к агенту |
| **Консоль** | Неинтерактивные команды CLI: `claude mcp list`, `claude doctor`, … |
| **Настройки** | Персона (CLAUDE.md), права (settings.json), сведения о движке |

## Слэш-команды

Набери `/` в поле ввода — появится меню. Свои команды: `/plugin` (магазин),
`/reload-plugins`, `/reload-skills`, `/mcp`, `/skills`, `/model`, `/clear`, `/help`.
Команды плагинов (например `/remember`) отправляй как обычное сообщение —
их исполняет сам Claude Code.

## Режимы прав

- **Спрашивать** — опасные действия (Write/Bash/MCP) показывают карточку
  «Разрешить / Всегда / Отклонить» прямо в чате.
- **Авто-правки** — редактирование файлов без вопросов.
- **Только план** — исследование без изменений.
- **Полный доступ** — эквивалент `claude --dangerously-skip-permissions`:
  агент делает всё без подтверждений (включается после предупреждения).

## Плагины

Панель «Плагины» читает настоящие маркетплейсы из `~/.claude/plugins/marketplaces`
(поиск по каталогу, кнопка «Установить» → `claude plugin install name@marketplace`),
показывает установленные и позволяет подключать их к агенту переключателем.
«+ Маркет» добавляет новый маркетплейс (`claude plugin marketplace add owner/repo`).
Подключённые плагины передаются в SDK как локальные и загружаются со следующим
сообщением (первый запуск с полным набором может занять минуту — грузятся их
MCP-серверы).

## MCP-сервер SStats.net (футбольные данные)

Кастомный MCP-сервер (`sstats_mcp/server.mjs`) поверх официального
OpenAPI-документа SStats (`sstats_mcp/v1.yaml`) — реальные матчи, статистика,
коэффициенты, составы, турнирные таблицы:

| Инструмент | Что даёт |
|---|---|
| `sstats_search_matches` | Поиск матчей: лига/дата/интервал/команда/H2H/статус, кэфы 1X2 и тоталы |
| `sstats_get_match` | Полный матч: статистика, составы, события, стадион, судья, кэфы закрытия |
| `sstats_match_preview_stats` | Предматчевая форма команд (последние N матчей, xG, тоталы) |
| `sstats_season_standings` / `sstats_league_table` | Турнирные таблицы |
| `sstats_odds` / `sstats_live_odds` | Доматчевые и live-коэффициенты по букмекерам |
| `sstats_injuries` / `sstats_match_text_summary` | Пропуски и текстовая сводка |
| `sstats_teams` / `sstats_players` / `sstats_leagues` / `sstats_bookmakers` | Справочники |
| `sstats_account` | Проверка ключа |

Ключ хранится в `data/sstats-key.json` (вне git) или env `SSTATS_API_KEY`.
Справочники кэшируются 10 минут, мягкий троттлинг от лимитов API.

## Источники моделей

Клик по модели на табло → выбор источника и модели:

- **Конфиг workspace** — как задано в окружении твоего Claude Code
  (по умолчанию `deepseek-v4-flash` через шлюз DeepSeek);
- **OpenRouter** — вставь ключ, получи живой список всех моделей (сотни, с поиском
  и фильтром `:free`);
- **DeepSeek** — официальный Anthropic-совместимый эндпоинт
  (`api.deepseek.com/anthropic`), модели `deepseek-chat` / `deepseek-reasoner`;
- **Свой источник (JSON)** — любой Anthropic-совместимый шлюз:
  ```json
  { "name": "my-gateway", "baseURL": "https://api.example.com",
    "apiKey": "…", "models": ["id-1", "id-2"] }
  ```

Выбор действует на следующее сообщение. Ключи хранятся на сервере в
`data/providers.json` (вне git, в API отдаются замаскированными) и передаются
в CLI через `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` на время запроса.

## Конфигурация (настоящие файлы Claude Code)

```
workspace/
├── SYSTEM_PROMPT.md           # системный промпт: роль и методология профи-аналитика
│                              # (Настройки → Персона; добавляется к промпту Claude Code)
├── CLAUDE.md                  # память проекта: конвенции workspace
├── .mcp.json                  # MCP-серверы (панель MCP)
└── .claude/
    ├── settings.json          # модель, env, permissions.allow/deny
    └── skills/                # навыки (SKILL.md)
```

Системный промпт задаёт роль «главный аналитик спортивных событий»: методологию
из 4 шагов (сбор данных → модель вероятностей с весами факторов → сравнение с
линией через fair odds и value → вывод с уверенностью), правила вывода
(TL;DR → таблицы → факторы → вероятности → итог) и жёсткие ограничения
(никаких «верняков», разделение фактов и оценок, риски ставок).

Модель и шлюз наследуются из окружения Claude Code (или выбираются в меню
источников: OpenRouter / DeepSeek / свой JSON). По умолчанию — `deepseek-v4-flash`
через DeepSeek-шлюз. Токен не хранится в проекте — наследуется из `~/.claude/settings.json`.

## Архитектура

```
server/
├── index.js   # express + ws (стрим событий агента → браузер)
├── agent.js   # ChatConnection: query() SDK, стрим-события, canUseTool → карточки
├── routes.js  # REST: mcp / skills / settings / sessions / cli-run
└── store.js   # workspace-файлы, история сессий, воспроизведение транскриптов
public/
├── index.html · css/app.css        # дизайн «ночной стадион»: табло, янтарь, срезанные углы
└── js/  main · chat · rail · settings · md · api · util
```

Сессии сохраняются самим Claude Code (`~/.claude/projects/…`), история и
воспроизведение — поверх этих файлов. Каждый запрос агента поднимает свежий
процесс CLI с актуальным конфигом: добавили MCP или навык — следующее сообщение
уже с ними.
