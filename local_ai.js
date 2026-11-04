// local_ai.js
const BRAIN_VERSION = "19.1"; 
const MAX_CONTEXT = 20;

let KNOWLEDGE_GRAPH = {
    "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] },
    "онегин": { "тип": ["произведение"] }
};

let CONTEXT_MEMORY = []; 
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";

const CODE_GENERATORS = {
    "змейка": (color = "green") => `<canvas id="game" width="400" height="400" style="border: 2px solid ${color};"></canvas>\n<script>/* Логика змейки */</script>`,
    "калькулятор": (theme = "dark") => `<div style="background: ${theme === 'dark' ? '#333' : '#fff'};"><input type="text" readonly><button>1</button></div>`
};

const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalKG'); 
    localStorage.removeItem('shtabContext'); 
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    if (localStorage.getItem('shtabLocalKG')) KNOWLEDGE_GRAPH = JSON.parse(localStorage.getItem('shtabLocalKG'));
    if (localStorage.getItem('shtabContext')) CONTEXT_MEMORY = JSON.parse(localStorage.getItem('shtabContext'));
} catch(e) {}

function saveBrain() { localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH)); }
function saveContext() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

function updateContext(role, text, entities = []) {
    CONTEXT_MEMORY.push({ role, text: text.toLowerCase(), entities, timestamp: Date.now() });
    if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
    saveContext();
}

// --- СЛОЙ МАТЕМАТИКИ (Embedding & Attention) ---
function getVocab() {
    let vocab = new Set(["поэт", "автор", "произведение", "привет", "погода"]);
    Object.keys(KNOWLEDGE_GRAPH).forEach(k => vocab.add(k));
    return Array.from(vocab);
}

function textToVector(text) {
    const vocab = getVocab();
    const vector = new Array(vocab.length).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    words.forEach(word => {
        vocab.forEach((v, i) => {
            if (word.includes(v) || v.includes(word)) vector[i] = 1;
        });
    });
    return vector;
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]; 
        normA += vecA[i] * vecA[i]; 
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mathSearch(query) {
    const queryVec = textToVector(query);
    let bestMatch = null; let highestScore = 0;

    for (const [entity, relations] of Object.entries(KNOWLEDGE_GRAPH)) {
        for (const [rel, objects] of Object.entries(relations)) {
            if (rel === "тип") continue;
            objects.forEach(obj => {
                const score = cosineSimilarity(queryVec, textToVector(`${entity} ${rel} ${obj}`));
                if (score > highestScore && score > 0.4) {
                    highestScore = score;
                    bestMatch = `[Совпадение ${Math.round(score*100)}%] ${entity.charAt(0).toUpperCase() + entity.slice(1)} — ${rel}: ${obj}`;
                }
            });
        }
    }
    return bestMatch;
}

