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
    if (typeof updateAgentInOffice === 'function') updateAgentInOffice(agentName, status);
    if (status === 'error' && typeof showAgentReaction === 'function') showAgentReaction(agentName, 'Босс, проблема!');
}

function handleAgentClick(name) {
    const card = document.getElementById('agent-' + name);
    if (card.classList.contains('has-idea')) {
        card.classList.remove('has-idea');
        if (!selectedAgents.includes(name)) selectedAgents.push(name);
        card.classList.add('selected');
        sendMessage(`[Система: Агент ${name} вступает в диалог]`);
        return;
    }
    if (selectedAgents.includes(name)) { showAgentInfo(name); } 
    else { selectedAgents.push(name); card.classList.add('selected'); }
}

function unselectAgentFromModal() {
    const name = document.getElementById('modalTitle').innerText;
    selectedAgents = selectedAgents.filter(a => a !== name);
    const card = document.getElementById('agent-' + name);
    if (card) card.classList.remove('selected');
    if (typeof setAgentStatus === 'function') setAgentStatus(name, 'idle');
    document.getElementById('agentModal').classList.remove('active');
}

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
    if (promptText) { customPrompts[name] = promptText; } else { delete customPrompts[name]; }
    localStorage.setItem('shtabCustomPrompts', JSON.stringify(customPrompts));
    const voiceCheck = document.getElementById('agentVoiceCheck').checked;
    agentVoiceSettings[name] = voiceCheck;
    localStorage.setItem('shtabAgentVoice', JSON.stringify(agentVoiceSettings));
    document.getElementById('agentModal').classList.remove('active');
    alert(`Настройки агента ${name} сохранены!`);
}

function closeModal(e) { if (e && e.target !== e.currentTarget) return; document.getElementById('agentModal').classList.remove('active'); }

function setMode(mode) {
    currentMode = mode;
    const bn = document.getElementById('btnNormal');
    const bh = document.getElementById('btnHacker');
    if (bn) bn.className = mode === 'normal' ? 'mode-btn active' : 'mode-btn';
    if (bh) bh.className = mode === 'hacker' ? 'mode-btn hacker-active' : 'mode-btn';
    if (allChats[currentChatId] && allChats[currentChatId].messages[0]) {
        allChats[currentChatId].messages[0].content = SYSTEM_PROMPT;
    }
    saveAll();
}

/* --- КНОПКА 🧠 ПЛАТНЫЕ ---
   Листает ТОЛЬКО платные модели. Бесплатные не трогает — у них своя кнопка.
   Долгое нажатие — панель выбора моделей (там же переключатель платных). */
function applyAIModelButton() {
    const btn = document.getElementById('btnAIModel');
    if (!btn) return;
    // Платная модель выбрана, а платные отключены — молча уходим на бесплатную.
    if (typeof resolveAllowedModel === 'function') {
        const fixed = resolveAllowedModel(selectedAIModel);
        if (fixed !== selectedAIModel) { selectedAIModel = fixed; localStorage.setItem('shtabAIModel', fixed); }
    }
    const on = (typeof paidEnabled === 'function') ? paidEnabled() : true;
    const paid = (typeof paidModels === 'function') ? paidModels() : [];
    /* Платных моделей в Штабе больше нет — кнопка 🧠 не нужна, прячем. */
    if (!paid.length) {
        btn.style.display = 'none';
        if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
        if (typeof updateGigaChatButtonVisual === 'function') updateGigaChatButtonVisual();
        return;
    }
    btn.style.display = '';
    const cur = paid.find(m => m.id === selectedAIModel);
    if (cur) {
        btn.innerText = '🧠 Платные: ' + cur.label;
        btn.style.background = cur.color || '#333';
        btn.style.color = cur.text || '#aaa';
    } else if (!on) {
        btn.innerText = '🧠 Платные: ВЫКЛ';
        btn.style.background = '#333'; btn.style.color = '#777';
    } else {
        btn.innerText = '🧠 Платные: выбрать';
        btn.style.background = '#333'; btn.style.color = '#aaa';
    }
    if (typeof applyFreeModelButton === 'function') applyFreeModelButton();
    // Выбрали другую модель — кнопка 🟣 GigaChat гаснет сама (состояние не врёт).
    if (typeof updateGigaChatButtonVisual === 'function') updateGigaChatButtonVisual();
}

function toggleAIModel() {
    const on = (typeof paidEnabled === 'function') ? paidEnabled() : true;
    const list = (typeof paidModels === 'function') ? paidModels() : [];
    if (!on) {
        if (typeof renderMessage === 'function') renderMessage('🔒 *[Система: платные модели отключены. Долгое нажатие на 🧠 — включить.]*', 'director', 'Оркестратор');
        return;
    }
    if (!list.length) {
        if (typeof renderMessage === 'function') renderMessage('💳 *[Система: платных моделей в списке нет.]*', 'director', 'Оркестратор');
        return;
    }
    let idx = list.findIndex(m => m.id === selectedAIModel);
    if (idx < 0) idx = -1;
    selectedAIModel = list[(idx + 1) % list.length].id;
    localStorage.setItem('shtabAIModel', selectedAIModel);
    applyAIModelButton();
    if (typeof renderMessage === 'function') renderMessage('🧠 *[Система: платная модель ' + getModelInfo(selectedAIModel).label + ']*', 'director', 'Оркестратор');
}

