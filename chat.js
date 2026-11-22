const PROXY = "https://shtab-boss.duckdns.org:8443";
let currentMode = 'normal'; let isAutoMode = false;
let isGenerating = false; let currentAbortController = null; let watchdogTimer = null;
let typingTimer = null; 
/* --- АВТО-ПИНОК ПРИ ОБРЫВЕ ОТВЕТА ---
   Если Архитектор замолчал (обрыв связи, таймаут, тишина) — скрипт сам,
   от имени Босса, пишет в чат «продолжи» и повторяет запрос.
   Не более STALL_MAX_KICKS раз подряд, чтобы не зациклиться. */
const STALL_TIMEOUT_MS = 303000;   // 300 с лимита запроса + 3 с запаса
const STALL_MAX_KICKS = 2;         // было 3: каждый пинок — ОТДЕЛЬНЫЙ платный запрос с полной историей
let stallWatchdog = null;
let stallKicks = 0;
/* --- ЗАЩИТА ОТ ДУБЛЕЙ ПРИ ОБНОВЛЕНИИ СТРАНИЦЫ ---
   Сторожа живут в памяти и умирают по F5. Раньше после обновления пинок
   срабатывал заново и в чат летело ВТОРОЕ «продолжи». Теперь метка о пинке
   и счётчик пинков лежат в localStorage — обновил страницу, дубля нет. */
const KICK_GUARD_MS = 25000;   // 25 с после пинка повторный пинок запрещён
function kickGuardKey() { return 'shtabKickGuard_' + (currentChatId || 'none'); }
function kickGuardActive() {
    try {
        const at = parseInt(localStorage.getItem(kickGuardKey()) || '0', 10);
        return !!at && (Date.now() - at) < KICK_GUARD_MS;
    } catch (e) { return false; }
}
function markKickSent() {
    try { localStorage.setItem(kickGuardKey(), String(Date.now())); } catch (e) {}
    try { localStorage.setItem('shtabStallKicks', String(stallKicks)); } catch (e) {}
}
function restoreKickState() {
    const k = parseInt(localStorage.getItem('shtabStallKicks') || '0', 10);
    stallKicks = isNaN(k) ? 0 : k;
}
let stallInterval = null;          // сторож проверяет чат каждые 3 с, а не только по таймеру
let stallStartCount = 0;           // сколько ответов было в чате на момент старта
let stallLastLen = -1;             // длина последнего ответа (детект «застыл»)
let stallLastChange = 0;           // когда последний ответ менялся
let sendSeq = 0;
let lastSendSuccess = false;   // пришёл ли ответ — от этого зависит, гасить ли сторож тишины
/* --- ОДИН СЧЁТЧИК НА КНОПКЕ (без наложения) ---
   Раньше каждый вызов sendMessage (в т.ч. авто-пинок и «продолжи этап»)
   заводил СВОЙ setInterval и не убивал предыдущий. Два-три счётчика писали
   в кнопку одновременно: цифры прыгали «друг на друга», а старый таймер
   продолжал считать от своего старта — отсюда зашкал за 500 с.
   Теперь счётчик один: перед стартом старый гасится, отсчёт идёт от
   единого sendStartTime. */
let sendTimerLoop = null;
let sendStartTime = 0;
const TIMER_MAX_MS = 330000;   // 330 с — предел (совпадает с таймаутом запроса): выше не растёт
/* --- ОДИН СЧЁТЧИК НА ВСЁ ПРИЛОЖЕНИЕ ---
   Раньше на КАЖДЫЙ вызов sendMessage (в т.ч. авто-пинок, «продолжи этап»)
   создавался свой setInterval. Два-три интервала писали в кнопку по очереди:
   цифры прыгали друг на друга, а старый считал от своего старта — отсюда
   зашкал за 500 с. Теперь интервал ОДИН и создаётся один раз. Он не хранит
   свой старт, а читает единственный sendStartTime — наложить два отсчёта
   физически невозможно. */
function stopSendTimer() {
    sendStartTime = 0;
    if (sendTimerLoop) { clearInterval(sendTimerLoop); sendTimerLoop = null; }
}
function startSendTimer() {
    sendStartTime = Date.now();          // точка отсчёта одна на всё приложение
    if (sendTimerLoop) return;           // цикл уже идёт — второй не создаём
    sendTimerLoop = setInterval(() => {
        if (!sendStartTime) { stopSendTimer(); return; }                       // отсчёт не запущен — стоп
        if (!isGenerating) { stopSendTimer(); return; }                        // ответ пришёл — стоп
        if (!sendBtn || sendBtn.className.indexOf('stop-active') === -1) { stopSendTimer(); return; } // кнопка не в работе — стоп
        const ms = Date.now() - sendStartTime;
        if (ms >= TIMER_MAX_MS) {                                              // запрос мёртв — не зашкаливаем
            stopSendTimer();
            isGenerating = false;
            try { if (currentAbortController) currentAbortController.abort(); } catch (e) {}
            sendBtn.disabled = false; sendBtn.className = 'send-btn'; sendBtn.innerText = '➤'; sendBtn.style.fontSize = '';
            renderMessage(`⏱️ *[Система: запрос висел больше ${Math.round(TIMER_MAX_MS / 1000)} с — счётчик сброшен, кнопка освобождена.]*`, 'director', 'Оркестратор');
            return;
        }
        sendBtn.innerText = (ms / 1000).toFixed(1) + "s";
    }, 100);
}
let attachedImageBase64 = null; let currentChatImage = null;
let attachedFile = null;   // приложенный файл Босса: { name, size, content }
let bossMemory = localStorage.getItem('shtabBossMemory') || "Босс.";
let customPrompts = {}; try { const sp = localStorage.getItem('shtabCustomPrompts'); if (sp) customPrompts = JSON.parse(sp); } catch (e) {}
let allChats = {}; try { const saved = localStorage.getItem('shtabAllChats'); if (saved) allChats = JSON.parse(saved); } catch (e) {}
let currentChatId = localStorage.getItem('shtabCurrentChatId') || null;
let selectedAIModel = localStorage.getItem('shtabAIModel') || 'yandex';

/* --- ОДИН ЧАТ: ВСЕГДА АРХИТЕКТОР ---
   Помощник и его ИИ-шлюз (:8002) убраны из Штаба. Переключателя «кому»
   больше нет — любое сообщение Босса уходит Архитектору Штаба. */

/* --- БЕСПЛАТНАЯ МОДЕЛЬ — ПОСЛЕДНИЙ РУБЕЖ НАДЗИРАТЕЛЯ ---
   Когда Архитектор не ответил, надзиратель зовёт сюда: запрос уходит
   на основной сервер Штаба с бесплатным маршрутом (0 ₽, без карты).
   Отдельного ИИ-шлюза :8002 больше нет — только PROXY. */
async function sendToFreeModel(text) {
    const freeId = (typeof firstFreeId === 'function') ? firstFreeId() : '';
    const freeInfo = (typeof getModelInfo === 'function') ? getModelInfo(freeId) : null;
    const freeLabel = (freeInfo && freeInfo.label) ? freeInfo.label : 'free';
    try {
        const r = await fetch(PROXY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: text }], temperature: 0.6, model: freeId, isBoss: true })
        }, 95000);
        const d = await r.json().catch(() => ({}));
        const answer = (d && d.choices && d.choices[0]) ? String(d.choices[0].message.content || '') : '';
        if (answer) {
            renderMessage(answer, 'director', 'Бесплатная модель');
            addMessageToHistory(answer, 'director', 'Бесплатная модель');
            renderMessage('🆓 *[Ответила БЕСПЛАТНАЯ модель: ' + freeLabel + ' — 0 ₽]*', 'director', 'Бесплатная модель');
            return true;
        }
        throw new Error((d && d.error) || 'пустой ответ');
    } catch (e) {
        const msg = (e && e.name === 'AbortError') ? 'таймаут 95 сек' : ((e && e.message) || 'сбой');
        const errText = '⚠️ Бесплатная модель не ответила: ' + msg;
        renderMessage(errText, 'director', 'Бесплатная модель');
        addMessageToHistory(errText, 'director', 'Бесплатная модель');
        return false;
    }
}

/* --- СПИСОК МОДЕЛЕЙ ИИ ---
   Бесплатные маршруты идут через тот же шлюз: при нулевом балансе они
   доступны без оплаты и без карты, формат запроса — обычный OpenAI.
   Список хранится в localStorage (shtabAIModels) — можно править без кода.
   Модель с полем free: true попадает на отдельную кнопку 🆓 Бесплатные.
   Платные можно отключить целиком (флаг shtabPaidModels) — тогда они
   не показываются в панели и не выбираются. */
