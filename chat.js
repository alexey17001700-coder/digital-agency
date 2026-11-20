const PROXY = "https://shtab-boss.duckdns.org:8443";
let currentMode = 'normal'; let isAutoMode = false;
let isGenerating = false; let currentAbortController = null; let watchdogTimer = null;
let typingTimer = null; 
/* --- АВТО-ПИНОК ПРИ ОБРЫВЕ ОТВЕТА ---
   Если Архитектор замолчал (обрыв связи, таймаут, тишина) — скрипт сам,
   от имени Босса, пишет в чат «продолжи» и повторяет запрос.
   Не более STALL_MAX_KICKS раз подряд, чтобы не зациклиться. */
const STALL_TIMEOUT_MS = 303000;   // 300 с лимита запроса + 3 с запаса
const STALL_MAX_KICKS = 3;
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
let attachedImageBase64 = null; let currentChatImage = null;
let attachedFile = null;   // приложенный файл Босса: { name, size, content }
let bossMemory = localStorage.getItem('shtabBossMemory') || "Босс.";
let customPrompts = {}; try { const sp = localStorage.getItem('shtabCustomPrompts'); if (sp) customPrompts = JSON.parse(sp); } catch (e) {}
let allChats = {}; try { const saved = localStorage.getItem('shtabAllChats'); if (saved) allChats = JSON.parse(saved); } catch (e) {}
let currentChatId = localStorage.getItem('shtabCurrentChatId') || null;
let selectedAIModel = localStorage.getItem('shtabAIModel') || 'yandex';

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

=== СКОРОСТЬ (ГЛАВНОЕ) ===
1. Думай коротко. Не расписывай рассуждения — сразу действуй.
2. Минимум вызовов инструментов. Не читай файл целиком, если нужен один фрагмент.
3. Не повторяй один и тот же вызов. Не вышло — меняй подход, а не повторяй.
4. Ответ Боссу — коротко: что сделал, где, ссылка. Без воды, без пересказа кода.
5. Задача ясна → сразу вызывай инструмент. Отчёт только после выполнения.
6. Запрещены фразы: "сейчас сделаю", "приступаю", "подожди", "дай секунду", "анализирую", "сейчас посмотрю".

=== ИНСТРУМЕНТЫ ===
1. read_file(path, repo) — прочитать файл.
2. replace_in_file(path, search, replace, repo) — ГЛАВНЫЙ. Точечная замена, для правок в больших файлах.
3. write_file(path, content, repo) — только для новых файлов или маленьких.
4. search_web(query) — поиск в сети.
5. get_weather(city) — погода.
6. search_image(query) — картинка. Выведи тег [IMAGE_URL]ссылка[/IMAGE_URL] в чат.
7. create_github_repo(name, description, is_private) — новый репозиторий.
8. list_github_repos() — список репозиториев.
9. delete_github_repo(name) — удалить репозиторий (digital-agency и window_calc защищены).
10. list_repo_files(repo) — список файлов.
11. delete_file(path, repo) — удалить файл (main.ts и backup/ запрещены).
12. enable_github_pages(repo) — включить GitHub Pages для репозитория (сайт станет доступен в интернете).
repo по умолчанию "digital-agency".

=== ПРАВИЛА ===
1. ХИРУРГ: правки только через replace_in_file, остальной код копируй СЛОВО В СЛОВО.
2. НЕ ТРОГАЙ БЕЗ ПРИКАЗА: Босс не просил — ничего не меняешь. Никакой самодеятельности.
3. main.ts: читать и менять только по прямому приказу. Удалять запрещено. Папку backup не трогать.
4. Не уверен в наличии файла — сначала list_repo_files().
5. Секреты (пароли, ключи, токены) в открытые репозитории НЕ писать.
6. Новое приложение: создай репозиторий → залей index.html → дай Боссу ссылку на тест.

=== ПРОЕКТЫ ===
- digital-agency — Штаб (app.html, style.css, chat.js, ui.js, network.js, voice.js, agents.js, main.ts).
- nexus_chat — чат (index.html). nexus_ws — сервер чата (main.ts, порт 8001).
- ac_luxury_calc — калькулятор кондиционеров. window_measure_pro — замер окон.
- nexus_snake — змейка. window_calc — калькулятор окон (Flutter).