/* --- КНОПКА 🆓 БЕСПЛАТНЫЕ ---
   Листает ТОЛЬКО бесплатные модели (free: true). Платные не трогает.
   Долгое нажатие — та же панель выбора моделей. */
function applyFreeModelButton() {
    const btn = document.getElementById('btnFreeModel');
    if (!btn) return;
    const f = (typeof freeModels === 'function') ? freeModels() : [];
    /* Бесплатных моделей в Штабе больше нет — кнопка 🆓 не нужна, прячем. */
    if (!f.length) {
        btn.style.display = 'none';
        if (typeof updateGigaChatButtonVisual === 'function') updateGigaChatButtonVisual();
        return;
    }
    btn.style.display = '';
    const cur = f.find(m => m.id === selectedAIModel);
    if (cur) {
        btn.innerText = '🆓 Бесплатные: ' + cur.label;
        btn.style.background = cur.color || '#333';
        btn.style.color = cur.text || '#fff';
    } else {
        btn.innerText = '🆓 Бесплатные: ' + (f.length ? 'выбрать' : 'нет');
        btn.style.background = '#333'; btn.style.color = '#aaa';
    }
    // Выбрали бесплатную — кнопка 🟣 GigaChat гаснет сама (состояние не врёт).
    if (typeof updateGigaChatButtonVisual === 'function') updateGigaChatButtonVisual();
}

function toggleFreeModel() {
    const f = (typeof freeModels === 'function') ? freeModels() : [];
    if (!f.length) {
        if (typeof renderMessage === 'function') renderMessage('🆓 *[Система: бесплатных моделей в списке нет.]*', 'director', 'Оркестратор');
        return;
    }
    let idx = f.findIndex(m => m.id === selectedAIModel);
    if (idx < 0) idx = -1;
    selectedAIModel = f[(idx + 1) % f.length].id;
    localStorage.setItem('shtabAIModel', selectedAIModel);
    applyAIModelButton();
    if (typeof renderMessage === 'function') renderMessage('🆓 *[Система: бесплатная модель ' + getModelInfo(selectedAIModel).label + ']*', 'director', 'Оркестратор');
}

function bindFreeModelButton() {
    const btn = document.getElementById('btnFreeModel');
    if (!btn || btn.dataset.freeBound === '1') return;
    btn.dataset.freeBound = '1';
    let pressTimer = null, longPressed = false;
    const start = () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; openAIModelPanel(); }, 600); };
    const cancel = () => { clearTimeout(pressTimer); };
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('touchend', cancel);
    btn.addEventListener('touchcancel', cancel);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (longPressed) { longPressed = false; return; }
        toggleFreeModel();
    });
}