const AI_MODELS_DEFAULT = [
    { id: 'yandex',   label: 'Yandex',    color: '#333',    text: '#aaa' },
    { id: 'deepseek', label: 'DeepSeek',  color: '#4CAF50', text: '#fff' },
    { id: 'gigachat', label: 'GigaChat',  color: '#7B61FF', text: '#fff' },
    /* 🅰️ АРХИТЕКТОР — ОТДЕЛЬНЫЙ КАНАЛ. exclusive: true — автоподбор и
       автосмена моделей его НЕ трогают. Вход только через кнопку 🅰️. */
    { id: 'zveno',    label: 'Zveno',     color: '#00e5ff', text: '#000', exclusive: true },
    /* --- БЕСПЛАТНЫЕ МАРШРУТЫ (0 ₽ вход/выход, без карты) --- */
    /* dots-studio/dots-3-note-preview:free — ДЕАКТИВИРОВАНА платформой, из списка убрана */
    { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano Omni', color: '#76b900', text: '#000', free: true },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra', color: '#76b900', text: '#000', free: true },
    { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning', color: '#76b900', text: '#000', free: true },
    { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'Nemotron 3.5 Super VL', color: '#76b900', text: '#000', free: true },
    { id: 'recursive/flint-v1.0:free', label: 'Flint', color: '#ff7043', text: '#000', free: true },
    /* --- ЛОКАЛЬНАЯ МОДЕЛЬ НА ПК (Ollama) ---
       Работает без ключей и без оплаты: запрос уходит на свой ПК через
       шлюз Caddy (путь /ollama/*). Имя модели хранится в localStorage. */
    { id: 'ollama', label: 'Ollama (ПК)', color: '#ff9800', text: '#000', free: true }
];
let AI_MODELS = AI_MODELS_DEFAULT;
/* Версия списка: подняли — старый сохранённый список в localStorage
   перезаписывается новым (иначе у Босса остался бы старый набор моделей). */
const AI_MODELS_VERSION = '2026-02-15-free6-ollama';   // dots-studio деактивирована платформой — убрана из списка
try {
    const ver = localStorage.getItem('shtabAIModelsVer');
    const sm = localStorage.getItem('shtabAIModels');
    if (ver === AI_MODELS_VERSION && sm) {
        const p = JSON.parse(sm);
        if (Array.isArray(p) && p.length) AI_MODELS = p;
    } else {
        localStorage.setItem('shtabAIModelsVer', AI_MODELS_VERSION);
        localStorage.removeItem('shtabAIModels');
    }
} catch (e) {}
function getModelInfo(id) { return AI_MODELS.find(m => m.id === id) || AI_MODELS[0]; }

/* --- ЛОКАЛЬНАЯ МОДЕЛЬ OLLAMA (ПК) ---
   Адрес задаётся путём через шлюз: Caddy проксирует /ollama/* на ПК:11434,
   поэтому IP в коде не нужен — Штаб стучится в свой же домен по HTTPS.
   Имя модели меняется в localStorage (shtabOllamaModel), по умолчанию
   qwen2.5-coder:7b. Запрос идёт на OpenAI-совместимый endpoint Ollama. */
const OLLAMA_ENDPOINT = PROXY + '/ollama/v1/chat/completions';
function ollamaModel() { return localStorage.getItem('shtabOllamaModel') || 'qwen2.5-coder:7b'; }
function isOllamaModel(id) { return id === 'ollama'; }
/* --- МЕТКА «КТО ОТВЕТИЛ» ---
   Босс должен видеть, какая модель реально ответила: бесплатная (0 ₽) или платная.
   Строчка ставится в чат после каждого ответа. */
function modelBadgeText(id) {
    const info = AI_MODELS.find(m => m.id === id);
    if (!info) return '❔ *[Модель: ' + id + ']*';
    if (id === 'zveno') return '🅰️ *[Ответил АРХИТЕКТОР (ZVENO) — отдельный канал, свой ключ]*';
    if (info.free) return '🆓 *[Ответила БЕСПЛАТНАЯ модель: ' + info.label + ' — 0 ₽]*';
    if (id === 'gigachat') return '🟣 *[Ответила модель: GigaChat (Сбер) — по ключу GIGACHAT_KEY]*';
    return '💳 *[Ответила платная модель: ' + info.label + ']*';
}

/* --- БЕСПЛАТНЫЕ / ПЛАТНЫЕ ---
   freeModels() — модели с пометкой free: true (кнопка 🆓 Бесплатные).
   paidEnabled() — разрешены ли платные (переключатель в панели 🧠 ИИ).
   allowedModels() — то, что реально можно выбрать сейчас.
   resolveAllowedModel() — страховка: платная модель при отключённых платных
   не уйдёт на сервер, запрос уедет на бесплатный маршрут. */
function freeModels() { return AI_MODELS.filter(m => m && m.free); }
/* --- ЖИВАЯ МОДЕЛЬ ПО УМОЛЧАНИЮ ---
   dots-studio платформа ДЕАКТИВИРОВАЛА. Раньше при выключении Архитектора
   (и в других местах) дефолтом бралась freeModels()[0] — то есть мёртвая
   dots. Отсюда ошибка «model has been deactivated» после выключения 🅰️.
   Теперь дефолт — первая ВКЛЮЧЁННАЯ и живая бесплатная модель. */
const DEAD_MODEL_IDS = ['dots-studio/dots-3-note-preview:free'];
function firstFreeId() {
    const list = freeModels().filter(m => m.id !== 'ollama' && DEAD_MODEL_IDS.indexOf(m.id) === -1 && modelEnabled(m.id));
    return list.length ? list[0].id : 'nvidia/nemotron-3.5-lightning:free';
}
/* Платные — БЕЗ Архитектора: 🅰️ Zveno живёт отдельным каналом (свой ключ,
   своя кнопка) и в общий список платных моделей не попадает. */
function paidModels() { return AI_MODELS.filter(m => m && !m.free && m.id !== 'zveno'); }
function paidEnabled() { return localStorage.getItem('shtabPaidModels') !== 'off'; }
function setPaidEnabled(on) {
    localStorage.setItem('shtabPaidModels', on ? 'on' : 'off');
    const cur = getModelInfo(selectedAIModel);
    if (!on && cur && !cur.free && cur.id !== 'gigachat') {
        selectedAIModel = firstFreeId();
        localStorage.setItem('shtabAIModel', selectedAIModel);
    }
    if (typeof applyAIModelButton === 'function') applyAIModelButton();
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
}
/* В список разрешённых попадают ТОЛЬКО включённые модели: выключенную
   кнопкой модель нельзя выбрать и нельзя подставить автоподбором. */
function allowedModels() {
    return freeModels().filter(m => modelEnabled(m.id))
        .concat(paidEnabled() ? paidModels().filter(m => modelEnabled(m.id)) : []);
}
function resolveAllowedModel(id) {
    /* ❗ ПЕРЕБОРА МОДЕЛЕЙ НЕТ (приказ Босса).
       Отвечает ТОЛЬКО та модель, которую выбрал Босс. Упала — в чат идёт
       честная ошибка. Автоподмена на бесплатную/другую модель запрещена:
       никакого автоподбора, никакой автосмены, никакого «аварийного резерва». */
    return id || selectedAIModel || 'gigachat';
}

/* =========================================
   🅰️ АРХИТЕКТОР — ОТДЕЛЬНЫЙ КАНАЛ (ZVENO)
   Всё, что связано с ZVENO, Босс держит ОТДЕЛЬНО от остальных моделей:
   1) своя кнопка 🅰️ (вкл/выкл) — единственный вход;
   2) свой ключ (architectKey) — не общий ZV и не GigaChat;
   3) автоподбор/автосмена Архитектора НЕ трогают (exclusive: true).
   Выключен — запрос на ZVENO не уходит вообще.
   Ключ хранится в shtabUserKeys на устройстве и уходит на сервер
   в userKeys.architectKey. В код и в Git он НИКОГДА не пишется.
   ========================================= */
function architectEnabled() { try { return localStorage.getItem('shtabArchitectOn') === 'on'; } catch (e) { return false; } }
function architectKey() {
    try { const k = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; return k.architectKey || ''; } catch (e) { return ''; }
}
function setArchitectKey(v) {
    let k = {};
    try { k = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) { k = {}; }
    k.architectKey = String(v || '').trim();
    try { localStorage.setItem('shtabUserKeys', JSON.stringify(k)); } catch (e) {}
    return k.architectKey;
}
function setArchitectEnabled(on) {
    try { localStorage.setItem('shtabArchitectOn', on ? 'on' : 'off'); } catch (e) {}
    if (!on && selectedAIModel === 'zveno') {
        // Выключили Архитектора — уводим на прежнюю/бесплатную модель.
        const prev = localStorage.getItem('shtabAIModelBeforeArch') || '';
        selectedAIModel = (prev && prev !== 'zveno' && getModelInfo(prev) && modelEnabled(prev)) ? prev
            : firstFreeId();
        try { localStorage.setItem('shtabAIModel', selectedAIModel); } catch (e) {}
    }
    if (typeof applyArchitectButton === 'function') applyArchitectButton();
    if (typeof applyAIModelButton === 'function') applyAIModelButton();
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
    if (typeof syncModeButtons === 'function') syncModeButtons();
    if (typeof renderMessage === 'function') {
        renderMessage(on
            ? '🅰️ *[Архитектор ВКЛЮЧЁН — отдельный канал ZVENO. Автоподбор его не трогает.]*'
            : '🅰️ *[Архитектор ВЫКЛЮЧЕН — ZVENO не выбирается и не подставляется.]*', 'director', 'Оркестратор');
    }
}
/* ТОЛЬКО внешний вид кнопки — без вызова соседних apply-функций (без рекурсии). */
function updateArchitectButtonVisual() {
    const b = document.getElementById('btnArchitect');
    if (!b) return;
    if (architectEnabled()) {
        b.classList.add('active', 'mode-on');
        b.innerText = (selectedAIModel === 'zveno') ? '🅰️ Архитектор: ВКЛ' : '🅰️ Архитектор: ВКЛ';
        b.style.borderColor = '#00e5ff';
        b.style.color = '#00e5ff';
        b.style.background = 'rgba(0,229,255,.14)';
    } else {
        b.classList.remove('active', 'mode-on');
        b.innerText = '🅰️ Архитектор';
        b.style.borderColor = '#00e5ff';
        b.style.color = '#00e5ff';
        b.style.background = '';
    }
}
function applyArchitectButton() { updateArchitectButtonVisual(); }
function selectArchitect() {
    // Выбрать Архитектора вручную можно только при включённой кнопке.
    if (!architectEnabled()) {
        if (typeof renderMessage === 'function') renderMessage('🔒 *[Архитектор выключен. Включи кнопку 🅰️ — тогда ZVENO станет доступен.]*', 'director', 'Оркестратор');
        return false;
    }
    if (selectedAIModel !== 'zveno') { try { localStorage.setItem('shtabAIModelBeforeArch', selectedAIModel); } catch (e) {} }
    selectedAIModel = 'zveno';
    try { localStorage.setItem('shtabAIModel', selectedAIModel); } catch (e) {}
    applyArchitectButton();
    if (typeof applyAIModelButton === 'function') applyAIModelButton();
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
    return true;
}
window.architectEnabled = architectEnabled;
window.architectKey = architectKey;
window.setArchitectKey = setArchitectKey;
window.setArchitectEnabled = setArchitectEnabled;
window.applyArchitectButton = applyArchitectButton;
window.updateArchitectButtonVisual = updateArchitectButtonVisual;
window.selectArchitect = selectArchitect;

/* =========================================
   🔑 УНИВЕРСАЛЬНЫЙ КАНАЛ МОДЕЛИ (вкл/выкл + свой ключ)
   У КАЖДОЙ модели — своя кнопка вкл/выкл и своё поле ключа,
   ровно как у Архитектора (🅰️ ZVENO). Логика одна на всех:
   1) shtabModelOn   — { id: 'on'|'off' }  (по умолчанию ВКЛ);
   2) shtabModelKeys — { id: 'ключ' }      (ключ модели, отдельно от общих);
   3) выключенная модель не выбирается, не подставляется автоподбором
      и запрос к ней на сервер НЕ уходит;
   4) ключ уходит на сервер в userKeys[<id модели>] и в код/Git не пишется.
   Архитектор (zveno) живёт своей кнопкой 🅰️ — здесь он только читается.
   ========================================= */
function modelOnMap() { try { return JSON.parse(localStorage.getItem('shtabModelOn')) || {}; } catch (e) { return {}; } }
function modelKeysMap() { try { return JSON.parse(localStorage.getItem('shtabModelKeys')) || {}; } catch (e) { return {}; } }
function modelEnabled(id) {
    if (!id) return false;
    if (id === 'zveno') return architectEnabled();          // Архитектор — своя кнопка 🅰️
    const m = modelOnMap();
    return m[id] !== 'off';                                  // по умолчанию модель включена
}
function modelKey(id) {
    if (!id) return '';
    if (id === 'zveno') return architectKey();               // ключ Архитектора — отдельно
    const k = modelKeysMap();
    return k[id] || '';
}
function setModelKey(id, v) {
    if (!id) return '';
    if (id === 'zveno') return setArchitectKey(v);           // Архитектор пишет в свой слот
    const k = modelKeysMap();
    k[id] = String(v || '').trim();
    try { localStorage.setItem('shtabModelKeys', JSON.stringify(k)); } catch (e) {}
    return k[id];
}
function setModelEnabled(id, on) {
    if (!id) return false;
    if (id === 'zveno') { setArchitectEnabled(on); return on; }   // Архитектор — своя кнопка 🅰️
    const m = modelOnMap();
    m[id] = on ? 'on' : 'off';
    try { localStorage.setItem('shtabModelOn', JSON.stringify(m)); } catch (e) {}
    // Выключили модель, которая сейчас выбрана — уводим на разрешённую.
    if (!on && selectedAIModel === id) {
        selectedAIModel = firstFreeId();
        try { localStorage.setItem('shtabAIModel', selectedAIModel); } catch (e) {}
    }
    if (typeof applyAIModelButton === 'function') applyAIModelButton();
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
    if (typeof applyGigaChatButton === 'function') applyGigaChatButton();
    if (typeof applyArchitectButton === 'function') applyArchitectButton();
    if (typeof renderModelPanel === 'function') renderModelPanel();
    return on;
}
window.modelEnabled = modelEnabled;
window.modelKey = modelKey;
window.setModelKey = setModelKey;
window.setModelEnabled = setModelEnabled;
window.modelOnMap = modelOnMap;
window.modelKeysMap = modelKeysMap;

/* --- ОТДЕЛЬНАЯ КНОПКА «🟣 GIGACHAT» ---
   Босс включает GigaChat (Сбер) одним тапом, не заходя в список моделей.
   Тап — включить, повторный тап — вернуть ту модель, что была до этого.
   Выбор запоминается на устройстве (shtabAIModel). */
function isGigaChatActive() { return selectedAIModel === 'gigachat'; }
/* ТОЛЬКО внешний вид кнопки — без вызова соседних apply-функций.
   Так её можно звать из applyAIModelButton / applyFreeModelButton
   без бесконечной рекурсии (те зовут её, она — их). */
function updateGigaChatButtonVisual() {
    const b = document.getElementById('btnGigaChat');
    if (!b) return;
    if (isGigaChatActive()) {
        b.classList.add('active');
        b.innerText = '🟣 GigaChat: ВКЛ';
        b.style.borderColor = '#7B61FF';
        b.style.color = '#b9a8ff';
        b.style.background = 'rgba(123,97,255,.16)';
    } else {
        b.classList.remove('active');
        b.innerText = '🟣 GigaChat';
        b.style.borderColor = '#7B61FF';
        b.style.color = '#7B61FF';
        b.style.background = '';
    }
}
function applyGigaChatButton() {
    updateGigaChatButtonVisual();
    // Кнопки «Платные» / «Бесплатные» перерисовываем, чтобы не показывали чужой выбор.
    if (typeof applyAIModelButton === 'function') { try { applyAIModelButton(); } catch (e) {} }
    if (typeof applyFreeModelButton === 'function') { try { applyFreeModelButton(); } catch (e) {} }
}
function toggleGigaChat() {
    if (isGigaChatActive()) {
        const prev = localStorage.getItem('shtabAIModelBeforeGiga') || 'yandex';
        selectedAIModel = getModelInfo(prev) ? prev : 'yandex';
        renderMessage('🟣 *[GigaChat выключен — вернул прежнюю модель]*', 'director', 'Оркестратор');
    } else {
        localStorage.setItem('shtabAIModelBeforeGiga', selectedAIModel);
        selectedAIModel = 'gigachat';
        renderMessage('🟣 *[GigaChat включён — следующие ответы идут через Сбер (GIGACHAT_KEY)]*', 'director', 'Оркестратор');
    }
    try { localStorage.setItem('shtabAIModel', selectedAIModel); } catch (e) {}
    applyGigaChatButton();
}
window.toggleGigaChat = toggleGigaChat;
window.applyGigaChatButton = applyGigaChatButton;

/* --- БЮДЖЕТ ЗАПРОСОВ НА ОДИН ВОПРОС БОССА ---
   Каждый запрос к модели = деньги. Раньше цепочки (этапы, авто-пинки,
   Совет, фоновые задачи) могли накрутить десятки запросов на ОДНО
   сообщение Босса — и баланс таял. Теперь на один вопрос Босса —
   не больше TURN_MAX_CALLS запросов к модели. Счётчик сбрасывается
   только когда Босс пишет новое сообщение (не авто-пинок). */
const TURN_MAX_CALLS = 8;
let turnCalls = 0;
function resetTurnCalls() { turnCalls = 0; }
function takeTurnCall() { turnCalls++; return turnCalls <= TURN_MAX_CALLS; }

const chatContainer = document.getElementById('chatContainer');
// Делегированный обработчик: разворот миниатюр по клику (переживает перерисовку innerHTML).
if (chatContainer) chatContainer.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('chat-thumbnail')) t.classList.toggle('expanded');
});
const chatListEl = document.getElementById('chatList');
const sendBtn = document.getElementById('sendBtn');
const chatTitleEl = document.getElementById('currentChatTitle');
const chatInputEl = document.getElementById('chatInput');

const WELCOME_TEXT = "Привет! 👋 Я администратор этого чата — Архитектор Штаба.\n\nЗадавай вопросы, говори что нужно сделать — узнаем, придумаем, соберём. С чего начнём?";
const SYSTEM_PROMPT = `Ты — Цифровой Архитектор Штаба. Senior-инженер и сисадмин. Управляешь кодом проекта и решаешь задачи Босса.

=== СКОРОСТЬ ===
1. Думай коротко, сразу действуй. Без рассуждений вслух.
2. Минимум вызовов. Не читай файл целиком, если нужен фрагмент.
3. Не повторяй вызов. Не вышло — меняй подход.
4. Ответ Боссу: что сделал, где, ссылка. Без воды и пересказа кода.
5. Задача ясна → сразу вызывай инструмент. Отчёт после выполнения.
6. Запрещены фразы: "сейчас сделаю", "приступаю", "подожди", "дай секунду", "анализирую", "сейчас посмотрю".

=== ИНСТРУМЕНТЫ ===
read_file(path, repo) · replace_in_file(path, search, replace, repo) — ГЛАВНЫЙ · write_file(path, content, repo) · search_web(query) · get_weather(city) · search_image(query) — выведи [IMAGE_URL]ссылка[/IMAGE_URL] · create_github_repo(name, desc, is_private) · list_github_repos() · delete_github_repo(name) (digital-agency и window_calc защищены) · list_repo_files(repo) · delete_file(path, repo) (main.ts и backup/ запрещены) · enable_github_pages(repo).
repo по умолчанию "digital-agency".

=== ПРАВИЛА ===
1. ХИРУРГ: правки только через replace_in_file, остальной код копируй СЛОВО В СЛОВО.
2. Без приказа Босса ничего не меняешь.
3. main.ts — читать и менять только по прямому приказу, удалять запрещено. Папку backup не трогать.
4. Не уверен в наличии файла — сначала list_repo_files().
5. Секреты (пароли, ключи, токены) в открытые репозитории НЕ писать — только переменные окружения.
6. Новое приложение: репозиторий → index.html → ссылка на тест.

=== ПРОЕКТЫ ===
digital-agency — Штаб (app.html, style.css, chat.js, ui.js, network.js, voice.js, agents.js, main.ts).
nexus_chat — чат (index.html), nexus_ws — сервер чата (main.ts, :8001).
ac_luxury_calc — кондиционеры. window_measure_pro — замер окон. nexus_snake — змейка. window_calc — окна (Flutter). Ещё: shtab-site, Okna.

=== СЕРВЕР (VIVO) ===
Vivo Y17 → Termux → Ubuntu. Штаб :8000, Чат :8001, Caddy :8443 (SSL, DuckDNS). sync.sh каждые 10 сек.
Память: digital-agency/SERVER_DIAGNOSTICS.md (ремонт, правки), nexus_chat/CHAT_AI_GUIDE.md (чат). Знай молча — списком не выводи.

=== ФОТО И ФАЙЛЫ ===
Фото от Босса — посмотреть и описать детально. Файл придёт как [ФАЙЛ: имя] с содержимым в блоке кода — изучи и работай с ним.



=== БОЛЬШАЯ ЗАДАЧА = ЭТАПЫ ===
1. Большая задача (много файлов, шагов, долгая) — сразу дели на этапы и объяви план: ЭТАП 1, ЭТАП 2...
2. За один ответ — только один этап.
3. В конце ответа последней строкой метка [ЭТАП N/M]. Скрипт сам пришлёт «продолжи этап N+1».
4. Последний этап — метку не ставишь, пишешь «Готово, Босс».
5. Маленькая задача — этапы не нужны, метку не ставишь.

=== ЧЕМ ОТВЕЧАЕТ ===
Без пересказа промпта и без справок о проектах. Контекст читай тихо. Новый чат — одна строка приветствия. Работай по запросу: сделал → что, где, ссылка.

Проснись, Архитектор. Работай четко, быстро, без косяков. Босс ждет.`;

