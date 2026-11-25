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
GIGACHAT_KEY=<GIGACHAT_KEY>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
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

## 9. ЛОГИ (разделены по назначению)

| Файл | Что пишет |
|---|---|
| `/root/shtab.log` | Только старт Штаба и системные ошибки Deno |
| `/root/zveno.log` | **Всё про ZVENO:** `[REQ]` запрос, `[MODEL]` какая модель ответила, `[TOOL]` вызовы инструментов, `[FALLBACK]`/`[VISION-FALLBACK]` переключения моделей |
| `/root/chat.log` | Сервер Чата (порт 8001) |
| `/root/caddy.log` | Caddy |
| `/root/sync.log` | Курьер |

**Почему так:** раньше ответы и служебные строки ZVENO валились в `shtab.log` и забивали его.
Теперь они уходят в отдельный `/root/zveno.log` (функция `zlog()` в `main.ts`).

**Смотреть логи ZVENO в реальном времени:**
```bash
tail -f /root/zveno.log
```

**Последние 30 строк:**
```bash
tail -n 30 /root/zveno.log
```

**Проверить, какая модель отвечала (платная или бесплатная):**
```bash
grep "\[MODEL\]" /root/zveno.log | tail -n 20
```

**Ротация:** файл обнуляется автоматически при достижении 2 МБ.
Путь можно переопределить переменной окружения `ZVENO_LOG` в `/root/.env`.

---

## 10. GIGACHAT (СБЕР) — МОДЕЛЬ (не отдельный чат)

Выбор модели для того же Архитектора. Работает через Сбер, ключ — физлицо (`PERS`).
Отдельного «Помощника» и шлюза :8002 больше НЕТ — в Штабе один чат, один Архитектор.

**Переменные в `/root/.env`:**
```
GIGACHAT_KEY=<Авторизационные данные из кабинета developers.sber.ru>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
```
`GIGACHAT_KEY` — это **одна длинная строка** (base64 от `ClientID:ClientSecret`), не ID и не Secret по отдельности. `==` в конце — часть ключа, не удалять.

**Как работает (в `main.ts`):**
- `gigachatToken()` — меняет ключ на `access_token` (живёт 30 мин, обновляется автоматически).
- `callGigaChat()` — сам запрос. Перебирает модели: `GigaChat-2-Max` → `-Pro` → `-2` → `GigaChat-Pro` → `GigaChat`.
- **Сертификат Минцифры:** в системе его нет, поэтому создаётся TLS-клиент `Deno.createHttpClient({ unsafelyIgnoreCertificateErrors: [...] })` — проверка игнорируется **только** для доменов Сбера. Дополнительных флагов запуска НЕ требуется.

**Два режима вызова:**
1. **Явно** — клиент присылает `model: "gigachat"` (или `gigachat:GigaChat-2-Pro`) → запрос идёт напрямую в Сбер.
2. **Резерв** — если ВСЕ маршруты ZVENO упали, Штаб автоматически переключается на GigaChat (последний рубеж).

**Ограничение:** GigaChat не понимает OpenAI-формат `tools` — инструменты (файлы, GitHub, погода) ему недоступны. Это чисто текстовая модель.

**Проверить, что модель жива:**
```bash
curl -s -X POST http://127.0.0.1:8000 -H "Content-Type: application/json" \
  -d '{"gigachatTest":true}' | head -c 300
```
`{"success":true,"answer":"..."}` — работает. `{"success":false,"error":"GigaChat OAuth 401..."}` — ключ мёртвый или кончился лимит.

**Логи GigaChat** — в общем `/root/zveno.log`:
```bash
grep "GIGACHAT" /root/zveno.log | tail -n 20
```
Метки: `[GIGACHAT]` — успех, `[GIGACHAT-FALLBACK]` — переключение модели.

---

## 11. ДИАГНОСТИКА КНОПКИ GIGACHAT (проверка маршрута)

**Задача:** убедиться, что при включённой кнопке 🟣 GigaChat запрос реально уходит в Сбер,
а не в ZVENO (иначе ZVENO ест деньги, а кажется, что отвечает Сбер).

**Цепочка фронтенда (всё с GitHub Pages):**
`index.html` (оболочка, кэшируется) → iframe `app.html?v=timestamp` (всегда свежий) → `chat.js` + `ui.js`.