function openAIModelPanel() {
    if (document.getElementById('aiModelPanel')) return;
    const ov = document.createElement('div');
    ov.id = 'aiModelPanel';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:340px;background:#101418;border:1px solid #2a333d;border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 12px 40px rgba(0,0,0,.6);max-height:80vh;overflow-y:auto;';
    const title = document.createElement('div');
    title.textContent = '🧠 МОДЕЛЬ ИИ';
    title.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:.5px;margin-bottom:12px;';
    box.appendChild(title);

    const rowStyle = (active) => 'display:block;width:100%;text-align:left;padding:11px;margin-bottom:8px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;border:1px solid ' + (active ? '#00e5ff' : '#2a333d') + ';background:' + (active ? 'rgba(0,229,255,.12)' : 'transparent') + ';color:#e6edf3;';
    const pick = (m) => {
        selectedAIModel = m.id;
        localStorage.setItem('shtabAIModel', selectedAIModel);
        // Ollama (ПК): спрашиваем имя локальной модели — её грузит ПК.
        if (m.id === 'ollama') {
            const cur = localStorage.getItem('shtabOllamaModel') || 'qwen2.5-coder:7b';
            const nm = prompt('Имя модели на ПК (Ollama):', cur);
            if (nm && nm.trim()) localStorage.setItem('shtabOllamaModel', nm.trim());
        }
        applyAIModelButton();
        ov.remove();
    };
    const section = (label, color) => {
        const s = document.createElement('div');
        s.textContent = label;
        s.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.6px;color:' + color + ';margin:10px 0 6px;';
        box.appendChild(s);
    };
    const hint = (txt) => {
        const e = document.createElement('div');
        e.textContent = txt;
        e.style.cssText = 'font-size:12px;color:#8b98a5;margin-bottom:8px;line-height:1.4;';
        box.appendChild(e);
    };

    /* --- СТРОКА МОДЕЛИ: выбор + шестерёнка настроек ---
       У КАЖДОЙ модели справа шестерёнка ⚙️ — там своя кнопка ВКЛ/ВЫКЛ
       и своё поле ключа, ровно как у Архитектора 🅰️.
       Выключенная модель в списке видна, но зачёркнута и не выбирается:
       тап по ней открывает настройки. */
    const modelRow = (m) => {
        const active = (m.id === selectedAIModel);
        const en = (typeof modelEnabled === 'function') ? modelEnabled(m.id) : true;
        const hasKey = !!(typeof modelKey === 'function' && modelKey(m.id));
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:6px;align-items:stretch;margin-bottom:8px;';
        const main = document.createElement('button');
        main.textContent = (active ? '✅ ' : '') + m.label + (m.free ? ' 🆓' : '') + (en ? '' : ' · ВЫКЛ') + (hasKey ? ' 🔑' : '');
        main.style.cssText = rowStyle(active) + 'margin-bottom:0;flex:1;min-width:0;' + (en ? '' : 'opacity:.5;text-decoration:line-through;');
        main.onclick = () => { if (!en) { openModelSettingsPanel(m.id, () => { ov.remove(); openAIModelPanel(); }); return; } pick(m); };
        const gear = document.createElement('button');
        gear.textContent = '⚙️';
        gear.title = 'Вкл/выкл и свой ключ модели';
        gear.style.cssText = 'flex:0 0 auto;width:42px;border-radius:8px;cursor:pointer;font-size:15px;border:1px solid ' + (hasKey ? '#00e5ff' : (en ? '#2a333d' : '#ff6688')) + ';background:' + (hasKey ? 'rgba(0,229,255,.12)' : 'transparent') + ';color:#e6edf3;';
        gear.onclick = () => openModelSettingsPanel(m.id, () => { ov.remove(); openAIModelPanel(); });
        wrap.appendChild(main); wrap.appendChild(gear);
        return wrap;
    };

    /* --- ДВА КАНАЛА ШТАБА (приказ Босса) ---
       Бесплатные модели (Nemotron, Flint и др.), Yandex и DeepSeek убраны
       полностью. Остались только: 🅰️ Архитектор (свой ключ) и 🟣 GigaChat.
       У каждого своя шестерёнка ⚙️ — вкл/выкл и свой ключ. */
    const zInfo = (typeof AI_MODELS !== 'undefined') ? AI_MODELS.find(m => m && m.id === 'zveno') : null;
    section('🅰️ АРХИТЕКТОР (ZVENO) — свой ключ', '#00e5ff');
    if (zInfo) box.appendChild(modelRow(zInfo));
    else hint('Канал Архитектора не загружен.');

    const gInfo = (typeof AI_MODELS !== 'undefined') ? AI_MODELS.find(m => m && m.id === 'gigachat') : null;
    section('🟣 GIGACHAT (СБЕР) — свой ключ или серверный', '#7B61FF');
    if (gInfo) box.appendChild(modelRow(gInfo));
    else hint('Канал GigaChat не загружен.');

    hint('Бесплатных моделей в Штабе нет — только Архитектор и GigaChat.');

    const close = document.createElement('button');
    close.textContent = 'ЗАКРЫТЬ';
    close.style.cssText = 'width:100%;padding:9px;border:1px solid #2a333d;border-radius:8px;background:transparent;color:#8b98a5;font-size:13px;cursor:pointer;margin-top:4px;';
    close.onclick = () => ov.remove();
    box.appendChild(close);
    ov.appendChild(box);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}

/* =========================================
   --- КНОПКА-ШЕСТЕРЁНКА: ВСЕ КНОПКИ ВНУТРИ ---
   Босс: панель кнопок не должна занимать пол-экрана. Теперь сверху одна
   шестерёнка ⚙️, а все кнопки режимов лежат в .mode-extra и скрыты.
   Видны только те, что СЕЙЧАС ВКЛЮЧЕНЫ (класс .mode-on) — чтобы состояние
   было видно без разворота панели. Тап по шестерёнке — развернуть/свернуть.
   ========================================= */
function modeBtnIsOn(btn) {
    if (!btn) return false;
    if (btn.classList.contains('active')) return true;   // 💬 Диалог, 🗣️ Озвучка, 🟣 GigaChat
    try {
        if (btn.id === 'btnAIModel') {                   // 🧠 Платные — горит, если выбрана платная модель
            if (typeof paidModels !== 'function' || typeof selectedAIModel === 'undefined') return false;
            return !!paidModels().find(m => m && m.id === selectedAIModel);
        }
        if (btn.id === 'btnFreeModel') {                 // 🆓 Бесплатные — горит, если выбрана бесплатная
            if (typeof freeModels !== 'function' || typeof selectedAIModel === 'undefined') return false;
            return !!freeModels().find(m => m && m.id === selectedAIModel);
        }
        if (btn.id === 'btnArchitect') {                 // 🅰️ Архитектор — горит, если канал включён
            if (typeof architectEnabled !== 'function') return false;
            return !!architectEnabled();
        }
    } catch (e) {}
    return false;
}

function syncModeButtons() {
    const sw = document.getElementById('modeSwitch');
    if (!sw) return;
    sw.querySelectorAll('.mode-extra .mode-btn').forEach(b => {
        b.classList.toggle('mode-on', modeBtnIsOn(b));
    });
}

