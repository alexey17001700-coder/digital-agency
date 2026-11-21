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
#  СТОРОЖ СЕРВЕРОВ (watchdog.sh)
# ============================================
#  Держит живыми ДВЕ службы:
#    :8001  chat/main.ts   — сервер чата (WebSocket)
#    :8002  gateway/ai.ts  — ИИ-шлюз Помощника
#
#  Почему отдельный сторож: сервер чата раньше никто не поднимал —
#  упал и лежал. Теперь сторож видит и «процесс умер», и «процесс жив,
#  но не отвечает» (3 провала подряд = завис), и «файл обновился».
#
#  Штаб (main.ts, :8000) сторож НЕ трогает — им управляет этот скрипт.
if [ -f "$PWD/watchdog.sh" ]; then
  chmod +x "$PWD/watchdog.sh" 2>/dev/null
  bash "$PWD/watchdog.sh" >/dev/null 2>&1 &
  echo "🐕 Сторож серверов запущен (чат :8001, ИИ-шлюз :8002)"
  echo "   Логи: watchdog.log · chat.log · ai.log"
else
  echo "⚠  watchdog.sh не найден — чат и шлюз придётся поднимать вручную"
fi

echo "🏢 Штаб запускается на порту 8000 (озвучка включена)..."
exec deno run --allow-net --allow-env --allow-read --allow-run --allow-write --watch main.ts