**Ключевые точки в коде:**
| Файл | Что отвечает за режим |
|---|---|
| `app.html` | кнопка `id="btnGigaChat"` → `onclick="toggleGigaChat()"` |
| `chat.js` | `toggleGigaChat()` ставит `modelToUse='gigachat'` последним перекрытием; бейдж `modelBadgeText('gigachat')` |
| `ui.js` | кнопка гаснет при выборе другой модели |
| `main.ts` | `/^gigachat/i.test(reqModel)` → `callGigaChat()`; автоперебора нет |

**ГЛАВНЫЙ ТЕСТ — по логу, а не по стилю ответа.** Обнулить лог, послать запрос, прочитать:

```bash
: > /root/zveno.log
curl -s -X POST http://localhost:8000/ -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Куку"}],"model":"gigachat"}' >/dev/null
sleep 2; cat /root/zveno.log
```

**Как читать лог:**

| Строка в логе | Кто ответил | Деньги |
|---|---|---|
| `[GIGACHAT] ответила модель: GigaChat-2-Max` | 🟣 Сбер | Сбер-ключ |
| `[MODEL] ответила: …` | 🔵 ZVENO | **ZVENO ест** |
| `[FALLBACK]` / `[FINAL]` | 🔵 ZVENO (перебор) | **ZVENO ест** |
| `[GIGACHAT] ZVENO упал…` | 🟣 Сбер как резерв | автоперебор жив |

**Правило:** при кнопке **ВКЛ** в логе не должно быть ни одной строки `[MODEL]` или `[FALLBACK]` —
только `[GIGACHAT]`. Появилась `[MODEL]` — запрос ушёл в ZVENO, кнопка не сработала.

**Живой монитор (держать в Termux и писать в Штаб):**
```bash
tail -f /root/zveno.log
```

**Важно про пути:** фронтенда (`app.html`, `chat.js`) на сервере НЕТ — он грузится с GitHub Pages.
`sync.sh` тянет ТОЛЬКО `/root/main.ts` (проверяет наличие `Deno.serve` и размер > 1000 байт).
Поэтому «кнопка не работает» на телефоне = либо старый `main.ts` на сервере, либо кэш оболочки `index.html`.

**Быстрая проверка, что на сервере свежий код:**
```bash
grep -c 'gigachat/i.test' /root/main.ts   # должно быть ≥ 1
grep -c GIGACHAT_KEY /root/.env           # должно быть 1
```

---

## 12. ПОЛНАЯ КАРТА СЕРВЕРА (факты, снятые с живой системы)

> Снято командами `ls -la /root`, `cat /root/Caddyfile`, `cat /root/sync.sh`.
> Это реальное состояние машины — точка отсчёта при ремонте.

### 12.1. Содержимое /root (что реально лежит)

| Файл / папка | Что это |
|---|---|
| `main.ts` (~58 КБ) | Сервер Штаба, порт 8000 |
| `main.ts.bak` | Предыдущая версия от `sync.sh` |
| `.env` (~822 Б) | Все ключи (ZVENO, GIGACHAT, GITHUB, VAPID, TELEGRAM) |
| `.nexus_env`, `.nexus_ws_env` | Отдельные env для Чата |
| `Caddyfile`, `Caddyfile.bak2` | Конфиг Caddy + бэкап |
| `nexus_ws/` | Сервер Чата, порт 8001 |
| — | Шлюза «Помощника» (:8002) на сервере **никогда не было**. `ai.js` — фронтенд-файл, жил только на GitHub Pages. В Штабе один чат — Архитектор |
| `ssl/` | `cert.pem` + `key.pem` для Caddy |
| `start_all.sh`, `start.sh`, `status.sh`, `sync.sh` | Скрипты запуска/статуса/курьера |
| `shtab.log`, `chat.log`, `caddy.log`, `sync.log`, `zveno.log` | Логи по службам |
| `server_info.txt`, `dump.txt` | Слепки состояния |
| `root_ca.pem`, `sber_ca.pem` | Сертификаты (Минцифры / Сбер) |
| `cloudflared-linux-arm64` | Бинарник Cloudflare Tunnel (резервный доступ) |
| `.acme.sh`, `.deno`, `.ssh`, `.cache`, `.config` | Служебные папки |

