# ПЛАН: Внедрение SportChat на сервер (пошагово)

> 2026-10-01. Цель: сайт работает на домене с HTTPS, купоны/юзеры в Supabase,
> готово к подключению Telegram Mini App. Всё деплоится Docker-ом — один
> авт-установщик, один скрипт обновления.

---

## Шаг 0. Что нужно (чеклист)

- [ ] VPS: Ubuntu 22.04+, 2 ГБ RAM, 20 ГБ диска (Timeweb/Hetzner/Selectel — любой)
- [ ] Домен (например `спортчат.рф` или `chat.example.com`) — доступ к DNS-панели
- [ ] Ключ модели: OpenRouter (`sk-or-v1-…`) или DeepSeek
- [ ] Ключ sstats.net (уже есть локально: `data/sstats-key.json`)
- [ ] Supabase: URL + service_role ключ (проект «СПОРТЧАТ» уже создан)
- [ ] Открытые порты: 22 (SSH), 80, 443

## Шаг 1. DNS (5 минут, до установки)

У регистратора домена создать **A-запись** `@` (или поддомен `chat`) → IP сервера.
Проверка через 5–15 минут: `ping твой-домен` должен показывать IP сервера.
Caddy сам получит Let's Encrypt сертификат при первом заходе — отдельного
действия по SSL нет.

## Шаг 2. Установка одной командой (10 минут)

На сервере:
```bash
git clone https://github.com/bychikola/SportChat.git /opt/sportchat
cd /opt/sportchat
sudo bash install.sh \
  --token sk-or-v1-ТВОЙ_КЛЮЧ \
  --domain твой-домен \
  --sstats-key КЛЮЧ_SSTATS \
  --supabase-url https://<ref>.supabase.co \
  --supabase-key eyJhbGci... \
  --yes
```
Установщик сам: поставит Docker → соберёт образ → создаст .env (600) → запишет
ключ sstats в `data/sstats-key.json` → поднимет контейнер → поднимет Caddy с
HTTPS → проверит DNS и здоровье `/api/meta`.

Если домен позже: сначала без `--domain`, затем `sudo bash domain.sh твой-домен`.

**Если на сервере уже есть сайт на Caddy** (порты заняты): установка без
`--domain`, затем `sudo bash caddy-add-site.sh твой-домен` — добавит сайт в
свой существующий Caddyfile, прежний сайт не тронет.

## Шаг 3. Проверка (5 минут)

- [ ] `https://домен` открывается, замок в браузере
- [ ] Лента прогнозов грузит матчи (значит sstats-ключ на месте)
- [ ] Регистрация юзера работает (значит Supabase подключён)
- [ ] Пиши «пинг» в чат → отвечает модель (значит ключ модели на месте)
- [ ] Чек-лист в Supabase: таблицы users/auth_sessions/coupons существуют

Диагностика: `cd /opt/sportchat && docker compose logs -f`

## Шаг 4. Данные и секреты (безопасность)

- `.env` (права 600): ключ модели + Supabase service_role — **не коммитится** (в .gitignore)
- `data/sstats-key.json` (600) — ключ sstats, вне git
- `data/` — купоны, сигналы, сессии; монтируется как volume → переживает
  пересоздание контейнера
- Бэкап раз в сутки (cron): `tar czf /root/sportchat-data-$(date +%F).tgz data .env`
  и копия в Supabase (users/coupons уже в БД) — JSON только фолбэк

## Шаг 5. Обновления (2 минуты)

```bash
cd /opt/sportchat && sudo bash update.sh
```
git pull → rebuild → рестарт → healthcheck → чистка старых образов.
`.env` и `data/` не трогаются.

## Шаг 6. Telegram Mini App (Этап 5 — когда готов)

1. **BotFather**: `/newbot` → имя и username → получишь токен бота
2. `/newapp` или Bot Menu Button → Web App URL = `https://твой-домен`
3. В .env добавить `TELEGRAM_BOT_TOKEN=…` (для валидации initData — Этап 5 PLAN.md:
   сервер проверяет HMAC подпись Telegram, юзер логинится одной кнопкой)
4. Проверка в Telegram: открыть бота → кнопка меню → Mini App открывается
   на весь экран с нашим PWA-интерфейсом

## Шаг 7. Мониторинг и эксплуатация

- Логи: `docker compose logs -f` (или `journalctl -u docker`)
- Здоровье: HEALTHCHECK встроен в образ (docker ps → STATUS healthy)
- Перезапуск при падении: `restart: unless-stopped` в compose
- Расход API sstats: кэши на сервере (60с лента, 10 мин форма, live 15с)

## Роли скриптов

| Скрипт | Когда | Что делает |
|---|---|---|
| `install.sh` | один раз на чистом VPS | Docker, код, .env, ключи, контейнер, Caddy, HTTPS |
| `domain.sh` | смена/добавление домена | DOMAIN в .env, DNS-проверка, Caddy, сертификат |
| `caddy-add-site.sh` | если 80/443 заняты твоим Caddy | добавить сайт в существующий Caddyfile |
| `update.sh` | каждый релиз | pull → rebuild → рестарт → healthcheck |

## Что было подправлено в скриптах (эта правка)

1. **Dockerfile**: `COPY sstats_mcp` — MCP-сервер не попадал в образ (лента/MCP
   падали); VOLUME исправлен на `/home/node/.claude` (сессии Claude не сохранялись).
2. **install.sh**: флаги `--supabase-url/--supabase-key` (Supabase обязателен для
   auth и купонов), `--sstats-key` → кладёт `data/sstats-key.json`; идемпотентная
   запись в существующий .env.
3. **update.sh**: fallback при локальных правках, чистка образов, проверка
   sstats-ключа и Supabase после обновления.
4. **.env.example**: Supabase раскомментирован, добавлено место хранения ключа
   sstats (в data/, не в .env).
