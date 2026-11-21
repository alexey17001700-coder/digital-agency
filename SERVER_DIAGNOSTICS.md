# SERVER_DIAGNOSTICS.md — Архитектура и управление сервером VIVO

> Все секреты обозначены плейсхолдерами (`<...>`). Реальные значения ключей
> в этот файл НЕ пишутся — они живут только в `/root/.env` на сервере.

---

## 1. ОБЩАЯ ИНФОРМАЦИЯ

- **Среда:** Android → Termux → proot-distro Ubuntu (root).
- **Домен:** `shtab-boss.duckdns.org`
- **Реверс-прокси:** Caddy (SSL, порт 8443).
- Все пути — от `/root`.

---

## 2. КАРТА ФАЙЛОВ (все пути от /root)

| Путь | Назначение |
|---|---|
| `/root/main.ts` | Код сервера Штаба (порт 8000) |
| `/root/.env` | Секретные ключи (ZVENO, GITHUB, VAPID). **В Git не коммитится** |
| `/root/start_all.sh` | Фоновый запуск ВСЕХ сервисов одной командой |
| `/root/status.sh` | Проверка работоспособности портов |
| `/root/sync.sh` | Курьер: скачивает обновления из GitHub каждые 3 секунды |
| `/root/Caddyfile` | Конфиг Caddy |
| `/root/zveno.log` | Логи ZVENO: какая модель ответила, вызовы инструментов, fallback. **Отдельно от `shtab.log`** |
| `/root/nexus_ws/main.ts` | Код сервера Чата (порт 8001) |
| `/usr/local/bin/caddy` | Бинарник Caddy (запускается просто как `caddy`) |

---

## 3. УПРАВЛЕНИЕ (основные команды)

**Запустить всё в фоне** (Штаб, Чат, Caddy, Курьер):
```bash
bash /root/start_all.sh
```

**Проверить, что всё работает:**
```bash
bash /root/status.sh
```
Показывает зелёные галочки для портов **8000, 8001, 8443** и процесса `sync.sh`.

**Остановить всё:**
```bash
pkill -f caddy; pkill -f "deno run"; pkill -f sync.sh
```

---

## 4. СКРИПТ start_all.sh (логика работы)

- Очищает старые логи (`/root/shtab.log`, `chat.log`, `caddy.log`, `sync.log`).
- Загружает ключи из `/root/.env` в память (`source /root/.env`).
- Запускает **Штаб** с флагом `--watch` (авто-перезагрузка при обновлении кода).
- Запускает **Чат** с флагом `--watch`.
- Запускает **Caddy** (системный бинарник).
- Запускает **sync.sh**.
- Всё запускается через `setsid nohup`, чтобы работать в фоне при закрытии Termux.

---

## 5. БЕЗОПАСНОСТЬ

- В коде (`main.ts`) **НЕТ ключей**. Они читаются через `Deno.env.get("ИМЯ")`.
- Ключи хранятся **ТОЛЬКО** в `/root/.env`.
- **Ручной запуск Штаба:**
```bash
deno run --allow-net --allow-env --allow-read --allow-write --allow-run --watch --env-file=.env main.ts
```
- **Ручной запуск Чата:**
```bash
deno run --allow-net --allow-env --allow-read --allow-write --allow-run --watch main.ts
```

---

## 6. ПОРТЫ И МАРШРУТЫ

| Порт | Служба | Маршруты в Caddy |
|---|---|---|
| 8000 | Штаб | `handle /tts*`, `handle { ... }` |
| 8001 | Чат | `handle /ws*`, `handle /stats*` |
| 8443 | Caddy SSL | домен `shtab-boss.duckdns.org` |

---

## 7. СЕКРЕТЫ (плейсхолдеры, хранятся в /root/.env)

```
ZVENO_KEY=<ZVENO_KEY>
GITHUB_TOKEN=<GITHUB_TOKEN>
VAPID_PUBLIC=<VAPID_PUBLIC>
VAPID_PRIVATE=<VAPID_PRIVATE>
TELEGRAM_TOKEN=<TELEGRAM_TOKEN>
```

---

## 8. ТИПОВЫЕ СБОИ И ЛЕЧЕНИЕ

**Симптом:** «ничего не работает» — не пишутся файлы, не тянется `sync.sh`, отказ 401.
**Причина:** в `/root/.env` остался старый (отозванный) `GITHUB_TOKEN`.
**Лечение:**
1. Выпустить новый токен: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → права `repo`.
2. Вписать в `/root/.env` строку `GITHUB_TOKEN=` — **одну**, без кавычек и пробелов вокруг `=`.
3. Проверить: `grep GITHUB_TOKEN /root/.env`
4. Перезапустить: `pkill -f "deno run"; pkill -f sync.sh; bash /root/start_all.sh`
5. Проверить токен:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: token $(grep GITHUB_TOKEN /root/.env | cut -d= -f2 | tr -d '\" ')" https://api.github.com/user
```
`200` — токен рабочий. `401` — токен мёртвый, выпускать новый.

---

=== КОНЕЦ ИНСТРУКЦИИ ===
