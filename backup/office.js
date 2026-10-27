let isOfficeOpen = false;
let officeSprites = {}; 
let officeDesks = []; 
let agentStatuses = {}; // Глобальная память статусов агентов

function toggleOffice() {
    isOfficeOpen = !isOfficeOpen;
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');
    
    if (isOfficeOpen) {
        chat.style.display = 'none';
        office.style.display = 'block';
        if (btn) btn.classList.add('active');
        if (!office.innerHTML.trim()) {
            initOffice();
        }
    } else {
        chat.style.display = 'flex';
        office.style.display = 'none';
        if (btn) btn.classList.remove('active');
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

    // Двери
    const door1 = document.createElement('div'); door1.className = 'office-door'; door1.style.left = '25%'; room.appendChild(door1);
    const door2 = document.createElement('div'); door2.className = 'office-door'; door2.style.left = '75%'; room.appendChild(door2);

    // 24 стола (4 колонки х 6 рядов)
    const cols = [10, 30, 50, 70];
    const rows = [10, 24, 38, 52, 66, 80];

    rows.forEach(top => {
        cols.forEach(left => {
            const desk = document.createElement('div');
            desk.className = 'desk';
            desk.style.top = top + '%';
            desk.style.left = left + '%';
            desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
            room.appendChild(desk);
            officeDesks.push({ el: desk, occupied: false });
        });
    });

    // Декор
    const cooler1 = document.createElement('div'); cooler1.className = 'water-cooler'; cooler1.style.top = '85%'; cooler1.style.left = '5%'; room.appendChild(cooler1);
    const cooler2 = document.createElement('div'); cooler2.className = 'water-cooler'; cooler2.style.top = '5%'; cooler2.style.left = '90%'; room.appendChild(cooler2);

    const printerDesk = document.createElement('div'); printerDesk.className = 'printer-desk'; printerDesk.style.top = '85%'; printerDesk.style.left = '85%'; printerDesk.innerHTML = '<div class="printer"></div>'; room.appendChild(printerDesk);

    const plant1 = document.createElement('div'); plant1.className = 'plant'; plant1.style.top = '20%'; plant1.style.left = '5%'; room.appendChild(plant1);
    const plant2 = document.createElement('div'); plant2.className = 'plant'; plant2.style.top = '50%'; plant2.style.left = '90%'; room.appendChild(plant2);
    const plant3 = document.createElement('div'); plant3.className = 'plant'; plant3.style.top = '85%'; plant3.style.left = '50%'; room.appendChild(plant3);

    // Создаем человечков
    const agentNames = Object.keys(AGENT_ICONS);
    agentNames.forEach((name) => {
        const sprite = document.createElement('div');
        sprite.className = 'agent-sprite';
        sprite.style.left = (15 + Math.random() * 60) + '%';
        sprite.style.top = (15 + Math.random() * 60) + '%';
        sprite.title = name; 

        const head = document.createElement('div'); head.className = 'agent-head';
        const body = document.createElement('div'); body.className = 'agent-body';
        body.style.backgroundColor = AGENT_COLORS[name] || '#00e5ff'; 

        sprite.appendChild(head); sprite.appendChild(body);
        room.appendChild(sprite);
        
        officeSprites[name] = { el: sprite, deskId: null };
        
        // Если агент уже работает, сразу сажаем его за стол!
        if (agentStatuses[name] && agentStatuses[name] !== 'idle' && agentStatuses[name] !== 'free') {
            applyAgentStatusToSprite(name, agentStatuses[name]);
        }
    });

    container.appendChild(room);
}

// Вызывается из ui.js при смене статуса
function updateAgentInOffice(name, status) {
    agentStatuses[name] = status; // Запоминаем статус
    if (!officeSprites[name]) return; // Если офис закрыт, просто сохранили
    applyAgentStatusToSprite(name, status);
}

function applyAgentStatusToSprite(name, status) {
    const agent = officeSprites[name];
    // Если статус busy, working, thinking или typing - агент работает
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    
    if (isWorking) {
        if (agent.deskId === null) {
            const freeDeskIndex = officeDesks.findIndex(d => !d.occupied);
            if (freeDeskIndex !== -1) {
                const desk = officeDesks[freeDeskIndex];
                desk.occupied = true;
                agent.deskId = freeDeskIndex;
                
                agent.el.style.left = desk.el.style.left;
                agent.el.style.top = parseFloat(desk.el.style.top) - 3 + '%'; 
                agent.el.classList.add('sitting');
                desk.el.querySelector('.desk-monitor').classList.add('active');
            }
        }
    } else {
        // Если idle или free - встает и идет гулять
        agent.el.classList.remove('sitting');
        if (agent.deskId !== null) {
            const desk = officeDesks[agent.deskId];
            desk.occupied = false;
            desk.el.querySelector('.desk-monitor').classList.remove('active');
            agent.deskId = null;
            // Отходим вниз от стола
            agent.el.style.top = (parseFloat(desk.el.style.top) + 10) + '%';
        }
    }
}

// Логика ходьбы
setInterval(() => {
    if (!isOfficeOpen) return;
    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.deskId === null && !agent.el.classList.contains('walking')) {
            if (Math.random() < 0.3) {
                agent.el.classList.add('walking');
                agent.el.style.left = (15 + Math.random() * 75) + '%';
                agent.el.style.top = (15 + Math.random() * 75) + '%';
                setTimeout(() => agent.el.classList.remove('walking'), 2000); 
            }
        }
    });
}, 3000);