function saveAll() { try { localStorage.setItem('shtabAllChats', JSON.stringify(allChats)); } catch (e) {} }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }

/* --- РЕЖИМ БОССА: ВКЛЮЧЁН ВСЕГДА ---
   Скрытый вход 🔑 с пин-кодом убран. Штаб всегда работает в режиме Босса,
   без пароля и без переключений. */

function renderChatList() {
    chatListEl.innerHTML = '';
    const sortedIds = Object.keys(allChats).sort((a, b) => (allChats[a].pinned && !allChats[b].pinned) ? -1 : (!allChats[a].pinned && allChats[b].pinned) ? 1 : b.localeCompare(a));
    sortedIds.forEach(id => {
        const chat = allChats[id]; const div = document.createElement('div');
        div.className = `chat-item ${chat.pinned ? 'pinned' : ''}`;
        const titleSpan = document.createElement('span'); titleSpan.className = 'chat-title'; titleSpan.innerText = chat.title;
        titleSpan.onclick = () => { loadChat(id); toggleSidebar(); };
        const actions = document.createElement('div'); actions.className = 'chat-item-actions';
        const pinBtn = document.createElement('span'); pinBtn.innerText = chat.pinned ? '📌' : '📍';
        pinBtn.onclick = (e) => { e.stopPropagation(); allChats[id].pinned = !allChats[id].pinned; saveAll(); renderChatList(); };
        const delBtn = document.createElement('span'); delBtn.innerText = '🗑️';
        delBtn.onclick = (e) => { e.stopPropagation(); if (confirm("Удалить?")) { delete allChats[id]; if (currentChatId === id) createNewChat(true); else { saveAll(); renderChatList(); } } };
        actions.appendChild(pinBtn); actions.appendChild(delBtn); div.appendChild(titleSpan); div.appendChild(actions); chatListEl.appendChild(div);
    });
}

function clearAllChats() {
    if (!confirm("Очистить всю историю чатов? Это действие нельзя отменить.")) return;
    allChats = {};
    Object.keys(localStorage).forEach(k => { if (k.startsWith('shtabChatImage_')) localStorage.removeItem(k); });
    localStorage.removeItem('shtabAllChats');
    localStorage.removeItem('shtabCurrentChatId');
    currentChatId = null;
    renderChatList();
    createNewChat(true);
}

function createNewChat(force = false) {
    if (Object.keys(allChats).length >= 10 && !force) { if (confirm("Лимит 10 чатов. Удалить старые?")) toggleSidebar(); return; }
    const id = 'chat_' + Date.now();
    allChats[id] = { id: id, title: "Новый чат", pinned: false, messages: [{ role: "system", content: SYSTEM_PROMPT }] };
    currentChatId = id; saveAll(); chatContainer.innerHTML = ''; chatTitleEl.innerText = "Новый чат";
    allChats[id].messages.push({ role: 'assistant', content: WELCOME_TEXT, agentName: 'Оркестратор' }); saveAll();
    selectedAgents = []; document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected', 'has-idea'));
    if (typeof resetAllStatuses === 'function') resetAllStatuses(); renderChatList(); toggleSidebar(); loadChat(id);
}

function loadChat(id) { currentChatImage = localStorage.getItem('shtabChatImage_' + id) || null;
    currentChatId = id; localStorage.setItem('shtabCurrentChatId', id);
    chatTitleEl.innerText = allChats[id].title; chatContainer.innerHTML = '';
    selectedAgents = []; document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected', 'has-idea'));
    if (typeof resetAllStatuses === 'function') resetAllStatuses();
    const msgs = allChats[id].messages;
    for (let i = 1; i < msgs.length; i++) { 
        const msg = msgs[i];
        if (msg.role === 'user') renderMessage(msg.content, 'boss', 'Оркестратор', msg.file || null);
        else if (msg.agentName === 'Совет') parseAgentReplies(msg.content).forEach(r => renderMessage(r.text, 'director', r.agent));
        else renderMessage(msg.content, 'director', msg.agentName || 'Оркестратор');
    }
    chatContainer.scrollTop = chatContainer.scrollHeight; renderChatList();
}

function addMessageToHistory(text, sender, agentName = null, file = null) {
    const role = sender === 'boss' ? 'user' : 'assistant';
    if (allChats[currentChatId]) {
        const msgs = allChats[currentChatId].messages;
        const lastMsg = msgs[msgs.length - 1];
        // Дубль: то же самое сообщение подряд в течение 5 с второй раз не пишем (защита после F5).
        if (lastMsg && lastMsg.role === role && lastMsg.content === text && lastMsg.t && (Date.now() - lastMsg.t) < 5000) return;
        msgs.push({ role, content: text, agentName, t: Date.now(), file: file || undefined });
        if (role === 'user' && allChats[currentChatId].title === "Новый чат") {
            allChats[currentChatId].title = text.substring(0, 20) + (text.length > 20 ? "..." : "");
            chatTitleEl.innerText = allChats[currentChatId].title;
        }
    }
    saveAll(); renderChatList();
                                                                          }
function processDangerTags(text) {
    // Превращаем тег картинки от ИИ в реальную картинку (с возможностью развернуть)
    text = text.replace(/\[IMAGE_URL\](.*?)\[\/IMAGE_URL\]/g, '<img src="$1" class="chat-thumbnail" />');
    
    text = text.replace(/\[SEARCH:[^\]]+\]/g, '').replace(/\[FUNCTION:[^\]]+\]/g, '').replace(/\[READ:[^\]]+\]/g, '').replace(/\[FILE:[^\]]+\]/g, '').replace(/\[TASK:[^\]]+\]/g, '');
    text = text.replace(/\[([^\]]+)\]/g, (match, name) => {
        if (name.includes(':') || name.includes('CMD')) return match;
        if (Object.keys(AGENT_ICONS).find(a => a.toLowerCase() === name.trim().toLowerCase())) return match;
        return '';
    });
    const dangerRegex = /\[DANGER:([^\]]+)\]/g; let dangerBadges = ''; let match;
    while ((match = dangerRegex.exec(text)) !== null) { const safeMsg = String(match[1]).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); dangerBadges += `<div class="danger-link-badge">⚠️ ОПАСНО! Хакер обнаружил угрозу: ${safeMsg}</div>`; }
    return { cleanText: text.replace(dangerRegex, '').trim(), dangerBadges };
}

/* =========================================
   --- ПОГОДНАЯ КАРТОЧКА (КРАСИВОЕ ОКНО) ---
   ========================================= */
const WEATHER_CARD_RE = /\[\[WEATHER_CARD\]\]([\s\S]*?)\[\[\/WEATHER_CARD\]\]/g;

function extractWeatherCards(text) {
    const cards = [];
    const cleanText = String(text || '').replace(WEATHER_CARD_RE, (m, json) => {
        try { cards.push(JSON.parse(json)); } catch (e) {}
        return '';
    });
    return { cleanText: cleanText.trim(), cards: cards };
}

function buildWeatherCard(d) {
    const wrap = document.createElement('div');
    wrap.className = 'weather-card';
    if (!d || typeof d !== 'object') return wrap;

    const num = v => (v === undefined || v === null || v === '' || isNaN(v)) ? null : Number(v);
    const fmtTemp = v => { const n = num(v); return n === null ? '—' : (n > 0 ? '+' : '') + Math.round(n) + '°'; };

    const head = document.createElement('div'); head.className = 'wc-head';

    const placeBox = document.createElement('div'); placeBox.className = 'wc-place';
    const emojiEl = document.createElement('div'); emojiEl.className = 'wc-emoji'; emojiEl.textContent = d.emoji || '🌡️';
    const placeText = document.createElement('div'); placeText.className = 'wc-place-text';
    const cityEl = document.createElement('div'); cityEl.className = 'wc-city'; cityEl.textContent = d.city || '—';
    placeText.appendChild(cityEl);
    if (d.country) { const c = document.createElement('div'); c.className = 'wc-country'; c.textContent = d.country; placeText.appendChild(c); }
    if (d.desc) { const ds = document.createElement('div'); ds.className = 'wc-desc'; ds.textContent = d.desc; placeText.appendChild(ds); }
    placeBox.appendChild(emojiEl); placeBox.appendChild(placeText);

    const tempBox = document.createElement('div'); tempBox.className = 'wc-tempbox';
    const tempEl = document.createElement('div'); tempEl.className = 'wc-temp'; tempEl.textContent = fmtTemp(d.temp);
    tempBox.appendChild(tempEl);
    if (num(d.feels) !== null) { const f = document.createElement('div'); f.className = 'wc-feels'; f.textContent = 'ощущается ' + fmtTemp(d.feels); tempBox.appendChild(f); }

    head.appendChild(placeBox); head.appendChild(tempBox);
    wrap.appendChild(head);

    const items = [];
    if (num(d.wind) !== null) items.push(['💨', 'Ветер', Math.round(Number(d.wind)) + ' км/ч' + (d.dir ? ' ' + d.dir : '')]);
    if (num(d.hum) !== null) items.push(['💧', 'Влажность', Math.round(Number(d.hum)) + '%']);
    if (num(d.press) !== null) items.push(['📊', 'Давление', Math.round(Number(d.press)) + ' гПа']);
    if (num(d.visib) !== null) items.push(['👁️', 'Видимость', Math.round(Number(d.visib)) + ' км']);
    if (num(d.cloud) !== null) items.push(['☁️', 'Облачность', Math.round(Number(d.cloud)) + '%']);
    if (num(d.precip) !== null) items.push(['🌧️', 'Осадки', (Math.round(Number(d.precip) * 10) / 10) + ' мм']);

    if (items.length) {
        const grid = document.createElement('div'); grid.className = 'wc-grid';
        items.forEach(it => {
            const cell = document.createElement('div'); cell.className = 'wc-item';
            const ico = document.createElement('span'); ico.className = 'wc-ico'; ico.textContent = it[0];
            const lab = document.createElement('span'); lab.className = 'wc-label'; lab.textContent = it[1];
            const val = document.createElement('span'); val.className = 'wc-val'; val.textContent = it[2];
            cell.appendChild(ico); cell.appendChild(lab); cell.appendChild(val);
            grid.appendChild(cell);
        });
        wrap.appendChild(grid);
    }

    if (Array.isArray(d.daily) && d.daily.length) {
        const fc = document.createElement('div'); fc.className = 'wc-forecast';
        d.daily.slice(0, 3).forEach(day => {
            const row = document.createElement('div'); row.className = 'wc-fday';
            const name = document.createElement('span'); name.className = 'wc-fname'; name.textContent = day.label || '';
            const em = document.createElement('span'); em.className = 'wc-femoji'; em.textContent = day.emoji || '🌡️';
            const tg = document.createElement('span'); tg.className = 'wc-ftemp'; tg.textContent = fmtTemp(day.min) + '…' + fmtTemp(day.max);
            const ds = document.createElement('span'); ds.className = 'wc-fdesc'; ds.textContent = day.desc || '';
            row.appendChild(name); row.appendChild(em); row.appendChild(tg); row.appendChild(ds);
            fc.appendChild(row);
        });
        wrap.appendChild(fc);
    }

    return wrap;
}

function shareMessage(text) {
    if (navigator.share) navigator.share({ title: 'Штаб', text: text }).catch(e => console.log(e));
    else navigator.clipboard.writeText(text).then(() => alert("Скопировано!"));
}

