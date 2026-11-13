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

const AGENT_SPEED = 12; // % в секунду
const CORRIDOR_Y = [8, 22, 35, 48, 61, 74, 92];
const CORRIDOR_X = [8, 25, 46, 67, 88];

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

    const wallTop = document.createElement('div'); wallTop.className = 'office-wall-top';
    const wallLeft = document.createElement('div'); wallLeft.className = 'office-wall-left';
    const mainDoor = document.createElement('div'); mainDoor.className = 'office-main-door'; mainDoor.style.left = '45px';
    room.appendChild(wallTop); room.appendChild(wallLeft); room.appendChild(mainDoor);

    [20, 40, 60, 80].forEach(pos => {
        const win = document.createElement('div');
        win.className = 'office-window';
        win.style.left = pos + '%';
        room.appendChild(win);
    });

    const waterMat = document.createElement('div'); waterMat.className = 'water-zone-mat'; room.appendChild(waterMat);
    const cooler1 = document.createElement('div'); cooler1.className = 'water-cooler'; cooler1.style.left = '10%'; cooler1.style.top = '85%'; room.appendChild(cooler1);
    const cooler2 = document.createElement('div'); cooler2.className = 'water-cooler'; cooler2.style.left = '90%'; cooler2.style.top = '85%'; room.appendChild(cooler2);

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

    const agentNames = Object.keys(AGENT_ICONS);
    agentNames.forEach((name, index) => {
        const deskData = officeDesks[index];
        if (!deskData) return;

        const sprite = document.createElement('div');
        const spriteType = (index % 4) + 1;
        
        // ИСПОЛЬЗУЕМ КАРТИНКИ ИЗ РЕПОЗИТОРИЯ
        sprite.className = `agent-sprite sitting sprite-${spriteType}`;
        sprite.style.backgroundImage = `url('char${spriteType}.png')`;
        sprite.style.backgroundSize = 'contain';
        sprite.style.backgroundRepeat = 'no-repeat';
        sprite.style.backgroundPosition = 'center bottom';
        
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
            isWorking: false, isMoving: false, breakTimer: Math.random() * 30 + 10,
            targetSpotKey: null
        };
    });
    container.appendChild(room);
}
function setAgentFacing(agent, dx, dy) {
    agent.el.classList.remove('face-up', 'face-down', 'face-left', 'face-right');
    if (Math.abs(dx) >= Math.abs(dy)) {
        agent.el.classList.add(dx >= 0 ? 'face-right' : 'face-left');
    } else {
        agent.el.classList.add(dy >= 0 ? 'face-down' : 'face-up');
    }
}

function nearest(arr, val) {
    return arr.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
}

function buildPath(x0, y0, x1, y1) {
    const pts = [{x: x0, y: y0}];

    const cy0 = nearest(CORRIDOR_Y, y0);
    const cy1 = nearest(CORRIDOR_Y, y1);
    const cx = nearest(CORRIDOR_X, (x0 + x1) / 2);
    const cx1 = nearest(CORRIDOR_X, x1);

    if (Math.abs(y0 - cy0) > 0.5) pts.push({x: x0, y: cy0});
    if (Math.abs(x0 - cx) > 0.5) pts.push({x: cx, y: cy0});
    if (Math.abs(cx - cx1) > 0.5) pts.push({x: cx1, y: cy0});
    if (Math.abs(cy0 - cy1) > 0.5) pts.push({x: cx1, y: cy1});
    if (Math.abs(cx1 - x1) > 0.5) pts.push({x: x1, y: cy1});
    pts.push({x: x1, y: y1});

    return pts.filter((p, i) => {
        if (i === 0) return true;
        return Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5;
    });
}

function moveAlongPath(agent, path, index, callback) {
    if (index >= path.length - 1) {
        agent.isMoving = false;
        agent.moveTimeout = null;
        agent.el.classList.remove('walking');
        if (callback) callback();
        return;
    }

    const from = path[index];
    const to = path[index + 1];
    const dX = to.x - from.x;
    const dY = to.y - from.y;
    const dist = Math.hypot(dX, dY);

    if (dist < 0.5) {
        moveAlongPath(agent, path, index + 1, callback);
        return;
    }

    setAgentFacing(agent, dX, dY);

    const duration = (dist / AGENT_SPEED) * 1000;
    agent.el.style.transition = `left ${duration}ms linear, top ${duration}ms linear`;
    void agent.el.offsetWidth;
    agent.el.style.left = to.x + '%';
    agent.el.style.top = to.y + '%';

    agent.moveTimeout = setTimeout(() => {
        agent.moveTimeout = null;
        moveAlongPath(agent, path, index + 1, callback);
    }, duration);
}

