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
5. Ты подчиняешься Боссу.`;

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
