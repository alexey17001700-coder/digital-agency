# 🗺️ REPO_MAP — Полная карта аккаунта Босса

**Владелец:** https://github.com/alexey17001700-coder
**GITHUB_OWNER:** `alexey17001700-coder`
**Все репозитории проекта — здесь.**

> Файл-память. Архитектор читает тихо, Боссу не пересказывает.
> Обновлять при добавлении/удалении файлов.

---

## 1. digital-agency — ШТАБ (главный)
Файлы (47):
- `.nojekyll`
- `APP_WORKLOG.md` — журнал работ приложения
- `CHAT_ARCHITECTURE.md` — **память: как устроен наш чат (один диалог — Архитектор)**
- `GITHUB_APK_PLAN.md` — план сборки APK
- `LICENSE`
- `OWNER.md` — данные владельца
- `PROMPT_BOSS.md` — промт Босса
- `README.md` — описание проекта
- `REPO_MAP.md` — эта карта
- `SERVER_DIAGNOSTICS.md` — **память проекта** (ремонт, история правок)
- `STEP_QUEUE.md` — очередь шагов
- `SYSTEM_PROMPT.md` — системный промт Архитектора
- `TASKS_CLEANUP.md`
- `agents.js` — агенты
- `app.html` — главный интерфейс Штаба
- `autopilot.js` — автопилот
- `backup.html`
- `char1.png` `char2.png` `char3.png` `char4.png` — персонажи
- `chat.js` — чат
- `cooler.png` — кулер
- `index.html` — точка входа
- `local_ai.js` — локальный ИИ
- `main.ts` — **НЕ ТРОГАТЬ без приказа**
- `manifest.json` — PWA
- `network.js` — сеть
- `office.js` — офис
- `office3d.js` — офис 3D
- `pc.png` — компьютер
- `safe.js`
- `server_dump.sh` — дамп состояния сервера
- `shtab_version.json` — **счётчик правок ШТАБА** (читает оболочка index.html и плашка версии)
- `start.sh` — запуск
- `style.css` — стили
- `supervisor.js` — сторож ответов Архитектора
- `sw.js` — service worker
- `sync.sh` — синхронизация каждые 10 сек
- `three.module.js` — Three.js
- `ui.js` — интерфейс
- `version.json` — счётчик правок **Калькулятора окон (window_calc)**, НЕ Штаба (с Штабом не перемешивается)
- `voice.js` — голос
- `watchdog.js` — сторож
- `watchdog.sh` — сторож (shell)
- `watchdog_app.html`
- `zveno_balance.js` — баланс звена

## 2. nexus_chat — ЧАТ
- `CHAT_AI_GUIDE.md` — устройство чата (память)
- `README.md`
- `index.html`
- `manifest.json`
- `sw.js`

## 3. nexus_ws — СЕРВЕР ЧАТА (:8001)
- `README.md`
- `gen_keys.ts` — генерация ключей
- `main.ts` — сервер

## 4. ac_luxury_calc — КАЛЬКУЛЯТОР КОНДИЦИОНЕРОВ
- `README.md`
- `index.html`
- `manifest.json`
- `sw.js`

## 5. window_measure_pro — ЗАМЕР ОКОН
- `README.md`
- `index.html`
- `manifest.json`
- `sw.js`

## 6. nexus_snake — ЗМЕЙКА
- `README.md`
- `index.html`
- `manifest.json`
- `sw.js`

## 7. window_calc — КАЛЬКУЛЯТОР ОКОН (Flutter, ЗАЩИЩЁН)
- `CHANGELOG.md`
- `pubspec.yaml`
- `zz_probe.html`

## 8. Okna — ОКНА
- `.gitignore`
- `README.md`
- `pubspec.yaml`

## 9. shtab-site — САЙТ ШТАБА
- `LICENSE`

## 10. nexus_trader — ТРЕЙДЕР
- `README.md`
- `build-apk.yml` — сборка APK
- `pubspec.yaml`

## 11. trading_terminal — ТОРГОВЫЙ ТЕРМИНАЛ
- `README.md`
- `index.html`

## 12. nexus_trade — ТРЕЙД
- `README.md`
- `index.html`

## 13. trade_bot — ТОРГОВЫЙ БОТ
- `README.md`
- `build-apk.yml` — сборка APK
- `icon.svg`
- `index.html`
- `manifest.json`
- `sw.js`

## 14. trading_sim — СИМУЛЯТОР ТОРГОВЛИ
- `README.md`
- `index.html`

## 15. nexus_bot — БОТ
- `README.md`
- `index.html`

## 16. nexus_calc — КАЛЬКУЛЯТОР
- `README.md`
- `index.html`

## 17. shtab_watchdog — СТОРОЖ ШТАБА
- `README.md`
- `icon.svg`
- `index.html`
- `manifest.json`
- `sw.js`

## 18. test_access_repo_xyz — ТЕСТ ДОСТУПА
- `README.md`
- `probe_test_file.txt`

## 19. nexus_space — КОСМОС (игра)
- `README.md`
- `game.js`
- `index.html`
- `space.js`
- `sw.js`
- `version.json` — счётчик правок **Калькулятора окон (window_calc)**, НЕ Штаба (с Штабом не перемешивается)

## 20. racing_game — ГОНКИ
- `README.md`
- `index.html`

---

## ⚙️ СЕРВЕР (VIVO)
Termux → Ubuntu. Штаб :8000, Чат :8001, Caddy :8443 (SSL, DuckDNS). sync.sh каждые 10 сек.

## 🔒 ЗАЩИЩЕНО
- `digital-agency` и `window_calc` — удалять ЗАПРЕЩЕНО.
- `main.ts` и папка `backup/` — удалять ЗАПРЕЩЕНО.
- Секреты — только в переменных окружения / GitHub Secrets, в открытые репо НЕ писать.