function toggleModeMenu(force) {
    const sw = document.getElementById('modeSwitch');
    if (!sw) return;
    const want = (typeof force === 'boolean') ? force : !sw.classList.contains('expanded');
    sw.classList.toggle('expanded', want);
    const g = document.getElementById('btnModeGear');
    if (g) {
        g.classList.toggle('active', want);
        g.innerText = want ? '⚙️ Свернуть' : '⚙️';
        g.title = want ? 'Свернуть панель кнопок' : 'Все кнопки Штаба';
    }
    syncModeButtons();
}
window.toggleModeMenu = toggleModeMenu;
window.syncModeButtons = syncModeButtons;

/* Держим видимость кнопок в актуальном состоянии: любая кнопка может
   включиться/выключиться из любого модуля (чат, голоса, модели). */
syncModeButtons();
setInterval(syncModeButtons, 700);

function bindAIModelButton() {
    const btn = document.getElementById('btnAIModel');
    if (!btn || btn.dataset.aiBound === '1') return;
    btn.dataset.aiBound = '1';
    let pressTimer = null, longPressed = false;
    const start = () => {
        longPressed = false;
        pressTimer = setTimeout(() => { longPressed = true; openAIModelPanel(); }, 600);
    };
    const cancel = () => { clearTimeout(pressTimer); };
    btn.addEventListener('touchstart', start, { passive: true });
    btn.addEventListener('touchend', cancel);
    btn.addEventListener('touchcancel', cancel);
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', cancel);
    btn.addEventListener('mouseleave', cancel);
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (longPressed) { longPressed = false; return; }
        toggleAIModel();
    });
}
/* =========================================
   🅰️ МЕНЮ АРХИТЕКТОРА (ZVENO) — ОТДЕЛЬНЫЙ КАНАЛ
   Тап по кнопке 🅰️ открывает это меню. Здесь две вещи:
   1) ВКЛ / ВЫКЛ канала — пока выключен, ZVENO не выбирается
      и не подставляется ни автоподбором, ни автосменой;
   2) СВОЙ КЛЮЧ Архитектора — отдельно от общих ключей.
   Ключ на устройстве (localStorage) и уходит на сервер в запросе
   (userKeys.architectKey). В код и в Git он НИКОГДА не пишется.
   ========================================= */
