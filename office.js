let isOfficeOpen = false;
let officeSprites = {}; 
let officeDesks = []; 
let agentStatuses = {}; 
let officeLoop = null;

const DESK_COLS = [15, 36, 57, 78];
const DESK_ROWS = [15, 28, 41, 54, 67, 80];

const SAFE_SPOTS = [
    {x: 10, y: 85, type: 'water'}, {x: 90, y: 85, type: 'water'}, 
    {x: 50, y: 12, type: 'print'}, 
    {x: 25, y: 35}, {x: 46, y: 60}, {x: 67, y: 35}, {x: 89, y: 60}
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
    
    // Стены и дверь
    const wallTop = document.createElement('div'); wallTop.className = 'office-wall-top';
    const wallLeft = document.createElement('div'); wallLeft.className = 'office-wall-left';
    const mainDoor = document.createElement('div'); mainDoor.className = 'office-main-door'; mainDoor.style.left = '45px';
    room.appendChild(wallTop); room.appendChild(wallLeft); room.appendChild(mainDoor);

    // Окна
    [20, 40, 60, 80].forEach(pos => {
        const win = document.createElement('div');
        win.className = 'office-window';
        win.style.left = pos + '%';
        room.appendChild(win);
    });

    // Коврик и кулеры
    const waterMat = document.createElement('div'); waterMat.className = 'water-zone-mat'; room.appendChild(waterMat);
    const cooler1 = document.createElement('div'); cooler1.className = 'water-cooler'; cooler1.style.left = '10%'; cooler1.style.top = '85%'; room.appendChild(cooler1);
    const cooler2 = document.createElement('div'); cooler2.className = 'water-cooler'; cooler2.style.left = '90%'; cooler2.style.top = '85%'; room.appendChild(cooler2);

    // Столы, стулья и агенты
    DESK_ROWS.forEach(top => {
        DESK_COLS.forEach(left => {
            const desk = document.createElement('div');
            desk.className = 'desk';
            desk.style.top = top + '%';
            desk.style.left = left + '%';
            desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
            room.appendChild(desk);
            officeDesks.push({ el: desk, x: left, y: top });

            const chair = document.createElement('div');
            chair.className = 'desk-chair';
            chair.style.top = (top + 7) + '%'; 
            chair.style.left = (left + 2) + '%';
            room.appendChild(chair);
        });
    });

    // Создаем агентов (Спрайты)
    const agentNames = Object.keys(AGENT_ICONS);
    agentNames.forEach((name, index) => {
        const deskData = officeDesks[index];
        if (!deskData) return;

        const sprite = document.createElement('div');
        // Выбираем один из 4 спрайтов по кругу
        const spriteType = (index % 4) + 1; 
        sprite.className = `agent-sprite sitting sprite-${spriteType}`; 
        
        sprite.style.left = (deskData.x + 2) + '%';
        sprite.style.top = (deskData.y + 7) + '%';
        sprite.title = name;

        const bubble = document.createElement('div'); bubble.className = 'agent-bubble'; bubble.id = 'bubble-' + name;
        const nameTag = document.createElement('div'); nameTag.className = 'agent-name'; nameTag.innerText = name;
        
        sprite.appendChild(bubble); 
        sprite.appendChild(nameTag); 
        room.appendChild(sprite);
        
        officeSprites[name] = { 
            el: sprite, deskX: deskData.x + 2, deskY: deskData.y + 7, 
            isWorking: false, isMoving: false, breakTimer: Math.random() * 30 + 10 
        };
    });
    container.appendChild(room);
}
function moveAgentTo(name, targetX, targetY, callback) {
    const agent = officeSprites[name];
    if (!agent || agent.isMoving) return;
    
    agent.isMoving = true;
    // Убираем класс сидения и старые направления
    agent.el.classList.remove('sitting', 'face-up', 'face-down', 'face-left', 'face-right');
    agent.el.classList.add('walking');

    const currentX = parseFloat(agent.el.style.left) || 0;
    const currentY = parseFloat(agent.el.style.top) || 0;
    
    const dX = targetX - currentX;
    const dY = targetY - currentY;

    // Определяем направление (включаем нужную анимацию ходьбы)
    if (Math.abs(dX) > Math.abs(dY)) {
        if (dX > 0) agent.el.classList.add('face-right');
        else agent.el.classList.add('face-left');
    } else {
        if (dY > 0) agent.el.classList.add('face-down');
        else agent.el.classList.add('face-up');
    }
    
    const timeX = (Math.abs(dX) / 4) * 1000;
    const timeY = (Math.abs(dY) / 4) * 1000;

    agent.el.style.transition = `left ${timeX}ms linear, top 0ms`;
    agent.el.style.left = targetX + '%';

    setTimeout(() => {
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
    agentStatuses[name] = status;
    if (!officeSprites[name] || !isOfficeOpen) return;
    
    const agent = officeSprites[name];
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    const deskIndex = Object.keys(officeSprites).indexOf(name);
    const deskEl = document.querySelectorAll('.desk')[deskIndex];

    if (isWorking) {
        agent.isWorking = true;
        agent.isMoving = false; 
        agent.el.classList.remove('walking', 'face-up', 'face-down', 'face-left', 'face-right');
        agent.el.style.transition = 'none'; 
        agent.el.style.left = agent.deskX + '%';
        agent.el.style.top = agent.deskY + '%';
        agent.el.classList.add('sitting'); // Спрайт спиной
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.add('active'); 
    } else {
        agent.isWorking = false;
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.remove('active'); 
        
        if (!agent.el.classList.contains('sitting') && !agent.isMoving) {
            moveAgentTo(name, agent.deskX, agent.deskY, () => {
                agent.el.classList.add('sitting');
            });
        } else {
            agent.el.classList.add('sitting');
        }
    }
}

function officeTick() {
    if (!isOfficeOpen) return;
    
    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.isWorking || agent.isMoving) return;

        agent.breakTimer--;
        
        if (agent.breakTimer <= 0) {
            const spot = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)];
            agent.breakTimer = Math.random() * 40 + 20; 
            
            moveAgentTo(name, spot.x, spot.y, () => {
                // Остановился - смотрит на нас
                agent.el.classList.remove('face-up', 'face-left', 'face-right');
                agent.el.classList.add('face-down');

                const bubble = document.getElementById('bubble-' + name);
                if (bubble && spot.type) {
                    bubble.innerText = spot.type === 'water' ? '💧 Пьет воду' : '🖨️ Печатает';
                    bubble.classList.add('show');
                }
                
                setTimeout(() => {
                    if (bubble) bubble.classList.remove('show');
                    // Идет обратно за стол
                    moveAgentTo(name, agent.deskX, agent.deskY, () => {
                        agent.el.classList.add('sitting');
                    });
                }, 5000);
            });
        }
    });
}
