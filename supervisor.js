/* ============================================================
   НАДЗИРАТЕЛЬ — supervisor.js  v2.0-lean
   ------------------------------------------------------------
   Следит за диалогом Босса в Штабе и не даёт задаче умереть молча.

   ЧТО ИЗМЕНИЛОСЬ В v2.0 (пересмотр под нынешние потребности Штаба):
     • Вычищен весь мёртвый код убранных функций: передача задачи
       другому агенту, дележ большой задачи между моделями, опрос
       ИИ-шлюза :8002 (его больше нет). Файл стал вдвое короче и честнее.
     • Настройки приведены к реальности Штаба: два канала (🅰️ Zveno,
       🟣 GigaChat) + режим ⚡ Дуэт. Перебора моделей и дележа НЕТ.
     • Пороги синхронизированы с chat.js: 330 с одиночный запрос,
       630 с дуэт (сервер гонит два запроса подряд), заморозка 5 с.

   ГЛАВНЫЙ ПОРОГ: 330 СЕКУНД (реальный предел кнопки «Отправить»),
   в дуэте — 630 с (сервер гонит ДВА запроса подряд: Zveno → GigaChat).
   Пороги совпадают с chat.js: TIMER_MAX_MS / DUET_TIMEOUT_MS.
   Пока лимит не вышел — агент считается живым, передача НЕ делается,
   сколько бы он ни думал.

   ЖИЗНЬ (задача НЕ останавливается):
     • на кнопке «Отправить» тикает счётчик;
     • isGenerating == true и прошло меньше 330 с (в дуэте — 630 с);
     • идёт авто-пинок «продолжи», следующий этап [ЭТАП N/M];
     • печатается ответ (typingTimer) или в ленте было движение.

   СМЕРТЬ (задача останавливается, слово Боссу):
     • счётчик на кнопке ЗАСТЫЛ и не менялся 5 с;
     • счётчик ПРОПАЛ (запрос оборвался), ответа в чате нет;
     • прошло 330 с тишины (в дуэте — 630 с) — лимит кнопки истёк;
     • явный сбой: ошибка, пустой ответ, «слишком много шагов».

   РЕЖИМЫ ШТАБА (сегодня):
     • 🅰️ Zveno (Архитектор) — основной канал;
     • 🟣 GigaChat (Сбер) — второй канал;
     • ⚡ Дуэт — оба канала над одной задачей: Zveno пишет черновик,
       GigaChat проверяет и выдаёт финал. Сервер гонит ДВА запроса подряд,
       поэтому в дуэте лимит ожидания вдвое больше (SUP_DUET_LIMIT_MS).

   ПЕРЕДАЧИ И ДЕЛЕЖА ЗАДАЧИ ОТКЛЮЧЕНЫ (приказ Босса):
     задача целиком у выбранной модели (или у дуэта). Перебора моделей нет:
     сбой — стоп и слово Боссу, а не передача другому агенту.

   Файл самостоятельный: всё внешнее — через typeof-проверки.
   ============================================================ */