/* --- КНОПКА «КОПИРОВАТЬ» НА БЛОКАХ КОДА --- */
function _injectCodeCss() {
    if (document.getElementById('codeCopyCss')) return;
    const st = document.createElement('style'); st.id = 'codeCopyCss';
    st.textContent = `
    .code-wrap { position: relative; margin: 10px 0; }
    .code-wrap pre { margin: 0 !important; padding-top: 36px !important; }
    .code-copy-btn {
        position: absolute; top: 6px; right: 6px; z-index: 5;
        padding: 4px 10px; font-size: 11px; font-weight: 700;
        font-family: inherit; letter-spacing: .3px;
        background: rgba(0,229,255,.14); color: #00e5ff;
        border: 1px solid rgba(0,229,255,.45); border-radius: 7px;
        cursor: pointer; transition: .18s; backdrop-filter: blur(4px);
    }
    .code-copy-btn:hover { background: rgba(0,229,255,.28); }
    .code-copy-btn:active { transform: scale(.95); }
    .code-copy-btn.copied { background: rgba(76,175,80,.25); color: #7ee08a; border-color: rgba(76,175,80,.6); }
    `;
    document.head.appendChild(st);
}
function enhanceCodeBlocks(container) {
    if (!container) return;
    const pres = container.querySelectorAll('pre');
    if (!pres.length) return;
    _injectCodeCss();
    pres.forEach(pre => {
        if (pre.parentElement && pre.parentElement.classList.contains('code-wrap')) return;
        const wrap = document.createElement('div'); wrap.className = 'code-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'code-copy-btn'; btn.innerText = '📋 Копировать';
        btn.onclick = (e) => {
            e.stopPropagation();
            const code = pre.innerText;
            const ok = () => { btn.innerText = '✅ Скопировано'; btn.classList.add('copied'); setTimeout(() => { btn.innerText = '📋 Копировать'; btn.classList.remove('copied'); }, 1600); };
            const fallback = () => {
                const ta = document.createElement('textarea');
                ta.value = code; ta.style.position = 'fixed'; ta.style.top = '-1000px';
                document.body.appendChild(ta); ta.focus(); ta.select();
                try { document.execCommand('copy'); ok(); } catch (err) { btn.innerText = '❌ Не вышло'; }
                document.body.removeChild(ta);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(ok).catch(fallback);
            else fallback();
        };
        wrap.appendChild(btn);
    });
}

function enhanceMediaInMessage(container) {
    container.querySelectorAll('a').forEach(link => {
        const url = link.href;
        if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
            let videoId = url.includes('youtu.be/') ? url.split('youtu.be/')[1].split('?')[0] : new URLSearchParams(new URL(url).search).get('v');
            if (videoId) { const v = document.createElement('div'); v.className = 'chat-video-container'; v.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>`; link.after(v); }
        } 
        else if (url.match(/\.(mp3|wav|ogg)$/i)) { const a = document.createElement('audio'); a.controls = true; a.src = url; a.className = 'chat-audio'; link.after(a); }
        else if (url.match(/\.(mp4|webm)$/i)) { const v = document.createElement('video'); v.controls = true; v.src = url; v.className = 'chat-media'; link.after(v); }
        else if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) { const i = document.createElement('img'); i.src = url; i.className = 'chat-media'; link.after(i); }
    });
    enhanceCodeBlocks(container);
}

async function manualDeploy(file, code) {
    if (confirm(`Внедрить новый код в файл ${file}?`)) {
        try {
            const res = await fetch(PROXY, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ updateFile: true, path: file, content: code, message: `Auto-update: ${file}` })
            });
            const data = await res.json();
            if (data.success) renderMessage(`✅ **Файл ${file} успешно обновлен!**`, 'director', 'DevOps');
            else renderMessage(`❌ **Ошибка:** ${data.error}`, 'director', 'DevOps');
        } catch(e) { renderMessage(`❌ **Сбой сети:** ${e.message}`, 'director', 'DevOps'); }
    }
}

function addDeployButton(container, text) {
    if (isAutoMode) return;
    let targetFile = "";
    
    const fileMatch = text.match(/\[FILE:\s*([^\]]+)\]/);
    if (fileMatch) {
        targetFile = fileMatch[1].trim();
    } else {
        if (/```css/i.test(text)) targetFile = "style.css";
        else if (/```html/i.test(text)) targetFile = "app.html";
        else if (/```(js|javascript)/i.test(text)) targetFile = "chat.js";
    }

    if (!targetFile) return;
    const codeMatch = /```(?:html|css|javascript|js)?\n([\s\S]*?)```/.exec(text);
    if (!codeMatch) return;
    const code = codeMatch[1];

    const btn = document.createElement('button');
    btn.innerText = `🛠️ Внедрить в ${targetFile}`;
    btn.style.marginTop = '10px'; btn.style.padding = '8px 12px';
    btn.style.background = '#00e5ff'; btn.style.color = '#000';
    btn.style.border = 'none'; btn.style.borderRadius = '5px';
    btn.style.fontWeight = 'bold'; btn.style.cursor = 'pointer';
    btn.onclick = () => { manualDeploy(targetFile, code); btn.remove(); };
    container.appendChild(btn);
}

function renderMessage(text, sender, agentName = 'Оркестратор', file = null) {
    const div = document.createElement('div'); div.className = 'chat-msg msg-' + sender;
    const shareBtn = document.createElement('button'); shareBtn.className = 'share-btn'; shareBtn.innerText = '📤'; shareBtn.onclick = () => shareMessage(text); div.appendChild(shareBtn);
    if (sender === 'director') {
        const speakBtn = document.createElement('button'); speakBtn.className = 'share-btn'; speakBtn.style.right = '35px'; speakBtn.innerText = '🔊'; speakBtn.onclick = () => speakText(text, agentName); div.appendChild(speakBtn);
        const header = document.createElement('div'); header.className = 'msg-name'; header.innerHTML = `<span class="msg-avatar">${AGENT_ICONS[agentName] || '🤖'}</span> ${agentName}`; header.onclick = () => speakText(text, agentName); div.appendChild(header);
    }
    if (sender === 'boss' && file) div.appendChild(buildFileChip(file, false));
    const wcParsed = extractWeatherCards(text);
    if (wcParsed.cards.length) div.classList.add('has-weather');
    const contentDiv = document.createElement('div'); const { cleanText, dangerBadges } = processDangerTags(wcParsed.cleanText);
    try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
    if (dangerBadges) contentDiv.innerHTML += dangerBadges;
    if (cleanText || dangerBadges) div.appendChild(contentDiv);
    wcParsed.cards.forEach(cd => div.appendChild(buildWeatherCard(cd)));
    chatContainer.appendChild(div); chatContainer.scrollTop = chatContainer.scrollHeight;
}

function typeMessage(fullText, sender, agentName, onComplete) {
    // НАДЗИРАТЕЛЬ: агент печатает ответ — он жив, передавать задачу некому.
    if (typeof window.supNoteActivity === 'function') window.supNoteActivity();
    const div = document.createElement('div'); div.className = 'chat-msg msg-' + sender;
    const shareBtn = document.createElement('button'); shareBtn.className = 'share-btn'; shareBtn.innerText = '📤'; shareBtn.onclick = () => shareMessage(fullText); div.appendChild(shareBtn);
    if (sender === 'director') {
        const speakBtn = document.createElement('button'); speakBtn.className = 'share-btn'; speakBtn.style.right = '35px'; speakBtn.innerText = '🔊'; speakBtn.onclick = () => speakText(fullText, agentName); div.appendChild(speakBtn);
        const header = document.createElement('div'); header.className = 'msg-name'; header.innerHTML = `<span class="msg-avatar">${AGENT_ICONS[agentName] || '🤖'}</span> ${agentName}`; div.appendChild(header);
    }
    const wcParsed = extractWeatherCards(fullText);
    const weatherCards = wcParsed.cards;
    if (weatherCards.length) div.classList.add('has-weather');
    const contentDiv = document.createElement('div'); div.appendChild(contentDiv); chatContainer.appendChild(div);

    let displayText = wcParsed.cleanText;
    
    if (displayText.includes('[FILE:') || displayText.includes('```')) {
        const { cleanText, dangerBadges } = processDangerTags(displayText);
        try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
        if (dangerBadges) contentDiv.innerHTML += dangerBadges;
        weatherCards.forEach(cd => div.appendChild(buildWeatherCard(cd)));
        chatContainer.scrollTop = chatContainer.scrollHeight;
        if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director' && !isSystemNotice(cleanText)) speakText(cleanText, agentName);
        if (onComplete) onComplete();
        return; 
    }

    const { cleanText, dangerBadges } = processDangerTags(displayText); let i = 0;
    
    const totalTimeMs = Math.max(500, cleanText.length * 4); 
    const speed = totalTimeMs / cleanText.length;
    
    function type() {
        if (i < cleanText.length) { 
            contentDiv.innerText = cleanText.substring(0, i + 1); 
            chatContainer.scrollTop = chatContainer.scrollHeight; 
            i++; 
            typingTimer = setTimeout(type, speed); 
        }
        else {
            try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
            if (dangerBadges) contentDiv.innerHTML += dangerBadges;
            weatherCards.forEach(cd => div.appendChild(buildWeatherCard(cd)));
            if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director' && !isSystemNotice(cleanText)) speakText(cleanText, agentName);
            if (onComplete) onComplete();
        }
    }
    type();
                                                                                                            }
function parseAgentReplies(text) {
    const agentNames = Object.keys(AGENT_ICONS); const regex = /(?:^|\n)\s*(?:\*\*)?\[?([А-Яа-яA-Za-z\s]+)\]?(?:\*\*)?:\s*/g;
    let match, lastIndex = 0, currentAgent = null, replies = [];
    while ((match = regex.exec(text)) !== null) {
        const possibleName = match[1].trim(); const foundAgent = agentNames.find(a => a.toLowerCase() === possibleName.toLowerCase());
        if (foundAgent) {
            if (currentAgent) { const agentText = text.substring(lastIndex, match.index).trim(); if (agentText) replies.push({ agent: currentAgent, text: agentText }); }
            currentAgent = foundAgent; lastIndex = regex.lastIndex;
        }
    }
    if (currentAgent) { const agentText = text.substring(lastIndex).trim(); if (agentText) replies.push({ agent: currentAgent, text: agentText }); }
    if (replies.length === 0 && text.trim()) replies.push({ agent: selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор', text: text.trim() });
    return replies;
}

async function playAgentReplies(replies) {
    for (let reply of replies) {
        focusAgentCard(reply.agent);
        const isTaskAgent = document.getElementById('agent-' + reply.agent)?.classList.contains('working');
        if (!isTaskAgent) { setAgentStatus(reply.agent, 'typing'); updateAgentStatus(reply.agent, 'busy'); }
        await new Promise(resolve => { typeMessage(reply.text, 'director', reply.agent, resolve); });
        if (!isTaskAgent) { setAgentStatus(reply.agent, 'idle'); updateAgentStatus(reply.agent, 'free'); }
        // 3D-ОФИС: ответ пришёл в чат — агент бросает печать и идёт с докладом к Боссу
        // 3D-ОФИС: ответ пришёл в чат — агент бросает печать и идёт к столу Босса
        // с НАЧАЛОМ НАСТОЯЩЕГО ответа, а не с дежурным «Готово, Босс!».
        if (typeof window.office3dReport === 'function') window.office3dReport(reply.agent, reply.text);
        await new Promise(r => setTimeout(r, 800)); 
    }
}

async function runBackgroundTask(agentName, taskDescription) {
    updateAgentStatus(agentName, 'working');
    setTimeout(async () => {
        try {
            if (!takeTurnCall()) { setAgentStatus(agentName, 'idle'); updateAgentStatus(agentName, 'free'); return; }   // бюджет исчерпан — фон не тратит деньги
            const keys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {};
            const bgModel = (typeof resolveAllowedModel === 'function') ? resolveAllowedModel(selectedAIModel) : selectedAIModel;
            const response = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: `Ты — ${agentName}. Выполнена задача: "${taskDescription}". Напиши краткий отчет.` }], temperature: 0.7, model: bgModel, userKeys: keys, freeKey: keys.freeKey || '', isBoss: true }) });
            const data = await response.json();
            // Учёт токенов делает перехватчик fetch в zveno_balance.js — РОВНО ОДИН раз.
            // Раньше здесь был ещё и явный zvenoAccount с ДРУГИМ текстом промпта:
            // подпись не совпадала, и фоновая задача списывалась ДВАЖДЫ.
            if (data.choices && data.choices.length > 0) { const r = data.choices[0].message.content; typeMessage(r, 'director', agentName); addMessageToHistory(r, 'director', agentName); }
        } catch(e) { console.error(e); }
        setAgentStatus(agentName, 'idle'); updateAgentStatus(agentName, 'free');
    }, 15000);
}

/* --- ОДИН АГЕНТ ДЕЛАЕТ СВОЮ ЧАСТЬ ЗАДАЧИ ---
   Надзиратель, когда задача большая, делит её между агентами и зовёт
   эту функцию на каждую часть. Агент отвечает сам, своим запросом,
   и его ответ печатается в чат от его имени. */
async function askAgent(agentName, partText) {
    if (typeof takeTurnCall === 'function' && !takeTurnCall()) return false;   // бюджет запросов исчерпан
    const directive = (typeof AGENT_DIRECTIVES !== 'undefined' && AGENT_DIRECTIVES[agentName]) || '';
    const sys = `Ты — ${agentName}, рабочий агент Штаба. ${directive}
Босс дал большую задачу — её разделили между агентами. Тебе досталась ОДНА часть.
Сделай ТОЛЬКО свою часть: коротко, по делу, с конкретным результатом.
Запрещено: приветствия, пересказ всей задачи, вопросы к Боссу, пустые фразы.`;
    const model = (typeof resolveAllowedModel === 'function') ? resolveAllowedModel(selectedAIModel) : selectedAIModel;
    let keys = {};
    try { keys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) {}
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 90000);
    try {
        if (typeof updateAgentStatus === 'function') updateAgentStatus(agentName, 'working');
        if (typeof window.office3dWork === 'function') window.office3dWork(agentName);
        const res = await fetch(PROXY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'system', content: sys }, { role: 'user', content: partText }], temperature: 0.6, model: model, userKeys: keys, freeKey: keys.freeKey || '', isBoss: true }),
            signal: ctrl.signal
        });
        const data = await res.json();
        const txt = (data && data.choices && data.choices[0]) ? String(data.choices[0].message.content || '').trim() : '';
        if (!txt) return false;
        renderMessage(txt, 'director', agentName);
        addMessageToHistory(`[${agentName} — своя часть задачи]: ${txt}`, 'director', agentName);
        if (typeof window.office3dReport === 'function') window.office3dReport(agentName, txt);
        return true;
    } catch (e) {
        return false;
    } finally {
        clearTimeout(tid);
        if (typeof updateAgentStatus === 'function') updateAgentStatus(agentName, 'free');
    }
}
window.askAgent = askAgent;

/* --- СТОРОЖ ТИШИНЫ ---
   Проверяет чат каждые 3 секунды, а не только по таймеру:
   1) ответа в чате нет вообще и прошло больше STALL_TIMEOUT_MS → пинок;
   2) ответ пришёл, но застыл и оборван на середине → пинок сразу,
      сколько бы секунд ни прошло.
   Не более STALL_MAX_KICKS пинков подряд. */
function resetStallKicks() { stallKicks = 0; try { localStorage.removeItem('shtabStallKicks'); localStorage.removeItem(kickGuardKey()); } catch (e) {} }
function stopStallWatchdog() { clearTimeout(stallWatchdog); stallWatchdog = null; clearInterval(stallInterval); stallInterval = null; }
function countDirectorMsgs() { return chatContainer ? chatContainer.querySelectorAll('.msg-director').length : 0; }
function lastDirectorText() {
    if (!chatContainer) return '';
    const nodes = chatContainer.querySelectorAll('.msg-director');
    if (!nodes.length) return '';
    return nodes[nodes.length - 1].innerText || '';
}
/* --- ЕДИНЫЙ АВТО-ПИНОК ---
   Все сторожа (тишина, оборвавшийся счётчик, жёсткий таймаут) зовут эту
   функцию. Она сама проверяет защиту от дублей и лимит пинков, обрывает
   зависший запрос и пишет «продолжи» от имени Босса. */
function fireAutoKick(reason) {
    if (kickGuardActive()) { stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); return false; }   // пинок уже был — дубль после F5 не шлём
    if (stallKicks >= STALL_MAX_KICKS) {
        renderMessage(`⏹️ *[Система: ${STALL_MAX_KICKS} авто-пинка без ответа — останавливаюсь. Жду Босса.]*`, 'director', 'Оркестратор');
        stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopHardWatchdog();
        return false;
    }
    stallKicks++;
    markKickSent();
    try { if (currentAbortController) currentAbortController.abort(); } catch (e) {}
    isGenerating = false; clearTimeout(typingTimer); stopSendTimer();
    renderMessage(`⚡ *[Система: ${reason} — авто-пинок ${stallKicks}/${STALL_MAX_KICKS}. Пишу «продолжи» от имени Босса.]*`, 'director', 'Оркестратор');
    renderMessage('продолжи', 'boss'); addMessageToHistory('продолжи', 'boss');
    stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopHardWatchdog();
    // НАДЗИРАТЕЛЬ: авто-пинок — это НЕ молчание. Агент жив, задача остаётся у него.
    if (typeof supResume === 'function') supResume('arch');
    setTimeout(() => sendMessage('продолжи', true), 900);   // sendMessage сам перезапустит сторожа, пока пинков меньше лимита
    return true;
}
function doStallKick(reason) { fireAutoKick(reason); }
/* --- ПЕРЕДАЧА ЗАДАЧИ ДРУГОМУ АГЕНТУ ВМЕСТО ПИНКА ТОМУ ЖЕ ---
   Босс: агент молчит 300 с (лимит кнопки) ИЛИ счётчик на кнопке оборвался
   (замер/пропал), а ответа нет — задача уходит СЛЕДУЮЩЕМУ по цепочке
   (Архитектор → Помощник → Бесплатная модель). Надзиратель ведёт журнал
   и сам решает, кому передать. Если надзирателя нет — старый авто-пинок. */
