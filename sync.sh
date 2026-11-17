#!/bin/bash
# sync.sh — АТОМАРНАЯ синхронизация main.ts из GitHub
# ------------------------------------------------------------------
# Отличия от старой версии:
#   1. Качает в УНИКАЛЬНЫЙ временный файл (PID в имени) — копии не дерутся.
#   2. flock — второй запущенный sync.sh просто выходит, а не мешает первому.
#   3. Проверяет размер с Content-Length сервера → обрубок не пройдёт.
#   4. Проверяет начало (Deno.serve) И конец (});) файла.
#   5. Только после всех проверок подменяет main.ts. Битый файл — main.ts не трогаем.
# ------------------------------------------------------------------

REPO="alexey17001700-coder/digital-agency"
URL="https://raw.githubusercontent.com/${REPO}/main/main.ts"

DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$DIR/main.ts"
BACKUP="$DIR/main.ts.bak"
LOCK="$DIR/sync.lock"

# --- защита от нескольких одновременных копий скрипта ---
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(date): другой sync.sh уже работает — выхожу"
  exit 0
fi

echo "$(date): sync.sh запущен (PID $$), следим за $TARGET"

while true; do
  TMP="$DIR/.tmp_main_$$.ts"

  # размер файла на сервере (Content-Length)
  REMOTE_SIZE=$(curl -fsSLI "$URL" 2>/dev/null \
    | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r' | tail -1)

  # качаем: -f падать на 404/500, ретраи на обрывах
  if curl -fsSL --retry 3 --retry-delay 2 -o "$TMP" "$URL"; then
    SIZE=$(wc -c < "$TMP" 2>/dev/null || echo 0)
    OK=1

    [ "$SIZE" -gt 5000 ]                       || OK=0   # не пустышка
    [ -z "$REMOTE_SIZE" ] || [ "$SIZE" = "$REMOTE_SIZE" ] || OK=0   # размер совпал с сервером
    grep -q "Deno.serve" "$TMP"                || OK=0   # начало сервера на месте
    tail -5 "$TMP" | grep -q "});"             || OK=0   # файл корректно закрыт

    if [ "$OK" = "1" ]; then
      HASH_OLD=$(sha256sum "$TARGET" 2>/dev/null | awk '{print $1}')
      HASH_NEW=$(sha256sum "$TMP" | awk '{print $1}')
      if [ "$HASH_OLD" != "$HASH_NEW" ]; then
        cp "$TARGET" "$BACKUP"
        mv "$TMP" "$TARGET"          # атомарная подмена в пределах одной ФС
        echo "$(date): File updated from GitHub! ($SIZE bytes)"
      else
        echo "$(date): уже актуально ($SIZE bytes)"
      fi
    else
      echo "$(date): файл битый — main.ts НЕ трогаю ($SIZE из $REMOTE_SIZE bytes)"
    fi
  else
    echo "$(date): Download failed. Skipping."
  fi

  rm -f "$TMP"
  sleep 10
done
