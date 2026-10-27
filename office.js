let isOfficeOpen = false;
let officeSprites = {}; 
let officeDesks = []; 
let agentStatuses = {}; 
let officeLoop = null;

// Сетка столов (4 колонки x 6 рядов = 24 стола)
const DESK_COLS = [10, 32, 54, 76];
const DESK_ROWS = [12, 26, 40, 54, 68, 82];

function toggleOffice() {
    isOfficeOpen = !isOfficeOpen;
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');
    
    if (isOfficeOpen) {
        chat.style.display = 'none';
        office.style.display = 'block';
        if (btn) btn.classList.add('active');
        
        agentStatuses = {}; 
        if (typeof resetAllStatuses === 'function') resetAllStatuses();
        
        if (!office.innerHTML.trim()) initOffice();
        if (!officeLoop) officeLoop = setInterval(officeTick, 1000);
    } else {
        chat.style.display = 'flex';
        office.style.display = 'none';
        if (btn) btn.classList.remove('active');
        if (officeLoop) { clearInterval(officeLoop); officeLoop = null; }
    }
}

function initOffice() {
    const container = document.getElementById('office-container');
    if (!container) return;
    container.innerHTML = '';
    officeSprites = {}; 
    officeDesks = [];

    const room = document.createElement('div');
    room.className = 'office-room';
    
    const wallTop = document.createElement('div'); wallTop.className = 'office-wall-top';
    const wallLeft = document.createElement('div'); wallLeft.className = 'office-wall-left';
    room.appendChild(wallTop); room.appendChild(wallLeft);

    // 1. Создаем 24 стола
    DESK_ROWS.forEach(top => {
        DESK_COLS.forEach(left => {
            const desk = document.createElement('div');
            desk.className = 'desk';
            desk.style.top = top + '%';
            desk.style.left = left + '%';
            desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
            room.appendChild(desk);
            officeDesks.push({ el: desk, x: left, y: top });
        });
    });

    // 2. Декор
    const cooler1 = document.createElement('div'); cooler1.className = 'water-cooler'; cooler1.style.top = '90%'; cooler1.style.left = '5%'; room.appendChild(cooler1);
    const cooler2 = document.createElement('div'); cooler2.className = 'water-cooler'; cooler2.style.top = '90%'; cooler2.style.left = '95%'; room.appendChild(cooler2);
    const printerDesk = document.createElement('div'); printerDesk.className = 'printer-desk'; printerDesk.style.top = '5%'; printerDesk.style.left = '50%'; printerDesk.innerHTML = '<div class="printer"></div>'; room.appendChild(printerDesk);
    const plant1 = document.createElement('div'); plant1.className = 'plant'; plant1.style.top = '15%'; plant1.style.left = '5%'; room.appendChild(plant1);
    const plant2 = document.createElement('div'); plant2.className = 'plant'; plant2.style.top = '15%'; plant2.style.left = '95%'; room.appendChild(plant2);

    // 3. Создаем агентов и закрепляем за ними столы
    const agentNames = Object.keys(AGENT_ICONS);
    
    agentNames.forEach((name, index) => {
        const deskData = officeDesks[index];
        if (!deskData) return; // Если агентов больше, чем столов

        const sprite = document.createElement('div');
        sprite.className = 'agent-sprite';
        
        // Начальная позиция (за своим столом)
        sprite.style.left = deskData.x + '%';
        sprite.style.top = (deskData.y - 3) + '%';

        // Табличка (скрыта по умолчанию)
        const bubble = document.createElement('div'); 
        bubble.className = 'agent-bubble'; 
        bubble.id = 'bubble-' + name;
        
        // Имя
        const nameTag = document.createElement('div'); 
        nameTag.className = 'agent-name'; 
        nameTag.innerText = name;
        
        // Голова с лицом
        const head = document.createElement('div'); head.className = 'agent-head';
        head.innerHTML = '<div class="agent-face"><div class="eye"></div><div class="eye"></div></div>';
        
        // Тело
        const body = document.createElement('div'); body.className = 'agent-body';
        body.style.backgroundColor = AGENT_COLORS[name] || '#00e5ff'; 
        
        // Руки и ноги
        const armL = document.createElement('div'); armL.className = 'agent-arm arm-left';
        const armR = document.createElement('div'); armR.className = 'agent-arm arm-right';
        const legL = document.createElement('div'); legL.className = 'agent-leg leg-left';
        const legR = document.createElement('div'); legR.className = 'agent-leg leg-right';
        
        body.appendChild(armL); body.appendChild(armR);
        body.appendChild(legL); body.appendChild(legR);

        sprite.appendChild(bubble);
        sprite.appendChild(nameTag);
        sprite.appendChild(head); 
        sprite.appendChild(body);
        
        room.appendChild(sprite);
        
        officeSprites[name] = { 
            el: sprite, 
            deskX: deskData.x, 
            deskY: deskData.y, 
            isWorking: false,
            isMoving: false
        };
    });

    container.appendChild(room);
}
// --- ДВИЖЕНИЕ И ПОВЕДЕНИЕ ---
function moveAgentTo(name, targetX, targetY) {
    const agent = officeSprites[name];
    if (!agent || agent.isMoving) return;
    
    agent.isMoving = true;
    agent.el.classList.add('walking');
    agent.el.style.left = targetX + '%';
    agent.el.style.top = targetY + '%';

    // Ждем окончания CSS-перехода (2 секунды)
    setTimeout(() => {
        if (!agent.isWorking) agent.el.classList.remove('walking');
        agent.isMoving = false;
    }, 2000);
}

