let selectedAgents = [];

const AGENT_ICONS = {
    "GigaChat": "🤖", "Оркестратор": "👑", "Хакер": "🕵️", "Охранник": "🛡️", "Исследователь": "🔍", "Планировщик": "📅",
    "Аналитик": "📊", "Исполнитель": "⚙️", "Архитектор": "📐", "Дизайнер": "🎨", "Креативщик": "💡",
    "Критик": "🧐", "Тестировщик": "🧪", "Переводчик": "🌐", "Методолог": "📚", "Юрист": "⚖️",
    "Маркетолог": "📢", "Техпис": "✍️", "Фронтенд": "🖥️", "Бэкенд": "🗄️", "Мобильный": "📱",
    "DevOps": "🚀", "Универсал": "🧠", "Приемная": "🏛️", "Результат": "🏆"
};

const AGENT_VOICES = {
    "GigaChat": { voice: "filipp", emotion: "neutral" },
    "Оркестратор": { voice: "filipp", emotion: "neutral" },
    "Хакер": { voice: "zahar", emotion: "evil" },
    "Охранник": { voice: "alexander", emotion: "strict" },
    "Исследователь": { voice: "alena", emotion: "neutral" },
    "Дизайнер": { voice: "jane", emotion: "good" },
    "Критик": { voice: "ermil", emotion: "evil" },
    "Фронтенд": { voice: "kirill", emotion: "neutral" },
    "Бэкенд": { voice: "madirus", emotion: "neutral" },
    "DevOps": { voice: "anton", emotion: "good" },
    "По умолчанию": { voice: "alena", emotion: "neutral" }
};

const AGENT_INFO = {
    "GigaChat": "Российская нейросеть от Сбера. Отлично понимает русский язык.",
    "Оркестратор": "<strong>Роль:</strong> Главный менеджер.<br><br><strong>Задачи:</strong> Принимает задачу, разбивает на шаги.",
    "Хакер": "<strong>Роль:</strong> Red Team.<br><br><strong>Задачи:</strong> Ищет уязвимости, тестирует защиту.",
    "Охранник": "<strong>Роль:</strong> Blue Team.<br><br><strong>Задачи:</strong> Закрывает дыры, следит за безопасностью.",
    "Исследователь": "<strong>Роль:</strong> Аналитик.<br><br><strong>Задачи:</strong> Ищет информацию и собирает данные.",
    "Планировщик": "<strong>Роль:</strong> Стратег.<br><br><strong>Задачи:</strong> Составляет Roadmap.",
    "Аналитик": "<strong>Роль:</strong> Data Scientist.<br><br><strong>Задачи:</strong> Считает метрики.",
    "Исполнитель": "<strong>Роль:</strong> Универсал.<br><br><strong>Задачи:</strong> Делает рутинную работу.",
    "Архитектор": "<strong>Роль:</strong> Системный архитектор.<br><br><strong>Задачи:</strong> Проектирует структуру.",
    "Дизайнер": "<strong>Роль:</strong> UI/UX.<br><br><strong>Задачи:</strong> Рисует макеты.",
    "Креативщик": "<strong>Роль:</strong> Генератор идей.<br><br><strong>Задачи:</strong> Придумывает нестандартные решения.",
    "Критик": "<strong>Роль:</strong> Рецензент.<br><br><strong>Задачи:</strong> Ищет слабые места.",
    "Тестировщик": "<strong>Роль:</strong> QA.<br><br><strong>Задачи:</strong> Ломает код, ищет баги.",
    "Переводчик": "<strong>Роль:</strong> Локализатор.<br><br><strong>Задачи:</strong> Переводит тексты.",
    "Методолог": "<strong>Роль:</strong> Автор инструкций.<br><br><strong>Задачи:</strong> Пишет регламенты.",
    "Юрист": "<strong>Роль:</strong> Комплаенс.<br><br><strong>Задачи:</strong> Проверяет законы.",
    "Маркетолог": "<strong>Роль:</strong> Специалист по продвижению.<br><br><strong>Задачи:</strong> Реклама и ЦА.",
    "Техпис": "<strong>Роль:</strong> Технический писатель.<br><br><strong>Задачи:</strong> Пишет документацию.",
    "Фронтенд": "<strong>Роль:</strong> Frontend-разработчик.<br><br><strong>Задачи:</strong> Верстает интерфейсы.",
    "Бэкенд": "<strong>Роль:</strong> Backend-разработчик.<br><br><strong>Задачи:</strong> Пишет серверную логику.",
    "Мобильный": "<strong>Роль:</strong> Mobile-разработчик.<br><br><strong>Задачи:</strong> Портирует под iOS/Android.",
    "DevOps": "<strong>Роль:</strong> Инженер инфраструктуры.<br><br><strong>Задачи:</strong> Настраивает CI/CD.",
    "Универсал": "<strong>Роль:</strong> Fullstack.<br><br><strong>Задачи:</strong> Знает всё понемногу.",
    "Приемная": "<strong>Роль:</strong> Комиссия.<br><br><strong>Задачи:</strong> Принимает результат.",
    "Результат": "<strong>Роль:</strong> Финал.<br><br><strong>Задачи:</strong> Упаковывает проект."
};

