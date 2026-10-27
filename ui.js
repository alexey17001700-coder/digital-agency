// --- СТАТУСЫ АГЕНТОВ ---
function setAgentStatus(name, status) {
    const el = document.getElementById(`status-text-${name}`);
    if (!el) return;
    el.className = 'agent-status-text';
    if (status === 'thinking') { el.innerText = 'Думает'; el.classList.add('status-thinking'); }
    else if (status === 'typing') { el.innerText = 'Печатает'; el.classList.add('status-typing'); }
    else if (status === 'busy') { el.innerText = 'Занят'; el.classList.add('status-busy'); }
    else if (status === 'working') { el.innerText = 'В работе'; el.classList.add('status-working'); }
    else { el.innerText = 'Ждет'; el.classList.add('status-idle'); }
}

function resetAllStatuses() {
    document.querySelectorAll('.agent-card').forEach(card => {
        card.classList.remove('working', 'error');
        const dot = card.querySelector('.status-dot');
        if (dot) dot.classList.remove('busy', 'error');
        const agentName = card.id.replace('agent-', '');
        if (!selectedAgents.includes(agentName)) setAgentStatus(agentName, 'idle');
    });
}

function updateAgentStatus(agentName, status) {
    const card = document.getElementById('agent-' + agentName);
    if (card) {
        const dot = card.querySelector('.status-dot');
        if (dot) {
            if (status === 'busy') { dot.classList.add('busy'); card.classList.add('working'); setAgentStatus(agentName, 'busy'); }
            else if (status === 'working') { dot.classList.add('busy'); card.classList.add('working'); setAgentStatus(agentName, 'working'); }
            else if (status === 'error') { dot.classList.add('error'); card.classList.add('error'); setAgentStatus(agentName, 'idle'); }
            else { dot.classList.remove('busy', 'error'); card.classList.remove('working', 'error'); setAgentStatus(agentName, 'idle'); }
        }
    }
    // Связь с офисом
    if (typeof updateAgentInOffice === 'function') updateAgentInOffice(agentName, status);
}

// --- КЛИКИ И ВЫБОР ---
function handleAgentClick(name) {
    const card = document.getElementById('agent-' + name);
    if (card.classList.contains('has-idea')) {
        card.classList.remove('has-idea');
        if (!selectedAgents.includes(name)) selectedAgents.push(name);
        card.classList.add('selected');
        sendMessage(`[Система: Агент ${name} вступает в диалог и озвучивает свою идею]`);
        return;
    }
    if (selectedAgents.includes(name)) {
        showAgentInfo(name); // 2-й клик открывает настройки
    } else {
        selectedAgents.push(name);
        card.classList.add('selected');
    }
}

function toggleCouncil() {
    const btn = document.getElementById('btnCouncil');
    if (selectedAgents.length > 0) {
        selectedAgents = [];
        document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected'));
        btn.className = 'mode-btn';
        resetAllStatuses();
    } else {
        selectedAgents = Object.keys(AGENT_INFO);
        document.querySelectorAll('.agent-card').forEach(c => c.classList.add('selected'));
        btn.className = 'mode-btn active';
    }
}

function unselectAgentFromModal() {
    const name = document.getElementById('modalTitle').innerText;
    selectedAgents = selectedAgents.filter(a => a !== name);
    const card = document.getElementById('agent-' + name);
    if (card) card.classList.remove('selected');
    if (typeof setAgentStatus === 'function') setAgentStatus(name, 'idle');
    document.getElementById('agentModal').classList.remove('active');
}

// --- МОДАЛКА АГЕНТА ---
function showAgentInfo(name) {
    document.getElementById('modalTitle').innerText = name;
    document.getElementById('modalBody').innerHTML = AGENT_INFO[name] || "Информация отсутствует.";
    
    const promptInput = document.getElementById('agentPromptInput');
    promptInput.value = customPrompts[name] || ''; 
    promptInput.placeholder = `По умолчанию: ${AGENT_INFO[name] || 'Нет описания'}`;
    
    document.getElementById('agentVoiceCheck').checked = agentVoiceSettings[name] !== false;
    document.getElementById('agentModal').classList.add('active');
}

