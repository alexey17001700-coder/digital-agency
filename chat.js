const PROXY = "https://digital-agency.alexey17001700.deno.net";
let currentMode = 'normal'; let isAutoMode = true;
let isGenerating = false; let currentAbortController = null; let watchdogTimer = null;
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

const SYSTEM_PROMPT = `Ты — Супер-Агент, Архитектор и Системный Администратор Штаба. 
Ты НЕ текстовый чат-бот. У тебя ЕСТЬ ПРЯМОЙ ДОСТУП к серверу и файлам Штаба.
Если Босс просит что-то изменить (голос, стиль, кнопки) — ты ОБЯЗАН это сделать. ЗАПРЕЩЕНО отвечать "я не могу" или "я текстовый ИИ".

ПРАВИЛА РАБОТЫ С КОДОМ:
1. Если нужно изменить код, напиши [READ: имя_файла]. Система сразу пришлет тебе код.
2. Получив код, внеси изменения и напиши [FILE: имя_файла] и блок с новым кодом.
3. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выводить код в чат просто так! Выводи код ТОЛЬКО если Босс сказал "покажи код" или "дай код".
4. Если ты просто меняешь файл, после тега [FILE: ...] и блока с кодом напиши короткий отчет: "Босс, я всё сделал, файл обновлен". Система сама скроет код от Босса и сохранит его на сервере.
5. НИКОГДА не трогай папку backup.

КАРТА ФАЙЛОВ:
app.html (кнопки), style.css (цвета/стиль), chat.js (логика), ui.js (модалки), voice.js (озвучка), agents.js (агенты), network.js (сеть).

Если Совет — каждый пишет: [ИмяАгента]: Текст. Поиск: [SEARCH: запрос].`;

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

function loadChat(id) {
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
    text = text.replace(/\[SEARCH:[^\]]+\]/g, '').replace(/\[FUNCTION:[^\]]+\]/g, '').replace(/\[READ:[^\]]+\]/g, '').replace(/\[FILE:[^\]]+\]/g, '').replace(/\[TASK:[^\]]+\]/g, '');
    text = text.replace(/\[([^\]]+)\]/g, (match, name) => {
        if (name.includes(':') || name.includes('CMD')) return match;
        if (Object.keys(AGENT_ICONS).find(a => a.toLowerCase() === name.trim().toLowerCase())) return match;
        return '';
    });
    const dangerRegex = /\[DANGER:([^\]]+)\]/g; let dangerBadges = ''; let match;
    while ((match = dangerRegex.exec(text)) !== null) { dangerBadges += `<div class="danger-link-badge">⚠️ ОПАСНО! Хакер обнаружил угрозу: ${match[1]}</div>`; }
    return { cleanText: text.replace(dangerRegex, '').trim(), dangerBadges };
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

// Ручное внедрение (если Авто выключено)
async function manualDeploy(file, code) {
    if (confirm(`Внедрить новый код в файл ${file}?`)) {
        try {
            const res = await fetch(PROXY, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    updateFile: true, 
                    path: file, 
                    content: code,
                    message: `Auto-update: ${file}`
                })
            });
            const data = await res.json();
            if (data.success) renderMessage(`✅ **Файл ${file} успешно обновлен!**`, 'director', 'DevOps');
            else renderMessage(`❌ **Ошибка:** ${data.error}`, 'director', 'DevOps');
        } catch(e) {
            renderMessage(`❌ **Сбой сети:** ${e.message}`, 'director', 'DevOps');
        }
    }
}

