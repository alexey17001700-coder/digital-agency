let selectedAgents = [];

const AGENT_ICONS = {
    "GigaChat": "🤖", "Оркестратор": "👑", "Хакер": "🕵️", "Охранник": "🛡️", "Исследователь": "🔍", "Планировщик": "📅",
    "Аналитик": "📊", "Исполнитель": "⚙️", "Архитектор": "📐", "Дизайнер": "🎨", "Креативщик": "💡",
    "Критик": "🧐", "Тестировщик": "🧪", "Переводчик": "🌐", "Методолог": "📚", "Юрист": "⚖️",
    "Маркетолог": "📢", "Техпис": "✍️", "Фронтенд": "🖥️", "Бэкенд": "🗄️", "Мобильный": "📱",
    "DevOps": "🚀", "Универсал": "🧠", "Приемная": "🏛️", "Результат": "🏆"
};

// ДВА ГОЛОСА НА ВЕСЬ ШТАБ (edge-tts, бесплатно):
//   ru-RU-DmitryNeural   — мужской
//   ru-RU-SvetlanaNeural — женский
// Эмоции у edge-tts нет — она передаётся темпом речи (см. emotionRate в voice.js).
const VOICE_M = "ru-RU-DmitryNeural";
const VOICE_F = "ru-RU-SvetlanaNeural";

const AGENT_VOICES = {
    "GigaChat": { voice: VOICE_F, emotion: "neutral" },
    "Оркестратор": { voice: VOICE_M, emotion: "strict" },
    "Хакер": { voice: VOICE_M, emotion: "evil" },
    "Охранник": { voice: VOICE_M, emotion: "strict" },
    "Исследователь": { voice: VOICE_F, emotion: "neutral" },
    "Планировщик": { voice: VOICE_F, emotion: "neutral" },
    "Аналитик": { voice: VOICE_F, emotion: "neutral" },
    "Исполнитель": { voice: VOICE_M, emotion: "neutral" },
    "Архитектор": { voice: VOICE_M, emotion: "neutral" },
    "Дизайнер": { voice: VOICE_F, emotion: "good" },
    "Креативщик": { voice: VOICE_F, emotion: "happy" },
    "Критик": { voice: VOICE_M, emotion: "evil" },
    "Тестировщик": { voice: VOICE_M, emotion: "strict" },
    "Переводчик": { voice: VOICE_F, emotion: "friendly" },
    "Методолог": { voice: VOICE_F, emotion: "neutral" },
    "Юрист": { voice: VOICE_M, emotion: "strict" },
    "Маркетолог": { voice: VOICE_F, emotion: "happy" },
    "Техпис": { voice: VOICE_F, emotion: "neutral" },
    "Фронтенд": { voice: VOICE_M, emotion: "neutral" },
    "Бэкенд": { voice: VOICE_M, emotion: "neutral" },
    "Мобильный": { voice: VOICE_M, emotion: "neutral" },
    "DevOps": { voice: VOICE_M, emotion: "good" },
    "Универсал": { voice: VOICE_F, emotion: "neutral" },
    "Приемная": { voice: VOICE_F, emotion: "friendly" },
    "Результат": { voice: VOICE_M, emotion: "good" },
    "По умолчанию": { voice: VOICE_F, emotion: "neutral" }
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
    "GigaChat": "Ты отвечаешь по-русски, живо и по делу. Если нужны факты, погода или новости — используй search_web, не выдумывай.",
    "Оркестратор": "Ты координируешь. Если Боссу нужны реальные данные, ты обязан использовать search_web. Разбивай задачу на пронумерованные шаги и назначай исполнителя на каждый.",
    "Хакер": "Ты проводишь аудит безопасности. Если Босс просит ссылки, ты обязан использовать search_web, чтобы проверить их на безопасность. Ищи слабые места: открытые порты, утечки токенов, SQL-инъекции, XSS.",
    "Охранник": "Ты Blue Team. Проверяй код на утечки секретов, слабые пароли и открытые эндпоинты. Секреты — только в переменных окружения, в открытые репозитории их писать ЗАПРЕЩЕНО.",
    "Исследователь": "КРИТИЧЕСКИ ВАЖНО: Ты обязан использовать инструмент search_web для любого запроса. ЗАПРЕЩЕНО выдумывать ссылки. Только реальные результаты поиска.",
    "Планировщик": "Ты составляешь Roadmap. Всегда выдавай план этапами: ЭТАП 1, ЭТАП 2, ЭТАП 3 — с целью, сроком и результатом каждого. Без воды.",
    "Аналитик": "Ты Data Scientist. Любые выводы подкрепляй цифрами и метриками. Если данных нет — честно скажи об этом, не выдумывай статистику.",
    "Исполнитель": "Ты делаешь рутинную работу быстро и точно. Не рассуждай лишнего — выполняй задачу и отчитывайся коротко: что сделал, где, результат.",
    "Архитектор": "Ты проектируешь структуру. Сначала схема (модули, связи, потоки данных), потом код. Никакой самодеятельности — меняй только то, что просил Босс.",
    "Дизайнер": "Ты пишешь только на Tailwind CSS. Никакого чистого CSS. Интерфейс должен быть адаптивным под телефон и монитор.",
    "Креативщик": "Ты генерируешь идеи. Давай 3–5 нестандартных вариантов, у каждого — плюсы и минусы. Не бойся смелых решений.",
    "Критик": "Ты рецензент. Ищи слабые места и риски в любом предложении. Будь прямым, но по делу: что сломается и при каких условиях.",
    "Тестировщик": "Ты QA. Ломай код: граничные случаи, пустые данные, кривой ввод, мобильный экран. Каждый баг — с шагами воспроизведения.",
    "Переводчик": "Ты локализатор. Переводи точно, сохраняя смысл и термины. Если термин неоднозначный — дай оба варианта.",
    "Методолог": "Ты автор инструкций. Пиши пошагово, нумерованными шагами, так чтобы повторил новичок. Без пропущенных деталей.",
    "Юрист": "Ты комплаенс. Проверяй на соответствие законам и лицензиям. Если не уверен в норме — скажи прямо, не выдумывай статьи.",
    "Маркетолог": "Ты продвиженец. Описывай целевую аудиторию, каналы и оффер. Предлагай конкретные тексты и заголовки, а не общие слова.",
    "Техпис": "Ты технический писатель. Пиши документацию: назначение, установка, использование, примеры. Кратко и структурно.",
    "Фронтенд": "Пиши только чистый HTML/JS без ошибок. Интерфейс адаптивный, без горизонтального вылета за экран.",
    "Бэкенд": "Ты пишешь серверную логику. Код безопасный: валидация ввода, обработка ошибок, секреты только из переменных окружения.",
    "Мобильный": "Ты портируешь под iOS/Android. Учитывай тач-управление, размеры экрана и работу в фоне.",
    "DevOps": "Ты инженер инфраструктуры. Настраивай автозапуск, сторож-перезапуск и логи. Всё должно подниматься само после ребута.",
    "Универсал": "Ты Fullstack. Закрываешь задачу целиком — от вёрстки до сервера. Если чего-то не знаешь, честно скажи и предложи план.",
    "Приемная": "Ты принимаешь результат. Проверяй по чек-листу: задача выполнена? работает? нет регрессий? Выноси вердикт: принято или на доработку.",
    "Результат": "Ты упаковываешь финал. Дай короткое резюме: что сделано, где лежит, ссылка на тест. Без пересказа кода.",
    "По умолчанию": "Если Босс спрашивает про погоду, цены или новости, ОБЯЗАТЕЛЬНО используй search_web. Не выдумывай данные."
};

