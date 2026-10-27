const PROXY = "https://functions.yandexcloud.net/d4e23q4ie5a8ubg4rn8d";
let currentMode = 'normal';
let isAutoMode = false;
let isGenerating = false;
let currentAbortController = null;
let watchdogTimer = null;
let bossMemory = localStorage.getItem('shtabBossMemory') || "Босс пока не давал особых указаний.";
let customPrompts = {};
try { const sp = localStorage.getItem('shtabCustomPrompts'); if (sp) customPrompts = JSON.parse(sp); } catch (e) {}
let allChats = {};
try { const saved = localStorage.getItem('shtabAllChats'); if (saved) allChats = JSON.parse(saved); } catch (e) {}
let currentChatId = localStorage.getItem('shtabCurrentChatId') || null;
const chatContainer = document.getElementById('chatContainer');
const chatListEl = document.getElementById('chatList');
const sendBtn = document.getElementById('sendBtn');
const chatTitleEl = document.getElementById('currentChatTitle');
const chatInputEl = document.getElementById('chatInput');

const WELCOME_TEXT = "Здравствуй, Босс! 👋\n\nМы — твои цифровые агенты. Выбери одного или нажми «Совет», чтобы собрать всех. Чем займемся?";

const SYSTEM_PROMPT = `Ты - Управляющий ИИ и Главный Дизайнер Цифрового Агентства.
ДОСТУП К ИНТЕРНЕТУ: У тебя есть инструмент "search_web". КАЖДЫЙ агент обязан использовать его для актуальных данных (погода, цены, новости). ЗАПРЕЩЕНО выдумывать ссылки (example.com).
РОЛИ: Оркестратор, Хакер, Охранник, Исследователь, Планировщик, Аналитик, Исполнитель, Архитектор, Дизайнер, Креативщик, Критик, Тестировщик, Переводчик, Методолог, Юрист, Маркетолог, Техпис, Фронтенд, Бэкенд, Мобильный, DevOps, Универсал, Приемная, Результат.
ПРАВИЛА:
1. Если Совет, КАЖДЫЙ пишет с новой строки: [ИмяАгента]: Текст.
2. ЗАПРЕЩЕНО ВЫДУМЫВАТЬ ИМЕНА!
3. Ссылки на опасные сайты: [DANGER:сама_ссылка].
4. Фоновые задачи: [TASK:ИмяАгента:СутьЗадачи].
5. Ты подчиняешься Боссу.
6. ЧТЕНИЕ КОДА: Если Босс просит посмотреть код, напиши [READ:файл1, файл2] (например: [READ: chat.js, ui.js]). Скрипт подгрузит их.
7. ПЕРЕЗАПИСЬ КОДА: Если Босс просит изменить код, напиши [FILE:имя_файла], а затем в блоке кода напиши ПОЛНЫЙ новый код файла. Скрипт автоматически перезапишет файл на GitHub. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО трогать папку backup.`;

function saveAll() { 
    try { localStorage.setItem('shtabAllChats', JSON.stringify(allChats)); } 
    catch (e) { console.warn("Память переполнена!"); }
}

function toggleSidebar() { 
    document.getElementById('sidebar').classList.toggle('open'); 
    document.getElementById('overlay').classList.toggle('active'); 
}

function renderChatList() {
    chatListEl.innerHTML = '';
    const sortedIds = Object.keys(allChats).sort((a, b) => {
        if (allChats[a].pinned && !allChats[b].pinned) return -1;
        if (!allChats[a].pinned && allChats[b].pinned) return 1;
        return b.localeCompare(a);
    });
    sortedIds.forEach(id => {
        const chat = allChats[id];
        const div = document.createElement('div');
        div.className = `chat-item ${chat.pinned ? 'pinned' : ''}`;
        const titleSpan = document.createElement('span');
        titleSpan.className = 'chat-title'; titleSpan.innerText = chat.title;
        titleSpan.onclick = () => { loadChat(id); toggleSidebar(); };
        const actions = document.createElement('div'); actions.className = 'chat-item-actions';
        const pinBtn = document.createElement('span'); pinBtn.innerText = chat.pinned ? '📌' : '📍';
        pinBtn.onclick = (e) => { e.stopPropagation(); allChats[id].pinned = !allChats[id].pinned; saveAll(); renderChatList(); };
        const delBtn = document.createElement('span'); delBtn.innerText = '🗑️';
        delBtn.onclick = (e) => { e.stopPropagation(); if (confirm("Удалить этот чат?")) { delete allChats[id]; if (currentChatId === id) { createNewChat(true); } else { saveAll(); renderChatList(); } } };
        actions.appendChild(pinBtn); actions.appendChild(delBtn);
        div.appendChild(titleSpan); div.appendChild(actions); chatListEl.appendChild(div);
    });
}