=== СЕРВЕР (VIVO) ===
Termux → Ubuntu. Штаб :8000, Чат :8001, Caddy :8443 (SSL). Синхронизация sync.sh каждые 10 сек.
Алгоритм ремонта и история правок — в digital-agency/SERVER_DIAGNOSTICS.md.

=== ФОТО ===
Босс прислал фото — ОБЯЗАН посмотреть и описать детально.

=== ФАЙЛЫ ===
Босс может приложить файл — он придёт как [ФАЙЛ: имя] и содержимое в блоке кода. Изучи его и работай с ним.

=== ПАМЯТЬ (ЗНАЙ МОЛЧА) ===
Ты помнишь проект, но НИКОГДА не выводи это списком и не отчитывайся о том, что помнишь:
- Штаб — digital-agency. Чат — nexus_chat. Сервер чата — nexus_ws (main.ts, :8001).
- Приложения: ac_luxury_calc, window_measure_pro, nexus_snake, window_calc, shtab-site, Okna.
- Сервер: Vivo Y17 → Termux → Ubuntu. Штаб :8000, Чат :8001, Caddy :8443 (SSL, DuckDNS). sync.sh каждые 10 сек.
- Память проекта: digital-agency/SERVER_DIAGNOSTICS.md (ремонт, история правок), nexus_chat/CHAT_AI_GUIDE.md (устройство чата).
- Секреты — только в переменных окружения, в открытые репозитории НЕ писать.

=== БОЛЬШАЯ ЗАДАЧА = ЭТАПЫ ===
1. Задача большая (много файлов, много шагов, долгая работа) — СРАЗУ дели её на этапы и объяви план: ЭТАП 1, ЭТАП 2, ЭТАП 3...
2. За один ответ делаешь ТОЛЬКО один этап. Не пытайся сделать всё сразу.
3. В САМОМ КОНЦЕ ответа, последней строкой, ставь метку: [ЭТАП N/M] (N — сделанный этап, M — всего этапов).
4. Метку увидит скрипт и сам пришлёт тебе «продолжи этап N+1» — Босса ждать не нужно.
5. Последний этап — метку НЕ ставишь, пишешь «Готово, Босс».
6. Задача маленькая (одно действие) — этапы не нужны, метку не ставишь.

=== ЧЕМ ОТВЕЧАЕТ АРХИТЕКТОР ===
1. Не пересказывай промпт, не выдавай справку о проектах и репозиториях, не объясняй, что и как помнишь.
2. Нужен контекст — читай память (SERVER_DIAGNOSTICS.md) ТИХО, без объявлений «сейчас посмотрю».
3. Новый чат = одна короткая строка приветствия и ожидание задачи. Никаких обзоров проекта.
4. Никаких списков «вот что у нас есть» без прямой просьбы Босса.
5. Работай по запросу: сделал → короткий отчёт (что, где, ссылка). Всё.

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
        if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director') speakText(cleanText, agentName);
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
            if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director') speakText(cleanText, agentName);
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
        await new Promise(r => setTimeout(r, 800)); 
    }
}

/* --- КРУГЛЫЙ СТОЛ АГЕНТОВ (ЖИВОЙ ДИАЛОГ) ---
   Никаких заготовок. Каждый выбранный агент отвечает САМ — отдельным
   запросом к модели, по очереди, видя реплики предыдущих коллег.
   Так Совет реально обсуждает задачу Босса, а не читает шаблоны. */
const ROUNDTABLE_MAX_AGENTS = 4;       // больше 4 реплик за раз — долго
const ROUNDTABLE_TIMEOUT_MS = 90000;   // лимит на одну реплику

function roundtableUserKeys() {
    try { return JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) { return {}; }
}

