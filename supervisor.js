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

   ЦЕПОЧКА ЗАМЕНЫ: Архитектор → Помощник → Бесплатная модель → стоп.
   Если агент молчит или сорвался, задача уходит следующему по цепочке.
   Число передач ограничено SUP_MAX_HANDOFFS — иначе два ИИ зациклятся
   и будут бесконечно пинать друг друга.

   СРОК МОЛЧАНИЯ = 300 с. Это лимит кнопки отправки. Пока он не вышел,
   агент считается работающим — даже если ответа ещё нет. Передача
   происходит только после 300 с тишины.

   Файл самостоятельный: ни от чего не зависит, всё внешнее —
   через typeof-проверки. Если chat.js не загрузился, надзиратель
   просто молчит и ничего не ломает.
   ============================================================ */
(function () {
    'use strict';

    const SUP_KEY = 'shtabSupervisor';
    const SUP_SILENCE_MS = 300000;   // 300 с — лимит кнопки отправки. Раньше этого срока агент может работать, это не молчание
    const SUP_TICK_MS = 5000;        // проверка каждые 5 с
    const SUP_MAX_HANDOFFS = 2;      // не больше 2 передач на одну задачу (стоп-кран)
    const SUP_TEXT_LIMIT = 2000;     // столько текста задачи храним в журнале

    const OWNER_LABEL = { arch: '🏛 Архитектор', assistant: '🤖 Помощник', free: '🆓 Бесплатная модель' };
    const OWNER_NEXT = { arch: 'assistant', assistant: 'free' };   // цепочка замены

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

    /* Агент сорвался (ошибка, пустой ответ, обрыв).
       Не просто помечаем сбой — сразу пробуем передать задачу дальше. */
    function supFailed(owner, reason) {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        st.status = 'failed';
        st.lastSeen = Date.now();
        st.reason = String(reason || 'сбой').slice(0, 300);
        supSave(st);
        supLog('⚠️ *[Надзиратель: ' + ownerLabel(owner || st.owner) + ' сорвался — ' + st.reason + '.]*');
        supHandoff();                          // пробуем следующего по цепочке
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

    /* ---------- ПЕРЕДАЧА ЗАДАЧИ ---------- */

    /* Кому передаём дальше: Архитектор → Помощник → Бесплатная модель.
       Передачи ограничены — иначе два ИИ зациклятся. */
    function supHandoff() {
        const st = supLoad();
        if (!st) return;
        if (st.status === 'answered') return;
        if ((st.handoffs || 0) >= SUP_MAX_HANDOFFS) { supStopKran(st); return; }
        const prev = st.owner;
        const next = OWNER_NEXT[prev];
        if (!next) { supStopKran(st); return; }
        st.owner = next;
        st.handoffs = (st.handoffs || 0) + 1;
        st.status = 'waiting';
        st.startedAt = Date.now();
        st.lastSeen = Date.now();
        st.reason = '';
        supSave(st);
        supLog('🔄 *[Надзиратель: ' + ownerLabel(prev) + ' не справился. Передаю задачу ' + ownerLabel(next) + ' (' + st.handoffs + '/' + SUP_MAX_HANDOFFS + ').]*');
        supDispatch(st.text, next);
    }

    /* Стоп-кран: передачи исчерпаны — дальше только Босс. */
    function supStopKran(st) {
        st.status = 'failed';
        st.lastSeen = Date.now();
        supSave(st);
        supLog('🛑 *[Надзиратель: ' + ownerLabel(st.owner) + ' молчит, передачи исчерпаны (' + SUP_MAX_HANDOFFS + '/' + SUP_MAX_HANDOFFS + '). Нужен Босс.]*');
    }

    /* Отправляем задачу новому владельцу и следим за результатом. */
    async function supDispatch(text, owner) {
        try {
            if (owner === 'assistant' && typeof window.sendToAssistant === 'function') {
                const ok = await window.sendToAssistant(text);
                if (ok) supAnswered('assistant'); else supFailed('assistant', 'Помощник не ответил');
            } else if (owner === 'free' && typeof window.sendToFreeModel === 'function') {
                const ok = await window.sendToFreeModel(text);
                if (ok) supAnswered('free'); else supFailed('free', 'Бесплатная модель не ответила');
            } else if (owner === 'arch' && typeof window.sendMessage === 'function') {
                window.sendMessage(text, true);   // Архитектор сам закроет журнал (supAnswered/supFailed)
            } else {
                supFailed(owner, 'нет канала для передачи');
            }
        } catch (e) {
            supFailed(owner, (e && e.message) || 'сбой передачи');
        }
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

        // Отсчёт ведём от момента, когда задача ушла агенту (startedAt).
        // Пульс lastSeen его НЕ сбрасывает: 300 с — жёсткий лимит кнопки отправки.
        const waited = Date.now() - (st.startedAt || Date.now());

        // Пока лимит не вышел — агент вправе работать, даже если запрос в полёте.
        if (waited < SUP_SILENCE_MS) {
            if (typeof isGenerating !== 'undefined' && isGenerating) supHeartbeat(st.owner);
            return;
        }

        // 300 с истекли — задача уходит следующему, даже если запрос ещё висит.
        st.status = 'stalled';
        supSave(st);
        supLog('⏳ *[Надзиратель: ' + ownerLabel(st.owner) + ' молчит ' + Math.round(waited / 1000) + ' с (лимит 300 с). Передаю задачу дальше.]*');
        supHandoff();                          // ЭТАП 2: передача второму агенту, затем бесплатной модели
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
    window.supHandoff = supHandoff;
    window.supClear = supClear;
    window.supState = supLoad;
    window.supTick = supTick;
    window.SUPERVISOR_VERSION = '1.2-stage2';

    supStartWatch();
})();