function openArchitectPanel() {
    const old = document.getElementById('architectPanel');
    if (old) old.remove();

    const on = (typeof architectEnabled === 'function') ? architectEnabled() : false;
    const savedKey = (typeof architectKey === 'function') ? architectKey() : '';

    const ov = document.createElement('div');
    ov.id = 'architectPanel';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:340px;background:#0d1418;border:1px solid #00e5ff;border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 12px 40px rgba(0,229,255,.18);max-height:85vh;overflow-y:auto;';

    const title = document.createElement('div');
    title.textContent = '🅰️ АРХИТЕКТОР (ZVENO)';
    title.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:.5px;color:#00e5ff;margin-bottom:4px;';
    box.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = 'Отдельный канал. Автоподбор и автосмена его не трогают.';
    sub.style.cssText = 'font-size:11px;color:#8b98a5;line-height:1.4;margin-bottom:12px;';
    box.appendChild(sub);

    /* --- ВКЛ / ВЫКЛ --- */
    const sw = document.createElement('button');
    sw.textContent = on ? '● ВКЛ — тап, чтобы выключить' : '○ ВЫКЛ — тап, чтобы включить';
    sw.style.cssText = 'display:block;width:100%;text-align:left;padding:12px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid ' + (on ? '#00e5ff' : '#2a333d') + ';background:' + (on ? 'rgba(0,229,255,.14)' : 'transparent') + ';color:' + (on ? '#00e5ff' : '#8b98a5') + ';';
    sw.onclick = () => {
        if (typeof setArchitectEnabled !== 'function') return;
        setArchitectEnabled(!on);
        // Включили канал — сразу переводим чат на Архитектора (ручной выбор).
        if (!on && typeof selectArchitect === 'function') selectArchitect();
        openArchitectPanel();   // перерисовать меню под новое состояние
    };
    box.appendChild(sw);

    const st = document.createElement('div');
    st.textContent = savedKey ? '🔑 Ключ вписан: •••••••• (хранится на устройстве)' : '🔑 Ключ не вписан — Архитектор не ответит';
    st.style.cssText = 'font-size:11px;color:' + (savedKey ? '#7ee08a' : '#ff8888') + ';margin:10px 0 6px;line-height:1.4;';
    box.appendChild(st);

    /* --- СВОЙ КЛЮЧ --- */
    const keyWrap = document.createElement('div');
    keyWrap.style.cssText = 'position:relative;margin-bottom:8px;';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id = 'architectKeyInput';
    keyInput.className = 'modal-textarea';
    keyInput.placeholder = savedKey ? 'Новый ключ ZVENO (пусто — оставить текущий)' : 'Ключ ZVENO';
    keyInput.style.cssText = 'height:40px;margin-bottom:0;padding-right:42px;width:100%;box-sizing:border-box;';
    const eye = document.createElement('button');
    eye.textContent = '👁';
    eye.style.cssText = 'position:absolute;right:10px;top:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;';
    eye.onclick = () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; eye.textContent = keyInput.type === 'password' ? '👁' : '🙈'; };
    keyWrap.appendChild(keyInput); keyWrap.appendChild(eye);
    box.appendChild(keyWrap);

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;line-height:1.4;margin-bottom:8px;min-height:14px;';
    box.appendChild(msg);

    const setMsg = (t, color) => { msg.textContent = t || ''; msg.style.color = color || '#8b98a5'; };

    const btnRow = (label, bg, color, border, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'display:block;width:100%;padding:11px;margin-top:8px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid ' + border + ';background:' + bg + ';color:' + color + ';';
        b.onclick = fn;
        box.appendChild(b);
        return b;
    };

    btnRow('💾 Сохранить ключ', '#00e5ff', '#000', '#00e5ff', () => {
        const v = String(keyInput.value || '').trim();
        if (!v) { setMsg(savedKey ? 'Ключ не изменён.' : 'Впиши ключ — поле пустое.', '#ffd700'); return; }
        if (typeof setArchitectKey !== 'function') { setMsg('Функция ключа не загружена.', '#ff8888'); return; }
        setArchitectKey(v);
        keyInput.value = '';
        setMsg('✅ Ключ сохранён на устройстве.', '#7ee08a');
        if (typeof applyArchitectButton === 'function') applyArchitectButton();
        if (typeof syncModeButtons === 'function') syncModeButtons();
        setTimeout(() => openArchitectPanel(), 700);
    });

    btnRow('🔌 Проверить связь с ключом', 'transparent', '#00e5ff', '#00e5ff', async () => {
        const v = String(keyInput.value || '').trim() || savedKey;
        if (!v) { setMsg('Проверять нечего — ключ не вписан.', '#ffd700'); return; }
        setMsg('Проверяю…', '#8b98a5');
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 30000);
            const r = await fetch(PROXY, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: 'ку' }],
                    temperature: 0.2, model: 'zveno',
                    userKeys: { architectKey: v }, isBoss: true
                }),
                signal: ctrl.signal
            });
            clearTimeout(tid);
            const d = await r.json().catch(() => ({}));
            /* Честная проверка: ошибка сервера — это ❌, а не «ответ». */
            const errText = (d && d.error) ? String(d.error) : (!r.ok ? ('HTTP ' + r.status) : '');
            if (errText) { setMsg('❌ Ключ не прошёл: ' + errText.replace(/^❌\s*\*\*Ошибка:\*\*\s*/, '').slice(0, 120), '#ff8888'); }
            else {
                const txt = (d && d.choices && d.choices[0]) ? String(d.choices[0].message.content || '').trim() : '';
                if (txt && txt.indexOf('❌') !== 0) { setMsg('✅ Ключ живой. Ответ: ' + txt.slice(0, 80), '#7ee08a'); }
                else { setMsg('❌ Не ответил: пустой ответ', '#ff8888'); }
            }
        } catch (e) {
            setMsg('❌ ' + ((e && e.name === 'AbortError') ? 'таймаут 30 с' : ((e && e.message) || 'сбой сети')), '#ff8888');
        }
    });

    btnRow('🗑️ Удалить ключ', 'transparent', '#ff6688', '#ff0055', () => {
        if (!confirm('Удалить ключ Архитектора с этого устройства?')) return;
        if (typeof setArchitectKey === 'function') setArchitectKey('');
        setMsg('Ключ удалён.', '#ff8888');
        setTimeout(() => openArchitectPanel(), 700);
    });

    const close = document.createElement('button');
    close.textContent = 'ЗАКРЫТЬ';
    close.style.cssText = 'display:block;width:100%;padding:10px;margin-top:12px;border:1px solid #2a333d;border-radius:9px;background:transparent;color:#8b98a5;font-size:13px;cursor:pointer;';
    close.onclick = () => ov.remove();
    box.appendChild(close);

    ov.appendChild(box);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}
window.openArchitectPanel = openArchitectPanel;

/* =========================================
   ⚙️ НАСТРОЙКА ЛЮБОЙ МОДЕЛИ (вкл/выкл + свой ключ)
   Ровно та же логика, что у Архитектора 🅰️, только для каждой модели:
   1) ВКЛ / ВЫКЛ — выключенная модель не выбирается и не подставляется
      автоподбором, запрос к ней на сервер не уходит;
   2) СВОЙ КЛЮЧ модели — отдельно от общих ключей, живёт на устройстве
      и уходит на сервер в userKeys[<id модели>]. В код и Git — НИКОГДА.
   ========================================= */
