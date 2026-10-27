let isOfficeOpen = false;
let officeSprites = {}; // Хранилище для человечков

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
    officeSprites = {}; // Сбрасываем при перезагрузке

    const room = document.createElement('div');
    room.className = 'office-room';
    
    const wallTop = document.createElement('div'); wallTop.className = 'office-wall-top';
    const wallLeft = document.createElement('div'); wallLeft.className = 'office-wall-left';
    room.appendChild(wallTop); room.appendChild(wallLeft);

    // Столы (9 штук сеткой)
    const deskPositions = [
        { top: '15%', left: '20%' }, { top: '15%', left: '45%' }, { top: '15%', left: '70%' },
        { top: '45%', left: '20%' }, { top: '45%', left: '45%' }, { top: '45%', left: '70%' },
        { top: '75%', left: '20%' }, { top: '75%', left: '45%' }, { top: '75%', left: '70%' }
    ];

    deskPositions.forEach(pos => {
        const desk = document.createElement('div');
        desk.className = 'desk';
        desk.style.top = pos.top; desk.style.left = pos.left;
        desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
        room.appendChild(desk);
    });

    // Декор
    const cooler = document.createElement('div'); cooler.className = 'water-cooler'; cooler.style.top = '85%'; cooler.style.left = '5%'; room.appendChild(cooler);
    const plant = document.createElement('div'); plant.className = 'plant'; plant.style.top = '10%'; plant.style.left = '5%'; room.appendChild(plant);

    // Создаем человечков-агентов
    const agentNames = Object.keys(AGENT_ICONS);
    agentNames.forEach((name) => {
        const sprite = document.createElement('div');
        sprite.className = 'agent-sprite';
        
        // Случайная стартовая позиция
        sprite.style.left = (20 + Math.random() * 60) + '%';
        sprite.style.top = (20 + Math.random() * 60) + '%';
        sprite.title = name; // При наведении видно имя

        const head = document.createElement('div'); head.className = 'agent-head';
        const body = document.createElement('div'); body.className = 'agent-body';
        body.style.backgroundColor = AGENT_COLORS[name] || '#00e5ff'; // Цвет из agents.js

        sprite.appendChild(head); sprite.appendChild(body);
        room.appendChild(sprite);
        
        officeSprites[name] = { el: sprite, isWorking: false };
    });

    container.appendChild(room);
}

// Логика случайной ходьбы (запускается каждые 3 секунды)
setInterval(() => {
    if (!isOfficeOpen) return;
    Object.keys(officeSprites).forEach(name => {
        const spriteData = officeSprites[name];
        const sprite = spriteData.el;
        
        // Если агент не работает и не гуляет прямо сейчас, даем ему шанс пойти
        if (!spriteData.isWorking && !sprite.classList.contains('walking')) {
            if (Math.random() < 0.3) { // 30% шанс
                const newX = (15 + Math.random() * 75) + '%';
                const newY = (15 + Math.random() * 75) + '%';
                
                sprite.classList.add('walking');
                sprite.style.left = newX;
                sprite.style.top = newY;
                
                // Убираем анимацию через 2 секунды (пока он идет)
                setTimeout(() => sprite.classList.remove('walking'), 2000); 
            }
        }
    });
}, 3000);