function updateAgentInOffice(name, status) {
    agentStatuses[name] = status;
    if (!officeSprites[name] || !isOfficeOpen) return;
    
    const agent = officeSprites[name];
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    const deskIndex = Object.keys(officeSprites).indexOf(name);
    const deskEl = document.querySelectorAll('.desk')[deskIndex];

    if (isWorking) {
        agent.isWorking = true;
        agent.el.classList.remove('walking');
        agent.el.classList.add('sitting');
        // Садим за свой стол
        agent.el.style.left = (agent.deskX + 1) + '%'; 
        agent.el.style.top = (agent.deskY + 2) + '%';
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.add('active');
    } else {
        agent.isWorking = false;
        agent.el.classList.remove('sitting');
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.remove('active');
        // Встаем со стула и отходим
        moveAgentTo(name, agent.deskX + (Math.random() > 0.5 ? 6 : -6), agent.deskY + 6);
    }
}

function showAgentReaction(name, text) {
    const agent = officeSprites[name];
    if (!agent) return;
    const bubble = document.getElementById('bubble-' + name);
    if (!bubble) return;

    agent.isWorking = false;
    agent.el.classList.remove('sitting', 'walking');
    agent.el.classList.add('has-reaction');
    
    // Встаем рядом со столом
    agent.el.style.left = (agent.deskX + 6) + '%'; 
    agent.el.style.top = (agent.deskY - 2) + '%';
    
    bubble.innerText = text;
    bubble.classList.add('show');

    // Прячем через 5 секунд
    setTimeout(() => {
        bubble.classList.remove('show');
        agent.el.classList.remove('has-reaction');
        // Возвращаемся к обычной жизни
        if (agentStatuses[name] && ['busy', 'working', 'thinking', 'typing'].includes(agentStatuses[name])) {
            updateAgentInOffice(name, agentStatuses[name]);
        } else {
            moveAgentTo(name, agent.deskX, agent.deskY);
        }
    }, 5000);
}

function officeTick() {
    if (!isOfficeOpen) return;
    
    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.isWorking || agent.isMoving || agent.el.classList.contains('has-reaction')) return;

        // 15% шанс пойти погулять / попить воды / к принтеру
        if (Math.random() < 0.15) {
            const action = Math.random();
            let tx, ty;
            if (action < 0.3) { tx = 5; ty = 90; } // Кулер 1
            else if (action < 0.6) { tx = 95; ty = 90; } // Кулер 2
            else if (action < 0.8) { tx = 50; ty = 5; } // Принтер
            else { tx = 15 + Math.random() * 70; ty = 20 + Math.random() * 60; } // Случайно
            
            moveAgentTo(name, tx, ty);
        }
    });
            }