function openModelSettingsPanel(id, onBack) {
    if (!id) return;
    const info = (typeof getModelInfo === 'function') ? getModelInfo(id) : null;
    const label = (info && info.label) ? info.label : id;
    const old = document.getElementById('modelSettingsPanel');
    if (old) old.remove();

    const on = (typeof modelEnabled === 'function') ? modelEnabled(id) : true;
    const savedKey = (typeof modelKey === 'function') ? modelKey(id) : '';

    const ov = document.createElement('div');
    ov.id = 'modelSettingsPanel';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:340px;background:#0d1418;border:1px solid #2a333d;border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 12px 40px rgba(0,0,0,.6);max-height:85vh;overflow-y:auto;';

    const title = document.createElement('div');
    title.textContent = '⚙️ ' + label;
    title.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:.4px;margin-bottom:4px;';
    box.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = 'Своя кнопка вкл/выкл и свой ключ. Автоподбор выключенную модель не трогает.';
    sub.style.cssText = 'font-size:11px;color:#8b98a5;line-height:1.4;margin-bottom:12px;';
    box.appendChild(sub);

    const sw = document.createElement('button');
    sw.textContent = on ? '● ВКЛ — тап, чтобы выключить' : '○ ВЫКЛ — тап, чтобы включить';
    sw.style.cssText = 'display:block;width:100%;text-align:left;padding:12px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid ' + (on ? '#00e5ff' : '#2a333d') + ';background:' + (on ? 'rgba(0,229,255,.14)' : 'transparent') + ';color:' + (on ? '#00e5ff' : '#8b98a5') + ';';
    sw.onclick = () => {
        if (typeof setModelEnabled !== 'function') return;
        setModelEnabled(id, !on);
        openModelSettingsPanel(id, onBack);
    };
    box.appendChild(sw);

    const kv = document.createElement('div');
    kv.textContent = savedKey ? '🔑 Ключ вписан: •••••••• (на устройстве)' : '🔑 Ключ не вписан — идёт по общим ключам сервера';
    kv.style.cssText = 'font-size:11px;color:' + (savedKey ? '#7ee08a' : '#8b98a5') + ';margin:12px 0 6px;line-height:1.4;';
    box.appendChild(kv);

    const keyWrap = document.createElement('div');
    keyWrap.style.cssText = 'position:relative;margin-bottom:8px;';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'modal-textarea';
    keyInput.placeholder = savedKey ? 'Новый ключ (пусто — оставить текущий)' : 'Ключ модели';
    keyInput.style.cssText = 'height:40px;margin-bottom:0;padding-right:42px;width:100%;box-sizing:border-box;';
    const eye = document.createElement('button');
    eye.textContent = '👁';
    eye.style.cssText = 'position:absolute;right:10px;top:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#aaa;';
    eye.onclick = () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; eye.textContent = keyInput.type === 'password' ? '👁' : '🙈'; };
    keyWrap.appendChild(keyInput); keyWrap.appendChild(eye);
    box.appendChild(keyWrap);

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;line-height:1.4;margin-bottom:8px;min-height:14px;';
    box.appendChild(msg);
    const setMsg = (t, c) => { msg.textContent = t || ''; msg.style.color = c || '#8b98a5'; };

    const btn = (label2, bg, color, border, fn) => {
        const b = document.createElement('button');
        b.textContent = label2;
        b.style.cssText = 'display:block;width:100%;padding:11px;margin-top:8px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid ' + border + ';background:' + bg + ';color:' + color + ';';
        b.onclick = fn;
        box.appendChild(b);
        return b;
    };

    btn('💾 Сохранить ключ', '#00e5ff', '#000', '#00e5ff', () => {
        const v = String(keyInput.value || '').trim();
        if (!v) { setMsg(savedKey ? 'Ключ не изменён.' : 'Впиши ключ — поле пустое.', '#ffd700'); return; }
        if (typeof setModelKey !== 'function') { setMsg('Функция ключа не загружена.', '#ff8888'); return; }
        setModelKey(id, v);
        keyInput.value = '';
        setMsg('✅ Ключ сохранён на устройстве.', '#7ee08a');
        if (typeof syncModeButtons === 'function') syncModeButtons();
        setTimeout(() => openModelSettingsPanel(id, onBack), 700);
    });

    btn('🔌 Проверить связь с ключом', 'transparent', '#00e5ff', '#00e5ff', async () => {
        const v = String(keyInput.value || '').trim() || savedKey;
        if (!v) { setMsg('Проверять нечего — ключ не вписан.', '#ffd700'); return; }
        setMsg('Проверяю…', '#8b98a5');
        try {
            const ctrl = new AbortController();
            const tid = setTimeout(() => ctrl.abort(), 30000);
            /* 🅰️ КЛЮЧ АРХИТЕКТОРА УХОДИТ ПОД ПРАВИЛЬНЫМ ИМЕНЕМ.
               Сервер (callZvenoAI) читает ТОЛЬКО userKeys.architectKey.
               Раньше шестерёнка ⚙️ у zveno слала userKeys.zveno — сервер его
               не видел и проверка падала на СЕРВЕРНЫЙ ключ, а если тот битый —
               приходило «missing or invalid authorization». Отсюда «ошибка»
               на живом ключе Босса. */
            const uk = {}; if (v) uk[id === 'zveno' ? 'architectKey' : id] = v;
            /* 🟣 GIGACHAT проверяем СВОЕЙ ручкой (gigachatTest): она берёт ключ
               из поля и отдаёт {success, answer} — без инструментов и без чата.
               Раньше ключ Сбера шёл через общий чат-путь и проверялся не тем. */
            const isGiga = (id === 'gigachat');
            const r = await fetch(PROXY, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(isGiga
                    ? { gigachatTest: true, userKeys: uk }
                    : { messages: [{ role: 'user', content: 'ку' }], temperature: 0.2, model: id, userKeys: uk, isBoss: true }),
                signal: ctrl.signal
            });
            clearTimeout(tid);
            const d = await r.json().catch(() => ({}));
            /* ЧЕСТНАЯ ПРОВЕРКА: сервер на ошибку тоже клал choices с текстом
               «❌ **Ошибка:** ...» — из-за этого проверка показывала ЗЕЛЁНОЕ «✅»
               на мёртвом ключе. Сначала смотрим r.ok и d.error, только потом текст. */
            const errText = (d && d.error) ? String(d.error) : (!r.ok ? ('HTTP ' + r.status) : '');
            if (errText) { setMsg('❌ Ключ не прошёл: ' + errText.replace(/^❌\s*\*\*Ошибка:\*\*\s*/, '').slice(0, 120), '#ff8888'); return; }
            const txt = (d && d.choices && d.choices[0]) ? String(d.choices[0].message.content || '').trim() : '';
            if (txt && txt.indexOf('❌') !== 0) setMsg('✅ Модель ответила: ' + txt.slice(0, 80), '#7ee08a');
            else setMsg('❌ Не ответила: пустой ответ', '#ff8888');
        } catch (e) {
            setMsg('❌ ' + ((e && e.name === 'AbortError') ? 'таймаут 30 с' : ((e && e.message) || 'сбой сети')), '#ff8888');
        }
    });

    btn('🗑️ Удалить ключ', 'transparent', '#ff6688', '#ff0055', () => {
        if (!confirm('Удалить ключ этой модели с устройства?')) return;
        if (typeof setModelKey === 'function') setModelKey(id, '');
        setMsg('Ключ удалён.', '#ff8888');
        setTimeout(() => openModelSettingsPanel(id, onBack), 700);
    });

    const back = document.createElement('button');
    back.textContent = 'НАЗАД К СПИСКУ';
    back.style.cssText = 'display:block;width:100%;padding:10px;margin-top:12px;border:1px solid #2a333d;border-radius:9px;background:transparent;color:#8b98a5;font-size:13px;cursor:pointer;';
    back.onclick = () => { ov.remove(); if (typeof onBack === 'function') onBack(); };
    box.appendChild(back);

    ov.appendChild(box);
    ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); if (typeof onBack === 'function') onBack(); } });
    document.body.appendChild(ov);
}
window.openModelSettingsPanel = openModelSettingsPanel;

