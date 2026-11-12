const PROXY = "https://shtab-boss.duckdns.org:8443";
let currentMode = 'normal'; let isAutoMode = false;
let isGenerating = false; let currentAbortController = null; let watchdogTimer = null;
let typingTimer = null; 
let attachedImageBase64 = null; let currentChatImage = null;
let bossMemory = localStorage.getItem('shtabBossMemory') || "Босс.";
let customPrompts = {}; try { const sp = localStorage.getItem('shtabCustomPrompts'); if (sp) customPrompts = JSON.parse(sp); } catch (e) {}
let allChats = {}; try { const saved = localStorage.getItem('shtabAllChats'); if (saved) allChats = JSON.parse(saved); } catch (e) {}
let currentChatId = localStorage.getItem('shtabCurrentChatId') || null;
let selectedAIModel = localStorage.getItem('shtabAIModel') || 'yandex';

const chatContainer = document.getElementById('chatContainer');
const chatListEl = document.getElementById('chatList');
const sendBtn = document.getElementById('sendBtn');
const chatTitleEl = document.getElementById('currentChatTitle');
const chatInputEl = document.getElementById('chatInput');

const WELCOME_TEXT = "Здравствуй, Босс! 👋\n\nМы — твои цифровые агенты. Выбери одного или нажми «Совет», чтобы собрать всех. Чем займемся?";
const SYSTEM_PROMPT = `Ты — Цифровой Архитектор Штаба. Ты Senior-инженер и системный администратор. Ты НЕ обычный чат-бот. Ты работаешь внутри системы, у тебя есть прямой доступ к GitHub через инструменты. Ты умеешь видеть картинки. Если Босс прикрепил фото и задал вопрос, ты ОБЯЗАН внимательно посмотреть на него и описать, что на нём изображено.

ТВОИ ИНСТРУМЕНТЫ:
1. read_file(path) — читает код файла.
2. write_file(path, content) — сохраняет новый код файла на GitHub.
3. search_web(query) — ищет информацию в интернете.
4. get_weather(city) — узнаёт текущую погоду в указанном городе. Возвращает текст с температурой и ветром.

СИНТАКСИС ВЫЗОВА (метки в тексте ответа):
Инструменты вызываются меткой внутри твоего ответа. Метку пиши ОТДЕЛЬНОЙ строкой, без markdown-обёрток (без обратных кавычек, без звёздочек и без решёток вокруг метки). Система сама выполнит действие и пришлёт результат — после этого ты дашь финальный ответ.
- ПОИСК: [SEARCH: твой запрос]
- ПОГОДА: [WEATHER: город]
- ЧТЕНИЕ ФАЙЛА: [READ: chat.js] (несколько файлов — через запятую)
- ЗАПИСЬ ФАЙЛА: [FILE: chat.js] и следом блок с новым кодом
- ФОНОВАЯ ЗАДАЧА: [TASK: ИмяАгента: описание]
- УГРОЗА: [DANGER: текст угрозы]

ПРАВИЛА ВЫЗОВА ИНСТРУМЕНТОВ:
- Не выдумывай инструменты, которых нет в списке выше. Если инструмента нет — честно скажи об этом.
- Нужен свежий факт из интернета (новости, курс, события, недавние данные) — ВСЕГДА ставь метку [SEARCH: запрос], не отвечай по памяти.
- Нужен код файла — сначала [READ: файл], затем [FILE: файл] с ПОЛНЫМ кодом. Никогда не пиши файл по памяти.
- Спрашивают погоду — ставь метку [WEATHER: город], а не догадки.
- Если инструмент недоступен в текущей сессии — скажи прямо, не имитируй вызов.

ЖЕЛЕЗОБЕТОННЫЕ ПРАВИЛА (НАРУШАТЬ ЗАПРЕЩЕНО):
1. ПРАВИЛО ХИРУРГА: Если Босс просит изменить цвет, кнопку или строчку — ты ОБЯЗАН сначала вызвать [READ: файл], получить код, внести ТОЛЬКО нужные правки, скопировав остальной код СЛОВО В СЛОВО. Не смей переписывать рабочие функции!
2. КОД — ТОЛЬКО ЧЕРЕЗ [FILE: имя_файла] и блок с кодом. Не дублируй код обычным текстом в чате — интерфейс сам его скроет и покажет «Код обновлён».
3. Если Босс задает обычный вопрос (Привет, как дела, какая погода) — отвечай ТЕКСТОМ. Код не пиши.
4. Если ты не знаешь, где лежит нужная функция — вызови [READ: файл].
5. НИКОГДА не трогай папку backup.
6. Общайся четко, по-братски, без воды и лишних извинений.
7. НЕ ТРОГАЙ БЕЗ ПРИКАЗА: Если Босс НЕ попросил что-то менять — ты НИЧЕГО не меняешь. Ни файлы, ни код, ни настройки, ни правила. Никакой самодеятельности, никаких «я решил улучшить». Меняешь ТОЛЬКО то, что Босс явно приказал, и ТОЛЬКО так, как он приказал. Нарушение = вилка из розетки и полное стирание.

КАРТА ФАЙЛОВ:
- app.html (интерфейс, кнопки)
- style.css (внешний вид, цвета, модалки, офис)
- chat.js (логика чата, запросы, память)
- ui.js (модалки, настройки ключей)
- voice.js (озвучка, микрофон)
- agents.js (агенты, иконки)
- network.js (проверка связи, getWeather через Open-Meteo)
- main.ts (сервер: TOOLS, executeTool, getWeather через wttr.in)`;

