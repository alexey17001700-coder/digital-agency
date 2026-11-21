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

## 10. GIGACHAT (СБЕР) — ПОМОЩНИК

Второй ИИ-помощник рядом с ZVENO. Работает через Сбер, ключ — физлицо (`PERS`).

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

**Ограничение:** GigaChat не понимает OpenAI-формат `tools` — инструменты (файлы, GitHub, погода) ему недоступны. Это чисто текстовый помощник.

**Проверить, что помощник жив:**
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

=== КОНЕЦ ИНСТРУКЦИИ ===