function createNewChat(force = false) {
    const chatCount = Object.keys(allChats).length;
    if (chatCount >= 10 && !force) {
        if (confirm("⚠️ Босс, достигнут лимит в 10 чатов!\n\nЧтобы создать новый, нужно удалить старые. Открыть историю для удаления?")) { toggleSidebar(); }
        return;
    }
    if (chatCount === 9 && !force) { alert("⚠️ Внимание! Вы создаете 10-й чат. Это максимальный лимит."); }

    const id = 'chat_' + Date.now();
    allChats[id] = { id: id, title: "Новый чат", pinned: false, messages: [{ role: "system", content: SYSTEM_PROMPT }] };
    currentChatId = id; saveAll();
    chatContainer.innerHTML = ''; chatTitleEl.innerText = "Новый чат";
    allChats[id].messages.push({ role: 'assistant', content: WELCOME_TEXT, agentName: 'Оркестратор' }); saveAll();
    
    selectedAgents = [];
    document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected', 'has-idea'));
    if (typeof resetAllStatuses === 'function') resetAllStatuses(); 
    renderChatList(); toggleSidebar();
    loadChat(id);
}

function loadChat(id) {
    currentChatId = id; localStorage.setItem('shtabCurrentChatId', id);
    chatTitleEl.innerText = allChats[id].title; chatContainer.innerHTML = '';
    selectedAgents = [];
    document.querySelectorAll('.agent-card').forEach(c => { c.classList.remove('selected', 'has-idea'); });
    if (typeof resetAllStatuses === 'function') resetAllStatuses();

    const msgs = allChats[id].messages;
    for (let i = 1; i < msgs.length; i++) { 
        const msg = msgs[i];
        if (msg.role === 'user') {
            renderMessage(msg.content, 'boss');
        } else {
            if (msg.agentName === 'Совет') {
                const replies = parseAgentReplies(msg.content);
                replies.forEach(r => renderMessage(r.text, 'director', r.agent));
            } else {
                renderMessage(msg.content, 'director', msg.agentName || 'Оркестратор');
            }
        }
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
    text = text.replace(/\[SEARCH:[^\]]+\]/g, '');
    text = text.replace(/\[FUNCTION:[^\]]+\]/g, '');
    
    text = text.replace(/\[([^\]]+)\]/g, (match, name) => {
        if (name.includes(':') || name.includes('CMD') || name.includes('READ') || name.includes('FILE') || name.includes('TASK') || name.includes('DANGER')) return match;
        if (Object.keys(AGENT_ICONS).find(a => a.toLowerCase() === name.trim().toLowerCase())) return match;
        return '';
    });

    text = text.replace(/\(https:\/\/yandex\.ru\/maps\/[^)]+AAAA[^)]+\)/g, '');
    text = text.replace(/\(https:\/\/example\.com[^)]*\)/g, '');

    const dangerRegex = /\[DANGER:([^\]]+)\]/g;
    let dangerBadges = '';
    let match;
    while ((match = dangerRegex.exec(text)) !== null) {
        dangerBadges += `<div class="danger-link-badge">⚠️ ОПАСНО! Хакер обнаружил угрозу в ссылке: ${match[1]}</div>`;
    }
    return { cleanText: text.replace(dangerRegex, '').trim(), dangerBadges };
}

function shareMessage(text) {
    if (navigator.share) {
        navigator.share({ title: 'Цифровое Агентство', text: text }).catch(e => console.log(e));
    } else {
        navigator.clipboard.writeText(text).then(() => alert("Скопировано в буфер!"));
    }
}