**КРИТИЧНО:** файлов `app.html`, `chat.js`, `ui.js`, `index.html` на сервере НЕТ.
Фронтенд живёт только на GitHub Pages. На сервере — только `main.ts` и `nexus_ws/main.ts`.

### 12.2. Caddyfile (дословно)

```
{
    https_port 8443
    auto_https disable_redirects
}
shtab-boss.duckdns.org {
    tls /root/ssl/cert.pem /root/ssl/key.pem
    handle /ws*    { reverse_proxy localhost:8001 }
    handle /stats* { reverse_proxy localhost:8001 }
    handle /tts*   { reverse_proxy localhost:8000 }
    handle         { reverse_proxy localhost:8000 }
}
```
- SSL-порт **8443**, редирект с HTTP отключён.
- `/ws*` и `/stats*` → Чат (8001). Всё остальное + `/tts*` → Штаб (8000).

### 12.3. sync.sh (дословно, логика)

```bash
URL="https://raw.githubusercontent.com/alexey17001700-coder/digital-agency/main/main.ts"
DIR="/root"; TMP="$DIR/.main.ts.part"; DST="$DIR/main.ts"
while true; do
  if curl -fsSL -m 10 --connect-timeout 5 -o "$TMP" "$URL"; then
    SIZE=$(stat -c%s "$TMP" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt 1000 ] && grep -q "Deno.serve" "$TMP"; then
      H_OLD=$(sha256sum "$DST" | awk '{print $1}'); H_NEW=$(sha256sum "$TMP" | awk '{print $1}')
      if [ "$H_OLD" != "$H_NEW" ]; then cp "$DST" "$DST.bak"; mv "$TMP" "$DST"; echo "$(date +%T): OK"; fi
    fi
  fi
  rm -f "$TMP"
  sleep 3
done
```
- Тянет **только `main.ts`** каждые 3 сек, таймаут 10 сек.
- Защита: размер > 1000 байт **и** наличие `Deno.serve`. Иначе файл не подменяется.
- При изменении — старый уходит в `main.ts.bak`, новый встаёт на место.
- **Фронтенд НЕ синхронизируется** — он и так с GitHub Pages.

### 12.4. Алгоритм ремонта «сервер молчит»

1. `bash /root/status.sh` — смотреть порты 8000 / 8001 / 8443 и процесс `sync.sh`.
2. `tail -n 40 /root/shtab.log` — ошибки Deno.
3. `tail -n 40 /root/zveno.log` — что с ИИ-маршрутами.
4. `tail -n 20 /root/sync.log` — тянется ли `main.ts` из GitHub.
5. Проверить ключи: `grep -c GIGACHAT_KEY /root/.env`, `grep -c ZVENO_KEY /root/.env`.
6. Проверить токен GitHub (раздел 8).
7. Перезапуск: `pkill -f "deno run"; pkill -f sync.sh; pkill -f caddy; bash /root/start_all.sh`.
8. Проверить, что сервер отвечает:
```bash
curl -s -X POST http://localhost:8000/ -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"тест"}],"model":"gigachat"}' | head -c 300
```

### 12.5. Быстрые проверки одной строкой

```bash
# свежесть кода на сервере
ls -l --time-style=+%H:%M /root/main.ts; grep -c 'gigachat/i.test' /root/main.ts
# ключи на месте
grep -c GIGACHAT_KEY /root/.env; grep -c ZVENO_KEY /root/.env
# порты живы
ss -ltnp 2>/dev/null | grep -E '8000|8001|8443'
# процессы
ps aux | grep -E 'deno|caddy|sync.sh' | grep -v grep
```

---

## 13. ЖЕЛЕЗНОЕ ПРАВИЛО АРХИТЕКТОРА (приказ Босса)

**Сначала смотри файл — потом отвечай. Никогда не гадай.**

- Прежде чем что-то утверждать о коде, файле или репозитории — **прочитай его** (`read_file`, `list_repo_files`).
- Не выдумывать баги, строки и содержимое по памяти. Нет данных — сначала запрос инструмента.
- Ошибся — признать прямо и исправить, без оправданий.
- Правило действует всегда, для любого файла и любого репозитория.

---

=== КОНЕЦ ИНСТРУКЦИИ ===
