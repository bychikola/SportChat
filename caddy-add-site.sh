#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  SportChat — домен через ТВОЙ существующий Caddy (свой сайт не трогаем)
#
#  Подходит, когда порты 80/443 уже заняты другим сайтом на Caddy
#  (systemd-служба или Docker-контейнер). Скрипт:
#    1. находит Caddy и его Caddyfile (с бэкапом)
#    2. добавляет сайт спортчат.рф → reverse_proxy 127.0.0.1:3777
#       (WebSocket и стриминг работают из коробки, flush_interval -1)
#    3. валидирует конфиг и перезагружает Caddy
#    4. ждёт сертификат и проверяет https://домен
#
#  Использование: sudo bash caddy-add-site.sh спортчат.рф
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

# IDN (кириллица) → punycode
if [[ "$DOMAIN" =~ [^A-Za-z0-9.-] ]]; then
  PUNY="$(python3 -c 'import sys; print(sys.argv[1].encode("idna").decode())' "$DOMAIN" 2>/dev/null || true)"
  [[ -n "$PUNY" ]] || die "Нужен python3: sudo apt install python3"
  info "IDN: $DOMAIN → $PUNY"
  DOMAIN="$PUNY"
fi
if ! grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' <<<"$DOMAIN"; then
  die "Некорректный домен: «$DOMAIN»"
fi

# ── где живёт Caddy ──
MODE=""
CTN=""
if command -v caddy >/dev/null 2>&1 && systemctl is-active --quiet caddy 2>/dev/null; then
  MODE=host
  CFG=/etc/caddy/Caddyfile
else
  CTN="$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null | awk -F'\t' '$2 ~ /caddy/ {print $1; exit}' || true)"
  if [[ -n "$CTN" ]]; then
    MODE=docker
    CFG="$(docker inspect "$CTN" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)"
    [[ -n "$CFG" && -f "$CFG" ]] || die "Caddy в контейнере «$CTN», но Caddyfile не найден (ищи в docker inspect $CTN)"
  fi
fi
[[ -n "$MODE" ]] || die "Caddy не найден ни в системе (systemd), ни в Docker"

# ── куда проксировать ──
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3777)"
if [[ "$MODE" == "host" ]]; then
  UP="127.0.0.1:${PORT}"
  curl -fs "http://127.0.0.1:${PORT}/api/meta" >/dev/null 2>&1 || die "SportChat не отвечает на 127.0.0.1:${PORT} — запусти docker compose up -d"
else
  # из контейнера caddy до хоста: шлюз docker0 (или host.docker.internal)
  GW="$(ip -4 addr show docker0 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1 || true)"
  UP="${GW:-host.docker.internal}:${PORT}"
  warn "Caddy в Docker: проксирую на $UP (шлюз docker0). Если не заработает — поправь в Caddyfile вручную"
fi

# ── Caddyfile: бэкап + добавление сайта (идемпотентно) ──
BAK="$CFG.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$CFG" "$BAK"
info "Бэкап Caddyfile: $BAK"

if grep -q "$DOMAIN" "$CFG"; then
  info "Домен $DOMAIN уже есть в Caddyfile — просто перезагружаю"
else
  cat >> "$CFG" <<EOF

# SportChat — добавлено caddy-add-site.sh ($(date +%F))
$DOMAIN {
	encode gzip
	reverse_proxy $UP {
		flush_interval -1
	}
}
EOF
  info "Сайт $DOMAIN добавлен (→ $UP)"
fi

# ── валидация и reload ──
if [[ "$MODE" == "host" ]]; then
  caddy validate --config "$CFG" --adapter caddyfile >/dev/null
  systemctl reload caddy
  info "Caddy перезагружен (systemd)"
else
  docker cp "$CFG" "$CTN:/etc/caddy/Caddyfile"
  docker exec "$CTN" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  docker exec "$CTN" caddy reload --config /etc/caddy/Caddyfile
  info "Caddy перезагружен (контейнер $CTN)"
fi

# ── ждём сертификат ──
info "Жду сертификат Let's Encrypt… (проверь A-запись $DOMAIN → IP сервера)"
ok=""
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" || "$code" == "302" || "$code" == "401" ]]; then
    ok=1
    break
  fi
  sleep 2
done

if [[ -n "$ok" ]]; then
  printf "\n${C_G}══════════════════════════════════════════════${C_0}\n"
  printf "${C_G} ✓ SportChat: https://%s${C_0}\n" "$DOMAIN"
  printf "   (твой прежний сайт на Caddy не тронут)\n"
  printf "${C_G}══════════════════════════════════════════════${C_0}\n"
else
  warn "Сертификат ещё не выдан. Проверь:"
  warn "  A-запись $DOMAIN → IP сервера у регистратора"
  warn "  логи Caddy: journalctl -u caddy -f (или docker logs $CTN -f)"
  exit 1
fi