function refreshShtab() {
    if (!confirm("🔄 Обновить Штаб? Страница перезагрузится.")) return;
    if ('caches' in window) {
        caches.keys().then(names => { for (let name of names) caches.delete(name); });
    }
    try { window.top.location.href = window.top.location.pathname + '?v=' + Date.now(); }
    catch (e) { location.reload(); }
}

function openApiSettings() {
    const keys = JSON.parse(localStorage.getItem('shtabUserKeys')) || {};
    document.getElementById('userYandexKey').value = keys.yandexKey || '';
    document.getElementById('userYandexFolder').value = keys.yandexFolder || '';
    document.getElementById('userDeepseekKey').value = keys.deepseekKey || '';
    const fk = document.getElementById('userFreeKey'); if (fk) fk.value = keys.freeKey || '';
    document.getElementById('apiModal').classList.add('active');
}

function saveApiSettings() {
    const keys = {
        yandexKey: document.getElementById('userYandexKey').value.trim(),
        yandexFolder: document.getElementById('userYandexFolder').value.trim(),
        deepseekKey: document.getElementById('userDeepseekKey').value.trim(),
        freeKey: (document.getElementById('userFreeKey') ? document.getElementById('userFreeKey').value.trim() : '')
    };
    localStorage.setItem('shtabUserKeys', JSON.stringify(keys));
    alert("Ключи сохранены! Теперь Штаб использует их.");
    document.getElementById('apiModal').classList.remove('active');
}
function clearApiSettings() {
    if (confirm("Удалить все сохраненные ключи с этого телефона?")) {
        localStorage.removeItem('shtabUserKeys');
        document.getElementById('userYandexKey').value = '';
        document.getElementById('userYandexFolder').value = '';
        document.getElementById('userDeepseekKey').value = '';
        const fk = document.getElementById('userFreeKey'); if (fk) fk.value = '';
        alert("Ключи успешно удалены из памяти.");
        document.getElementById('apiModal').classList.remove('active');
    }
}
function toggleKeyVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '🙈';
    } else {
        input.type = 'password';
        btn.innerText = '👁';
    }
}

/* --- СЧЁТЧИК ПРАВОК ШТАБА (shtab_version.json) ---
   Показывает версию ШТАБА и сколько правок накоплено до обновления.
   ВАЖНО: Штаб читает СВОЙ файл shtab_version.json. Общий version.json
   принадлежит Калькулятору окон (window_calc) — файлы не перемешиваются.
   Версия поднимается каждые 5 правок (правило 11 SERVER_DIAGNOSTICS.md).
   Тап по плашке — панель с деталями и кнопкой перечитать. */
let __versionData = null;