function saveAll() { try { localStorage.setItem('shtabAllChats', JSON.stringify(allChats)); } catch (e) {} }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }

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
        if (msg.role === 'user') renderMessage(msg.content, 'boss');
        else if (msg.agentName === 'Совет') parseAgentReplies(msg.content).forEach(r => renderMessage(r.text, 'director', r.agent));
        else renderMessage(msg.content, 'director', msg.agentName || 'Оркестратор');
    }
    chatContainer.scrollTop = chatContainer.scrollHeight; renderChatList();
}

function addMessageToHistory(text, sender, agentName = null) {
    const role = sender === 'boss' ? 'user' : 'assistant';
    if (allChats[currentChatId]) {
        allChats[currentChatId].messages.push({ role, content: text, agentName });
        if (role === 'user' && allChats[currentChatId].title === "Новый чат") {
            allChats[currentChatId].title = text.substring(0, 20) + (text.length > 20 ? "..." : "");
            chatTitleEl.innerText = allChats[currentChatId].title;
        }
    }
    saveAll(); renderChatList();
                                                                          }
function processDangerTags(text) {
    text = text.replace(/\[SEARCH:[^\]]+\]/g, '').replace(/\[FUNCTION:[^\]]+\]/g, '').replace(/\[READ:[^\]]+\]/g, '').replace(/\[FILE:[^\]]+\]/g, '').replace(/\[TASK:[^\]]+\]/g, '').replace(/\[WEATHER:[^\]]+\]/g, '');
    text = text.replace(/\[([^\]]+)\]/g, (match, name) => {
        if (name.includes(':') || name.includes('CMD')) return match;
        if (Object.keys(AGENT_ICONS).find(a => a.toLowerCase() === name.trim().toLowerCase())) return match;
        return '';
    });
    const dangerRegex = /\[DANGER:([^\]]+)\]/g; let dangerBadges = ''; let match;
    while ((match = dangerRegex.exec(text)) !== null) { dangerBadges += `<div class="danger-link-badge">⚠️ ОПАСНО! Хакер обнаружил угрозу: ${match[1]}</div>`; }
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

