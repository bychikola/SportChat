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

> Безопасность: без домена порт привязывается к `127.0.0.1` — доступ снаружи
> только через SSH-туннель (`ssh -L 3777:127.0.0.1:3777 user@server`).
> Ключ хранится в `.env` с правами 600 и не попадает в git.

## Что внутри

| Панель | Что делает |
|---|---|
| **Чат** | Стриминговые ответы, markdown, блоки «Размышление», карточки инструментов с результатами |
| **Табло** (верх) | Живой статус, **источники моделей**: конфиг workspace, OpenRouter (ключ → живой список всех моделей), DeepSeek, свой источник в JSON; токены, стоимость, ходы |
| **Эпизоды** | Каждое действие агента вживую: WebSearch, Read, Bash, вызовы MCP |
| **MCP** | Подключение серверов (stdio / http / sse) → `workspace/.mcp.json` |
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

## Источники моделей

Клик по модели на табло → выбор источника и модели:

- **Конфиг workspace** — как задано в `~/.claude` / `workspace/.claude/settings.json`
  (по умолчанию ox-alpha через OpenRouter);
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

Модели маршрутизируются через OpenRouter: алиас `sonnet` → `stealth/ox-alpha[1M]`
(см. `env` в `workspace/.claude/settings.json`). Токен не хранится в проекте —
наследуется из `~/.claude/settings.json`.

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