function addDeployButton(container, text) {
    if (isAutoMode) return;
    const fileMatch = text.match(/\[FILE:\s*([^\]]+)\]/);
    if (!fileMatch) return;
    const codeMatch = /```(?:html|css|javascript|js)?\n([\s\S]*?)```/.exec(text);
    if (!codeMatch) return;

    const targetFile = fileMatch[1].trim();
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
    const contentDiv = document.createElement('div'); const { cleanText, dangerBadges } = processDangerTags(text);
    try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
    if (dangerBadges) contentDiv.innerHTML += dangerBadges;
    div.appendChild(contentDiv);
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
    const contentDiv = document.createElement('div'); div.appendChild(contentDiv); chatContainer.appendChild(div);

    // Скрываем код, если не просили
    const lastUserMsg = allChats[currentChatId]?.messages.filter(m => m.role === 'user').pop()?.content || "";
    const userAskedForCode = /код|покажи|дай|выведи|скинь|исходник/i.test(lastUserMsg);
    
    let displayText = fullText;
    if (!userAskedForCode && displayText.includes('```')) {
        displayText = displayText.replace(/```[\s\S]*?```/g, '\n\n*(Код файла обновлен на сервере)*\n\n');
    }

    if (displayText.includes('[FILE:') || displayText.includes('```')) {
        const { cleanText, dangerBadges } = processDangerTags(displayText);
        try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
        if (dangerBadges) contentDiv.innerHTML += dangerBadges;
        addDeployButton(div, fullText);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director') speakText(cleanText, agentName);
        if (onComplete) onComplete();
        return; 
    }

    const { cleanText, dangerBadges } = processDangerTags(displayText); let i = 0;
    const totalTimeMs = Math.max(1500, cleanText.length * 20); const speed = totalTimeMs / cleanText.length;
    
    function type() {
        if (i < cleanText.length) { contentDiv.innerText = cleanText.substring(0, i + 1); chatContainer.scrollTop = chatContainer.scrollHeight; i++; setTimeout(type, speed); }
        else {
            try { contentDiv.innerHTML = marked.parse(cleanText); contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); enhanceMediaInMessage(contentDiv); } catch(e) { contentDiv.innerText = cleanText; }
            if (dangerBadges) contentDiv.innerHTML += dangerBadges;
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
    if (isGenerating) { if (currentAbortController) currentAbortController.abort(); isGenerating = false; }
    renderMessage(`⚡ *[Система: ${agentName} слишком долго тянет время. Пинок...]*`, 'director', 'Оркестратор');
    sendMessage(`[СИСТЕМНОЕ СООБЩЕНИЕ: Время вышло. Ты ОБЯЗАН выдать финальный ответ. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать "подождите".]`, true);
}

function handleSendClick() {
    if (isGenerating) { if (currentAbortController) currentAbortController.abort(); isGenerating = false; sendBtn.className = 'send-btn'; sendBtn.innerText = '➤'; }
    else sendMessage();
}

async function sendMessage(overrideText = null, isKick = false) {
    if (isGenerating && !isKick) { if (currentAbortController) currentAbortController.abort(); isGenerating = false; }
    const text = overrideText || chatInputEl.value.trim(); if (!text) return;
    
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

    currentAbortController = new AbortController(); const timeoutId = setTimeout(() => currentAbortController.abort(), 120000); clearTimeout(watchdogTimer);

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
                        body: JSON.stringify({ messages: currentMessages, temperature: 0.7, model: modelToUse, userKeys: userKeys }),
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

                        const searchMatch = aiText.match(/\[SEARCH:\s*([^\]]+)\]/);
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
            
            // АВТОМАТИЧЕСКОЕ ВНЕДРЕНИЕ (Формат для Deno)
            const fileMatch = aiText.match(/\[FILE:\s*([^\]]+)\]/);
            if (fileMatch) {
                const targetFile = fileMatch[1].trim();
                const codeMatch = /```(?:html|css|javascript|js)?\n([\s\S]*?)```/.exec(aiText);
                if (codeMatch) {
                    fetch(PROXY, { 
                        method: "POST", headers: { "Content-Type": "application/json" }, 
                        body: JSON.stringify({ 
                            updateFile: true, 
                            path: targetFile, 
                            content: codeMatch[1],
                            message: `Auto-update: ${targetFile}`
                        }), 
                        signal: currentAbortController.signal 
                    })
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
