/* ============================================================
   НАДЗИРАТЕЛЬ — supervisor.js
   ------------------------------------------------------------
   Следит за диалогом Босса в Штабе и не даёт задаче умереть молча.

   Кто ведёт задачу (Архитектор или Помощник), когда ответил,
   сколько ждём ответа — всё лежит в localStorage под ключом
   shtabSupervisor. Оба агента пишут в один журнал и читают его,
   поэтому видят, что делает второй.

   ЭТАП 1: журнал задач + детект молчания + запись в ленту чата.
   ЭТАП 2: передача задачи второму агенту + бесплатная модель.
   ЭТАП 3: индикатор в ленте + стоп-кран.

   Файл самостоятельный: ни от чего не зависит, всё внешнее —
   через typeof-проверки. Если chat.js не загрузился, надзиратель
   просто молчит и ничего не ломает.
   ============================================================ */
(function () {
    'use strict';

    const SUP_KEY = 'shtabSupervisor';
    const SUP_SILENCE_MS = 90000;    // 90 с без ответа — агент считается молчащим
    const SUP_TICK_MS = 5000;        // проверка каждые 5 с
    const SUP_MAX_HANDOFFS = 2;      // не больше 2 передач на одну задачу (стоп-кран)
    const SUP_TEXT_LIMIT = 2000;     // столько текста задачи храним в журнале

    const OWNER_LABEL = { arch: '🏛 Архитектор', assistant: '🤖 Помощник', free: '🆓 Бесплатная модель' };
    const OWNER_NEXT = { arch: 'assistant', assistant: 'arch' };

    let supTimer = null;

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
    function ownerLabel(o) { return OWNER_LABEL[o] || ('❔ ' + o); }

    /* Задача взята в работу. owner: 'arch' | 'assistant' */
    function supStart(text, owner) {
        const prev = supLoad();
        const history = (prev && Array.isArray(prev.history)) ? prev.history : [];
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: owner || 'arch',
            status: 'waiting',                 // waiting | answered | stalled | failed
            handoffs: 0,
            startedAt: Date.now(),
            lastSeen: Date.now(),
            history: history
        });
        supLog('📋 *[Надзиратель: задачу взял ' + ownerLabel(owner) + '. Жду ответа.]*');
    }

    /* Агент ответил — задача закрыта. */
    function supAnswered(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && owner !== st.owner) return;   // ответил не тот, кто ведёт — не закрываем
        st.status = 'answered';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('✅ *[Надзиратель: ' + ownerLabel(st.owner) + ' ответил. Задача закрыта.]*');
        setTimeout(supClear, 1500);            // журнал чистим, чтобы не копить мусор
    }

    /* Агент сорвался (ошибка, пустой ответ, обрыв). */
    function supFailed(owner, reason) {
        const st = supLoad();
        if (!st) return;
        st.status = 'failed';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'сбой').slice(0, 300);
        supSave(st);
        supLog('⚠️ *[Надзиратель: ' + ownerLabel(owner || st.owner) + ' сорвался — ' + st.reason + '.]*');
    }

    /* Пульс: агент ещё жив и работает (длинный запрос). */
    function supHeartbeat(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && owner !== st.owner) return;
        st.lastSeen = Date.now();
        if (st.status === 'stalled') st.status = 'waiting';
        supSave(st);
    }

    /* ---------- ВЫВОД В ЛЕНТУ ---------- */

    function supLog(text) {
        try {
            if (typeof renderMessage === 'function') renderMessage(text, 'director', 'Надзиратель');
        } catch (e) { /* лента недоступна — молчим */ }
    }

    /* ---------- ДЕТЕКТ МОЛЧАНИЯ ---------- */

    function supTick() {
        const st = supLoad();
        if (!st) return;
        if (st.status !== 'waiting') return;

        // Агент реально работает (запрос в полёте) — молчанием это не считается.
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            supHeartbeat(st.owner);
            return;
        }

        const waited = Date.now() - (st.lastSeen || st.startedAt || Date.now());
        if (waited < SUP_SILENCE_MS) return;

        st.status = 'stalled';
        supSave(st);
        supLog('⏳ *[Надзиратель: ' + ownerLabel(st.owner) + ' молчит ' + Math.round(waited / 1000) + ' с. Готовлю передачу задачи.]*');
        // ЭТАП 2: здесь надзиратель передаст задачу второму агенту,
        // а если молчат оба — отдаст её бесплатной модели.
    }

    function supStartWatch() {
        if (supTimer) return;
        supTimer = setInterval(supTick, SUP_TICK_MS);
    }

    /* ---------- НАРУЖУ ---------- */

    window.supStart = supStart;
    window.supAnswered = supAnswered;
    window.supFailed = supFailed;
    window.supHeartbeat = supHeartbeat;
    window.supClear = supClear;
    window.supState = supLoad;
    window.supTick = supTick;
    window.SUPERVISOR_VERSION = '1.0-stage1';

    supStartWatch();
})();