function extractTokens(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит', 'давай', 'напиши', 'создай', 'сделай'];
    return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    const tokens = extractTokens(msg);

    // --- СЛОЙ 0: РЕФЛЕКСЫ ---
    if (/^(привет|куку|здорово|хай|приветствую|здравствуй)/i.test(msg)) {
        const ans = "Привет, Босс! На связи. Готов к новым задачам. Чем займемся?";
        updateContext('assistant', ans);
        return ans;
    }
    if (/как дела|как ты/i.test(msg)) return "Все системы в норме. Как ваши дела, Босс?";
    if (/спасибо|благодарю/i.test(msg)) return "Всегда пожалуйста! Рад помочь.";

    // --- СЛОЙ УТОЧНЕНИЙ (Короткие вопросы к предыдущей теме) ---
    const isShortQuestion = msg.length < 20 && (msg.includes('?') || /^(это|а|и)\s/i.test(msg));
    if (isShortQuestion && CONTEXT_MEMORY.length > 0) {
        // Ищем последнее упоминание погоды в контексте
        const weatherContext = [...CONTEXT_MEMORY].reverse().find(c => c.text.includes("погод") || c.text.includes("градус") || c.text.includes("температур"));
        if (weatherContext) {
            let isTomorrow = /завтра/i.test(msg);
            // Пытаемся найти город в старых сообщениях
            let contextCity = lastCity;
            const cityMatch = weatherContext.text.match(/(?:погода|погоду)(?:\s+в|\s+во)?\s+([а-яёa-z\-]+)/i);
            if (cityMatch) contextCity = cityMatch[1];
            
            try {
                const weatherRes = await fetch(proxyUrl, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ weatherQuery: contextCity, day: isTomorrow ? 1 : 0 }),
                    signal: signal
                });
                const weatherData = await weatherRes.json();
                if (weatherData.success) {
                    let ans = `🌤️ Данные из сети (${isTomorrow ? 'на завтра' : 'сейчас'}) для ${contextCity}: ${weatherData.results}`;
                    updateContext('assistant', ans);
                    return ans;
                }
            } catch(e) {}
        }
    }

    // --- СЛОЙ 1: ПОГОДА ---
    if (/погод|градус|температур/i.test(msg)) {
        let isTomorrow = /завтра/i.test(msg);
        let cleanText = msg.replace(/[?.!,]/g, '').replace(/(?:что|думаешь|насчет|расскажи|какая|какой|узнай|найди|покажи|сейчас)?\s*(?:погода|погоды|погоду|погоде)\s*(?:в|во|на)?\s*/gi, '').replace(/(?:в|во|на)\s*/gi, '');
        let city = cleanText.trim() || lastCity;
        localStorage.setItem('shtabLastCity', city);

        try {
            const weatherRes = await fetch(proxyUrl, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }),
                signal: signal
            });
            const weatherData = await weatherRes.json();
            if (weatherData.success) {
                let ans = `🌤️ Данные из сети: ${weatherData.results}`;
                updateContext('user', msg, [city]);
                updateContext('assistant', ans);
                return ans;
            }
        } catch(e) { return `Не удалось получить данные о погоде.`; }
    }

    // --- СЛОЙ 2: ГЕНЕРАТОР КОДА ---
    if (/напиши|создай/i.test(msg) && /код|скрипт/i.test(msg)) {
        let target = null;
        if (msg.includes("змейк")) target = "змейка";
        if (msg.includes("калькулятор")) target = "калькулятор";
        if (target && CODE_GENERATORS[target]) {
            let color = msg.includes("красн") ? "red" : "green";
            return `💻 **Генератор кода:**\n\n\`\`\`html\n${CODE_GENERATORS[target](color)}\n\`\`\``;
        }
        return `💻 Босс, я могу написать код для: ${Object.keys(CODE_GENERATORS).join(', ')}.`;
    }

    // --- СЛОЙ 3: ОБУЧЕНИЕ (Граф Знаний) ---
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    if (teachMatch && !msg.includes('?')) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '').toLowerCase();
        
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        let relation = fact.includes("поэт") || fact.includes("писатель") ? "профессия" : "описание";
        
        if (!KNOWLEDGE_GRAPH[subject][relation]) KNOWLEDGE_GRAPH[subject][relation] = [];
        if (!KNOWLEDGE_GRAPH[subject][relation].includes(fact)) KNOWLEDGE_GRAPH[subject][relation].push(fact);
        
        saveBrain();
        updateContext('user', msg, [subject]);
        return `🧠 **Слой обучения:** Запомнил, что "${subject}" — это "${fact}".`;
    }

    // --- СЛОЙ 4: МАТЕМАТИЧЕСКИЙ ПОИСК ---
    const mathResult = mathSearch(msg);
    if (mathResult && (msg.includes('?') || /^(кто|что|где|когда)/i.test(msg))) {
        updateContext('user', msg);
        let ans = `🧮 **Математический слой (Attention):**\n${mathResult}`;
        updateContext('assistant', ans);
        return ans;
    }

    // --- СЛОЙ 5: КОНТЕКСТ ---
    if (msg.includes('?') && CONTEXT_MEMORY.length > 0) {
        let lastEntity = null;
        for (let i = CONTEXT_MEMORY.length - 1; i >= 0; i--) {
            if (CONTEXT_MEMORY[i].entities && CONTEXT_MEMORY[i].entities.length > 0) {
                lastEntity = CONTEXT_MEMORY[i].entities[0]; break;
            }
        }
        if (lastEntity && KNOWLEDGE_GRAPH[lastEntity]) {
            let ans = `🧠 **Слой контекста:** Мы говорили про "${lastEntity}". Что именно вас интересует?`;
            updateContext('assistant', ans);
            return ans;
        }
    }

    // --- СЛОЙ 6: ПОИСК В ИНТЕРНЕТЕ ---
    try {
        const searchQuery = tokens.join(' ') || msg;
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        const searchData = await searchRes.json();
        if (searchData.success && searchData.results) {
            let cleanFact = searchData.results.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/^-\s*/, '').trim().substring(0, 200) + "...";
            
            const mainSubject = tokens[0] || "информация";
            if (!KNOWLEDGE_GRAPH[mainSubject]) KNOWLEDGE_GRAPH[mainSubject] = {};
            if (!KNOWLEDGE_GRAPH[mainSubject]["из_интернета"]) KNOWLEDGE_GRAPH[mainSubject]["из_интернета"] = [];
            KNOWLEDGE_GRAPH[mainSubject]["из_интернета"].push(cleanFact);
            saveBrain();
            
            updateContext('user', msg, [mainSubject]);
            let ans = `🔎 **Слой поиска (Из сети):** ${cleanFact}\n\n*[Добавлено в память]*`;
            updateContext('assistant', ans);
            return ans;
        }
        return `❌ Я проанализировал запрос, но в памяти и в сети нет ответа.`;
    } catch (e) {
        return `❌ Ошибка Сети: ${e.message}`;
    }
}
