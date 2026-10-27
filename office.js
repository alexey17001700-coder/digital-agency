let isOfficeOpen = false;
let officeSprites = {}; 
let officeDesks = []; 
let agentStatuses = {}; 
let officeLoop = null;

const DESK_COLS = [10, 32, 54, 76];
const DESK_ROWS = [12, 26, 40, 54, 68, 82];

// Безопасные точки (проходы между столами)
const SAFE_SPOTS = [
    {x: 21, y: 19}, {x: 43, y: 19}, {x: 65, y: 19}, {x: 87, y: 19},
    {x: 21, y: 33}, {x: 43, y: 33}, {x: 65, y: 33}, {x: 87, y: 33},
    {x: 21, y: 47}, {x: 43, y: 47}, {x: 65, y: 47}, {x: 87, y: 47},
    {x: 21, y: 61}, {x: 43, y: 61}, {x: 65, y: 61}, {x: 87, y: 61},
    {x: 21, y: 75}, {x: 43, y: 75}, {x: 65, y: 75}, {x: 87, y: 75},
    {x: 5, y: 90}, {x: 95, y: 90}, // Кулеры
    {x: 50, y: 5} // Принтер
];

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
        if (!officeLoop) officeLoop = setInterval(officeTick, 1500);
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

    const cooler1 = document.createElement('div'); cooler1.className = 'water-cooler'; cooler1.style.top = '90%'; cooler1.style.left = '5%'; room.appendChild(cooler1);
    const cooler2 = document.createElement('div'); cooler2.className = 'water-cooler'; cooler2.style.top = '90%'; cooler2.style.left = '95%'; room.appendChild(cooler2);
    const printerDesk = document.createElement('div'); printerDesk.className = 'printer-desk'; printerDesk.style.top = '5%'; printerDesk.style.left = '50%'; printerDesk.innerHTML = '<div class="printer"></div>'; room.appendChild(printerDesk);
    const plant1 = document.createElement('div'); plant1.className = 'plant'; plant1.style.top = '15%'; plant1.style.left = '5%'; room.appendChild(plant1);
    const plant2 = document.createElement('div'); plant2.className = 'plant'; plant2.style.top = '15%'; plant2.style.left = '95%'; room.appendChild(plant2);

    const agentNames = Object.keys(AGENT_ICONS);
    
    agentNames.forEach((name, index) => {
        const deskData = officeDesks[index];
        if (!deskData) return;

        const sprite = document.createElement('div');
        sprite.className = 'agent-sprite';
        sprite.style.left = deskData.x + '%';
        sprite.style.top = (deskData.y - 2) + '%';

        const bubble = document.createElement('div'); bubble.className = 'agent-bubble'; bubble.id = 'bubble-' + name;
        const nameTag = document.createElement('div'); nameTag.className = 'agent-name'; nameTag.innerText = name;
        
        const head = document.createElement('div'); head.className = 'agent-head';
        head.innerHTML = '<div class="agent-face"><div class="eye"></div><div class="eye"></div></div>';
        
        // Форма агента (Цвет зависит от роли)
        const body = document.createElement('div'); body.className = 'agent-body';
        body.style.backgroundColor = AGENT_COLORS[name] || '#00e5ff'; 
        
        const armL = document.createElement('div'); armL.className = 'agent-arm arm-left';
        const armR = document.createElement('div'); armR.className = 'agent-arm arm-right';
        const legL = document.createElement('div'); legL.className = 'agent-leg leg-left';
        const legR = document.createElement('div'); legR.className = 'agent-leg leg-right';
        
        body.appendChild(armL); body.appendChild(armR); body.appendChild(legL); body.appendChild(legR);
        sprite.appendChild(bubble); sprite.appendChild(nameTag); sprite.appendChild(head); sprite.appendChild(body);
        room.appendChild(sprite);
        
        officeSprites[name] = { el: sprite, deskX: deskData.x, deskY: deskData.y, isWorking: false, isMoving: false };
    });

    container.appendChild(room);
}

function moveAgentTo(name, targetX, targetY, callback) {
    const agent = officeSprites[name];
    if (!agent || agent.isMoving) return;
    
    agent.isMoving = true;
    agent.el.classList.add('walking');

    const currentX = parseFloat(agent.el.style.left) || 0;
    const currentY = parseFloat(agent.el.style.top) || 0;
    
    // Время на основе дистанции (скорость 4% в секунду)
    const timeX = (Math.abs(targetX - currentX) / 4) * 1000;
    const timeY = (Math.abs(targetY - currentY) / 4) * 1000;

    // Сначала идем по горизонтали
    agent.el.style.transition = `left ${timeX}ms linear, top 0ms`;
    agent.el.style.left = targetX + '%';

    setTimeout(() => {
        // Потом по вертикали
        agent.el.style.transition = `top ${timeY}ms linear, left 0ms`;
        agent.el.style.top = targetY + '%';

        setTimeout(() => {
            agent.isMoving = false;
            agent.el.classList.remove('walking');
            if (callback) callback();
        }, timeY);
    }, timeX);
}

function updateAgentInOffice(name, status) {
function updateAgentInOffice(name, status) {
    agentStatuses[name] = status;
    if (!officeSprites[name] || !isOfficeOpen) return;
    
    const agent = officeSprites[name];
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    const deskIndex = Object.keys(officeSprites).indexOf(name);
    const deskEl = document.querySelectorAll('.desk')[deskIndex];

    if (isWorking) {
        agent.isWorking = true;
        agent.isMoving = false; // Сбрасываем флаг движения
        agent.el.classList.remove('walking');
        agent.el.style.transition = 'none'; // Отключаем плавность, чтобы мгновенно сел
        agent.el.style.left = (agent.deskX + 1) + '%';
        agent.el.style.top = (agent.deskY + 2) + '%';
        agent.el.classList.add('sitting');
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.add('active');
    } else {
        if (agent.isWorking) {
            agent.isWorking = false;
            agent.el.classList.remove('sitting');
            if (deskEl) deskEl.querySelector('.desk-monitor').classList.remove('active');
            
            const safeSpot = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)];
            agent.el.style.transition = 'left 2s linear, top 2s linear'; // Включаем обратно
            moveAgentTo(name, safeSpot.x, safeSpot.y);
        }
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
    
    // Встаем рядом со столом в проходе
    agent.el.style.left = (agent.deskX + 10) + '%'; 
    agent.el.style.top = (agent.deskY + 5) + '%';
    
    bubble.innerText = text;
    bubble.classList.add('show');

    setTimeout(() => {
        bubble.classList.remove('show');
        agent.el.classList.remove('has-reaction');
        if (agentStatuses[name] && ['busy', 'working', 'thinking', 'typing'].includes(agentStatuses[name])) {
            updateAgentInOffice(name, agentStatuses[name]);
        } else {
            moveAgentTo(name, agent.deskX + 1, agent.deskY + 1);
        }
    }, 5000);
}

function officeTick() {
    if (!isOfficeOpen) return;
    
    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.isWorking || agent.isMoving || agent.el.classList.contains('has-reaction')) return;

        // 20% шанс пойти погулять
        if (Math.random() < 0.2) {
            const spot = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)];
            moveAgentTo(name, spot.x, spot.y, () => {
                // Если дошли до кулера, можно попить
                if (spot.x === 5 || spot.x === 95) {
                    const bubble = document.getElementById('bubble-' + name);
                    if(bubble) {
                        bubble.innerText = '💧 Водичка';
                        bubble.classList.add('show');
                        setTimeout(() => bubble.classList.remove('show'), 2000);
                    }
                }
            });
        }
    });
    }
