#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  server_dump.sh — снимок состояния сервера (Vivo Y17)
#  Пишет отчёт в память телефона: $HOME/server_dump.txt
#  Ключи маскируются — в открытый репозиторий секреты не попадут.
#  Запуск:  bash ~/digital-agency/server_dump.sh
# ============================================================

OUT="$HOME/server_dump.txt"
SHTAB="$HOME/digital-agency"

{
echo "=================================================="
echo " СНИМОК СЕРВЕРА  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================="

echo; echo "=== 1. ЧТО ЗАПУЩЕНО ==="
ps aux 2>/dev/null | grep -E "deno|caddy|node|watchdog|sync" | grep -v grep

echo; echo "=== 2. КТО СЛУШАЕТ ПОРТЫ ==="
(netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null || echo "нет netstat/ss")

echo; echo "=== 3. АВТОЗАПУСК TERMUX:BOOT ==="
ls -la "$HOME/.termux/boot/" 2>/dev/null || echo "папки ~/.termux/boot нет"
for f in "$HOME"/.termux/boot/*.sh; do
  [ -f "$f" ] && { echo "--- $f ---"; cat "$f"; }
done 2>/dev/null

echo; echo "=== 4. CADDYFILE ==="
for f in "$HOME/Caddyfile" /etc/caddy/Caddyfile /root/Caddyfile "$HOME/digital-agency/Caddyfile"; do
  [ -f "$f" ] && { echo "--- найден: $f ---"; cat "$f"; }
done 2>/dev/null
echo "(если пусто — Caddyfile не найден в стандартных местах)"

echo; echo "=== 5. START_ALL ==="
for f in /root/start_all.sh "$HOME/start_all.sh" "$HOME/digital-agency/start_all.sh"; do
  [ -f "$f" ] && { echo "--- найден: $f ---"; cat "$f"; }
done 2>/dev/null

echo; echo "=== 6. ПАПКА ШТАБА ==="
ls -la "$SHTAB" 2>/dev/null || echo "папка $SHTAB не найдена"

echo; echo "=== 7. ШЛЮЗ И КЛЮЧИ (значения скрыты) ==="
ls -la "$SHTAB/gateway/" 2>/dev/null || echo "папки gateway нет"
sed 's/=.*/=***/' "$SHTAB/gateway/.env" 2>/dev/null || echo ".env не найден"

echo; echo "=== 8. ПАПКА ЧАТА ==="
ls -la "$SHTAB/chat/" 2>/dev/null || echo "папки chat нет"

echo; echo "=== 9. ПРОВЕРКА СЛУЖБ ==="
for p in 8000 8001 8002 8443; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "http://localhost:$p/" 2>/dev/null)
  echo "порт $p → ${code:-нет ответа}"
done
echo "шлюз ИИ:  $(curl -s --max-time 4 http://localhost:8002/ai/health 2>/dev/null | head -c 300)"
echo "чат:      $(curl -s --max-time 4 http://localhost:8001/stats 2>/dev/null | head -c 300)"

echo; echo "=== 10. ЛОГИ (хвост) ==="
for l in "$SHTAB/watchdog.log" /root/shtab.log /root/chat.log /root/caddy.log /root/ai.log /root/sync.log; do
  [ -f "$l" ] && { echo "--- $l ---"; tail -n 15 "$l"; }
done 2>/dev/null

echo; echo "=================================================="
echo " КОНЕЦ СНИМКА"
echo "=================================================="
} > "$OUT" 2>&1

echo "✅ ГОТОВО: $OUT"
echo "Размер: $(wc -l < "$OUT") строк"
echo
echo "Показать на экране:   cat $OUT"
echo "Скопировать в буфер:  cat $OUT | termux-clipboard-set"
