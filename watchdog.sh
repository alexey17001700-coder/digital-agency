#!/bin/bash
# ============================================================
#  watchdog.sh — СТОРОЖ СЕРВЕРОВ NEXUS
# ============================================================
#  Держит живыми две службы:
#    :8001  chat/main.ts   — сервер чата (WebSocket relay)
#    :8002  gateway/ai.ts  — ИИ-шлюз Помощника
#
#  Что делает:
#    1. Процесс умер        → поднимает заново.
#    2. Процесс жив, но не отвечает на health → 3 провала подряд → перезапуск.
#    3. Файл обновился (sync.sh скачал новую версию) → перезапуск на новом коде.
#
#  Штаб (main.ts, порт 8000) НЕ ТРОГАЕТ — им управляет start.sh.
#  Запуск:  ./watchdog.sh          (в фоне: ./watchdog.sh >/dev/null 2>&1 &)
#  Логи:    watchdog.log, chat.log, ai.log
# ============================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
export PATH="$HOME/.local/bin:$PATH"

CHECK=15          # как часто проверяем здоровье (сек)
FAILS=3           # сколько провалов подряд = завис
LOG="$DIR/watchdog.log"

log() {
  echo "$(date '+%F %T'): $*" >> "$LOG"
  echo "$(date '+%H:%M:%S'): $*"
}

# лог не растёт бесконечно
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 300000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# --- поиск файлов служб (несколько возможных мест) ---
find_file() {
  for p in "$@"; do
    if [ -f "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}

locate_chat() { find_file "$DIR/chat/main.ts" "$DIR/../nexus_ws/main.ts" "$HOME/nexus_ws/main.ts"; }
locate_ai()   { find_file "$DIR/gateway/ai.ts" "$DIR/../nexus_ws/ai.ts" "$HOME/nexus_ws/ai.ts"; }

CHAT_TS="$(locate_chat)"
AI_TS="$(locate_ai)"

# ключи моделей: .env рядом со шлюзом
if [ -n "$AI_TS" ] && [ -f "$(dirname "$AI_TS")/.env" ]; then
  set -a; . "$(dirname "$AI_TS")/.env"; set +a
fi

CHAT_PORT="${PORT:-8001}"
AI_PORT="${AI_PORT:-8002}"

CHAT_PID="$DIR/.chat.pid"
AI_PID="$DIR/.ai.pid"
CHAT_HASH="$DIR/.chat.hash"
AI_HASH="$DIR/.ai.hash"

hash_of() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

# --- запуск служб ---
start_chat() {
  if [ -z "$CHAT_TS" ]; then
    CHAT_TS="$(locate_chat)"
    if [ -z "$CHAT_TS" ]; then
      log "чат: main.ts не найден — жду sync.sh"
      return 1
    fi
  fi
  log "чат: запуск $CHAT_TS (порт $CHAT_PORT)"
  PORT="$CHAT_PORT" deno run --allow-net --allow-env --allow-read --allow-write \
    "$CHAT_TS" >> "$DIR/chat.log" 2>&1 &
  echo $! > "$CHAT_PID"
  hash_of "$CHAT_TS" > "$CHAT_HASH"
  return 0
}

start_ai() {
  if [ -z "$AI_TS" ]; then
    AI_TS="$(locate_ai)"
    if [ -z "$AI_TS" ]; then
      log "шлюз: ai.ts не найден — жду sync.sh"
      return 1
    fi
  fi
  log "шлюз: запуск $AI_TS (порт $AI_PORT)"
  AI_PORT="$AI_PORT" deno run --allow-net --allow-env --allow-read \
    "$AI_TS" >> "$DIR/ai.log" 2>&1 &
  echo $! > "$AI_PID"
  hash_of "$AI_TS" > "$AI_HASH"
  return 0
}

# --- остановка службы (мягко, потом жёстко) ---
stop_pid() {
  local pid="$1"
  [ -z "$pid" ] && return
  kill "$pid" 2>/dev/null
  sleep 2
  kill -9 "$pid" 2>/dev/null
}

alive() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

healthy() {
  curl -fsS --max-time 6 "http://127.0.0.1:$1$2" >/dev/null 2>&1
}

echo "🐕 Сторож серверов запущен (PID $$)"
log "старт: чат=$CHAT_TS шлюз=$AI_TS"

start_chat
start_ai

chat_fails=0
ai_fails=0

while true; do
  sleep "$CHECK"

  # ================= ЧАТ :8001 =================
  cpid="$(cat "$CHAT_PID" 2>/dev/null)"
  if ! alive "$cpid"; then
    log "чат: процесс умер — поднимаю"
    start_chat
    chat_fails=0
  else
    # файл обновился → перезапуск на новом коде
    if [ -n "$CHAT_TS" ] && [ -f "$CHAT_TS" ]; then
      newh="$(hash_of "$CHAT_TS")"
      oldh="$(cat "$CHAT_HASH" 2>/dev/null)"
      if [ -n "$newh" ] && [ "$newh" != "$oldh" ]; then
        log "чат: код обновился — перезапуск"
        stop_pid "$cpid"
        start_chat
        chat_fails=0
        continue
      fi
    fi
    if healthy "$CHAT_PORT" "/stats"; then
      chat_fails=0
    else
      chat_fails=$((chat_fails + 1))
      log "чат: нет ответа ($chat_fails/$FAILS)"
      if [ "$chat_fails" -ge "$FAILS" ]; then
        log "чат: завис — перезапуск"
        stop_pid "$cpid"
        start_chat
        chat_fails=0
      fi
    fi
  fi

  # ================= ИИ-ШЛЮЗ :8002 =================
  apid="$(cat "$AI_PID" 2>/dev/null)"
  if ! alive "$apid"; then
    log "шлюз: процесс умер — поднимаю"
    start_ai
    ai_fails=0
  else
    if [ -n "$AI_TS" ] && [ -f "$AI_TS" ]; then
      newh="$(hash_of "$AI_TS")"
      oldh="$(cat "$AI_HASH" 2>/dev/null)"
      if [ -n "$newh" ] && [ "$newh" != "$oldh" ]; then
        log "шлюз: код обновился — перезапуск"
        stop_pid "$apid"
        start_ai
        ai_fails=0
        continue
      fi
    fi
    if healthy "$AI_PORT" "/ai/health"; then
      ai_fails=0
    else
      ai_fails=$((ai_fails + 1))
      log "шлюз: нет ответа ($ai_fails/$FAILS)"
      if [ "$ai_fails" -ge "$FAILS" ]; then
        log "шлюз: завис — перезапуск"
        stop_pid "$apid"
        start_ai
        ai_fails=0
      fi
    fi
  fi
done