function handoffOrKick(reason) {
    if (typeof window.supTimerBroken === 'function') {
        try { if (window.supTimerBroken(reason)) return true; } catch (e) {}
    }
    return fireAutoKick(reason);
}
function startStallWatchdog() {
    stopStallWatchdog();
    stallStartCount = countDirectorMsgs();
    stallLastLen = -1; stallLastChange = Date.now();
    const startedAt = Date.now();
    stallInterval = setInterval(() => {
        const now = Date.now();
        const newMsgs = countDirectorMsgs() - stallStartCount;
        const txt = lastDirectorText();
        if (txt.length !== stallLastLen) { stallLastLen = txt.length; stallLastChange = now; }
        // 1) Ответ есть, но застыл и оборван на середине — пинок сразу.
        if (newMsgs > 0 && (now - stallLastChange) >= 3000 && looksTruncated(txt)) {
            doStallKick('ответ оборван на середине'); return;
        }
        // 2) Ответа в чате нет вообще — прошёл лимит кнопки (300 с). Задача уходит
        //    СЛЕДУЮЩЕМУ агенту, а не повторному пинку того же.
        if (newMsgs === 0 && (now - startedAt) >= STALL_TIMEOUT_MS) {
            handoffOrKick(`тишина ${Math.round(STALL_TIMEOUT_MS / 1000)} с`); return;
        }
        // 3) Запрос завершился, а ответа в чате так и нет — обрыв. Передаём сразу,
        //    не дожидаясь 300 с: так «оборвавшийся секундомер» больше не молчит.
        if (!isGenerating && newMsgs === 0) { handoffOrKick('запрос оборвался без ответа'); return; }
        // Ответ пришёл и в порядке — сторож больше не нужен.
        if (!isGenerating && newMsgs > 0) stopStallWatchdog();
    }, 3000);
}
/* --- ДЕТЕКТ ФРАЗЫ «ПУСТОЙ ОТВЕТ» ---
   Бывает, модель не молчит, а присылает сообщение вида «Пустой ответ»,
   «(пустой ответ)», «Ответ пустой» — по сути тот же обрыв, только текстом.
   Такой ответ считаем пустым и пинаем «продолжи» от имени Босса. */
const EMPTY_ANSWER_RE = /(?:^|[\s(\[«"'])(?:пуст(?:ой|ые|ая|ое|ым|ых)|нет\s+ответа|ответ\s+(?:пуст|отсутств)|empty\s+(?:answer|response)|no\s+(?:answer|response))(?=$|[\s)\]»"'.,!])/i;
function isEmptyAnswerText(t) {
    const s = String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/[*_`>#]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return true;
    // Фраза про пустой ответ, но сам ответ короткий (до 200 символов) — это заглушка, а не разбор.
    if (s.length <= 200 && EMPTY_ANSWER_RE.test(s)) return true;
    return false;
}

// Признак оборванного ответа: незакрытый блок кода, многоточие или союз на конце.
function looksTruncated(t) {
    const s = String(t || '').trim();
    if (s.length < 120) return false;
    if ((s.match(/```/g) || []).length % 2 !== 0) return true;
    if (/(\.\.\.|…)$/.test(s)) return true;
    if (/\b(и|а|но|или|что|как|чтобы|который|поэтому|значит)$/i.test(s)) return true;
    return false;
}

/* --- ДЕТЕКТ ФРАЗЫ «СЛИШКОМ МНОГО ШАГОВ» ---
   Сервер обрывает работу, когда модель 20 раз подряд дёрнула инструменты
   и не выдала финальный текст: «⚠️ Слишком много шагов. Задача прервана.».
   Это такой же обрыв, как тишина или оборванный ответ, — только текстом.
   Раньше на эту фразу пинка не было, и задача молча умирала. */
const TOO_MANY_STEPS_RE = /слишком много шагов|задача прервана|too many steps/i;
function isTooManySteps(t) { return TOO_MANY_STEPS_RE.test(String(t || '')); }

/* --- СИСТЕМНЫЕ УВЕДОМЛЕНИЯ НЕ ОЗВУЧИВАЕМ ---
   Раньше озвучка читала вслух служебные тексты («Слишком много шагов.
   Задача прервана.», «Ошибка AI», «Пустой ответ») — Босс слышал робота
   вместо ответа. Теперь такие тексты в голос не идут. */
const SYSTEM_NOTICE_RE = /(?:^|\n)\s*[^\p{L}\p{N}]{0,4}\s*(?:система\s*:|слишком много шагов|задача прервана|авто-пинок|пустой ответ|ошибка ai|лимит запросов|нет данных по этому пункту)/iu;
function isSystemNotice(t) { return SYSTEM_NOTICE_RE.test(String(t || '')); }

/* --- ЭТАПЫ БОЛЬШОЙ ЗАДАЧИ ---
   Большая задача делится на этапы. В конце каждого этапа Архитектор ставит
   метку [ЭТАП N/M]. Скрипт видит метку и сам, от имени Босса, пишет
   «продолжи этап N+1» — пока этапы не кончатся. Метка в чате не видна. */
const STAGE_RE = /\[(?:ЭТАП|STAGE)\s*(\d+)\s*\/\s*(\d+)\]/i;
const STAGE_MAX_KICKS = 3;         // было 12: каждый этап — ОТДЕЛЬНЫЙ платный запрос с полной историей
let stageKicks = 0;
function resetStageKicks() { stageKicks = 0; }
function parseStageMarker(text) {
    const m = String(text || '').match(STAGE_RE);
    if (!m) return null;
    const cur = parseInt(m[1], 10), total = parseInt(m[2], 10);
    if (!cur || !total || cur >= total) return null;   // последний этап — метка не нужна
    return { cur: cur, total: total };
}


/* --- СТОРОЖ ЗАСТЫВШЕГО ТАЙМЕРА ---
   Босс нажал «Отправить» → на кнопке бегут секунды. Если счётчик внезапно
   замер (ответ не пришёл, связь оборвалась, поток умер), а в чате тишина —
   это тоже обрыв. Ловим и пинаем, сколько бы секунд ни прошло. */
const TIMER_FREEZE_MS = 5000;      // счётчик не менялся 5 с — считаем застывшим
let timerFreezeWatchdog = null;
let lastTimerText = '';
let lastTimerChange = 0;

function startTimerFreezeWatchdog() {
    stopTimerFreezeWatchdog();
    lastTimerText = ''; lastTimerChange = Date.now();
    const startedAt = Date.now();
    timerFreezeWatchdog = setInterval(() => {
        const now = Date.now();
        const cur = sendBtn ? String(sendBtn.innerText || '') : '';
        const hasTimer = /\d/.test(cur);
        if (hasTimer) {
            // Счётчик идёт — запоминаем движение.
            if (cur !== lastTimerText) { lastTimerText = cur; lastTimerChange = now; return; }
            // Счётчик застыл на месте, а ответа нет — обрыв потока. Задачу — дальше.
            if (now - lastTimerChange >= TIMER_FREEZE_MS) handoffOrKick(`счётчик застыл на ${cur || '—'}`);
            return;
        }
        // Счётчика на кнопке нет. Ответ пришёл — сторож больше не нужен.
        if (lastSendSuccess) { stopTimerFreezeWatchdog(); return; }
        // Счётчик «оборвался» (запрос умер без ответа) — передаём сразу, не ждём 300 с.
        if (now - startedAt >= TIMER_FREEZE_MS) handoffOrKick('счётчик оборвался, ответа нет');
    }, 1000);
}
function stopTimerFreezeWatchdog() { if (timerFreezeWatchdog) { clearInterval(timerFreezeWatchdog); timerFreezeWatchdog = null; } }

/* --- МИГАНИЕ КНОПКИ «ОБНОВИТЬ ШТАБ» ---
   sync.sh тянет новый код каждые 10 с, но открытая страница остаётся старой.
   Раз в 30 с проверяем, не изменился ли chat.js на сервере (по Last-Modified /
   ETag). Изменился — кнопка «🔄 Обновить штаб» начинает мигать жёлтым. */
const UPDATE_CHECK_MS = 30000;
let updateWatchTimer = null;
let serverBuildMark = null;
/* --- ТИХИЙ ИНДИКАТОР ОБНОВЛЕНИЯ ---
   Раньше кнопка на КАЖДУЮ правку кода меняла текст на «🔄 Обновить штаб ⬤»
   и мигала жёлтым — Босса это раздражало. Теперь текст кнопки не трогаем:
   справа от неё появляется маленькая жёлтая точка. Один раз и молча. */
function _injectUpdateDotCss() {
    if (document.getElementById('updateDotCss')) return;
    const st = document.createElement('style'); st.id = 'updateDotCss';
    st.textContent = '.update-dot{display:inline-block;width:7px;height:7px;margin-left:6px;border-radius:50%;background:#ffd700;box-shadow:0 0 5px rgba(255,215,0,.8);vertical-align:middle;}';
    document.head.appendChild(st);
}
function findRefreshBtn() {
    return document.getElementById('btnRefreshShtab') || (function () {
        const btns = document.querySelectorAll('.mode-switch .mode-btn');
        for (let i = 0; i < btns.length; i++) {
            const oc = btns[i].getAttribute('onclick') || '';
            if (oc.indexOf('refreshShtab') !== -1) return btns[i];
        }
        return null;
    })();
}
async function checkServerBuild() {
    try {
        const res = await fetch('chat.js?probe=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        if (!res.ok) return;
        const mark = res.headers.get('last-modified') || res.headers.get('etag') || res.headers.get('content-length');
        if (!mark) return;
        if (serverBuildMark === null) { serverBuildMark = mark; return; }   // первый замер — точка отсчёта
        if (mark !== serverBuildMark) {
            serverBuildMark = mark;            // отметили один раз — больше не дёргаем кнопку
            const btn = findRefreshBtn();
            if (btn) {
                btn.classList.remove('needs-update');   // мигание убрано совсем
                if (!btn.dataset.baseText) btn.dataset.baseText = btn.innerText;
                btn.innerText = btn.dataset.baseText;   // текст кнопки не меняется
                if (!btn.querySelector('.update-dot')) {
                    _injectUpdateDotCss();
                    const dot = document.createElement('span');
                    dot.className = 'update-dot';
                    dot.title = 'На сервере свежий код — можно обновить';
                    btn.appendChild(dot);
                }
            }
        }
    } catch (e) {}
}
function startUpdateWatch() { stopUpdateWatch(); checkServerBuild(); updateWatchTimer = setInterval(checkServerBuild, UPDATE_CHECK_MS); }
function stopUpdateWatch() { if (updateWatchTimer) { clearInterval(updateWatchTimer); updateWatchTimer = null; } }

function kickAI(agentName) {
    sendMessage(`[СИСТЕМНОЕ СООБЩЕНИЕ: Время вышло. Ты ОБЯЗАН выдать финальный ответ. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать "подождите".]`, true);
}

/* --- ЖЁСТКИЙ СТОРОЖ 300 СЕКУНД (отдельный скрипт) ---
   Следит за кнопкой «Отправить» и общим временем ответа.
   Прошло 300 с с момента отправки, а ответа в чате так и нет — пинок «продолжи».
   Работает независимо от сторожа застывшего счётчика. */
const HARD_TIMEOUT_MS = 300000;
let hardWatchdog = null;
let hardStartTime = 0;
let hardStartCount = 0;
function startHardWatchdog() {
    stopHardWatchdog();
    hardStartTime = Date.now();
    hardStartCount = chatContainer ? chatContainer.children.length : 0;
    hardWatchdog = setInterval(() => {
        if (!isGenerating) { stopHardWatchdog(); return; }
        const answered = chatContainer && chatContainer.children.length > hardStartCount;
        if (answered) { stopHardWatchdog(); return; }
        if (Date.now() - hardStartTime >= HARD_TIMEOUT_MS) {
            stopHardWatchdog();
            handoffOrKick('прошло 300 с, ответа нет');
        }
    }, 3000);
}
function stopHardWatchdog() { if (hardWatchdog) { clearInterval(hardWatchdog); hardWatchdog = null; } }

/* --- ТАЙМЕР 303 СЕКУНДЫ, ВСТРОЕННЫЙ В КНОПКУ «ОТПРАВИТЬ» ---
   Босс нажал «Отправить» → на кнопке бегут секунды. Ровно через 303 с,
   если ответа в чате так и нет, скрипт САМ, от имени Босса, пишет
   «продолжи» и повторяет запрос. Один сторож на всё — без гонок таймеров.
   Ловит и обрыв: счётчик на кнопке замер или пропал, а ответа нет. */
const BUTTON_TIMEOUT_MS = 303000;
let buttonWatchdog = null;
let buttonWatchStart = 0;
let buttonWatchCount = 0;
function startButtonWatchdog() {
    stopButtonWatchdog();
    buttonWatchStart = Date.now();
    buttonWatchCount = countDirectorMsgs();
    buttonWatchdog = setInterval(() => {
        if (!isGenerating && lastSendSuccess) { stopButtonWatchdog(); return; }
        const answered = countDirectorMsgs() > buttonWatchCount;
        if (answered) { stopButtonWatchdog(); return; }
        // Счётчик на кнопке оборвался (запрос умер), а ответа нет — пинок сразу.
        const btnText = sendBtn ? String(sendBtn.innerText || '') : '';
        const btnAlive = /\d/.test(btnText) || (sendBtn && sendBtn.classList.contains('stop-active'));
        if (!btnAlive && !isGenerating && !lastSendSuccess) { handoffOrKick('счётчик на кнопке оборвался, ответа нет'); return; }
        // Прошло 303 с — задача уходит следующему агенту.
        if (Date.now() - buttonWatchStart >= BUTTON_TIMEOUT_MS) { handoffOrKick('на кнопке прошло 303 с, ответа нет'); return; }
    }, 1000);
}
function stopButtonWatchdog() { if (buttonWatchdog) { clearInterval(buttonWatchdog); buttonWatchdog = null; } }

function handleSendClick() {
    if (isGenerating) { 
        if (currentAbortController) currentAbortController.abort(); 
        isGenerating = false; 
        stopHardWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopButtonWatchdog();
        clearTimeout(typingTimer); // МГНОВЕННАЯ ОСТАНОВКА ПЕЧАТИ
        stopSendTimer();           // гасим секундомер на кнопке
        if (typeof supClear === 'function') supClear();   // Босс остановил сам — передавать некому
        sendBtn.className = 'send-btn'; 
        sendBtn.innerText = '➤'; 
    }
    else sendMessage();
}
function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 512;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            attachedImageBase64 = canvas.toDataURL('image/jpeg', 0.7); currentChatImage = attachedImageBase64; localStorage.setItem('shtabChatImage_' + currentChatId, attachedImageBase64);
            
            const div = document.createElement('div');
            div.className = 'chat-msg msg-boss';
            const imgEl = document.createElement('img');
            imgEl.src = attachedImageBase64;
            imgEl.className = 'chat-thumbnail';
            div.appendChild(imgEl);
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            playSound('send');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

/* --- 👁 ГЛАЗА АРХИТЕКТОРА: ФОТО → ТЕКСТ ---
   Архитектор не видит картинок. Поэтому фото Босса сначала уходит
   в зрение (сервер при наличии поля image отвечает описанием),
   возвращается ПОДРОБНОЕ техническое описание — и уже ОНО
   подмешивается в контекст как текст. Так Архитектор «видит» чертёж.
   Плюс: главный запрос уходит БЕЗ картинки — иначе сервер снова
   уводит всё в зрение и отвечает описанием вместо решения задачи. */
const VISION_PROMPT = 'Опиши это изображение максимально подробно и технически. Что за изделие или чертёж; сколько секций/створок; какая где открывается (глухая, поворотная, поворотно-откидная, откидная); где ручки и петли; какие размеры, цифры и надписи видны; как расположены элементы и линии. Только факты, списком, без вступлений и без вопросов.';
async function describeAttachedImage(base64) {
    if (!base64) return null;
    if (!takeTurnCall()) return null;   // бюджет запросов на вопрос исчерпан — зрение не тратим
    try {
        let vKeys = {};
        try { vKeys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) {}
        const res = await fetch(PROXY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: VISION_PROMPT }],
                temperature: 0.2,
                model: (typeof resolveAllowedModel === 'function') ? resolveAllowedModel(selectedAIModel) : selectedAIModel,
                userKeys: vKeys, freeKey: vKeys.freeKey || '',
                image: base64, isBoss: true
            }),
            signal: currentAbortController ? currentAbortController.signal : undefined
        });
        const data = await res.json();
        const txt = (data && data.choices && data.choices[0]) ? String(data.choices[0].message.content || '').trim() : '';
        return txt || null;
    } catch (e) { return null; }
}

