#!/usr/bin/env bash
# Обновление SportChat до последней версии из репозитория
set -euo pipefail
C_G='\033[1;32m'; C_R='\033[1;31m'; C_0='\033[0m'
info() { printf "${C_G}▸${C_0} %s\n" "$*"; }
die()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; exit 1; }

[[ -f docker-compose.yml ]] || die "Запусти из папки проекта (или задай cd /opt/sportchat)"

info "Забираю изменения из репозитория…"
git pull --ff-only

info "Пересобираю образ…"
docker compose build --quiet

info "Перезапускаю…"
docker compose up -d

info "Проверяю готовность…"
for _ in $(seq 1 30); do
  curl -fs "http://127.0.0.1:$(grep -E '^PORT=' .env | cut -d= -f2)/api/meta" >/dev/null 2>&1 && { info "Готово ✓"; exit 0; }
  sleep 2
done
docker compose logs --tail 30
die "Не дождался ответа — смотри логи"