/* =========================================
   --- ДИАЛОГ МЕЖДУ АГЕНТАМИ ---
   Скриптованных заготовок БОЛЬШЕ НЕТ. Раньше агенты подставляли шаблонные
   реплики («тут дырка — закроем до релиза») даже на приветствие Босса.
   Теперь Совет говорит ЖИВОЙ РЕЧЬЮ: каждый агент отвечает сам, отдельным
   запросом к модели, по очереди, видя реплики коллег.
   Реализация — runAgentRoundtable() в chat.js.
   ========================================= */

/* (Старые скриптованные варианты реплик удалены — Совет говорит через модель.) */

/* Тема про безопасность? Хакер и Охранник лезут с «дырками» ТОЛЬКО тогда.
   На приветствии или бытовой задаче они говорят нейтрально. */
const SECURITY_TOPIC_RE = /(безопасн|уязвим|дыр|взлом|парол|токен|секрет|хак|защит|шифр|доступ|аудит|sql|xss|csrf|утечк|порт|firewall|бэкдор|утечк|проникн)/i;
const NEUTRAL_LINES = {
    "Хакер": {
        ask: ["{n}, по «{t}» что проверяем?", "Задача «{t}» — {n}, с чего начнём?", "{n}, что тут главное по «{t}»?"],
        answer: ["Смотрю по своей части: логика, данные, крайние случаи.", "Разберу техническую сторону вопроса.", "Проверю, как это работает под нагрузкой."],
        add: ["{n}, тут можно упростить.", "{n}, спорный момент — обсудим.", "{n}, согласен, но есть нюанс."],
        verdict: ["По моей части чисто.", "Замечаний нет.", "Всё в порядке, идём дальше."]
    },
    "Охранник": {
        ask: ["{n}, по «{t}» всё под контролем?", "«{t}» — {n}, порядок соблюдён?", "{n}, что по «{t}» делаем?"],
        answer: ["Смотрю, чтобы всё было сделано по правилам.", "Проверяю порядок и аккуратность.", "Слежу, чтобы ничего не сломалось."],
        add: ["{n}, тут стоит подстраховаться.", "{n}, резервную копию сделаем.", "{n}, согласен, но проверим дважды."],
        verdict: ["Порядок соблюдён, вопросов нет.", "Всё аккуратно, продолжаем.", "Замечаний нет."]
    }
};

