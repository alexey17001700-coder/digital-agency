#!/bin/bash
# ============================================
#  ЗАПУСК ШТАБА (Deno, порт 8000) — С ОЗВУЧКОЙ
# ============================================
#  Флаги, без которых озвучка НЕ работает:
#    --allow-run    → запуск edge-tts (нейро-синтез речи)
#    --allow-write  → временный mp3-файл для озвучки
#
#  Симптом без этих флагов:
#    "edge-tts не установлен: Requires run access to 'edge-tts'"
#    → озвучка молча падает в системный голос телефона.
#
#  Установка edge-tts: Ubuntu 24+ / Debian 12+ (python 3.12+) блокируют
#  pip в системный Python (PEP 668, "externally-managed-environment").
#  Поэтому ставим с флагом --break-system-packages. Скрипт делает это сам.
# ============================================

cd "$(dirname "$0")" || exit 1

# ~/.local/bin — сюда pip ставит скрипты при --user / pipx
export PATH="$HOME/.local/bin:$PATH"

install_edge_tts() {
  echo "📦 Ставлю edge-tts (нейро-голоса Microsoft)..."
  if command -v pipx >/dev/null 2>&1; then
    pipx install edge-tts && return 0
  fi
  if command -v pip3 >/dev/null 2>&1; then
    pip3 install --break-system-packages --user edge-tts && return 0
    pip3 install --break-system-packages edge-tts && return 0
  fi
  if command -v pip >/dev/null 2>&1; then
    pip install --break-system-packages --user edge-tts && return 0
    pip install --break-system-packages edge-tts && return 0
  fi
  return 1
}

if ! command -v edge-tts >/dev/null 2>&1 && ! python3 -c "import edge_tts" >/dev/null 2>&1; then
  echo "⚠  edge-tts НЕ найден — серверная озвучка не заработает."
  install_edge_tts || {
    echo "❌ Автоустановка не удалась. Поставь вручную:"
    echo "   pip install --break-system-packages edge-tts"
    echo "   (или: pipx install edge-tts)"
  }
  export PATH="$HOME/.local/bin:$PATH"
fi

if command -v edge-tts >/dev/null 2>&1; then
  echo "✅ edge-tts: $(command -v edge-tts)"
elif python3 -c "import edge_tts" >/dev/null 2>&1; then
  echo "✅ edge-tts: python-модуль (python3 -m edge_tts)"
else
  echo "⚠  edge-tts всё ещё не найден — озвучка уйдёт в голос телефона."
fi

# ============================================
#  ИИ-ШЛЮЗ ПОМОЩНИКА (ai.ts, порт 8002)
# ============================================
#  Без него Помощник молчит: сообщение уходит, ответа нет.
#  Поднимаем в фоне и следим — упал, значит поднимаем снова.
AI_TS=""
for p in "$PWD/gateway/ai.ts" "$PWD/../nexus_ws/ai.ts" "$HOME/nexus_ws/ai.ts"; do
  if [ -f "$p" ]; then AI_TS="$p"; break; fi
done

start_gateway() {
  if [ -z "$AI_TS" ]; then
    echo "⚠  ai.ts не найден — Помощник будет молчать (ждём sync.sh)"
    return
  fi
  # ключи моделей: .env рядом со шлюзом
  if [ -f "$(dirname "$AI_TS")/.env" ]; then
    set -a; . "$(dirname "$AI_TS")/.env"; set +a
  fi
  echo "🤖 ИИ-шлюз: $AI_TS (порт ${AI_PORT:-8002})"
  while true; do
    deno run --allow-net --allow-env --allow-read "$AI_TS"
    echo "$(date): ИИ-шлюз упал — перезапуск через 5 с"
    sleep 5
  done
}

start_gateway &

echo "🏢 Штаб запускается на порту 8000 (озвучка включена)..."
exec deno run --allow-net --allow-env --allow-read --allow-run --allow-write --watch main.ts
