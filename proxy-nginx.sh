#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  SportChat — домен через СУЩЕСТВУЮЩИЙ веб-сервер (nginx/apache)
#
#  Для серверов, где порты 80/443 уже заняты другим сайтом.
#  Спортчат.рф добавляется как отдельный виртуальный хост и
#  проксируется на SportChat (порт 3777), с поддержкой WebSocket.
#  HTTPS выдаётся через certbot (Let's Encrypt).
#
#  Использование (на сервере, в папке проекта):
#    sudo bash proxy-nginx.sh спортчат.рф
#    sudo bash proxy-nginx.sh chat.example.com
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
info() { printf "${C_G}▸${C_0} %s\n" "$*"; }
warn() { printf "${C_Y}!${C_0} %s\n" "$*"; }
die()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запусти через sudo"

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  printf "${C_B}Домен${C_0} (например спортчат.рф): "
  read -r DOMAIN
fi
DOMAIN="$(echo "$DOMAIN" | tr -d '[:space:]' | sed 's|^https\?://||; s|/.*$||')"

# IDN → punycode
if [[ "$DOMAIN" =~ [^A-Za-z0-9.-] ]]; then
  PUNY="$(python3 -c 'import sys; print(sys.argv[1].encode("idna").decode())' "$DOMAIN" 2>/dev/null || true)"
  [[ -n "$PUNY" ]] || die "Нужен python3 для перевода кириллицы: sudo apt install python3"
  info "IDN: $DOMAIN → $PUNY"
  DOMAIN="$PUNY"
fi
if ! grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' <<<"$DOMAIN"; then
  die "Некорректный домен: «$DOMAIN»"
fi

# ── какой веб-сервер уже стоит ──
SERVER=""
systemctl is-active --quiet nginx 2>/dev/null && SERVER=nginx
systemctl is-active --quiet apache2 2>/dev/null && SERVER=apache
[[ -n "$SERVER" ]] || die "Не нашёл работающий nginx или apache2. Если их нет — используй domain.sh с Caddy."

# ── проверить, что SportChat доступен локально ──
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3777)"
curl -fs "http://127.0.0.1:${PORT}/api/meta" >/dev/null 2>&1 || die "SportChat не отвечает на 127.0.0.1:${PORT} — запусти docker compose up -d"

if [[ "$SERVER" == "nginx" ]]; then
  info "Веб-сервер: nginx"
  cat > /etc/nginx/sites-available/sportchat <<EOF
# SportChat — добавлено скриптом proxy-nginx.sh ($(date +%F))
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        # WebSocket-поддержка для стриминга ответов агента
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # долгие ответы Claude Code без таймаутов
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/sportchat /etc/nginx/sites-enabled/sportchat
  nginx -t && systemctl reload nginx
  info "Виртуальный хост добавлен (nginx)"
else
  info "Веб-сервер: apache2"
  a2enmod proxy proxy_http proxy_wstunnel rewrite >/dev/null 2>&1 || true
  cat > /etc/apache2/sites-available/sportchat.conf <<EOF
# SportChat — добавлено скриптом proxy-nginx.sh ($(date +%F))
<VirtualHost *:80>
    ServerName $DOMAIN

    ProxyPreserveHost On
    ProxyRequests Off

    # WebSocket для стриминга
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:${PORT}/\$1 [P,L]

    ProxyPass / http://127.0.0.1:${PORT}/
    ProxyPassReverse / http://127.0.0.1:${PORT}/
    ProxyTimeout 3600
</VirtualHost>
EOF
  a2ensite sportchat >/dev/null 2>&1 || true
  apache2ctl -t && systemctl reload apache2
  info "Виртуальный хост добавлен (apache2)"
fi

# ── HTTPS через certbot ──
info "Ставлю certbot (если нет)…"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -qq
  if [[ "$SERVER" == "nginx" ]]; then
    apt-get install -y -qq certbot python3-certbot-nginx
  else
    apt-get install -y -qq certbot python3-certbot-apache
  fi
fi

info "Выдаю сертификат Let's Encrypt… (нужна A-запись $DOMAIN → IP сервера)"
if [[ "$SERVER" == "nginx" ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || warn "certbot не смог выдать сертификат — проверь A-запись и попробуй: certbot --nginx -d $DOMAIN"
else
  certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || warn "certbot не смог выдать сертификат — проверь A-запись и попробуй: certbot --apache -d $DOMAIN"
fi

printf "\n${C_G}══════════════════════════════════════════════${C_0}\n"
printf "${C_G} ✓ SportChat: https://%s${C_0}\n" "$DOMAIN"
printf "   (твой прежний сайт на 80/443 не тронут)\n"
printf "${C_G}══════════════════════════════════════════════${C_0}\n"