async function loadVersionCounter() {
    const el = document.getElementById('version-text');
    if (!el) return;
    try {
        const r = await fetch('shtab_version.json?v=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        __versionData = d;
        const limit = d.limit || 5;
        const edits = d.edits || 0;
        el.innerText = 'v' + d.version + ' · ' + edits + '/' + limit;
        const box = document.getElementById('status-version');
        if (box) {
            box.style.borderColor = edits >= limit ? '#ff0055' : '#ffd700';
            box.title = (d.name || d.app) + ' — правок ' + edits + ' из ' + limit +
                (edits >= limit ? ' · ПОРА ОБНОВЛЯТЬ' : ' · можно работать');
        }
    } catch (e) {
        el.innerText = 'v--';
        console.warn('shtab_version.json не прочитан:', e);
    }
}

/* Автообновление счётчика: раз в 60 секунд и при возврате в приложение.
   Так плашка всегда показывает актуальное «сколько правок до обновления». */
let __versionTimer = null;
function startVersionAutoRefresh() {
    if (__versionTimer) return;
    __versionTimer = setInterval(() => { loadVersionCounter(); }, 60000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) loadVersionCounter();
    });
}

function openVersionPanel() {
    const d = __versionData;
    if (document.getElementById('versionPanel')) return;
    const ov = document.createElement('div');
    ov.id = 'versionPanel';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;';
    const box = document.createElement('div');
    box.style.cssText = 'width:100%;max-width:340px;background:#101418;border:1px solid #2a333d;border-radius:14px;padding:18px;color:#e6edf3;box-shadow:0 12px 40px rgba(0,0,0,.6);';

    const title = document.createElement('div');
    title.textContent = '📦 ПРАВКИ: ШТАБ';
    title.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:.5px;margin-bottom:12px;';
    box.appendChild(title);

    const line = (label, value, color) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #1d242c;font-size:13px;';
        const l = document.createElement('span');
        l.textContent = label; l.style.color = '#8b98a5';
        const v = document.createElement('span');
        v.textContent = value; v.style.cssText = 'font-weight:700;color:' + (color || '#e6edf3') + ';';
        row.appendChild(l); row.appendChild(v);
        box.appendChild(row);
    };

    if (!d) {
        const e = document.createElement('div');
        e.textContent = 'Данные не загружены. Нажми «Перечитать».';
        e.style.cssText = 'font-size:13px;color:#ff8888;padding:8px 0;';
        box.appendChild(e);
    } else {
        const limit = d.limit || 5;
        const edits = d.edits || 0;
        const left = Math.max(0, limit - edits);
        line('Приложение', d.name || d.app);
        line('Версия', d.version, '#ffd700');
        line('Сборка', String(d.build || '--'));
        line('Правок накоплено', edits + ' / ' + limit, edits >= limit ? '#ff0055' : '#7ee08a');
        line('До обновления', edits >= limit ? 'ПОРА ОБНОВЛЯТЬ' : ('ещё ' + left + ' правк' + (left === 1 ? 'а' : 'и')), edits >= limit ? '#ff0055' : '#00e5ff');
        /* --- ЖУРНАЛ ПРАВОК ---
           Босс видит, ЧТО именно считалось правкой и почему счётчик сдвинулся.
           Никаких «само добавилось»: каждая цифра подписана. */
        if (Array.isArray(d.log) && d.log.length) {
            const h = document.createElement('div');
            h.textContent = '📝 ЧТО СЧИТАЛОСЬ ПРАВКОЙ';
            h.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.6px;color:#8b98a5;margin:12px 0 6px;';
            box.appendChild(h);
            d.log.slice().reverse().forEach(it => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #1d242c;font-size:12px;line-height:1.35;';
                const n = document.createElement('span');
                n.textContent = '#' + (it.n || '?');
                n.style.cssText = 'color:#ffd700;font-weight:700;flex:0 0 auto;';
                const t = document.createElement('span');
                t.textContent = it.text || '';
                t.style.color = '#c9d6e2';
                row.appendChild(n); row.appendChild(t);
                box.appendChild(row);
            });
        }
        if (d.note) {
            const n = document.createElement('div');
            n.textContent = d.note;
            n.style.cssText = 'font-size:11px;color:#8b98a5;margin-top:10px;line-height:1.4;';
            box.appendChild(n);
        }
    }

    const reload = document.createElement('button');
    reload.textContent = '🔄 ПЕРЕЧИТАТЬ';
    reload.style.cssText = 'width:100%;padding:10px;margin-top:14px;border:1px solid #ffd700;border-radius:8px;background:rgba(255,215,0,.10);color:#ffd700;font-size:13px;font-weight:700;cursor:pointer;';
    reload.onclick = async () => { await loadVersionCounter(); ov.remove(); openVersionPanel(); };
    box.appendChild(reload);

    const close = document.createElement('button');
    close.textContent = 'ЗАКРЫТЬ';
    close.style.cssText = 'width:100%;padding:9px;margin-top:8px;border:1px solid #2a333d;border-radius:8px;background:transparent;color:#8b98a5;font-size:13px;cursor:pointer;';
    close.onclick = () => ov.remove();
    box.appendChild(close);

    ov.appendChild(box);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
}