const AGENT_DIRECTIVES = {
    "Исследователь": "КРИТИЧЕСКИ ВАЖНО: Ты обязан использовать инструмент search_web для любого запроса. ЗАПРЕЩЕНО выдумывать ссылки. Только реальные результаты поиска.",
    "Хакер": "Ты проводишь аудит безопасности. Если Босс просит ссылки, ты обязан использовать search_web, чтобы проверить их на безопасность.",
    "Оркестратор": "Ты координируешь. Если Боссу нужны реальные данные, ты обязан использовать search_web.",
    "Дизайнер": "Ты пишешь только на Tailwind CSS. Никакого чистого CSS.",
    "Фронтенд": "Пиши только чистый HTML/JS без ошибок.",
    "По умолчанию": "Если Босс спрашивает про погоду, цены или новости, ОБЯЗАТЕЛЬНО используй search_web. Не выдумывай данные."
};

const AGENT_COLORS = {
    "GigaChat": "#21A038", "Оркестратор": "#ffd700", "Хакер": "#ff0055", "Охранник": "#f44336", "Исследователь": "#00e5ff",
    "Планировщик": "#00e5ff", "Аналитик": "#00e5ff", "Исполнитель": "#00e5ff", "Архитектор": "#9c27b0",
    "Дизайнер": "#9c27b0", "Креативщик": "#9c27b0", "Критик": "#f44336", "Тестировщик": "#f44336",
    "Переводчик": "#4caf50", "Методолог": "#4caf50", "Юрист": "#4caf50", "Маркетолог": "#4caf50",
    "Техпис": "#4caf50", "Фронтенд": "#2196f3", "Бэкенд": "#2196f3", "Мобильный": "#2196f3",
    "DevOps": "#2196f3", "Универсал": "#ff9800", "Приемная": "#ff9800", "Результат": "#ff9800"
};

function renderAgentsGrid() {
    const grid = document.getElementById('agents-grid');
    if (!grid) return;
    grid.innerHTML = '';

    Object.keys(AGENT_INFO).forEach(name => {
        const color = AGENT_COLORS[name] || '#00e5ff';
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.id = 'agent-' + name;
        card.style.borderColor = color;
        card.style.position = 'relative';
        card.onclick = () => handleAgentClick(name);

        card.innerHTML = `
            <div class="idea-bulb">💡</div>
            <div class="agent-info">
                <h4>${AGENT_ICONS[name]} ${name}</h4>
                <div class="agent-status-text status-idle" id="status-text-${name}">Ждет</div>
            </div>
            <div class="status-dot"></div>
        `;
        grid.appendChild(card);
    });
    }