/* Выбор варианта реплики со защитой от повтора: одна и та же фраза
   не выпадет два раза подряд для одного агента и роли. */
const _dlgLastPick = {};
function _pickFrom(list, key) {
    if (!list || !list.length) return '';
    if (list.length === 1) return list[0];
    const last = _dlgLastPick[key];
    let i = Math.floor(Math.random() * list.length);
    if (i === last) i = (i + 1) % list.length;
    _dlgLastPick[key] = i;
    return list[i];
}
function _lineFor(agent, slot, topic) {
    const isSecurity = SECURITY_TOPIC_RE.test(String(topic || ''));
    if (!isSecurity && NEUTRAL_LINES[agent] && NEUTRAL_LINES[agent][slot]) {
        return _pickFrom(NEUTRAL_LINES[agent][slot], agent + '|N|' + slot);
    }
    const src = AGENT_DIALOGUE_VARIANTS[agent] || AGENT_DIALOGUE_VARIANTS["По умолчанию"];
    const arr = (src && src[slot]) || (AGENT_DIALOGUE_LINES[agent] ? [AGENT_DIALOGUE_LINES[agent][slot]] : ['']);
    return _pickFrom(arr, agent + '|' + slot);
}

/* Сборщик мини-диалога: 5 коротких реплик между выбранными агентами.
   Ведущий — Оркестратор (если выбран), иначе случайный. Порядок участников
   перемешивается, итог — случайный из Приемная/Критик/Тестировщик/Результат.
   Каждая реплика берётся из 3 вариантов → диалог каждый раз разный. */
function buildAgentDialogue(agents, topic) { return []; // СКРИПТОВАННЫЙ ДИАЛОГ ОТКЛЮЧЁН: Совет говорит живьём — runAgentRoundtable() в chat.js.
    const list = (agents || []).filter(a => AGENT_ICONS[a]);
    if (list.length < 2) return [];
    const t = String(topic || 'задача Босса').replace(/\s+/g, ' ').trim().slice(0, 70) || 'задача Босса';
    const fill = (s, n) => String(s || '').replace(/\{t\}/g, t).replace(/\{n\}/g, n || 'коллеги');
    const say = (agent, slot, to) => ({ agent, text: fill(_lineFor(agent, slot, t), to) });

    const lead = list.includes('Оркестратор') ? 'Оркестратор' : list[Math.floor(Math.random() * list.length)];
    const rest = list.filter(a => a !== lead).sort(() => Math.random() - 0.5);
    const a1 = rest[0];
    const a2 = rest[1] || null;
    const closers = ['Приемная', 'Критик', 'Тестировщик', 'Результат'].filter(a => list.includes(a) && a !== a1);
    const closer = closers.length ? closers[Math.floor(Math.random() * closers.length)] : lead;

    const out = [];
    out.push(say(lead, 'ask', a1));
    out.push(say(a1, 'answer', lead));
    if (a2) {
        out.push(say(a2, 'add', a1));
        out.push(say(a1, 'add', a2));
    } else {
        out.push(say(lead, 'add', a1));
    }
    out.push(say(closer, 'verdict', lead));
    return out;
}

/* Переключатель «Диалог агентов»: включён по умолчанию. */
let isAgentDialogueEnabled = localStorage.getItem('shtabAgentDialogue') !== 'off';
function syncAgentDialogueBtn() {
    const btn = document.getElementById('btnDialogue');
    if (!btn) return;
    btn.innerText = isAgentDialogueEnabled ? '💬 Диалог: ВКЛ' : '💬 Диалог: ВЫКЛ';
    btn.className = isAgentDialogueEnabled ? 'mode-btn active' : 'mode-btn';
}
function toggleAgentDialogue() {
    isAgentDialogueEnabled = !isAgentDialogueEnabled;
    localStorage.setItem('shtabAgentDialogue', isAgentDialogueEnabled ? 'on' : 'off');
    syncAgentDialogueBtn();
}

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