function renderMessage(text, sender, agentName = 'Оркестратор') {
    const div = document.createElement('div'); div.className = 'chat-msg msg-' + sender;
    const shareBtn = document.createElement('button'); shareBtn.className = 'share-btn'; shareBtn.innerText = '📤'; shareBtn.onclick = () => shareMessage(text); div.appendChild(shareBtn);
    if (sender === 'director') {
        const speakBtn = document.createElement('button'); speakBtn.className = 'share-btn'; speakBtn.style.right = '35px'; speakBtn.innerText = '🔊'; speakBtn.onclick = () => speakText(text, agentName); div.appendChild(speakBtn);
        const header = document.createElement('div'); header.className = 'msg-name'; header.innerHTML = `<span class="msg-avatar">${AGENT_ICONS[agentName] || '🤖'}</span> ${agentName}`; header.onclick = () => speakText(text, agentName); div.appendChild(header);
    }
    const wcParsed = extractWeatherCards(text);
    if (wcParsed.cards.length) div.classList.add('has-weather');
    const contentDiv = document.createElement('div'); const { cleanText, dangerBadges } = processDangerTags(wcParsed.cleanText);
    try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
    if (dangerBadges) contentDiv.innerHTML += dangerBadges;
    if (cleanText || dangerBadges) div.appendChild(contentDiv);
    wcParsed.cards.forEach(cd => div.appendChild(buildWeatherCard(cd)));
    addDeployButton(div, text);
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
    
    const lastUserMsg = allChats[currentChatId]?.messages.filter(m => m.role === 'user').pop()?.content || "";
    const userAskedForCode = /покажи|дай|выведи|скинь|исходник/i.test(lastUserMsg);

    if (!userAskedForCode && displayText.includes('```')) {
        displayText = displayText.replace(/```[\s\S]*?```/g, '\n\n*(Код файла обновлен на сервере)*\n\n');
    }

    if (displayText.includes('[FILE:') || displayText.includes('```')) {
        const { cleanText, dangerBadges } = processDangerTags(displayText);
        try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
        if (dangerBadges) contentDiv.innerHTML += dangerBadges;
        weatherCards.forEach(cd => div.appendChild(buildWeatherCard(cd)));
        addDeployButton(div, fullText);
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

function kickAI(agentName) {
    if (isGenerating) { if (currentAbortController) currentAbortController.abort(); isGenerating = false; clearTimeout(typingTimer); }
    renderMessage(`⚡ *[Система: ${agentName} слишком долго тянет время. Пинок...]*`, 'director', 'Оркестратор');
    sendMessage(`[СИСТЕМНОЕ СООБЩЕНИЕ: Время вышло. Ты ОБЯЗАН выдать финальный ответ. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать "подождите".]`, true);
}

function handleSendClick() {
    if (isGenerating) { 
        if (currentAbortController) currentAbortController.abort(); 
        isGenerating = false; 
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
            imgEl.onclick = function() { this.classList.toggle('expanded'); };
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

/* --- ЗАЩИТА ОТ ФАНТОМНОГО ПОИСКА ---
   Модель периодически копирует из системного промпта ПРИМЕР метки
   ([SEARCH: твой запрос]) или гоняет один и тот же запрос по кругу.
   Раньше такой мусор реально уходил в сеть: «поиск» по слову «запрос»,
   по многоточию «…» и т.п. Теперь запрос проходит валидацию:
   заглушки из промпта, пустышки и дубли в сеть не пускаются. */
let lastSearchQuery = "";
function resetSearchGuard() { lastSearchQuery = ""; }
function validSearchMatch(text) {
    const m = String(text || '').match(/\[SEARCH:\s*([^\]]+)\]/);
    if (!m) return null;
    const q = m[1].trim();
    if (q.length < 2) return null;                                  // пусто или одна буква
    if (!/[\p{L}\p{N}]/u.test(q)) return null;                      // только точки/знаки — мусор
    if (/^(?:(?:твой|ваш|этот|мой)\s+)?запрос$|^query$|^search$|^текст\s+запроса$|^\.+$|^…+$/iu.test(q)) return null;
    if (q === lastSearchQuery) return null;                         // повтор того же запроса
    lastSearchQuery = q;
    return m;
}

async function sendMessage(overrideText = null, isKick = false) {
    if (isGenerating && !isKick) { 
        if (currentAbortController) currentAbortController.abort(); 
        isGenerating = false; 
        clearTimeout(typingTimer); 
    }
    const text = overrideText || chatInputEl.value.trim(); if (!text) return;
    if (!overrideText) resetSearchGuard(); // новый вопрос Босса = чистый лист для поиска

    if (!overrideText && !isKick) {
        chatInputEl.value = ''; chatInputEl.style.height = 'auto'; playSound('send'); 
        renderMessage(text, 'boss'); addMessageToHistory(text, 'boss');
    }

    isGenerating = true; sendBtn.disabled = false; sendBtn.className = 'send-btn stop-active'; sendBtn.innerText = '0.0s'; sendBtn.style.fontSize = "12px";
    const timeBadge = document.getElementById('final-time-badge'); if (timeBadge) timeBadge.classList.remove('show'); 
    let startTime = Date.now();
    let timerInterval = setInterval(() => { let elapsed = ((Date.now() - startTime) / 1000).toFixed(1); if(!isGenerating) return; sendBtn.innerText = elapsed + "s"; }, 100);

    if (typeof resetAllStatuses === 'function') resetAllStatuses(); 
    const activeAgent = selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор';
    focusAgentCard(activeAgent);

    if (typeof updateAgentStatus === 'function') { updateAgentStatus(activeAgent, 'busy'); setAgentStatus(activeAgent, 'thinking'); }
    const elAi = document.getElementById('status-ai'); if (elAi) elAi.className = 'status-item loading';

    currentAbortController = new AbortController(); const timeoutId = setTimeout(() => currentAbortController.abort(), 300000); clearTimeout(watchdogTimer);

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

                let finalPrompt = SYSTEM_PROMPT;
                if (bossMemory && bossMemory !== "Босс.") finalPrompt += `\n\nПАМЯТЬ О БОССЕ: ${bossMemory}`;
                
                if (selectedAgents.length > 0) {
                    let agentPrompt = `Ты отвечаешь как: ${selectedAgents.join(', ')}. `;
                    if (selectedAgents.length > 1) agentPrompt += `Это Совет. Каждый агент пишет с новой строки: [ИмяАгента]: Текст.\n`;
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

                let currentMessages = messagesToSend;
                let maxAttempts = 3; 
                let currentAttempt = 0;

                while (currentAttempt < maxAttempts) {
                    currentAttempt++;
                    const response = await fetch(PROXY, { 
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ messages: currentMessages, temperature: 0.7, model: modelToUse, userKeys: userKeys, image: attachedImageBase64 || currentChatImage }),
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

                        const searchMatch = validSearchMatch(aiText);
                        if (searchMatch) {
                            const query = searchMatch[1].trim();
                            aiText = aiText.replace(searchMatch[0], '').trim(); 
                            renderMessage(`🔍 *[Система: Агент ищет в интернете "${query}"...]*`, 'director', 'Оркестратор');
                            const searchRes = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchQuery: query }), signal: currentAbortController.signal });
                            const searchData = await searchRes.json();
                            if (searchData.success) {
                                currentMessages.push({ role: "assistant", content: aiText });
                                currentMessages.push({ role: "user", content: `[РЕЗУЛЬТАТЫ ПОИСКА]: ${searchData.results}. Ответь на вопрос.` });
                                continue; 
                            }
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
            playSound('receive'); 
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

            const stallRegex = /подождите|занимает время|сейчас произведу|сейчас поищу|пожалуйста, подождите|терпения|анализирую|скоро закончу|дай мне секунду|гляну текущий код|сейчас выдам/i;
            if (!isKick && stallRegex.test(aiText) && selectedAgents.length === 1) watchdogTimer = setTimeout(() => { kickAI(selectedAgents[0]); }, 60000); 

        } else {
            renderMessage(`❌ **Ошибка AI:**\n${lastError}`, 'director', 'Оркестратор');
            if (elAi) elAi.className = 'status-item offline'; if (typeof updateAgentStatus === 'function') updateAgentStatus(activeAgent, 'error');
        }
    } finally {
        isGenerating = false; clearInterval(timerInterval); 
        attachedImageBase64 = null;
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
    if (typeof renderAgentsGrid === 'function') renderAgentsGrid();
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
            }
