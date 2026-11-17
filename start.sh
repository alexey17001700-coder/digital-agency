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
# ============================================

cd "$(dirname "$0")" || exit 1

if ! command -v edge-tts >/dev/null 2>&1; then
  echo "⚠  edge-tts НЕ найден — серверная озвучка не заработает."
  echo "   Установи:  pip install edge-tts"
  echo "   Проверь:   edge-tts --list-voices | head -3"
  echo ""
fi

echo "🏢 Штаб запускается на порту 8000 (озвучка включена)..."
exec deno run --allow-net --allow-env --allow-read --allow-run --allow-write --watch main.ts