function moveAgentTo(name, targetX, targetY, callback) {
    const agent = officeSprites[name];
    if (!agent) return;

    if (agent.moveTimeout) {
        clearTimeout(agent.moveTimeout);
        agent.moveTimeout = null;
    }

    agent.isMoving = true;
    agent.el.classList.remove('sitting');
    agent.el.classList.add('walking');

    const startX = parseFloat(agent.el.style.left) || 0;
    const startY = parseFloat(agent.el.style.top) || 0;
    const endX = targetX;
    const endY = targetY;

    const path = buildPath(startX, startY, endX, endY);
    path[path.length - 1] = {x: endX, y: endY};
    moveAlongPath(agent, path, 0, callback);
                                            }
function updateAgentInOffice(name, status) {
    agentStatuses[name] = status;
    if (!officeSprites[name] || !isOfficeOpen) return;

    const agent = officeSprites[name];
    const isWorking = ['busy', 'working', 'thinking', 'typing'].includes(status);
    const deskData = officeDesks.find(d => d.x + 2 === agent.deskX && d.y + 7 === agent.deskY);
    const monitor = deskData ? deskData.el.querySelector('.desk-monitor') : null;

    if (isWorking) {
        if (agent.moveTimeout) { clearTimeout(agent.moveTimeout); agent.moveTimeout = null; }
        agent.targetSpotKey = null;
        agent.isWorking = true;
        agent.isMoving = false;

        agent.el.classList.remove('walking', 'face-up', 'face-down', 'face-left', 'face-right');
        agent.el.style.transition = 'none';
        agent.el.style.left = agent.deskX + '%';
        agent.el.style.top = agent.deskY + '%';
        void agent.el.offsetWidth;
        agent.el.classList.add('sitting');

        if (monitor) monitor.classList.add('active');

        const bubble = document.getElementById('bubble-' + name);
        if (bubble) bubble.classList.remove('show');
    } else {
        agent.isWorking = false;
        if (monitor) monitor.classList.remove('active');

        if (!agent.el.classList.contains('sitting') && !agent.isMoving) {
            moveAgentTo(name, agent.deskX, agent.deskY, () => {
                agent.el.classList.add('sitting');
            });
        } else if (!agent.isMoving) {
            agent.el.classList.add('sitting');
        }
    }
}

function officeTick() {
    if (!isOfficeOpen) return;

    const occupied = new Set();
    Object.keys(officeSprites).forEach(n => {
        const a = officeSprites[n];
        if (a.targetSpotKey) occupied.add(a.targetSpotKey);
    });

    Object.keys(officeSprites).forEach(name => {
        const agent = officeSprites[name];
        if (agent.isWorking || agent.isMoving) return;

        agent.breakTimer--;
        if (agent.breakTimer > 0) return;

        if (['busy', 'working', 'thinking', 'typing'].includes(agentStatuses[name])) return;

        const freeSpots = SAFE_SPOTS.filter(s => !occupied.has(s.x + ',' + s.y));
        if (freeSpots.length === 0) {
            agent.breakTimer = 5;
            return;
        }

        const spot = freeSpots[Math.floor(Math.random() * freeSpots.length)];
        const spotKey = spot.x + ',' + spot.y;
        agent.targetSpotKey = spotKey;
        occupied.add(spotKey);
        agent.breakTimer = Math.random() * 40 + 20;

        moveAgentTo(name, spot.x, spot.y, () => {
            agent.el.classList.remove('face-up', 'face-left', 'face-right');
            agent.el.classList.add('face-down');

            const bubble = document.getElementById('bubble-' + name);
            if (bubble && spot.type) {
                bubble.innerText = spot.type === 'water' ? '💧 Пьёт воду' : '🖨️ Печатает';
                bubble.classList.add('show');
            }

            setTimeout(() => {
                if (bubble) bubble.classList.remove('show');
                agent.targetSpotKey = null;

                if (['busy', 'working', 'thinking', 'typing'].includes(agentStatuses[name])) return;
                moveAgentTo(name, agent.deskX, agent.deskY, () => {
                    agent.el.classList.add('sitting');
                });
            }, 5000);
        });
    });
                }
