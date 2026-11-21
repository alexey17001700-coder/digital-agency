/* ============================================================
   НАДЗИРАТЕЛЬ — supervisor.js
   ------------------------------------------------------------
   Следит за диалогом Босса в Штабе и не даёт задаче умереть молча.

   ЖИЗНЬ (передача НЕ делается):
     • счётчик на кнопке «Отправить» тикает — запрос идёт, агент работает;
     • идёт авто-пинок «продолжи» или следующий этап [ЭТАП N/M];
     • большая задача разбита на этапы и этапы идут один за другим.
     Пока агент жив — сколько бы он ни думал, задача остаётся у него.

   СМЕРТЬ (задача уходит следующему по цепочке):
     • счётчик на кнопке застыл и не меняется SUP_FREEZE_MS — поток умер;
     • счётчик пропал (запрос оборвался), а ответа в чате нет;
     • SUP_LIMIT_MS полной тишины — лимит кнопки отправки вышел;
     • явный сбой: ошибка, пустой ответ, «слишком много шагов».

   ЦЕПОЧКА ЗАМЕНЫ: Архитектор → Помощник → Бесплатная модель → стоп.
   Передач не больше SUP_MAX_HANDOFFS — иначе два ИИ зациклятся.

   Файл самостоятельный: всё внешнее — через typeof-проверки.
   Если chat.js не загрузился, надзиратель просто молчит.
   ============================================================ */
(function () {
    'use strict';

    const SUP_KEY = 'shtabSupervisor';
    const SUP_LIMIT_MS = 300000;    // 300 с — лимит кнопки отправки: столько тишины терпим
    const SUP_FREEZE_MS = 10000;    // счётчик на кнопке не менялся 10 с — считаем застывшим
    const SUP_TICK_MS = 3000;       // проверка каждые 3 с
    const SUP_MAX_HANDOFFS = 2;     // не больше 2 передач на одну задачу (стоп-кран)
    const SUP_TEXT_LIMIT = 2000;    // столько текста задачи храним в журнале

    const OWNER_LABEL = { arch: '🏛 Архитектор', assistant: '🤖 Помощник', free: '🆓 Бесплатная модель' };
    const OWNER_NEXT = { arch: 'assistant', assistant: 'free' };   // цепочка замены

    let supTimer = null;
    let supBusyCount = 0;           // идёт передача задачи — надзиратель не мешает сам себе

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
        const now = Date.now();
        supSave({
            text: String(text || '').slice(0, SUP_TEXT_LIMIT),
            owner: owner || 'arch',
            status: 'waiting',                 // waiting | answered | failed
            handoffs: 0,
            startedAt: now,
            lastSeen: now,
            lastTimerText: '',
            lastTimerChange: now,
            history: history
        });
        supLog('📋 *[Надзиратель: задачу взял ' + ownerLabel(owner) + '. Жду ответа.]*');
    }

    /* Задача продолжается: авто-пинок, следующий этап, повтор после сбоя.
       Журнал переоткрываем — агент снова в работе, передавать некому. */
    function supResume(owner) {
        const st = supLoad();
        if (!st) return;
        const now = Date.now();
        st.owner = owner || st.owner || 'arch';
        st.status = 'waiting';
        st.startedAt = now;
        st.lastSeen = now;
        st.lastTimerText = '';
        st.lastTimerChange = now;
        st.reason = '';
        supSave(st);
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

    /* Пульс: агент ещё жив и работает (пинок, этап, длинный запрос). */
    function supHeartbeat(owner) {
        const st = supLoad();
        if (!st) return;
        if (owner && st.owner && owner !== st.owner) return;
        st.lastSeen = Date.now();
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
        const now = Date.now();
        st.owner = next;
        st.handoffs = (st.handoffs || 0) + 1;
        st.status = 'waiting';
        st.startedAt = now;
        st.lastSeen = now;
        st.lastTimerText = '';
        st.lastTimerChange = now;
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
        supBusyCount++;                        // пока идёт передача — свой же тик не мешает
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
        } finally {
            supBusyCount--;
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
        if (!st || st.status !== 'waiting') return;
        if (supBusyCount > 0) return;          // идёт передача — не мешаем

        const now = Date.now();

        // 1) СЧЁТЧИК НА КНОПКЕ ТИКАЕТ — агент работает, молчания нет.
        const btnText = (typeof sendBtn !== 'undefined' && sendBtn) ? String(sendBtn.innerText || '') : '';
        const timerAlive = /\d/.test(btnText);
        if (timerAlive && btnText !== st.lastTimerText) {
            st.lastTimerText = btnText;
            st.lastTimerChange = now;
            st.lastSeen = now;
            supSave(st);
            return;
        }

        // 2) ПАУЗА МЕЖДУ ПИНКАМИ И ЭТАПАМИ (900 мс) — тоже не молчание.
        const silent = now - (st.lastSeen || st.startedAt || now);
        if (silent < SUP_FREEZE_MS) return;

        const generating = (typeof isGenerating !== 'undefined') && isGenerating;

        // 3) ПРИЧИНА ПЕРЕДАЧИ.
        let why = '';
        if (!generating && !timerAlive) {
            why = 'счётчик оборвался, ответа нет';              // запрос умер без ответа
        } else if (timerAlive) {
            why = 'счётчик на кнопке застыл на ' + btnText;      // поток завис
        } else if (silent >= SUP_LIMIT_MS) {
            why = 'прошло ' + Math.round(silent / 1000) + ' с тишины (лимит 300 с)';
        } else {
            return;                                              // запрос идёт меньше 300 с — ждём
        }

        st.status = 'failed';
        st.reason = why;
        st.lastSeen = now;
        supSave(st);
        supLog('⏳ *[Надзиратель: ' + ownerLabel(st.owner) + ' — ' + why + '. Передаю задачу дальше.]*');
        supHandoff();
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
    window.SUPERVISOR_VERSION = '1.3-stage2';

    supStartWatch();
})();