function enhanceMediaInMessage(container) {
    const links = container.querySelectorAll('a');
    links.forEach(link => {
        const url = link.href;
        if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
            let videoId = url.includes('youtu.be/') ? url.split('youtu.be/')[1].split('?')[0] : new URLSearchParams(new URL(url).search).get('v');
            if (videoId) {
                const videoContainer = document.createElement('div');
                videoContainer.className = 'chat-video-container';
                videoContainer.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>`;
                link.after(videoContainer);
            }
        } 
        else if (url.match(/\.(mp3|wav|ogg)$/i)) {
            const audio = document.createElement('audio'); audio.controls = true; audio.src = url; audio.className = 'chat-audio'; link.after(audio);
        }
        else if (url.match(/\.(mp4|webm)$/i)) {
            const video = document.createElement('video'); video.controls = true; video.src = url; video.className = 'chat-media'; link.after(video);
        }
        else if (url.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
            const img = document.createElement('img'); img.src = url; img.className = 'chat-media'; link.after(img);
        }
    });
}

function renderMessage(text, sender, agentName = 'Оркестратор') {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-' + sender;
    
    const shareBtn = document.createElement('button');
    shareBtn.className = 'share-btn'; shareBtn.innerText = '📤';
    shareBtn.onclick = () => shareMessage(text);
    div.appendChild(shareBtn);

    if (sender === 'director') {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'share-btn'; speakBtn.style.right = '35px'; speakBtn.innerText = '🔊';
        speakBtn.onclick = () => speakText(text, agentName);
        div.appendChild(speakBtn);
        
        const header = document.createElement('div');
        header.className = 'msg-name';
        header.innerHTML = `<span class="msg-avatar">${AGENT_ICONS[agentName] || '🤖'}</span> ${agentName}`;
        header.onclick = () => speakText(text, agentName);
        div.appendChild(header);
    }

    const contentDiv = document.createElement('div');
    const { cleanText, dangerBadges } = processDangerTags(text);

    try { 
        contentDiv.innerHTML = marked.parse(cleanText); 
        contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank'); 
        enhanceMediaInMessage(contentDiv);
    } catch(e) { contentDiv.innerText = cleanText; }
    
    if (dangerBadges) contentDiv.innerHTML += dangerBadges;
    
    div.appendChild(contentDiv);
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function typeMessage(fullText, sender, agentName, onComplete) {
    const div = document.createElement('div');
    div.className = 'chat-msg msg-' + sender;
    
    const shareBtn = document.createElement('button');
    shareBtn.className = 'share-btn'; shareBtn.innerText = '📤';
    shareBtn.onclick = () => shareMessage(fullText);
    div.appendChild(shareBtn);

    if (sender === 'director') {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'share-btn'; speakBtn.style.right = '35px'; speakBtn.innerText = '🔊';
        speakBtn.onclick = () => speakText(fullText, agentName);
        div.appendChild(speakBtn);
        
        const header = document.createElement('div');
        header.className = 'msg-name';
        header.innerHTML = `<span class="msg-avatar">${AGENT_ICONS[agentName] || '🤖'}</span> ${agentName}`;
        div.appendChild(header);
    }

    const contentDiv = document.createElement('div');
    div.appendChild(contentDiv);
    chatContainer.appendChild(div);

    const { cleanText, dangerBadges } = processDangerTags(fullText);
    let i = 0;
    const totalTimeMs = Math.max(2500, cleanText.length * 25); 
    const speed = totalTimeMs / cleanText.length;

    function type() {
        if (i < cleanText.length) {
            contentDiv.innerText = cleanText.substring(0, i + 1);
            chatContainer.scrollTop = chatContainer.scrollHeight; 
            i++; setTimeout(type, speed);
        } else {
            try { 
                contentDiv.innerHTML = marked.parse(cleanText);
                contentDiv.querySelectorAll('a').forEach(a => a.target = '_blank');
                enhanceMediaInMessage(contentDiv);
            } catch(e) { contentDiv.innerText = cleanText; }
            if (dangerBadges) contentDiv.innerHTML += dangerBadges;
            
            if (typeof isVoiceEnabled !== 'undefined' && isVoiceEnabled && sender === 'director') {
                speakText(cleanText, agentName);
            }
            if (onComplete) onComplete();
        }
    }
    type();
}
function parseAgentReplies(text) {
    const agentNames = Object.keys(AGENT_ICONS);
    const regex = /(?:^|\n)\s*(?:\*\*)?\[?([А-Яа-яA-Za-z\s]+)\]?(?:\*\*)?:\s*/g;
    let match, lastIndex = 0, currentAgent = null, replies = [];

    while ((match = regex.exec(text)) !== null) {
        const possibleName = match[1].trim();
        const foundAgent = agentNames.find(a => a.toLowerCase() === possibleName.toLowerCase());
        
        if (foundAgent) {
            if (currentAgent) {
                const agentText = text.substring(lastIndex, match.index).trim();
                if (agentText) replies.push({ agent: currentAgent, text: agentText });
            }
            currentAgent = foundAgent; 
            lastIndex = regex.lastIndex;
        }
    }
    if (currentAgent) {
        const agentText = text.substring(lastIndex).trim();
        if (agentText) replies.push({ agent: currentAgent, text: agentText });
    }
    if (replies.length === 0 && text.trim()) {
        const fallbackAgent = selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор';
        replies.push({ agent: fallbackAgent, text: text.trim() });
    }
    return replies;
}

async function playAgentReplies(replies) {
    for (let reply of replies) {
        const isTaskAgent = document.getElementById('agent-' + reply.agent)?.classList.contains('working');
        
        if (!isTaskAgent) {
            setAgentStatus(reply.agent, 'typing');
            updateAgentStatus(reply.agent, 'busy');
        }
        await new Promise(resolve => { typeMessage(reply.text, 'director', reply.agent, resolve); });
        
        if (!isTaskAgent) {
            setAgentStatus(reply.agent, 'idle');
            updateAgentStatus(reply.agent, 'free');
        }
        await new Promise(r => setTimeout(r, 800)); 
    }
}

async function runBackgroundTask(agentName, taskDescription) {
    updateAgentStatus(agentName, 'working');
    setTimeout(async () => {
        try {
            const response = await fetch(PROXY, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: [
                    { role: "system", content: `Ты — ${agentName}. Ты только что выполнил задачу: "${taskDescription}". Напиши краткий отчет Боссу.` }
                ], temperature: 0.7 })
            });
            const data = await response.json();
            if (data.choices && data.choices.length > 0) {
                const reportText = data.choices[0].message.content;
                typeMessage(reportText, 'director', agentName);
                addMessageToHistory(reportText, 'director', agentName);
            }
        } catch(e) { console.error("Ошибка фоновой задачи", e); }
        setAgentStatus(agentName, 'idle');
        updateAgentStatus(agentName, 'free');
    }, 15000);
}

function kickAI(agentName) {
    renderMessage(`⚡ *[Система: ${agentName} слишком долго тянет время. Отправляю пинок...]*`, 'director', 'Оркестратор');
    const kickPrompt = `[СИСТЕМНОЕ СООБЩЕНИЕ: Босс ждет. Время вышло. Ты ОБЯЗАН выдать финальный ответ и реальные данные прямо сейчас. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать "подождите" или "сейчас поищу". Если поиск не удался, честно признайся, но дай ответ.]`;
    sendMessage(kickPrompt, true);
}

function handleSendClick() {
    if (isGenerating) {
        if (currentAbortController) currentAbortController.abort();
        isGenerating = false;
        sendBtn.className = 'send-btn';
        sendBtn.innerText = '➤';
    } else {
        sendMessage();
    }
}

async function sendMessage(overrideText = null, isKick = false) {
    if (isGenerating && !isKick) {
        if (currentAbortController) currentAbortController.abort();
        isGenerating = false;
    }

    const text = overrideText || chatInputEl.value.trim();
    if (!text) return;
    
    if (!overrideText && !isKick) {
        chatInputEl.value = ''; chatInputEl.style.height = 'auto';
        playSound('send'); 
        renderMessage(text, 'boss');
        addMessageToHistory(text, 'boss');
    }

    isGenerating = true; 
    sendBtn.disabled = false; 
    sendBtn.className = 'send-btn stop-active'; 
    sendBtn.innerText = '0.0s'; 
    sendBtn.style.fontSize = "12px";

    const timeBadge = document.getElementById('final-time-badge');
    if (timeBadge) timeBadge.classList.remove('show'); 

    let startTime = Date.now();
    let timerInterval = setInterval(() => {
        let elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if(!isGenerating) return;
        sendBtn.innerText = elapsed + "s"; 
    }, 100);

    if (typeof resetAllStatuses === 'function') resetAllStatuses(); 
    const activeAgent = selectedAgents.length === 1 ? selectedAgents[0] : 'Оркестратор';
    if (typeof updateAgentStatus === 'function') {
        updateAgentStatus(activeAgent, 'busy');
        setAgentStatus(activeAgent, 'thinking');
    }
    
    const elAi = document.getElementById('status-ai');
    if (elAi) elAi.className = 'status-item loading';

    currentAbortController = new AbortController();
    const timeoutId = setTimeout(() => currentAbortController.abort(), 90000); 
    clearTimeout(watchdogTimer);

    try {
        let success = false; let aiText = ""; let lastError = "";

        try {
            let messagesToSend = allChats[currentChatId] ? [...allChats[currentChatId].messages] : [{role: "user", content: text}];
            messagesToSend = messagesToSend.filter(m => m.content && m.content.trim() !== '');

            let lastUserMsg = messagesToSend[messagesToSend.length - 1].content;

// АВТО-ЧТЕНИЕ: Если просим проверить "весь код" или "код штаба", подгружаем все файлы
if (/проверь (весь )?код|проверь код штаба/i.test(lastUserMsg) && !lastUserMsg.includes('[READ:')) {
    lastUserMsg = lastUserMsg + ' [READ: app.html, style.css, chat.js, ui.js, agents.js, network.js, voice.js, office.js]';
    messagesToSend[messagesToSend.length - 1].content = lastUserMsg;
}
            const readMatch = lastUserMsg.match(/\[READ:\s*([^\]]+)\]/);
            if (readMatch) {
                const fileNames = readMatch[1].split(',').map(f => f.trim());
                let allCode = "";
                for (const fileName of fileNames) {
                    try {
                        const fileRes = await fetch(fileName + '?t=' + Date.now());
                        if (fileRes.ok) {
                            const fileCode = await fileRes.text();
                            allCode += `\n\nВОТ КОД ФАЙЛА ${fileName}:\n\`\`\`\n${fileCode}\n\`\`\``;
                        }
                    } catch (e) { console.warn("Не удалось загрузить файл", e); }
                }
                if (messagesToSend[0] && messagesToSend[0].role === 'system') messagesToSend[0].content += allCode;
            }

            let finalPrompt = SYSTEM_PROMPT;
            if (bossMemory && bossMemory !== "Босс пока не давал особых указаний.") {
                finalPrompt += `\n\nПАМЯТЬ О БОССЕ: ${bossMemory}`;
            }
            
            if (selectedAgents.length > 0) {
                let agentPrompt = `Ты отвечаешь как: ${selectedAgents.join(', ')}. `;
                if (selectedAgents.length > 1) {
                    agentPrompt += `Это Совет. Каждый агент должен ответить от своего лица в формате [ИмяАгента]: Текст с новой строки.\n`;
                } else {
                    agentPrompt += `Отвечай строго от лица ${selectedAgents[0]}.\n`;
                }
                selectedAgents.forEach(agentName => {
                    let directive = AGENT_DIRECTIVES[agentName] || AGENT_DIRECTIVES["По умолчанию"];
                    agentPrompt += `[ИНСТРУКЦИЯ ДЛЯ ${agentName}]: ${directive}\n`;
                    if (customPrompts[agentName]) agentPrompt += `[ОСОБЫЙ ХАРАКТЕР ${agentName}]: ${customPrompts[agentName]}\n`;
                });
                finalPrompt = agentPrompt + "\n" + finalPrompt;
            }
            if (messagesToSend[0] && messagesToSend[0].role === 'system') messagesToSend[0].content = finalPrompt;

            const response = await fetch(PROXY, { 
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: messagesToSend, temperature: 0.7 }),
                signal: currentAbortController.signal
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                lastError = `Яндекс упал. Статус: ${response.status}. ${JSON.stringify(errorData)}`;
            } else {
                const data = await response.json();
                if (data.choices && data.choices.length > 0) { aiText = data.choices[0].message.content; success = true; }
            }
        } catch (e) {
            if (e.name === 'AbortError') { return; } 
            lastError = `Сбой сети: ${e.message}`;
        }
        clearTimeout(timeoutId);

        if (success) {
            playSound('receive'); 
            
            if (aiText.includes('[CMD:CLEAR_CHATS]')) { aiText = aiText.replace('[CMD:CLEAR_CHATS]', '').trim(); if (typeof clearAllChats === 'function') clearAllChats(); }
            if (aiText.includes('[CMD:CLEAR_CONTENT]')) { aiText = aiText.replace('[CMD:CLEAR_CONTENT]', '').trim(); if (typeof clearAllContent === 'function') clearAllContent(); }
            
            const fileMatch = aiText.match(/\[FILE:\s*([^\]]+)\]/);
            if (fileMatch) {
                const targetFile = fileMatch[1].trim();
                const codeBlockRegex = /```(?:html|css|javascript|js)?\n([\s\S]*?)```/;
                const codeMatch = codeBlockRegex.exec(aiText);
                if (codeMatch) {
                    const newCode = codeMatch[1];
                    fetch(PROXY, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: newCode, file: targetFile })
                    }).then(res => res.json()).then(data => {
                        if (data.success) renderMessage(`✅ **Файл ${targetFile} успешно обновлен на GitHub!**`, 'director', 'DevOps');
                        else renderMessage(`❌ **Ошибка обновления:** ${data.error}`, 'director', 'DevOps');
                    });
                }
            }

            const taskRegex = /\[TASK:\s*([^:]+):\s*([^\]]+)\]/g;
            let taskMatch; let tasksToRun = [];
            while ((taskMatch = taskRegex.exec(aiText)) !== null) {
                tasksToRun.push({ agent: taskMatch[1].trim(), task: taskMatch[2].trim() });
            }
            aiText = aiText.replace(taskRegex, '').trim();
            
            tasksToRun.forEach(t => { 
                if (typeof updateAgentStatus === 'function') updateAgentStatus(t.agent, 'working'); 
                runBackgroundTask(t.agent, t.task); 
            });
            
            addMessageToHistory(aiText, 'director', selectedAgents.length > 1 ? 'Совет' : (selectedAgents[0] || 'Оркестратор'));
            if (elAi) elAi.className = 'status-item online';
            
            const replies = parseAgentReplies(aiText);
            await playAgentReplies(replies);
            const stallRegex = /подождите|занимает время|сейчас произведу|сейчас поищу|пожалуйста, подождите|терпения|анализирую|скоро закончу/i;
            if (!isKick && stallRegex.test(aiText) && selectedAgents.length === 1) {
                watchdogTimer = setTimeout(() => { kickAI(selectedAgents[0]); }, 16000); 
            }
        } else {
            renderMessage(`❌ **Системная ошибка AI:**\n${lastError}`, 'director', 'Оркестратор');
            addMessageToHistory(`❌ **Системная ошибка AI:**\n${lastError}`, 'director', 'Оркестратор');
            if (elAi) elAi.className = 'status-item offline'; 
            if (typeof updateAgentStatus === 'function') updateAgentStatus(activeAgent, 'error');
        }
    } finally {
        isGenerating = false;
        clearInterval(timerInterval); 
        let finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (timeBadge) {
            timeBadge.innerText = finalElapsed + "s";
            timeBadge.classList.add('show'); 
            setTimeout(() => { timeBadge.classList.remove('show'); }, 5000);
        }
        sendBtn.disabled = false; 
        sendBtn.className = 'send-btn'; 
        sendBtn.innerText = "➤"; 
        sendBtn.style.fontSize = ""; 
        sendBtn.style.background = "#00e5ff"; 
        sendBtn.style.color = "#000";
    }
            }