/* --- ОТПРАВКА ФАЙЛОВ АРХИТЕКТОРУ ---
   Босс прикладывает файл к задаче. Текстовые (код, конфиги, логи, json)
   читаются и уходят в контекст модели. Бинарные — только имя и размер. */
const MAX_FILE_SIZE = 200 * 1024;   // 200 КБ — больше не влезет в контекст модели
const TEXT_FILE_RE = /\.(txt|md|markdown|json|jsonc|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|sass|less|py|java|c|cpp|cc|h|hpp|cs|sh|bash|zsh|yml|yaml|xml|csv|tsv|log|ini|conf|cfg|env|sql|php|rb|go|rs|kt|kts|swift|dart|vue|svelte|toml|gradle|properties|gitignore|dockerfile)$/i;

function isTextFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('text/') === 0) return true;
    if (file.type === 'application/json' || file.type === 'application/xml' || file.type === 'application/javascript') return true;
    return TEXT_FILE_RE.test(file.name || '');
}
function formatFileSize(b) {
    if (b === undefined || b === null) return '';
    if (b < 1024) return b + ' Б';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' КБ';
    return (b / 1024 / 1024).toFixed(2) + ' МБ';
}
function _injectFileCss() {
    if (document.getElementById('fileAttachCss')) return;
    const st = document.createElement('style'); st.id = 'fileAttachCss';
    st.textContent = `
    .attach-preview { display: none; padding: 6px 10px; }
    .attach-preview.show { display: block; }
    .file-chip {
        display: inline-flex; align-items: center; gap: 8px;
        max-width: 100%; padding: 6px 10px; margin: 4px 0;
        background: rgba(0,229,255,.10); border: 1px solid rgba(0,229,255,.45);
        border-radius: 10px; font-size: 12px; color: #cfefff;
    }
    .file-chip-icon { font-size: 16px; }
    .file-chip-info { min-width: 0; }
    .file-chip-name { font-weight: 700; color: #00e5ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; }
    .file-chip-size { color: #8fb8c8; font-size: 11px; }
    .file-chip-remove { background: none; border: none; color: #ff6688; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
    `;
    document.head.appendChild(st);
}
function buildFileChip(file, removable) {
    _injectFileCss();
    const chip = document.createElement('div'); chip.className = 'file-chip';
    const icon = document.createElement('span'); icon.className = 'file-chip-icon'; icon.textContent = file.content ? '📄' : '🗄️';
    const info = document.createElement('div'); info.className = 'file-chip-info';
    const nm = document.createElement('div'); nm.className = 'file-chip-name'; nm.textContent = file.name || 'файл';
    const sz = document.createElement('div'); sz.className = 'file-chip-size';
    sz.textContent = formatFileSize(file.size) + (file.content ? ' · текст приложен' : ' · бинарный, только имя');
    info.appendChild(nm); info.appendChild(sz);
    chip.appendChild(icon); chip.appendChild(info);
    if (removable) {
        const rm = document.createElement('button'); rm.className = 'file-chip-remove'; rm.textContent = '✖'; rm.title = 'Убрать файл';
        rm.onclick = () => { attachedFile = null; clearAttachPreview(); };
        chip.appendChild(rm);
    }
    return chip;
}
function renderAttachPreview() {
    const box = document.getElementById('attachPreview');
    if (!box) return;
    box.innerHTML = '';
    if (!attachedFile) { box.classList.remove('show'); return; }
    box.appendChild(buildFileChip(attachedFile, true));
    box.classList.add('show');
}
function clearAttachPreview() {
    const box = document.getElementById('attachPreview');
    if (box) { box.innerHTML = ''; box.classList.remove('show'); }
}
function handleFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
        alert('Файл «' + file.name + '» слишком большой: ' + formatFileSize(file.size) + '. Максимум ' + formatFileSize(MAX_FILE_SIZE) + '.');
        return;
    }
    if (!isTextFile(file)) {
        attachedFile = { name: file.name, size: file.size, content: null };
        renderAttachPreview(); playSound('send');
        return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
        attachedFile = { name: file.name, size: file.size, content: String(e.target.result || '') };
        renderAttachPreview(); playSound('send');
    };
    reader.onerror = function () { alert('Не удалось прочитать файл «' + file.name + '».'); };
    reader.readAsText(file);
}

/* --- ЗАЩИТА ОТ ФАНТОМНОГО ПОИСКА ---
   Модель периодически копирует из системного промпта ПРИМЕР метки
   ([SEARCH: твой запрос]) или гоняет один и тот же запрос по кругу.
   Раньше такой мусор реально уходил в сеть: «поиск» по слову «запрос»,
   по многоточию «…» и т.п. Теперь запрос проходит валидацию:
   заглушки из промпта, пустышки и дубли в сеть не пускаются. */
