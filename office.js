let isOfficeOpen = false;

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

    const room = document.createElement('div');
    room.className = 'office-room';
    
    const wallTop = document.createElement('div');
    wallTop.className = 'office-wall-top';
    const wallLeft = document.createElement('div');
    wallLeft.className = 'office-wall-left';
    room.appendChild(wallTop);
    room.appendChild(wallLeft);

    // Столы (9 штук сеткой)
    const deskPositions = [
        { top: '15%', left: '20%' }, { top: '15%', left: '45%' }, { top: '15%', left: '70%' },
        { top: '45%', left: '20%' }, { top: '45%', left: '45%' }, { top: '45%', left: '70%' },
        { top: '75%', left: '20%' }, { top: '75%', left: '45%' }, { top: '75%', left: '70%' }
    ];

    deskPositions.forEach(pos => {
        const desk = document.createElement('div');
        desk.className = 'desk';
        desk.style.top = pos.top;
        desk.style.left = pos.left;
        desk.innerHTML = '<div class="desk-monitor"></div><div class="desk-pc"></div>';
        room.appendChild(desk);
    });

    // Декор
    const cooler = document.createElement('div');
    cooler.className = 'water-cooler';
    cooler.style.top = '85%';
    cooler.style.left = '5%';
    room.appendChild(cooler);

    const plant = document.createElement('div');
    plant.className = 'plant';
    plant.style.top = '10%';
    plant.style.left = '5%';
    room.appendChild(plant);

    container.appendChild(room);
                                   }