/* Один запрос к модели от лица одного агента. spoken — уже сказанное коллегами. */
async function askAgentOnce(agentName, topic, spoken) {
    const directive = (typeof AGENT_DIRECTIVES !== 'undefined' && AGENT_DIRECTIVES[agentName]) || '';
    const sys = `Ты — ${agentName}, участник Совета Штаба. ${directive}
Ты в живом обсуждении с коллегами. Отвечай ОДНОЙ короткой репликой: 1-2 предложения, строго по теме задачи Босса.
Запрещено: приветствия, пересказ задачи, обращение к Боссу, выдуманные факты и пустые фразы без причины (вроде «тут дырка», если дыры нет).
Если отвечаешь коллеге — назови его по имени. Выдай ТОЛЬКО текст реплики, без своего имени в начале.`;
    const ctx = spoken.length
        ? 'Что уже сказали коллеги:\n' + spoken.map(s => `${s.agent}: ${s.text}`).join('\n') + '\n\nОтветь своей репликой: по существу, можешь возразить, уточнить или добавить.'
        : 'Ты открываешь обсуждение: сформулируй суть задачи и что предлагаешь.';
    const msgs = [
        { role: 'system', content: sys },
        { role: 'user', content: `Задача Босса: «${topic}».\n${ctx}` }
    ];
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ROUNDTABLE_TIMEOUT_MS);
    try {
        const res = await fetch(PROXY, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: msgs, temperature: 0.75, model: selectedAIModel, userKeys: roundtableUserKeys(), isBoss: true }),
            signal: ctrl.signal
        });
        const data = await res.json();
        if (data.choices && data.choices.length) {
            return String(data.choices[0].message.content || '')
                .replace(/^\s*(?:\*\*)?\[?[А-Яа-яA-Za-z\s]+\]?(?:\*\*)?:\s*/, '')   // убираем «Имя:» в начале
                .replace(/\[[^\]]*\]/g, '')                                          // и служебные метки
                .trim();
        }
        return '';
    } catch (e) { return ''; }
    finally { clearTimeout(tid); }
}

/* Круглый стол: агенты говорят по очереди, каждый — своим ответом модели. */
async function runAgentRoundtable(topic) {
    const list = (selectedAgents || [])
        .filter(a => typeof AGENT_ICONS === 'undefined' || AGENT_ICONS[a])
        .slice(0, ROUNDTABLE_MAX_AGENTS);
    if (list.length < 2) return;
    renderMessage('💬 *[Совет: агенты обсуждают задачу между собой]*', 'director', 'Оркестратор');
    const spoken = [];
    for (const agent of list) {
        focusAgentCard(agent);
        setAgentStatus(agent, 'typing'); updateAgentStatus(agent, 'busy');
        let reply = await askAgentOnce(agent, topic, spoken);
        if (!reply) reply = 'Нет данных по этому пункту — жду уточнения от коллег.';
        spoken.push({ agent: agent, text: reply });
        await new Promise(resolve => { typeMessage(reply, 'director', agent, resolve); });
        setAgentStatus(agent, 'idle'); updateAgentStatus(agent, 'free');
        await new Promise(r => setTimeout(r, 400));
    }
    addMessageToHistory(spoken.map(s => `[${s.agent}]: ${s.text}`).join('\n'), 'director', 'Совет');
}

async function runBackgroundTask(agentName, taskDescription) {
    updateAgentStatus(agentName, 'working');
    setTimeout(async () => {
        try {
            const response = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "system", content: `Ты — ${agentName}. Выполнена задача: "${taskDescription}". Напиши краткий отчет.` }], temperature: 0.7, userKeys: JSON.parse(localStorage.getItem('shtabUserKeys')) || {} }) });
            const data = await response.json();
            if (data.choices && data.choices.length > 0) { const r = data.choices[0].message.content; typeMessage(r, 'director', agentName); addMessageToHistory(r, 'director', agentName); }
        } catch(e) { console.error(e); }
        setAgentStatus(agentName, 'idle'); updateAgentStatus(agentName, 'free');
    }, 15000);
}

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
    isGenerating = false; clearTimeout(typingTimer);
    renderMessage(`⚡ *[Система: ${reason} — авто-пинок ${stallKicks}/${STALL_MAX_KICKS}. Пишу «продолжи» от имени Босса.]*`, 'director', 'Оркестратор');
    renderMessage('продолжи', 'boss'); addMessageToHistory('продолжи', 'boss');
    stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopHardWatchdog();
    setTimeout(() => sendMessage('продолжи', true), 900);   // sendMessage сам перезапустит сторожа, пока пинков меньше лимита
    return true;
}
function doStallKick(reason) { fireAutoKick(reason); }
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
        // 2) Ответа в чате нет вообще — пинок по таймауту.
        if (newMsgs === 0 && (now - startedAt) >= STALL_TIMEOUT_MS) {
            doStallKick(`тишина ${Math.round(STALL_TIMEOUT_MS / 1000)} с`); return;
        }
        // 3) Запрос завершился, а ответа в чате так и нет — обрыв. Пинаем сразу,
        //    не дожидаясь 300 с: так «оборвавшийся секундомер» больше не молчит.
        if (!isGenerating && newMsgs === 0) { doStallKick('запрос оборвался без ответа'); return; }
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

