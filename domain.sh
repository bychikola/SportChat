#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  SportChat — подключение/смена домена с автоматическим HTTPS
#
#  Использование (на сервере, в папке проекта):
#    sudo bash domain.sh chat.example.com
#    sudo bash domain.sh               # спросит домен
#
#  Что делает:
#    1. Записывает DOMAIN в .env
#    2. Проверяет A-запись домена → IP сервера
#    3. Поднимает Caddy (профиль proxy) с Let's Encrypt
#    4. Ждёт выдачи сертификата и проверяет https://домен
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
info() { printf "${C_G}▸${C_0} %s\n" "$*"; }
warn() { printf "${C_Y}!${C_0} %s\n" "$*"; }
die()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; exit 1; }

[[ -f docker-compose.yml ]] || die "Запусти из папки проекта SportChat"
[[ $EUID -eq 0 ]] || die "Запусти через sudo"

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  printf "${C_B}Домен${C_0} (например chat.example.com): "
  read -r DOMAIN
fi
DOMAIN="$(echo "$DOMAIN" | tr -d '[:space:]' | sed 's|^https\?://||; s|/.*$||')"
[[ -n "$DOMAIN" ]] || die "Домен не указан"

# 1. .env
if [[ -f .env ]] && grep -q '^DOMAIN=' .env; then
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
else
  echo "DOMAIN=$DOMAIN" >> .env
fi
info "DOMAIN=$DOMAIN записан в .env"

# 2. DNS
server_ip="$(curl -fs ifconfig.me 2>/dev/null || echo '?')"
domain_ip="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
if [[ "$domain_ip" == "$server_ip" && "$server_ip" != '?' ]]; then
  info "DNS: $DOMAIN → $domain_ip ✓"
else
  warn "DNS: $DOMAIN → ${domain_ip:-не резолвится}, а IP сервера: $server_ip"
  warn "Создай A-запись $DOMAIN → $server_ip у регистратора домена (нужно 1–15 минут)"
fi

# 3. порты для Caddy (если ufw активен)
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  info "Файрвол ufw: порты 80/443 открыты"
fi

# 4. поднять Caddy
info "Поднимаю Caddy…"
docker compose --profile proxy up -d

# 5. ждать сертификат
info "Жду сертификат Let's Encrypt (до ~90 секунд)…"
ok=""
for _ in $(seq 1 45); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" || "$code" == "302" || "$code" == "401" ]]; then
    ok=1
    break
  fi
  sleep 2
done

if [[ -n "$ok" ]]; then
  printf "\n${C_G}══════════════════════════════════════════════${C_0}\n"
  printf "${C_G} ✓ SportChat доступен по адресу${C_0}\n\n"
  printf "   ${C_B}https://%s${C_0}\n\n" "$DOMAIN"
  printf "${C_G}══════════════════════════════════════════════${C_0}\n"
else
  warn "Сертификат ещё не выдан — проверь A-запись домена и логи:"
  warn "  docker compose --profile proxy logs -f caddy"
  exit 1
fi