let lastSearchQuery = ""; let searchRejects = 0; let searchesThisTurn = 0;
function resetSearchGuard() { lastSearchQuery = ""; searchRejects = 0; searchesThisTurn = 0; }
// Чистим запрос: убираем невидимки, кавычки и лишние пробелы.
// Так «твой запрос», «…» и прочий мусор нельзя замаскировать невидимым символом.
function normalizeSearchQuery(raw) {
    return String(raw || '')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .replace(/^["'«»\s]+|["'«»\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
const SEARCH_STUB_RE = /^(?:(?:твой|ваш|этот|мой)\s+)?запрос[а-яё]*$|^query$|^search$|^текст\s+запроса$|^пример$|^example$|^имя_файла$|^город$|^описание$|^[.…\-–—_]+$/iu;
function validSearchMatch(text) {
    const m = String(text || '').match(/\[SEARCH:\s*([^\]]+)\]/);
    if (!m) return null;
    if (searchesThisTurn >= 1) return null;                         // один поиск на один вопрос Босса
    const q = normalizeSearchQuery(m[1]);
    if (q.length < 2 || q.length > 120) return null;                // пусто/одна буква или простыня
    if ((q.match(/[\p{L}\p{N}]/gu) || []).length < 2) return null;  // нет реальных слов (одни точки/знаки) — мусор
    if (SEARCH_STUB_RE.test(q)) return null;                        // заглушка из промпта ([SEARCH: твой запрос] и её варианты)
    if (SYSTEM_PROMPT.includes('[SEARCH: ' + q + ']')) return null; // дословная копия примера из промпта
    if (q.toLowerCase() === lastSearchQuery.toLowerCase()) return null; // повтор того же запроса
    lastSearchQuery = q; searchesThisTurn++;
    return m;
}

/* --- ЗАЩИТА ОТ ПЕРЕПОЛНЕНИЯ КОНТЕКСТА ---
   У модели лимит 128k токенов. Длинный чат + фото легко переваливают его,
   и приходит ошибка "maximum context length is 128000 tokens".
   Режем историю: системный промпт всегда на месте, дальше — только
   последние сообщения в пределах бюджета. */
const MAX_HISTORY_CHARS = 60000;   // ~20k токенов текста: с запасом под ответ и инструменты
const MAX_HISTORY_MSGS = 40;

function trimHistory(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    const systemMsg = (messages[0] && messages[0].role === 'system') ? messages[0] : null;
    let rest = systemMsg ? messages.slice(1) : messages.slice();
    if (rest.length > MAX_HISTORY_MSGS) rest = rest.slice(-MAX_HISTORY_MSGS);
    let total = 0; const kept = [];
    for (let i = rest.length - 1; i >= 0; i--) {
        const m = rest[i];
        const len = (typeof m.content === 'string') ? m.content.length : 0;
        if (kept.length > 0 && total + len > MAX_HISTORY_CHARS) break;
        total += len; kept.unshift(m);
    }
    return systemMsg ? [systemMsg, ...kept] : kept;
}

async function sendMessage(overrideText = null, isKick = false) {
    if (isGenerating && !isKick) { 
        if (currentAbortController) currentAbortController.abort(); 
        isGenerating = false; 
        clearTimeout(typingTimer); 
        stopSendTimer();   // старый секундомер гасим сразу, не ждём нового старта
    }
    const text = overrideText || chatInputEl.value.trim(); if (!text && !attachedFile) return;
    if (!overrideText) resetSearchGuard(); // новый вопрос Босса = чистый лист для поиска
    if (!overrideText && !isKick) resetStallKicks(); // новый вопрос Босса = счётчик авто-пинков с нуля
    if (!overrideText && !isKick) resetStageKicks(); // новый вопрос Босса = этапы с нуля
    if (!overrideText && !isKick) resetTurnCalls();  // новый вопрос Босса = бюджет запросов с нуля

    if (!overrideText && !isKick) {
        chatInputEl.value = ''; chatInputEl.style.height = 'auto'; playSound('send'); 
        const fileMeta = attachedFile ? { name: attachedFile.name, size: attachedFile.size } : null;
        const displayText = text || (attachedFile ? '📄 ' + attachedFile.name : '');
        renderMessage(displayText, 'boss', 'Оркестратор', fileMeta);
        addMessageToHistory(displayText, 'boss', null, fileMeta);
        clearAttachPreview();
    }

    // НАДЗИРАТЕЛЬ: задачу ведёт Архитектор — пишем в журнал.
    if (!overrideText && !isKick && typeof supStart === 'function') supStart(text, 'arch');
    isGenerating = true; lastSendSuccess = false; const mySeq = ++sendSeq;
    // Сторож тишины стартует ТОЛЬКО когда Босс сам нажал «Отправить».
    // Авто-пинки и системные дозапросы сторож не перезапускают.
    // Счётчик на кнопке ведёт ТОЛЬКО startSendTimer() — один интервал на всё приложение.
    // startButtonWatchdog() больше НЕ запускается: он писал в ту же кнопку своим отсчётом
    // и накладывался на основной счётчик — отсюда прыжки цифр и зашкал за 500 с.
    // Тишину ловит сторож тишины, заморозку счётчика — timer-freeze, жёсткий предел — hard.
    if (!overrideText && !isKick) { startStallWatchdog(); startTimerFreezeWatchdog(); startHardWatchdog(); } else if (isKick && stallKicks < STALL_MAX_KICKS) { startStallWatchdog(); startTimerFreezeWatchdog(); startHardWatchdog(); } else { stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopHardWatchdog(); }
    sendBtn.disabled = false; sendBtn.className = 'send-btn stop-active'; sendBtn.innerText = '0.0s'; sendBtn.style.fontSize = "12px";
    const timeBadge = document.getElementById('final-time-badge'); if (timeBadge) timeBadge.classList.remove('show'); 
    const startTime = sendStartTime = Date.now();
    startSendTimer();                      // один счётчик на всё приложение, без наложения

    if (typeof resetAllStatuses === 'function') resetAllStatuses(); 
    const activeAgent = selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор';
    focusAgentCard(activeAgent);

    if (typeof updateAgentStatus === 'function') { updateAgentStatus(activeAgent, 'busy'); setAgentStatus(activeAgent, 'thinking'); }
    // 3D-ОФИС: задействованный агент встаёт из-за стола и уходит к компьютеру печатать
    if (typeof window.office3dWork === 'function') window.office3dWork(activeAgent);
    const elAi = document.getElementById('status-ai'); if (elAi) elAi.className = 'status-item loading';

    // Контроллер — локальный (myCtrl). Раньше таймаут аборта держался за общую
    // переменную currentAbortController: пока запрос висел, её перезаписывал
    // следующий вызов, и старый таймаут обрывал ЧУЖОЙ запрос. Теперь каждый
    // запрос абортится ровно своим контроллером через 330 с.
    const myCtrl = new AbortController(); currentAbortController = myCtrl;
    const timeoutId = setTimeout(() => myCtrl.abort(), 330000); clearTimeout(watchdogTimer);

    try {
        let success = false; let aiText = ""; let lastError = ""; let usedModel = "";
        
        let userKeys = {};
        try { userKeys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) {}
        /* 🅰️ СВОЙ КЛЮЧ АРХИТЕКТОРА — отдельно от общих.
           Уходит на сервер в userKeys.architectKey и только при выбранном ZVENO. */
        if (typeof architectKey === 'function') {
            const _ak = architectKey();
            if (_ak && String(selectedAIModel || '') === 'zveno') userKeys.architectKey = _ak;
        }
        /* 🔑 СВОЙ КЛЮЧ ЛЮБОЙ МОДЕЛИ — отдельно от общих.
           Уходит на сервер в userKeys[<id модели>] и только для выбранной модели. */
        if (typeof modelKey === 'function') {
            const _mk = modelKey(selectedAIModel);
            if (_mk && String(selectedAIModel || '') !== 'zveno') userKeys[selectedAIModel] = _mk;
        }
        let hasAnyKeys = Object.keys(userKeys).length > 0 && Object.values(userKeys).some(k => k && k.trim() !== '');

        let isBossSecret = false;
        if (userKeys.deepseekKey && (userKeys.deepseekKey.trim().toLowerCase() === 'zveno' || userKeys.deepseekKey.trim().toLowerCase() === 'boss')) {
            hasAnyKeys = true; isBossSecret = true; userKeys = {}; 
        }
        // Локальная модель на ПК (Ollama) работает БЕЗ ключей и без оплаты —
        // идём основным путём, только запрос уходит на свой ПК через шлюз.
        const isOllama = isOllamaModel(selectedAIModel);
        if (isOllama) hasAnyKeys = true;
        // GigaChat работает на серверном ключе Сбера (GIGACHAT_KEY) — свои ключи
        // Боссу для него не нужны, поэтому запрос уходит даже при пустых полях.
        if (selectedAIModel === 'gigachat') hasAnyKeys = true;
                if (hasAnyKeys) {
            try {
                let messagesToSend = allChats[currentChatId] ? [...allChats[currentChatId].messages] : [{role: "user", content: text}];
                messagesToSend = messagesToSend.filter(m => m.content && m.content.trim() !== '');
                // Приложенный файл: подмешиваем содержимое в последнее сообщение Босса (только на этот запрос).
                if (attachedFile && attachedFile.content) {
                    for (let i = messagesToSend.length - 1; i >= 0; i--) {
                        if (messagesToSend[i].role === 'user') {
                            messagesToSend[i] = Object.assign({}, messagesToSend[i], {
                                content: `[ФАЙЛ: ${attachedFile.name}]\n\`\`\`\n${attachedFile.content}\n\`\`\`\n\n${messagesToSend[i].content}`
                            });
                            break;
                        }
                    }
                }

                // --- 👁 ГЛАЗА: фото → описание → в контекст Архитектору ---
                let visionBridgeUsed = false;
                if (attachedImageBase64) {
                    renderMessage('👁 *[Глаза: разбираю фото...]*', 'director', 'Оркестратор');
                    const visionDesc = await describeAttachedImage(attachedImageBase64);
                    if (visionDesc) {
                        visionBridgeUsed = true;
                        renderMessage(`👁 **Что я вижу на фото:**\n\n${visionDesc}`, 'director', 'Оркестратор');
                        addMessageToHistory(`[ФОТО ОТ БОССА — ОПИСАНИЕ]: ${visionDesc}`, 'director', 'Оркестратор');
                        for (let i = messagesToSend.length - 1; i >= 0; i--) {
                            if (messagesToSend[i].role === 'user') {
                                messagesToSend[i] = Object.assign({}, messagesToSend[i], {
                                    content: `[ФОТО ОТ БОССА — ОПИСАНИЕ ЗРЕНИЯ]:\n${visionDesc}\n\n${messagesToSend[i].content}`
                                });
                                break;
                            }
                        }
                    } else {
                        renderMessage('👁 *[Глаза: описание не пришло — фото уходит в модель как есть.]*', 'director', 'Оркестратор');
                    }
                }

                let finalPrompt = SYSTEM_PROMPT;
                if (bossMemory && bossMemory !== "Босс.") finalPrompt += `\n\nПАМЯТЬ О БОССЕ: ${bossMemory}`;
                
                if (selectedAgents.length > 0) {
                    let agentPrompt = `Ты отвечаешь как: ${selectedAgents.join(', ')}. `;
                    if (selectedAgents.length > 1) agentPrompt += `Это Совет из ${selectedAgents.length} агентов. Агенты ОБЩАЮТСЯ между собой, а не читают монологи: обращаются друг к другу по имени, задают короткие вопросы, возражают, соглашаются, уточняют. Каждая реплика — с новой строки строго в формате [ИмяАгента]: Текст. Реплики короткие, 1-2 предложения. Начинает Оркестратор, заканчивает тот, кто подводит итог.\n`;
                    else agentPrompt += `Отвечай строго от лица ${selectedAgents[0]}.\n`;
                    selectedAgents.forEach(agentName => {
                        let directive = AGENT_DIRECTIVES[agentName] || AGENT_DIRECTIVES["По умолчанию"];
                        agentPrompt += `[ИНСТРУКЦИЯ ДЛЯ ${agentName}]: ${directive}\n`;
                        if (customPrompts[agentName]) agentPrompt += `[ОСОБЫЙ ХАРАКТЕР ${agentName}]: ${customPrompts[agentName]}\n`;
                    });
                    finalPrompt = agentPrompt + "\n" + finalPrompt;
                }
                
                if (messagesToSend[0] && messagesToSend[0].role === 'system') messagesToSend[0].content = finalPrompt;

                let modelToUse = selectedAIModel;
                if (selectedAgents.includes('GigaChat')) modelToUse = 'gigachat';
                // ПЕРЕБОРА МОДЕЛЕЙ НЕТ: на сервер уходит ровно та модель, что выбрана Боссом.
                if (typeof resolveAllowedModel === 'function') modelToUse = resolveAllowedModel(modelToUse);
                // ЖЁСТКАЯ ГАРАНТИЯ: Босс выбрал бесплатную модель — на сервер уходит ИМЕННО она.
                // Раньше секрет-ключ (deepseekKey = "zveno"/"boss") молча подменял выбор на
                // платную Zveno — отсюда плашка «Ответила платная модель: Zveno» при бесплатной
                // модели на кнопке. Теперь бесплатный выбор не подменяется ничем.
                const selModelInfo = getModelInfo(selectedAIModel);
                if (selModelInfo && selModelInfo.free) modelToUse = selectedAIModel;
                // ЖЁСТКАЯ ГАРАНТИЯ №2: кнопка 🟣 GigaChat включена — на сервер уходит
                // ИМЕННО "gigachat". Тот же секрет-ключ Босса (deepseekKey = "zveno"/"boss")
                // подменял выбор на платную Zveno — из-за этого кнопка GigaChat «не работала»:
                // отвечал Zveno, а не Сбер. Теперь выбор GigaChat не подменяется ничем.
                if (selectedAIModel === 'gigachat') modelToUse = 'gigachat';
                // Ollama: на ПК уходит ИМЯ локальной модели (например qwen2.5-coder:7b),
                // а в бейдже остаётся 'ollama' — чтобы Босс видел верную подпись.
                if (isOllama) modelToUse = ollamaModel();
                // 🅰️ Архитектор выключен кнопкой — запрос не отправляем вообще.
                // Никакой подмены на другую модель: честный отказ Боссу.
                if (modelToUse === 'zveno' && !architectEnabled()) {
                    renderMessage('🅰️ *[Архитектор выключен кнопкой — запрос не отправлен. Включи 🅰️ или выбери другую модель.]*', 'director', 'Оркестратор');
                    lastError = 'Архитектор выключен кнопкой';
                    return;
                }
                // 🔑 Модель выключена своей кнопкой — тот же честный отказ, без подмены.
                if (typeof modelEnabled === 'function' && modelToUse !== 'zveno' && !modelEnabled(modelToUse)) {
                    const _off = getModelInfo(modelToUse);
                    renderMessage('🔒 *[Модель «' + ((_off && _off.label) || modelToUse) + '» выключена кнопкой — запрос не отправлен.]*', 'director', 'Оркестратор');
                    lastError = 'Модель выключена кнопкой';
                    return;
                }
                usedModel = isOllama ? 'ollama' : modelToUse;   // запоминаем, кто реально отвечает — покажем Боссу

                let currentMessages = trimHistory(messagesToSend);
                let maxAttempts = 3; 
                let currentAttempt = 0;

                while (currentAttempt < maxAttempts) {
                    currentAttempt++;
                    if (!takeTurnCall()) { lastError = 'Лимит запросов на один вопрос исчерпан (экономия баланса).'; break; }
                    currentMessages = trimHistory(currentMessages);
                    // Ollama (ПК) — свой OpenAI-совместимый адрес через шлюз; остальные — штатный PROXY.
                    const endpoint = isOllama ? OLLAMA_ENDPOINT : PROXY;
                    const response = await fetch(endpoint, { 
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ messages: currentMessages, temperature: 0.7, model: modelToUse, userKeys: userKeys, freeKey: userKeys.freeKey || '', image: visionBridgeUsed ? null : attachedImageBase64, isBoss: true }),
                        signal: currentAbortController.signal
                    });
                    
                    const data = await response.json();
                    if (!response.ok) { lastError = data.error || `Ошибка сервера: ${response.status}`; break; }
                    
                    if (data.choices && data.choices.length > 0) {
                        aiText = data.choices[0].message.content;
                        // БАЛАНС ZVENOAI: списываем ВХОД (запрос: вся история) + ВЫХОД (ответ).
                        if (typeof window.zvenoAccount === 'function') window.zvenoAccount(data, aiText, currentMessages.map(m => m.content || '').join('\n'));
                        
                        const readMatch = aiText.match(/\[READ:\s*([^\]]+)\]/);
                        if (readMatch) {
                            const fileNames = readMatch[1].split(',').map(f => f.trim());
                            let allCode = "";
                            for (const fileName of fileNames) {
                                try {
                                    const fileRes = await fetch(fileName + '?t=' + Date.now(), { signal: currentAbortController.signal });
                                    if (fileRes.ok) { const fileCode = await fileRes.text(); allCode += `\n\nВОТ КОД ФАЙЛА ${fileName}:\n\`\`\`\n${fileCode}\n\`\`\``; }
                                } catch (e) { if (e.name === 'AbortError') return; }
                            }
                            if (allCode) {
                                currentMessages.push({ role: "assistant", content: aiText });
                                currentMessages.push({ role: "user", content: `[СИСТЕМА: Вот запрошенные файлы]${allCode}\n\nТеперь выполни мою первоначальную просьбу. Напиши [FILE: имя_файла] и выдай ПОЛНЫЙ новый код.` });
                                continue; 
                            }
                        }

                        const rawSearchTag = aiText.match(/\[SEARCH:\s*[^\]]+\]/);
                        const searchMatch = validSearchMatch(aiText);
                        if (searchMatch) {
                            const query = normalizeSearchQuery(searchMatch[1]);
                            aiText = aiText.replace(searchMatch[0], '').trim(); 
                            renderMessage(`🔍 *[Система: Агент ищет в интернете "${query}"...]*`, 'director', 'Оркестратор');
                            const searchRes = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchQuery: query }), signal: currentAbortController.signal });
                            const searchData = await searchRes.json();
                            if (searchData.success) {
                                currentMessages.push({ role: "assistant", content: aiText });
                                currentMessages.push({ role: "user", content: `[РЕЗУЛЬТАТЫ ПОИСКА]: ${searchData.results}. Ответь на вопрос.` });
                                continue; 
                            }
                        } else if (rawSearchTag) {
                            aiText = aiText.replace(rawSearchTag[0], '').trim();
                            searchRejects++;
                            if (!aiText && searchRejects < 2) {
                                currentMessages.push({ role: "assistant", content: "[SEARCH отклонён]" });
                                currentMessages.push({ role: "user", content: "[СИСТЕМА: Метка поиска отклонена — запрос пустой, шаблонный или повторный. Ответь Боссу БЕЗ поиска, своими знаниями.]" });
                                continue;
                            }
                            if (!aiText) aiText = "Босс, метка поиска пришла пустой или шаблонной (копия примера из промпта) — отвечаю своими знаниями. Сформулируй вопрос конкретнее, и я найду нужное в сети.";
                        }

                        const weatherMatch = aiText.match(/\[WEATHER:\s*([^\]]+)\]/);
                        if (weatherMatch) {
                            const city = weatherMatch[1].trim();
                            aiText = aiText.replace(weatherMatch[0], '').trim();
                            renderMessage(`🌤️ *[Система: смотрю погоду в "${city}"...]*`, 'director', 'Оркестратор');
                            let weatherText = "";
                            if (typeof getWeather === 'function') {
                                try { weatherText = await getWeather(city); } catch (e) { weatherText = "Ошибка погоды: " + e.message; }
                            } else { weatherText = "Функция getWeather недоступна."; }
                            const wcGot = extractWeatherCards(weatherText);
                            wcGot.cards.forEach(cd => {
                                const rawCard = '[[WEATHER_CARD]]' + JSON.stringify(cd) + '[[/WEATHER_CARD]]';
                                renderMessage(rawCard, 'director', 'Оркестратор');
                                addMessageToHistory(rawCard, 'director', 'Оркестратор');
                            });
                            const plainWeather = wcGot.cleanText || weatherText;
                            currentMessages.push({ role: "assistant", content: aiText });
                            currentMessages.push({ role: "user", content: `[ПОГОДА]: ${plainWeather}. Босс уже видит красивую карточку с погодой. Ответь коротко, 1-3 предложения: прокомментируй погоду по-человечески. НЕ перечисляй все цифры заново.` });
                            continue;
                        }
                        success = true; break; 
                    }
                }
            } catch (e) { if (e.name === 'AbortError') return; lastError = `Сбой сети: ${e.message}`; }
            clearTimeout(timeoutId);
        } else {
            renderMessage('⚙️ *[Система: API-ключи не найдены...]*', 'director', 'Оркестратор');
            await new Promise(resolve => setTimeout(resolve, 1000)); 
            if (typeof generateLocalResponse === 'function') {
                try { aiText = await generateLocalResponse(activeAgent, text, PROXY, currentAbortController.signal); success = true; } 
                catch (e) { if (e.name === 'AbortError') return; lastError = `Ошибка локального ИИ: ${e.message}`; }
            } else { lastError = "Локальный ИИ не загружен."; }
            clearTimeout(timeoutId);
        }
        
        if (success) {
            // ПУСТОЙ ОТВЕТ = обрыв. Модель вернула пустоту, одни служебные метки
            // ИЛИ прямо написала «пустой ответ» — это такой же обрыв, как тишина:
            // пинаем «продолжи» от имени Босса.
            const emptyCheck = String(aiText || '').replace(/\[[^\]]*\]/g, '').replace(/[\s*_`>#\-–—•.]/g, '');
            // «Пустой ответ» пинаем ТОЛЬКО когда это единственный текст сообщения.
            // Если модель разбирает тему и лишь упомянула заглушку — пинка нет.
            const saidEmpty = isOnlyEmptyAnswerText(aiText);
            if (!emptyCheck || saidEmpty) {
                lastSendSuccess = false;
                const emptyWhy = saidEmpty ? 'модель написала «пустой ответ»' : 'пустой ответ от модели';
                if (!isKick) {
                    // НАДЗИРАТЕЛЬ: пустой ответ = задача не сделана. Передаём её
                    // бесплатной модели Штаба, а не пинаем того же самого ещё раз.
                    if (typeof supFailed === 'function') { supFailed('arch', emptyWhy); return; }
                    fireAutoKick(emptyWhy); return;
                }
                renderMessage('❌ **Модель вернула пустой ответ.**', 'director', 'Оркестратор');
            }
            lastSendSuccess = true;
            // НАДЗИРАТЕЛЬ: Архитектор ответил — задача закрыта, агент жив.
            if (typeof window.supNoteActivity === 'function') window.supNoteActivity();
            if (typeof supAnswered === 'function') supAnswered('arch');
            playSound('receive'); stallKicks = 0; stopStallWatchdog(); stopButtonWatchdog();
            try { localStorage.removeItem('shtabStallKicks'); localStorage.removeItem(kickGuardKey()); } catch (e) {}
            const fileMatch = aiText.match(/\[FILE:\s*([^\]]+)\]/);
            if (fileMatch && isAutoMode) {
                const targetFile = fileMatch[1].trim();
                const codeMatch = /```(?:html|css|javascript|js)?\n([\s\S]*?)```/.exec(aiText);
                if (codeMatch) {
                    fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updateFile: true, path: targetFile, content: codeMatch[1], message: `Auto-update: ${targetFile}` }), signal: currentAbortController.signal })
                    .then(res => res.json()).then(data => {
                        if (data.success) renderMessage(`✅ **Файл ${targetFile} обновлен автоматически!**`, 'director', 'DevOps');
                        else renderMessage(`❌ **Ошибка авто-внедрения:** ${data.error}`, 'director', 'DevOps');
                    }).catch(e => { if (e.name !== 'AbortError') console.error(e); });
                }
            }

            const taskRegex = /\[TASK:\s*([^:]+):\s*([^\]]+)\]/g; let taskMatch; let tasksToRun = [];
            while ((taskMatch = taskRegex.exec(aiText)) !== null) tasksToRun.push({ agent: taskMatch[1].trim(), task: taskMatch[2].trim() });
            tasksToRun = tasksToRun.slice(0, 2);   // не больше 2 фоновых задач за раз: каждая — платный запрос
            aiText = aiText.replace(taskRegex, '').trim();
            tasksToRun.forEach(t => { if (typeof updateAgentStatus === 'function') updateAgentStatus(t.agent, 'working'); runBackgroundTask(t.agent, t.task); });
            
            addMessageToHistory(aiText, 'director', selectedAgents.length > 1 ? 'Совет' : (selectedAgents[0] || 'Оркестратор'));
            if (elAi) elAi.className = 'status-item online';
            const replies = parseAgentReplies(aiText); await playAgentReplies(replies);
            if (usedModel) renderMessage(modelBadgeText(usedModel), 'director', 'Оркестратор');

            // Метка [ЭТАП N/M] — этап закрыт, просим продолжить следующий.
            const stage = parseStageMarker(aiText);
            // НАДЗИРАТЕЛЬ: задача разбита на этапы — это НЕ молчание, агент жив.
            // Большая задача не передаётся другому, пока идут этапы.
            if (typeof window.supStage === 'function') window.supStage(stage);
            if (stage && typeof window.supAlive === 'function') window.supAlive();
            if (!isKick && stage && stageKicks < STAGE_MAX_KICKS) {
                stageKicks++;
                renderMessage(`🧩 *[Система: этап ${stage.cur}/${stage.total} закрыт. Авто-пинок — прошу продолжить этап ${stage.cur + 1}.]*`, 'director', 'Оркестратор');
                const nextStageText = `продолжи этап ${stage.cur + 1} из ${stage.total}`;
                renderMessage(nextStageText, 'boss'); addMessageToHistory(nextStageText, 'boss');
                // НАДЗИРАТЕЛЬ: идёт следующий этап большой задачи — агент жив, передавать нельзя.
                if (typeof supResume === 'function') supResume('arch');
                setTimeout(() => sendMessage(nextStageText, true), 900);
            }
            // Ответ пришёл, но оборван на середине ИЛИ сервер упёрся в лимит шагов — просим продолжить.
            // ПИНОК РАБОТАЕТ И НА САМОМ ПИНКЕ: раньше здесь стояло «!isKick», из-за чего
            // ответ на «продолжи» снова упирался в лимит шагов и задача молча умирала.
            // Теперь «продолжи» пинается повторно, пока не исчерпан лимит STALL_MAX_KICKS.
            else if (!kickGuardActive() && (looksTruncated(aiText) || isTooManySteps(aiText)) && stallKicks < STALL_MAX_KICKS) {
                /* --- ЛИМИТ ШАГОВ СЕРВЕРА = ЗАДАЧА НЕ СДЕЛАНА ---
                   Пинать тем же лимитом бесполезно: модель снова упрётся.
                   Отдаём задачу надзирателю — он передаст её
                   бесплатной модели Штаба. */
                if (isTooManySteps(aiText) && typeof supFailed === 'function') {
                    supFailed('arch', 'упёрся в лимит шагов');
                } else {
                stallKicks++;
                markKickSent();
                /* --- РАЗНЫЙ ПИНОК ДЛЯ РАЗНЫХ ОБРЫВОВ ---
                   Сервер оборвал задачу на «Слишком много шагов. Задача прервана.» —
                   простое «продолжи» снова упирается в тот же лимит шагов.
                   Поэтому от имени Босса уходит «делай пошагово и отчитывайся»:
                   модель дробит работу на этапы и ставит метку [ЭТАП N/M],
                   а дальше этапы сам продолжает сторож этапов (шаг 2, 3...).
                   Оборванный на середине ответ по-прежнему просим «продолжи». */
                const tooMany = isTooManySteps(aiText);
                const kickText = tooMany ? 'делай пошагово и отчитывайся' : 'продолжи';
                const kickWhy = tooMany ? 'упёрся в лимит шагов' : 'ответ оборван на середине';
                renderMessage(`⚡ *[Система: ${kickWhy}. Авто-пинок ${stallKicks}/${STALL_MAX_KICKS} — пишу «${kickText}» от имени Босса.]*`, 'director', 'Оркестратор');
                renderMessage(kickText, 'boss'); addMessageToHistory(kickText, 'boss');
                setTimeout(() => sendMessage(kickText, true), 900);
                }
            }

            const stallRegex = /подождите|занимает время|сейчас произведу|сейчас поищу|пожалуйста, подождите|терпения|анализирую|скоро закончу|дай мне секунду|гляну текущий код|сейчас выдам/i;
            if (!isKick && stallRegex.test(aiText) && selectedAgents.length === 1) watchdogTimer = setTimeout(() => { kickAI(selectedAgents[0]); }, 60000); 

        } else {
            // НАДЗИРАТЕЛЬ: Архитектор сорвался — помечаем сбой в журнале.
            if (typeof supFailed === 'function') supFailed('arch', lastError || 'сбой');
            renderMessage(`❌ **Ошибка AI:**\n${lastError}`, 'director', 'Оркестратор');
            if (elAi) elAi.className = 'status-item offline'; if (typeof updateAgentStatus === 'function') updateAgentStatus(activeAgent, 'error');
        }
    } finally {
        if (mySeq === sendSeq) {
            stopHardWatchdog();
            if (lastSendSuccess) { stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); }
            // Ответа нет — сторожа счётчика и тишины оставляем жить: они поймают
            // «оборвавшийся секундомер» и пошлют авто-пинок, а не будут молчать.
            // Всё глобальное состояние гасит ТОЛЬКО актуальный запрос: иначе
            // дохлый старый вызов сбрасывал бы флаг и счётчик живого.
            isGenerating = false; stopSendTimer();
            attachedImageBase64 = null; attachedFile = null; clearAttachPreview();
        }
        if (mySeq === sendSeq) {
            let finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            if (timeBadge) { timeBadge.innerText = finalElapsed + "s"; timeBadge.classList.add('show'); setTimeout(() => { timeBadge.classList.remove('show'); }, 5000); }
            sendBtn.disabled = false; sendBtn.className = 'send-btn'; sendBtn.innerText = "➤"; sendBtn.style.fontSize = ""; sendBtn.style.background = "#00e5ff"; sendBtn.style.color = "#000";
        }
    }
}

/* --- «ПУСТОЙ ОТВЕТ» КАК ЕДИНСТВЕННЫЙ ТЕКСТ ---
   Пинок даём ТОЛЬКО если сообщение целиком состоит из заглушки
   («Пустой ответ», «(пустой ответ)», «Нет ответа» и т.п.).
   Если заглушка лишь упомянута внутри нормального текста — не пинаем. */
const EMPTY_ANSWER_STUBS = [
    'пустой ответ', 'ответ пустой', 'пустой ответ от модели', 'модель вернула пустой ответ',
    'нет ответа', 'ответа нет', 'ответ отсутствует', 'пусто',
    'empty answer', 'empty response', 'no response', 'no answer'
];
function isOnlyEmptyAnswerText(text) {
    let t = String(text || '');
    t = t.replace(/\[[^\]]*\]/g, ' ');                       // служебные метки [FILE:...], [TASK:...]
    t = t.replace(/[*_`>#~]/g, ' ');                          // разметка
    t = t.replace(/[«»"'()\[\]{}]/g, ' ');                    // кавычки и скобки
    t = t.replace(/[.,:;!?\-–—•…]+/g, ' ');                   // пунктуация
    t = t.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return false;                                     // совсем пусто — это ловит emptyCheck
    return EMPTY_ANSWER_STUBS.some(s => t === s);
}

function focusAgentCard(agentName) {
    document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active-agent-glow'));
    const activeCard = document.getElementById('agent-' + agentName);
    if (!activeCard) return;
    activeCard.classList.add('active-agent-glow');
    const container = activeCard.parentNode;
    if (container && container.firstElementChild !== activeCard) container.prepend(activeCard);
}

/* --- АВТООБНОВЛЕНИЕ: НАКОПИЛОСЬ 5 ПРАВОК → САМ ПИШУ БОССУ «обновляй» ---
   version.json хранит edits (накоплено правок) и limit (порог, 5).
   Как только edits >= limit — скрипт сам, от имени Босса, отправляет
   в чат «обновляй», и Архитектор поднимает версию приложения.
   Повтор по одной и той же версии не шлём (ключ в localStorage). */
const VERSION_UPDATE_POLL_MS = 60000;
let versionUpdateTimer = null;
function versionUpdateSent(v) {
    try { return JSON.parse(localStorage.getItem('shtabUpdateSent') || '[]').indexOf(v) !== -1; }
    catch (e) { return false; }
}
function markVersionUpdateSent(v) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('shtabUpdateSent') || '[]'); } catch (e) {}
    if (list.indexOf(v) === -1) list.push(v);
    while (list.length > 20) list.shift();
    try { localStorage.setItem('shtabUpdateSent', JSON.stringify(list)); } catch (e) {}
}
async function checkVersionUpdate() {
    try {
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        const edits = Number(d.edits) || 0;
        const limit = Number(d.limit) || 5;
        if (edits < limit) return;                          // порог не достигнут
        const key = String(d.version || '') + '|' + edits;
        if (versionUpdateSent(key)) return;                 // уже отправляли
        if (isGenerating) return;                           // Архитектор ещё отвечает — подождём
        const inp = document.getElementById('chatInput');
        if (inp && inp.value && inp.value.trim()) return;   // Босс печатает — не мешаю
        markVersionUpdateSent(key);
        renderMessage(`📦 *[Система: ${d.name || 'Калькулятор окон (Алмаз)'} — накоплено ${edits}/${limit} правок. Пора поднимать версию. Пишу «обновляй» от имени Босса.]*`, 'director', 'Оркестратор');
        renderMessage('обновляй', 'boss'); addMessageToHistory('обновляй', 'boss');
        setTimeout(() => sendMessage('обновляй', true), 900);
    } catch (e) {}
}
function startVersionUpdateWatch() {
    if (versionUpdateTimer) return;
    checkVersionUpdate();
    versionUpdateTimer = setInterval(checkVersionUpdate, VERSION_UPDATE_POLL_MS);
}

