#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  SportChat — авто-установщик на VPS (Ubuntu/Debian)
#
#  Что делает:
#    1. Ставит Docker + Compose, если их нет
#    2. Клонирует репозиторий (или использует текущую папку)
#    3. Создаёт .env с ключом модели (OpenRouter по умолчанию)
#    4. Собирает и запускает контейнер, ждёт готовности
#    5. Опционально поднимает Caddy с автоматическим HTTPS
#
#  Использование:
#    sudo bash install.sh                        # интерактивный режим
#    sudo bash install.sh --token sk-or-v1-…     # неинтерактивный
#    sudo bash install.sh --domain chat.example.com
#
#  Флаги: --token --base-url --port --bind-ip --domain --basic-auth user:pass --yes
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_URL="${SPORTCHAT_REPO:-https://github.com/bychikola/SportChat.git}"
APP_DIR="${SPORTCHAT_DIR:-}"

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
info() { printf "${C_G}▸${C_0} %s\n" "$*"; }
warn() { printf "${C_Y}!${C_0} %s\n" "$*"; }
die()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; exit 1; }
banner() { printf "\n${C_B}⚡ SportChat — установка на сервер${C_0}\n\n"; }

TOKEN="" BASE_URL="https://openrouter.ai/api" PORT="3777" BIND_IP="127.0.0.1"
DOMAIN="" BASIC_AUTH="" NONINTERACTIVE=0

usage() { grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)      TOKEN="$2"; shift 2 ;;
    --base-url)   BASE_URL="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --bind-ip)    BIND_IP="$2"; shift 2 ;;
    --domain)     DOMAIN="$2"; shift 2 ;;
    --basic-auth) BASIC_AUTH="$2"; shift 2 ;;
    --yes)        NONINTERACTIVE=1; shift ;;
    -h|--help)    usage ;;
    *) die "Неизвестный аргумент: $1 (см. --help)" ;;
  esac
done

banner

# ── 1. права и ОС ────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Запусти через sudo: sudo bash install.sh"
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl git; }

# ── 2. Docker ────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  info "Устанавливаю Docker (get.docker.com)…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  info "Docker уже установлен: $(docker --version)"
fi
docker compose version >/dev/null 2>&1 || die "Плагин Docker Compose не найден"

# ── 3. код проекта ───────────────────────────────────────────────
if [[ -z "$APP_DIR" ]]; then
  if [[ -f "./docker-compose.yml" && -f "./server/index.js" ]]; then
    APP_DIR="$PWD"                       # запущено внутри уже склонированного репо
  else
    APP_DIR="/opt/sportchat"
  fi
fi
if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
  info "Код: $APP_DIR"
else
  info "Клонирую репозиторий в $APP_DIR…"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 4. .env ──────────────────────────────────────────────────────
if [[ -f .env ]]; then
  info ".env существует — не перезаписываю (ключи сохранены)"
  # домен можно обновить флагом
  if [[ -n "$DOMAIN" ]]; then
    sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
  fi
else
  if [[ -z "$TOKEN" ]] && [[ $NONINTERACTIVE -eq 1 ]]; then
    die "Неинтерактивный режим требует --token"
  fi
  if [[ -z "$TOKEN" ]]; then
    printf "${C_B}Вставь ключ модели${C_0} (OpenRouter, формат sk-or-v1-…): "
    read -r TOKEN
  fi
  [[ -n "$TOKEN" ]] || die "Ключ обязателен — получить на openrouter.ai/keys"
  if [[ $NONINTERACTIVE -eq 0 && -z "$DOMAIN" ]]; then
    printf "${C_B}Домен для HTTPS${C_0} (например chat.example.com, Enter — без домена): "
    read -r DOMAIN
  fi
  cat > .env <<EOF
ANTHROPIC_BASE_URL=$BASE_URL
ANTHROPIC_AUTH_TOKEN=$TOKEN
PORT=$PORT
BIND_IP=$BIND_IP
DOMAIN=$DOMAIN
EOF
  chmod 600 .env
  info ".env создан (права 600)"
fi
# значения из .env по умолчанию, если флаги не заданы
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || echo "$PORT")"
BIND_IP="$(grep -E '^BIND_IP=' .env | cut -d= -f2 || echo "$BIND_IP")"
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2 || true)"

# ── 5. права на томы ─────────────────────────────────────────────
mkdir -p data workspace
chown -R 1000:1000 data workspace 2>/dev/null || warn "Не удалось сменить владельца томов (не критично)"

# ── 6. сборка и запуск ───────────────────────────────────────────
info "Собираю образ (первый раз ~2–4 минуты)…"
docker compose build --quiet
info "Запускаю контейнер…"
docker compose up -d

# ── 7. проверка здоровья ─────────────────────────────────────────
info "Жду готовности приложения…"
ok=""
for _ in $(seq 1 45); do
  if curl -fs "http://127.0.0.1:${PORT}/api/meta" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [[ -z "$ok" ]]; then
  docker compose logs --tail 40
  die "Приложение не ответило — смотри логи выше"
fi
info "Приложение работает ✓"

# ── 8. опционально: HTTPS через Caddy ────────────────────────────
URL=""
if [[ -n "$DOMAIN" ]]; then
  info "Поднимаю Caddy с автоматическим HTTPS для ${DOMAIN}…"
  docker compose --profile proxy up -d
  server_ip="$(curl -fs ifconfig.me 2>/dev/null || echo '?')"
  domain_ip="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [[ "$domain_ip" != "$server_ip" ]]; then
    warn "DNS: $DOMAIN → ${domain_ip:-не найден}, а IP сервера: $server_ip"
    warn "Направь A-запись домена на этот сервер, иначе сертификат не выдастся"
  fi
  URL="https://${DOMAIN}"
else
  public_ip="$(curl -fs ifconfig.me 2>/dev/null || echo '<IP-сервера>')"
  if [[ "$BIND_IP" == "127.0.0.1" ]]; then
    URL="http://127.0.0.1:${PORT} (локально; снаружи — через SSH-туннель: ssh -L ${PORT}:127.0.0.1:${PORT} user@server)"
    warn "Порт привязан к localhost. Для прямого доступа поставь домен (запусти установщик с --domain) или поменяй BIND_IP=0.0.0.0 в .env"
  else
    URL="http://${public_ip}:${PORT}"
    warn "Приложение открыто в интернет напрямую — рекомендуется домен с HTTPS"
  fi
fi

# ── итог ─────────────────────────────────────────────────────────
printf "\n${C_G}══════════════════════════════════════════════${C_0}\n"
printf "${C_G} ✓ SportChat развёрнут${C_0}\n\n"
printf "  Адрес:      ${C_B}${URL}${C_0}\n"
printf "  Конфиг:     %s/.env\n" "$APP_DIR"
printf "  Логи:       cd %s && docker compose logs -f\n" "$APP_DIR"
printf "  Обновление: bash update.sh\n"
printf "  Перезапуск: cd %s && docker compose restart\n" "$APP_DIR"
printf "\n${C_G}══════════════════════════════════════════════${C_0}\n"