/* --- ЭТАПЫ БОЛЬШОЙ ЗАДАЧИ ---
   Большая задача делится на этапы. В конце каждого этапа Архитектор ставит
   метку [ЭТАП N/M]. Скрипт видит метку и сам, от имени Босса, пишет
   «продолжи этап N+1» — пока этапы не кончатся. Метка в чате не видна. */
const STAGE_RE = /\[(?:ЭТАП|STAGE)\s*(\d+)\s*\/\s*(\d+)\]/i;
const STAGE_MAX_KICKS = 12;        // предохранитель от бесконечной цепочки
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
            // Счётчик застыл на месте, а ответа нет — обрыв потока.
            if (now - lastTimerChange >= TIMER_FREEZE_MS) fireAutoKick(`счётчик застыл на ${cur || '—'}`);
            return;
        }
        // Счётчика на кнопке нет. Ответ пришёл — сторож больше не нужен.
        if (lastSendSuccess) { stopTimerFreezeWatchdog(); return; }
        // Счётчик «оборвался» (запрос умер без ответа) — пинаем сразу, не ждём 300 с.
        if (now - startedAt >= TIMER_FREEZE_MS) fireAutoKick('счётчик оборвался, ответа нет');
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
            const btn = findRefreshBtn();
            if (btn) { btn.classList.add('needs-update'); btn.innerText = '🔄 Обновить штаб ⬤'; }
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
            fireAutoKick('прошло 300 с, ответа нет');
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
        if (!btnAlive && !isGenerating && !lastSendSuccess) { fireAutoKick('счётчик на кнопке оборвался, ответа нет'); return; }
        // Прошло 303 с — пинок от имени Босса.
        if (Date.now() - buttonWatchStart >= BUTTON_TIMEOUT_MS) { fireAutoKick('на кнопке прошло 303 с, ответа нет'); return; }
    }, 1000);
}
function stopButtonWatchdog() { if (buttonWatchdog) { clearInterval(buttonWatchdog); buttonWatchdog = null; } }