(function () {
    'use strict';

    /* ---------- НАСТРОЙКИ (под нынешние потребности Штаба) ---------- */
    const SUP_KEY = 'shtabSupervisor';   // ключ журнала в localStorage
    const SUP_LIMIT_MS = 330000;         // 330 с — предел одиночного запроса (chat.js: TIMER_MAX_MS)
    const SUP_DUET_LIMIT_MS = 630000;    // ⚡ Дуэт: два запроса подряд (Zveno → GigaChat) — ждём вдвое дольше (chat.js: DUET_TIMEOUT_MS)
    const SUP_FREEZE_MS = 5000;          // счётчик не менялся 5 с — считаем застывшим (chat.js: TIMER_FREEZE_MS)
    const SUP_TICK_MS = 3000;            // проверка каждые 3 с
    const SUP_TEXT_LIMIT = 2000;         // столько текста задачи храним в журнале
    const SUP_ALIVE_MS = 120000;         // признак жизни держится 120 с: агент работает — остановка запрещена
    const SUP_ACTIVITY_MS = 45000;       // движение в ленте за это время = агент жив

    const OWNER_LABEL = {
        arch: '🅰️ Zveno (Архитектор)',
        free: '🟣 GigaChat',
        duet: '⚡ Дуэт (Zveno + GigaChat)'
    };

    /* ---------- РЕЖИМ ШТАБА: ⚡ ДУЭТ ----------
       Босс включил ⚡ Дуэт — задачу ведут ОБА канала: 🅰️ Zveno пишет
       черновик, 🟣 GigaChat проверяет и выдаёт финал. Сервер гонит ДВА
       запроса подряд, поэтому и предел ожидания вдвое больше.
       Состояние берём у chat.js (duetEnabled), с запасным чтением
       localStorage — надзиратель остаётся самостоятельным файлом. */
    function supDuetOn() {
        try { if (typeof window.duetEnabled === 'function') return !!window.duetEnabled(); } catch (e) {}
        try { return localStorage.getItem('shtabDuetOn') === 'on'; } catch (e) { return false; }
    }
    /* Предел ожидания под текущий режим: одиночный ответ или ⚡ дуэт. */
    function supLimitMs() { return supDuetOn() ? SUP_DUET_LIMIT_MS : SUP_LIMIT_MS; }
    /* Тот же ли владелец ведёт задачу. ⚡ Дуэт ведёт ОБА канала сразу,
       поэтому ответ любого из них (arch или free) закрывает журнал дуэта. */
    function supSameOwner(a, b) {
        const x = String(a || ''), y = String(b || '');
        if (x === y) return true;
        return x === 'duet' || y === 'duet';
    }

    let supTimer = null;
    let supAliveUntil = 0;        // до этого времени задача считается ЖИВОЙ — остановка запрещена
    let supLastActivity = 0;      // когда в ленте последний раз было движение (печать/ответ)
    let supStageInfo = null;      // { cur, total } — задача разбита на этапы, это НЕ молчание

    /* ---------- ЖУРНАЛ ---------- */

    function supLoad() {
        try {
            const raw = localStorage.getItem(SUP_KEY);
            const o = raw ? JSON.parse(raw) : null;
            return (o && typeof o === 'object') ? o : null;
        } catch (e) { return null; }
    }
    function supSave(o) {
        try { localStorage.setItem(SUP_KEY, JSON.stringify(o)); } catch (e) {}
    }
    function supClear() {
        try { localStorage.removeItem(SUP_KEY); } catch (e) {}
    }
    function ownerLabel(o) { return OWNER_LABEL[o] || ('👤 ' + o); }

    /* ---------- ЖИВОЙ АГЕНТ: ПРИЗНАКИ ЖИЗНИ ----------
       Остановка задачи — только когда агент МЁРТВ. Пока он работает,
       надзиратель молчит и ждёт. Признаки жизни:
       1) идёт запрос (isGenerating) или печатается ответ (typingTimer);
       2) крутятся этапы большой задачи ([ЭТАП N/M], N < M);
       3) в ленте было движение за последние SUP_ACTIVITY_MS;
       4) chat.js явно позвал supAlive() (этап, ответ, пинок).
       Любой из них — задача живая, остановка запрещена. */
    function supAlive(ms) {
        supAliveUntil = Math.max(supAliveUntil, Date.now() + (ms || SUP_ALIVE_MS));
    }
    function supNoteActivity() { supLastActivity = Date.now(); supAlive(); }
    /* Свежая жизнь: только что был ответ/печать или идут этапы.
       Именно это отличает РАБОТУ от обрыва, когда счётчик на кнопке замер.
       isGenerating здесь НЕ учитываем: зависший запрос — это не жизнь. */
    function supRecentlyAlive() {
        const now = Date.now();
        if (supLastActivity && (now - supLastActivity) < SUP_ACTIVITY_MS) return true;
        if (supStageInfo && supStageInfo.cur < supStageInfo.total) return true;
        try { if (typeof typingTimer !== 'undefined' && typingTimer) return true; } catch (e) {}
        return false;
    }
    function supIsAlive() {
        if (supRecentlyAlive()) return true;
        if (Date.now() < supAliveUntil) return true;
        try { if (typeof isGenerating !== 'undefined' && isGenerating) return true; } catch (e) {}
        return false;
    }

    /* ---------- БОЛЬШАЯ ЗАДАЧА: ЭТАПЫ ----------
       Модель разбила задачу на этапы ([ЭТАП N/M]). Это НЕ молчание:
       задача живая, пока этапы идут. Надзиратель запоминает разбивку
       и не останавливает задачу. */
    function supStage(stage) {
        if (!stage || !stage.total) { supStageInfo = null; return; }
        supStageInfo = { cur: Number(stage.cur) || 1, total: Number(stage.total) || 1 };
        supAlive(SUP_ALIVE_MS);
        const st = supLoad();
        if (st) { st.big = supStageInfo.total > 1; st.stage = supStageInfo.cur + '/' + supStageInfo.total; supSave(st); }
        supLog('🧩 Задача разбита на этапы ' + supStageInfo.cur + '/' + supStageInfo.total + ' — агент жив, остановка не нужна');
    }

    /* Задача взята в работу. owner: 'arch' | 'free' | 'duet' */
    function supStart(text, owner) {
        supStageInfo = null;                           // новая задача — этапы с нуля
        supLastActivity = 0;                           // прошлая жизнь не считается
        supAlive(SUP_ALIVE_MS);                        // агент только взял задачу — он жив
        if (supDuetOn()) owner = 'duet';               // ⚡ Дуэт: задачу ведут оба канала
        const prev = supLoad();
        const history = (prev && Array.isArray(prev.history)) ? prev.history : [];
        const now = Date.now();
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: owner || 'arch',
            status: 'waiting',                 // waiting | answered | failed
            startedAt: now,
            lastSeen: now,
            lastTimerText: '',
            lastTimerChange: now,
            history: history
        });
        supLog('📋 Задачу взял ' + ownerLabel(owner));
    }

    /* Задача продолжается: авто-пинок, следующий этап, повтор после сбоя.
       Журнал переоткрываем — агент снова в работе. */
    function supResume(owner) {
        const st = supLoad();
        if (!st) return;
        const now = Date.now();
        if (!st.owner) st.owner = owner || 'arch';     // ⚡ дуэт не перебиваем
        st.status = 'waiting';
        st.startedAt = now;
        st.lastSeen = now;
        st.lastTimerText = '';
        st.lastTimerChange = now;
        st.reason = '';
        supSave(st);
        supAlive(SUP_ALIVE_MS);   // агент продолжает работу — он жив
    }

    /* Пульс: агент ещё жив и работает (пинок, этап, длинный запрос). */
    function supHeartbeat(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && !supSameOwner(owner, st.owner)) return;
        st.lastSeen = Date.now();
        supSave(st);
    }

    /* Агент ответил — задача закрыта. */
    function supAnswered(owner) {
        const st = supLoad();
        if (!st) return;
        supNoteActivity();   // ответ пришёл — агент жив, задача не брошена
        if (owner && st.owner && !supSameOwner(owner, st.owner)) return;   // ответил не тот, кто ведёт — не закрываем
        st.status = 'answered';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('✅ ' + ownerLabel(st.owner) + ' ответил — задача закрыта');
    }

    /* Агент сорвался (ошибка, пустой ответ, обрыв).
       Перебора моделей нет — задача останавливается, слово Боссу. */
    function supFailed(owner, reason) {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        st.status = 'failed';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'сбой').slice(0, 300);
        supSave(st);
        supLog('⚠️ ' + ownerLabel(owner || st.owner) + ' сорвался — ' + st.reason);
        supHandoff();                          // перебора нет — просто стоп
    }

    /* ---------- ОСТАНОВКА ЗАДАЧИ ----------
       ❗ ПЕРЕБОРА МОДЕЛЕЙ НЕТ (приказ Босса).
       Задача НЕ передаётся другой модели: отвечает только та модель,
       что выбрал Босс (или дуэт). Сбой — стоп и слово Боссу. */
    function supHandoff() {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        st.status = 'failed';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('🛑 Перебора моделей нет — задача остановлена. Жду Босса.');
    }

    /* ---------- ВЫВОД В ЛЕНТУ ---------- */

    function supLog(text) {
        try {
            if (typeof renderMessage === 'function') renderMessage(text, 'director', 'Надзиратель');
        } catch (e) { /* лента недоступна — молчим */ }
    }

    /* ---------- ДЕТЕКТ МОЛЧАНИЯ ---------- */

    function timerState(st, now) {
        const btnText = (typeof sendBtn !== 'undefined' && sendBtn) ? String(sendBtn.innerText || '') : '';
        const timerAlive = /\d/.test(btnText);
        if (timerAlive && btnText !== st.lastTimerText) {
            st.lastTimerText = btnText;
            st.lastTimerChange = now;
            st.lastSeen = now;
            return { alive: true, text: btnText };
        }
        return { alive: timerAlive, text: btnText };
    }

    function supTick() {
        const st = supLoad();
        if (!st || st.status !== 'waiting') return;

        const now = Date.now();
        const t = timerState(st, now);
        if (t.alive && t.text === st.lastTimerText) supSave(st);

        // 1) Счётчик тикает — агент работает.
        if (t.alive && (now - (st.lastTimerChange || now)) < SUP_FREEZE_MS) return;

        const generating = (typeof isGenerating !== 'undefined') && isGenerating;
        const silent = now - (st.lastSeen || st.startedAt || now);
        const limit = supLimitMs();   // ⚡ в дуэте лимит вдвое больше: сервер гонит два запроса

        // 2) ГЛАВНОЕ: лимит ещё не вышел и агент жив — не трогаем.
        if (generating && silent < limit) return;
        if (!generating && silent < SUP_FREEZE_MS) return;

        // 2б) ЖИВОЙ АГЕНТ — НЕ ОСТАНАВЛИВАЕМ. Печатается ответ, крутятся этапы
        //     большой задачи — это работа, а не молчание. Срок продлеваем и ждём.
        if (supRecentlyAlive()) {
            st.lastSeen = now;
            st.startedAt = now;
            st.lastTimerText = '';
            st.lastTimerChange = now;
            supSave(st);
            return;
        }

        // 3) Причина остановки.
        let why = '';
        if (silent >= limit) why = 'лимит ' + Math.round(limit / 1000) + ' с истёк';
        else if (!generating && !t.alive) why = 'счётчик пропал, ответа нет';
        else if (t.alive) why = 'счётчик застыл на ' + t.text;
        else return;

        st.status = 'failed';
        st.reason = why;
        st.lastSeen = now;
        supSave(st);
        supLog('⏳ ' + ownerLabel(st.owner) + ' — ' + why);
        supHandoff();
    }

    /* ---------- ОБРЫВ (зов из chat.js) ----------
       chat.js зовёт это, когда счётчик на кнопке замер/пропал или вышло 330 с.
       ЖИВОЙ АГЕНТ НЕ ОСТАНАВЛИВАЕТСЯ: если идёт печать или крутятся этапы —
       это работа, а не обрыв. Возвращает true, если надзиратель взял на себя. */
    function supBreak(reason) {
        const st = supLoad();
        if (!st || st.status !== 'waiting') return false;
        const now = Date.now();
        if (supRecentlyAlive()) {
            st.lastSeen = now;
            st.startedAt = now;
            st.lastTimerText = '';
            st.lastTimerChange = now;
            supSave(st);
            return true;                        // агент жив — остановки не будет
        }
        st.status = 'failed';
        st.reason = String(reason || 'обрыв').slice(0, 300);
        st.lastSeen = now;
        supSave(st);
        supLog('⏳ ' + ownerLabel(st.owner) + ' — ' + st.reason);
        supHandoff();
        return true;
    }

    function supStartWatch() {
        if (supTimer) return;
        supTimer = setInterval(supTick, SUP_TICK_MS);
    }

    /* ---------- НАРУЖУ ---------- */

    window.supStart = supStart;
    window.supResume = supResume;
    window.supAnswered = supAnswered;
    window.supFailed = supFailed;
    window.supHeartbeat = supHeartbeat;
    window.supHandoff = supHandoff;
    window.supClear = supClear;
    window.supState = supLoad;
    window.supTick = supTick;
    window.supTimerBroken = supBreak;        // chat.js: счётчик оборвался / 330 с → задача останавливается
    window.supAlive = supAlive;              // chat.js: агент жив (этап, ответ, пинок)
    window.supNoteActivity = supNoteActivity;// chat.js: в ленте движение — агент работает
    window.supStage = supStage;              // chat.js: задача разбита на этапы [ЭТАП N/M]
    window.supIsAlive = supIsAlive;
    window.supDuetOn = supDuetOn;            // chat.js: включён ли ⚡ Дуэт — надзиратель ждёт вдвое дольше
    window.supLimitMs = supLimitMs;          // chat.js: текущий предел ожидания под режим

    /* Совместимость: дележа и опроса моделей больше нет — заглушки,
       чтобы старые вызовы не падали. */
    window.supSplit = function () { return false; };
    window.supOnlineAgents = function () { return ['arch', 'free']; };

    window.SUPERVISOR_VERSION = '2.0-lean';

    supStartWatch();
})();