function saveAgentCharacter() {
    const name = document.getElementById('modalTitle').innerText;
    const promptText = document.getElementById('agentPromptInput').value.trim();
    
    if (promptText) { customPrompts[name] = promptText; } 
    else { delete customPrompts[name]; }
    localStorage.setItem('shtabCustomPrompts', JSON.stringify(customPrompts));
    
    const voiceCheck = document.getElementById('agentVoiceCheck').checked;
    agentVoiceSettings[name] = voiceCheck;
    localStorage.setItem('shtabAgentVoice', JSON.stringify(agentVoiceSettings));
    
    document.getElementById('agentModal').classList.remove('active');
    alert(`Настройки агента ${name} сохранены!`);
}

function closeModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('agentModal').classList.remove('active');
}

// --- РЕЖИМЫ И ОЧИСТКА ---
function setMode(mode) {
    currentMode = mode;
    document.getElementById('btnNormal').className = mode === 'normal' ? 'mode-btn active' : 'mode-btn';
    document.getElementById('btnHacker').className = mode === 'hacker' ? 'mode-btn hacker-active' : 'mode-btn';
    if (allChats[currentChatId] && allChats[currentChatId].messages[0]) {
        if (mode === 'hacker') { allChats[currentChatId].messages[0].content = "Ты - Этичный Хакер. Анализируй код, ищи уязвимости."; }
        else { allChats[currentChatId].messages[0].content = SYSTEM_PROMPT; }
    }
    saveAll();
}

function toggleAutoMode() {
    isAutoMode = !isAutoMode;
    const btn = document.getElementById('btnAuto');
    if (isAutoMode) { btn.innerText = "⚡ Авто: ВКЛ"; btn.style.background = "#00ff00"; btn.style.color = "#000"; }
    else { btn.innerText = "⚡ Авто: ВЫКЛ"; btn.style.background = "#333"; btn.style.color = "#aaa"; }
}

function clearAllChats() {
    const pinnedIds = [];
    for (let id in allChats) { if (allChats[id].pinned) pinnedIds.push(allChats[id]); }
    allChats = {};
    pinnedIds.forEach(chat => { allChats[chat.id] = chat; });
    if (!allChats[currentChatId]) createNewChat(true);
    else { saveAll(); renderChatList(); }
    renderMessage("🧹 История чатов очищена (кроме закрепленных).", 'director', 'Оркестратор');
}

async function clearAllContent() {
    renderMessage("🧹 Очищаю добавленный контент...", 'director', 'Оркестратор');
    try {
        const response = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isClearContent: true }) });
        const data = await response.json();
        if (data.success) renderMessage("✅ Контент успешно очищен! Обновите страницу.", 'director', 'Оркестратор');
    } catch (e) { renderMessage("❌ Ошибка очистки: " + e.message, 'director', 'Оркестратор'); }
}

async function clearContentFromButton() {
    if (confirm("⚠️ Очистить всю папку Контент?")) {
        document.getElementById('contentModal').classList.remove('active');
        await clearAllContent();
        setTimeout(() => { location.reload(); }, 2000);
    }
}

// --- ЗАПУСК ---
function init() {
    if (typeof renderAgentsGrid === 'function') renderAgentsGrid();
    if (typeof checkPing === 'function') checkPing();
    if (typeof updateNetStatus === 'function') updateNetStatus();
    
    const chatIds = Object.keys(allChats);
    if (!currentChatId || !allChats[currentChatId]) {
        if (chatIds.length > 0) {
            const sortedIds = chatIds.sort((a, b) => b.localeCompare(a));
            currentChatId = sortedIds[0];
            loadChat(currentChatId);
        } else { createNewChat(true); }
    } else { loadChat(currentChatId); }
    
    renderChatList(); 

    const btnVoice = document.getElementById('btnVoiceToggle');
    if (btnVoice && typeof isVoiceEnabled !== 'undefined') {
        if (isVoiceEnabled) { btnVoice.innerText = '🗣️ Озвучка: ВКЛ'; btnVoice.classList.add('active'); }
        else { btnVoice.innerText = '🗣️ Озвучка: ВЫКЛ'; btnVoice.classList.remove('active'); }
    }
    
    if (chatInputEl) {
        chatInputEl.addEventListener('input', function() {
            this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
            if(this.value === '') this.style.height = 'auto';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(init, 100);
});