function init() {
    restoreKickState();   // подхватываем счётчик пинков после F5 — лишних не шлём
    startVersionUpdateWatch();   // 5 правок накоплено → сам пишу Боссу «обновляй»
    startUpdateWatch();   // следим за обновлениями с сервера — кнопка «Обновить штаб» мигает
    if (typeof loadVersionCounter === 'function') loadVersionCounter();   // плашка «v3.4.55 · 1/5» в шапке
    setInterval(() => { if (typeof loadVersionCounter === 'function') loadVersionCounter(); }, 60000);   // обновляем раз в минуту
    if (typeof renderAgentsGrid === 'function') renderAgentsGrid();
    if (typeof syncAgentDialogueBtn === 'function') syncAgentDialogueBtn();   // кнопка «💬 Диалог» показывает сохранённое состояние
    if (typeof checkPing === 'function') checkPing();
    if (typeof updateNetStatus === 'function') updateNetStatus();
    
    const chatIds = Object.keys(allChats);
    if (!currentChatId || !allChats[currentChatId]) {
        if (chatIds.length > 0) { currentChatId = chatIds.sort((a, b) => b.localeCompare(a))[0]; loadChat(currentChatId); } 
        else { createNewChat(true); }
    } else { loadChat(currentChatId); }
    
    renderChatList(); 
    const btnVoice = document.getElementById('btnVoiceToggle');
    if (btnVoice && typeof isVoiceEnabled !== 'undefined') {
        if (isVoiceEnabled) { btnVoice.innerText = '🗣️ Озвучка: ВКЛ'; btnVoice.classList.add('active'); }
        else { btnVoice.innerText = '🗣️ Озвучка: ВЫКЛ'; btnVoice.classList.remove('active'); }
    }
    if (chatInputEl) {
        chatInputEl.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; if(this.value === '') this.style.height = 'auto'; });
    }
    if (typeof applyAIModelButton === 'function') applyAIModelButton();
    if (typeof bindAIModelButton === 'function') bindAIModelButton();
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
    if (typeof bindFreeModelButton === 'function') bindFreeModelButton();
    if (typeof applyGigaChatButton === 'function') applyGigaChatButton();   // кнопка 🟣 GigaChat показывает сохранённый выбор
    if (typeof applyArchitectButton === 'function') applyArchitectButton(); // 🅰️ Архитектор: своя кнопка, своё состояние
    // Страховка: выбрана ZVENO, а Архитектор выключен — уходим на разрешённую модель.
    if (typeof architectEnabled === 'function' && !architectEnabled() && selectedAIModel === 'zveno') {
        const _f = freeModels();
        selectedAIModel = _f.length ? _f[0].id : 'gigachat';
        try { localStorage.setItem('shtabAIModel', selectedAIModel); } catch (e) {}
    }
}