function handleSendClick() {
    if (isGenerating) { 
        if (currentAbortController) currentAbortController.abort(); 
        isGenerating = false; 
        stopHardWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopButtonWatchdog();
        clearTimeout(typingTimer); // МГНОВЕННАЯ ОСТАНОВКА ПЕЧАТИ
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
    }
    const text = overrideText || chatInputEl.value.trim(); if (!text && !attachedFile) return;
    if (!overrideText) resetSearchGuard(); // новый вопрос Босса = чистый лист для поиска
    if (!overrideText && !isKick) resetStallKicks(); // новый вопрос Босса = счётчик авто-пинков с нуля
    if (!overrideText && !isKick) resetStageKicks(); // новый вопрос Босса = этапы с нуля

    if (!overrideText && !isKick) {
        chatInputEl.value = ''; chatInputEl.style.height = 'auto'; playSound('send'); 
        const fileMeta = attachedFile ? { name: attachedFile.name, size: attachedFile.size } : null;
        const displayText = text || (attachedFile ? '📄 ' + attachedFile.name : '');
        renderMessage(displayText, 'boss', 'Оркестратор', fileMeta);
        addMessageToHistory(displayText, 'boss', null, fileMeta);
        clearAttachPreview();
    }

    isGenerating = true; lastSendSuccess = false; const mySeq = ++sendSeq;
    // Сторож тишины стартует ТОЛЬКО когда Босс сам нажал «Отправить».
    // Авто-пинки и системные дозапросы сторож не перезапускают.
    if (!overrideText && !isKick) { startButtonWatchdog(); startStallWatchdog(); startTimerFreezeWatchdog(); startHardWatchdog(); } else if (isKick && stallKicks < STALL_MAX_KICKS) { startButtonWatchdog(); startStallWatchdog(); startTimerFreezeWatchdog(); startHardWatchdog(); } else { stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); stopHardWatchdog(); }
    sendBtn.disabled = false; sendBtn.className = 'send-btn stop-active'; sendBtn.innerText = '0.0s'; sendBtn.style.fontSize = "12px";
    const timeBadge = document.getElementById('final-time-badge'); if (timeBadge) timeBadge.classList.remove('show'); 
    let startTime = Date.now();
    let timerInterval = setInterval(() => { let elapsed = ((Date.now() - startTime) / 1000).toFixed(1); if(!isGenerating) return; sendBtn.innerText = elapsed + "s"; }, 100);

    if (typeof resetAllStatuses === 'function') resetAllStatuses(); 
    const activeAgent = selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор';
    focusAgentCard(activeAgent);

    if (typeof updateAgentStatus === 'function') { updateAgentStatus(activeAgent, 'busy'); setAgentStatus(activeAgent, 'thinking'); }
    const elAi = document.getElementById('status-ai'); if (elAi) elAi.className = 'status-item loading';

    currentAbortController = new AbortController(); const timeoutId = setTimeout(() => currentAbortController.abort(), 330000); clearTimeout(watchdogTimer);

    try {
        let success = false; let aiText = ""; let lastError = "";
        
        let userKeys = {};
        try { userKeys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {}; } catch (e) {}
        let hasAnyKeys = Object.keys(userKeys).length > 0 && Object.values(userKeys).some(k => k && k.trim() !== '');

        let isBossSecret = false;
        if (userKeys.deepseekKey && (userKeys.deepseekKey.trim().toLowerCase() === 'zveno' || userKeys.deepseekKey.trim().toLowerCase() === 'boss')) {
            hasAnyKeys = true; isBossSecret = true; userKeys = {}; 
        }
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
                if (isBossSecret) modelToUse = 'zveno';

                let currentMessages = trimHistory(messagesToSend);
                let maxAttempts = 3; 
                let currentAttempt = 0;

                while (currentAttempt < maxAttempts) {
                    currentAttempt++;
                    currentMessages = trimHistory(currentMessages);
                    const response = await fetch(PROXY, { 
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ messages: currentMessages, temperature: 0.7, model: modelToUse, userKeys: userKeys, image: attachedImageBase64, isBoss: true }),
                        signal: currentAbortController.signal
                    });
                    
                    const data = await response.json();
                    if (!response.ok) { lastError = data.error || `Ошибка сервера: ${response.status}`; break; }
                    
                    if (data.choices && data.choices.length > 0) {
                        aiText = data.choices[0].message.content;
                        
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
                if (!isKick) { fireAutoKick(saidEmpty ? 'модель написала «пустой ответ»' : 'пустой ответ от модели'); return; }
                renderMessage('❌ **Модель вернула пустой ответ.**', 'director', 'Оркестратор');
            }
            lastSendSuccess = true;
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
            aiText = aiText.replace(taskRegex, '').trim();
            tasksToRun.forEach(t => { if (typeof updateAgentStatus === 'function') updateAgentStatus(t.agent, 'working'); runBackgroundTask(t.agent, t.task); });
            
            addMessageToHistory(aiText, 'director', selectedAgents.length > 1 ? 'Совет' : (selectedAgents[0] || 'Оркестратор'));
            if (elAi) elAi.className = 'status-item online';
            const replies = parseAgentReplies(aiText); await playAgentReplies(replies);

            // Модель ответила монологом (или реплики одного и того же агента), а в Совете
            // 2+ агентов — включаем короткий диалог между ними, чтобы Совет реально общался.
            // Считаем именно РАЗНЫХ говорящих: если реплики повторяет один агент — это не диалог.
            const distinctSpeakers = new Set(replies.map(r => r.agent)).size;
            if (!isKick && typeof isAgentDialogueEnabled !== 'undefined' && isAgentDialogueEnabled
                && selectedAgents.length > 1 && distinctSpeakers < 2) {
                await runAgentRoundtable(text);
            }

            // Метка [ЭТАП N/M] — этап закрыт, просим продолжить следующий.
            const stage = parseStageMarker(aiText);
            if (!isKick && stage && stageKicks < STAGE_MAX_KICKS) {
                stageKicks++;
                renderMessage(`🧩 *[Система: этап ${stage.cur}/${stage.total} закрыт. Авто-пинок — прошу продолжить этап ${stage.cur + 1}.]*`, 'director', 'Оркестратор');
                const nextStageText = `продолжи этап ${stage.cur + 1} из ${stage.total}`;
                renderMessage(nextStageText, 'boss'); addMessageToHistory(nextStageText, 'boss');
                setTimeout(() => sendMessage(nextStageText, true), 900);
            }
            // Ответ пришёл, но оборван на середине — просим продолжить.
            else if (!isKick && !kickGuardActive() && looksTruncated(aiText) && stallKicks < STALL_MAX_KICKS) {
                stallKicks++;
                markKickSent();
                renderMessage(`⚡ *[Система: ответ оборван на середине. Авто-пинок ${stallKicks}/${STALL_MAX_KICKS} — прошу продолжить.]*`, 'director', 'Оркестратор');
                renderMessage('продолжи', 'boss'); addMessageToHistory('продолжи', 'boss');
                setTimeout(() => sendMessage('продолжи', true), 900);
            }

            const stallRegex = /подождите|занимает время|сейчас произведу|сейчас поищу|пожалуйста, подождите|терпения|анализирую|скоро закончу|дай мне секунду|гляну текущий код|сейчас выдам/i;
            if (!isKick && stallRegex.test(aiText) && selectedAgents.length === 1) watchdogTimer = setTimeout(() => { kickAI(selectedAgents[0]); }, 60000); 

        } else {
            renderMessage(`❌ **Ошибка AI:**\n${lastError}`, 'director', 'Оркестратор');
            if (elAi) elAi.className = 'status-item offline'; if (typeof updateAgentStatus === 'function') updateAgentStatus(activeAgent, 'error');
        }
    } finally {
        if (mySeq === sendSeq) {
            stopHardWatchdog();
            if (lastSendSuccess) { stopButtonWatchdog(); stopStallWatchdog(); stopTimerFreezeWatchdog(); }
            // Ответа нет — сторожа счётчика и тишины оставляем жить: они поймают
            // «оборвавшийся секундомер» и пошлют авто-пинок, а не будут молчать.
        }
        isGenerating = false; clearInterval(timerInterval); 
        attachedImageBase64 = null; attachedFile = null; clearAttachPreview();
        let finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (timeBadge) { timeBadge.innerText = finalElapsed + "s"; timeBadge.classList.add('show'); setTimeout(() => { timeBadge.classList.remove('show'); }, 5000); }
        sendBtn.disabled = false; sendBtn.className = 'send-btn'; sendBtn.innerText = "➤"; sendBtn.style.fontSize = ""; sendBtn.style.background = "#00e5ff"; sendBtn.style.color = "#000";
    }
}

function focusAgentCard(agentName) {
    document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('active-agent-glow'));
    const activeCard = document.getElementById('agent-' + agentName);
    if (!activeCard) return;
    activeCard.classList.add('active-agent-glow');
    const container = activeCard.parentNode;
    if (container && container.firstElementChild !== activeCard) container.prepend(activeCard);
}

function init() {
    restoreKickState();   // подхватываем счётчик пинков после F5 — лишних не шлём
    startUpdateWatch();   // следим за обновлениями с сервера — кнопка «Обновить штаб» мигает
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
    const btnAI = document.getElementById('btnAIModel');
    if (btnAI) {
        if (selectedAIModel === 'deepseek') {
            btnAI.innerText = '🧠 ИИ: DeepSeek';
            btnAI.style.background = '#4CAF50';
            btnAI.style.color = '#fff';
        } else {
            btnAI.innerText = '🧠 ИИ: Yandex';
            btnAI.style.background = '#333';
            btnAI.style.color = '#aaa';
        }
    }
}
