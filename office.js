let isOfficeOpen = false;
let officeSprites = {}; 
let officeDesks = []; 
let agentStatuses = {}; 
let officeLoop = null;

const DESK_COLS = [10, 32, 54, 76];
const DESK_ROWS = [12, 26, 40, 54, 68, 82];

const SAFE_SPOTS = [
    {x: 21, y: 19}, {x: 43, y: 19}, {x: 65, y: 19}, {x: 87, y: 19},
    {x: 21, y: 33}, {x: 43, y: 33}, {x: 65, y: 33}, {x: 87, y: 33},
    {x: 21, y: 47}, {x: 43, y: 47}, {x: 65, y: 47}, {x: 87, y: 47},
    {x: 21, y: 61}, {x: 43, y: 61}, {x: 65, y: 61}, {x: 87, y: 61},
    {x: 21, y: 75}, {x: 43, y: 75}, {x: 65, y: 75}, {x: 87, y: 75}
];

function toggleOffice() {
    isOfficeOpen = !isOfficeOpen;
    const chat = document.getElementById('chatContainer');
    const office = document.getElementById('office-container');
    const btn = document.getElementById('btnOffice');
    
    if (isOfficeOpen) {
        chat.style.display = 'none'; office.style.display = 'block';
        if (btn) btn.classList.add('active');
        agentStatuses = {}; 
        if (typeof resetAllStatuses === 'function') resetAllStatuses();
        if (!office.innerHTML.trim()) initOffice();
        if (!officeLoop) officeLoop = setInterval(officeTick, 1500);
    } else {
        chat.style.display = 'flex'; office.style.display = 'none';
        if (btn) btn.classList.remove('active');
        if (officeLoop) { clearInterval(officeLoop); officeLoop = null; }
    }
}

function initOffice() {
    const container = document.getElementById('office-container');
    if (!container) return;
    container.innerHTML = ''; officeSprites = {}; officeDesks = [];

    const room = document.createElement('div'); room.className = 'office-room';
    room.appendChild(Object.assign(document.createElement('div'), { className: 'office-wall-top' }));
    room.appendChild(Object.assign(document.createElement('div'), { className: 'office-wall-left' }));

    DESK_ROWS.forEach(top => {
        DESK_COLS.forEach(left => {
            const desk = document.createElement('div'); desk.className = 'desk';
            desk.style.top = top + '%'; desk.style.left = left + '%';
            desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
            room.appendChild(desk); officeDesks.push({ el: desk, x: left, y: top });
        });
    });

    const agentNames = Object.keys(AGENT_ICONS);
    agentNames.forEach((name, index) => {
        const deskData = officeDesks[index];
        if (!deskData) return;

        const sprite = document.createElement('div'); sprite.className = 'agent-sprite';
        sprite.style.left = deskData.x + '%'; sprite.style.top = (deskData.y - 2) + '%';

        const bubble = document.createElement('div'); bubble.className = 'agent-bubble'; bubble.id = 'bubble-' + name;
        const nameTag = document.createElement('div'); nameTag.className = 'agent-name'; nameTag.innerText = name;
        const head = document.createElement('div'); head.className = 'agent-head'; head.innerHTML = '<div class="agent-face"><div class="eye"></div><div class="eye"></div></div>';
        const body = document.createElement('div'); body.className = 'agent-body'; body.style.backgroundColor = AGENT_COLORS[name] || '#00e5ff'; 
        
        ['arm-left','arm-right','leg-left','leg-right'].forEach(cls => {
            const part = document.createElement('div'); 
            part.className = 'agent-' + (cls.includes('arm')?'arm':'leg') + ' ' + cls;
            body.appendChild(part);
        });
        
        sprite.appendChild(bubble); sprite.appendChild(nameTag); sprite.appendChild(head); sprite.appendChild(body);
        room.appendChild(sprite);
        officeSprites[name] = { el: sprite, deskX: deskData.x, deskY: deskData.y, isWorking: false, isMoving: false };
    });
    container.appendChild(room);
}

function moveAgentTo(name, targetX, targetY, callback) {
    const agent = officeSprites[name];
    if (!agent || agent.isMoving) return;
    agent.isMoving = true; agent.el.classList.add('walking');
    const currentX = parseFloat(agent.el.style.left) || 0;
    const currentY = parseFloat(agent.el.style.top) || 0;
    const timeX = (Math.abs(targetX - currentX) / 4) * 1000;
    const timeY = (Math.abs(targetY - currentY) / 4) * 1000;

    agent.el.style.transition = `left ${timeX}ms linear, top 0ms`;
    agent.el.style.left = targetX + '%';
    setTimeout(() => {
        agent.el.style.transition = `top ${timeY}ms linear, left 0ms`;
        agent.el.style.top = targetY + '%';
        setTimeout(() => { agent.isMoving = false; agent.el.classList.remove('walking'); if (callback) callback(); }, timeY);
    }, timeX);
}

function updateAgentInOffice(name, status) {
    agentStatuses[name] = status;
    if (!officeSprites[name] || !isOfficeOpen) return;
    const agent = officeSprites[name];
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    const deskEl = document.querySelectorAll('.desk')[Object.keys(officeSprites).indexOf(name)];

    if (isWorking) {
        agent.isWorking = true; agent.isMoving = false; agent.el.classList.remove('walking');
        agent.el.style.transition = 'none'; agent.el.style.left = (agent.deskX + 1) + '%'; agent.el.style.top = (agent.deskY + 2) + '%';
        agent.el.classList.add('sitting');
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.add('active');
    } else if (agent.isWorking) {
        agent.isWorking = false; agent.el.classList.remove('sitting');
        if (deskEl) deskEl.querySelector('.desk-monitor').classList.remove('active');
        const spot = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)];
        agent.el.style.transition = 'left 2s linear, top 2s linear'; moveAgentTo(name, spot.x, spot.y);
    }
}

function showAgentReaction(name, text) {
    const agent = officeSprites[name]; if (!agent) return;
    const bubble = document.getElementById('bubble-' + name); if (!bubble) return;
    agent.isWorking = false; agent.el.classList.remove('sitting', 'walking'); agent.el.classList.add('has-reaction');
    agent.el.style.left = (agent.deskX + 10) + '%'; agent.el.style.top = (agent.deskY + 5) + '%';
    bubble.innerText = text; bubble.classList.add('show');
    setTimeout(() => { bubble.classList.remove('show'); agent.el.classList.remove('has-reaction'); moveAgentTo(name, agent.deskX + 1, agent.deskY + 1); }, 5000);
}

function officeTick() {
    if (!isOfficeOpen) return;
    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.isWorking || agent.isMoving || agent.el.classList.contains('has-reaction')) return;
        if (Math.random() < 0.2) { const spot = SAFE_SPOTS[Math.floor(Math.random() * SAFE_SPOTS.length)]; moveAgentTo(name, spot.x, spot.y); }
    });
        }
