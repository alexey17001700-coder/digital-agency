#!/bin/bash
# sync.sh — ПОЛНАЯ синхронизация Штаба из GitHub (фронтенд + сервер)
# ------------------------------------------------------------------
# ПОЧЕМУ ПЕРЕПИСАН:
#   Раньше этот скрипт тянул ТОЛЬКО main.ts. Из-за этого на телефоне
#   навсегда залипали index.html, app.html, chat.js и остальной фронтенд:
#   Caddy отдавал старые файлы с диска, и кнопка «Откатить Штаб» снова
#   показывала «Бэкап и откат доступны только с ключом Администратора»
#   (старый index.html + старый main.ts с замком). Ошибка вылезала на
#   ЛЮБОМ телефоне — потому что файлы берутся с сервера, а не из кэша.
#
# Теперь: качаем ВЕСЬ список файлов Штаба, каждый — атомарно и с проверкой.
#   • уникальный временный файл (PID) — копии не дерутся
#   • flock — второй sync.sh просто выходит
#   • сверка размера с Content-Length сервера → обрубок не пройдёт
#   • main.ts дополнительно проверяется на "Deno.serve" и закрывающий "});"
#   • подмена только после всех проверок; битый файл — старый не трогаем
# ------------------------------------------------------------------

REPO="alexey17001700-coder/digital-agency"
BASE="https://raw.githubusercontent.com/${REPO}/main"

DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK="$DIR/sync.lock"

# Весь фронтенд Штаба + сервер. Порядок не важен.
FILES=(
  main.ts
  index.html
  app.html
  chat.js
  ui.js
  network.js
  voice.js
  agents.js
  safe.js
  style.css
  version.json
  manifest.json
  sw.js
  watchdog.js
  watchdog_app.html
  office.js
  office3d.js
  autopilot.js
  local_ai.js
  three.module.js
  backup.html
  probe_test.html
)

# --- защита от нескольких одновременных копий скрипта ---
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date): другой sync.sh уже работает — выхожу"
  exit 0
fi

echo "$(date): sync.sh запущен (PID $$), следим за ${#FILES[@]} файлами в $DIR"

sync_one() {
  local NAME="$1"
  local URL="$BASE/$NAME"
  local TARGET="$DIR/$NAME"
  local TMP="$DIR/.tmp_${NAME}.$$"

  # размер файла на сервере (Content-Length)
  local REMOTE_SIZE
  REMOTE_SIZE=$(curl -fsSLI "$URL" 2>/dev/null \
    | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r' | tail -1)

  if ! curl -fsSL --retry 3 --retry-delay 2 -o "$TMP" "$URL"; then
    rm -f "$TMP"
    return 1
  fi

  local SIZE OK=1
  SIZE=$(wc -c < "$TMP" 2>/dev/null || echo 0)
  [ "$SIZE" -gt 0 ] || OK=0
  [ -z "$REMOTE_SIZE" ] || [ "$SIZE" = "$REMOTE_SIZE" ] || OK=0

  # серверный код проверяем строже — иначе Штаб не поднимется
  if [ "$NAME" = "main.ts" ]; then
    [ "$SIZE" -gt 5000 ]              || OK=0
    grep -q "Deno.serve" "$TMP"       || OK=0
    tail -5 "$TMP" | grep -q "});"    || OK=0
  fi

  if [ "$OK" != "1" ]; then
    echo "$(date): $NAME битый — НЕ трогаю ($SIZE из $REMOTE_SIZE bytes)"
    rm -f "$TMP"
    return 1
  fi

  local HASH_OLD HASH_NEW
  HASH_OLD=$(sha256sum "$TARGET" 2>/dev/null | awk '{print $1}')
  HASH_NEW=$(sha256sum "$TMP" | awk '{print $1}')

  if [ "$HASH_OLD" != "$HASH_NEW" ]; then
    [ -f "$TARGET" ] && cp "$TARGET" "$TARGET.bak"
    mv "$TMP" "$TARGET"            # атомарная подмена в пределах одной ФС
    echo "$(date): $NAME обновлён из GitHub ($SIZE bytes)"
  else
    rm -f "$TMP"
  fi
  return 0
}

while true; do
  for F in "${FILES[@]}"; do
    sync_one "$F"
  done
  sleep 10
done
