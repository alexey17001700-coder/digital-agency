// local_ai.js

const BRAIN_VERSION = "13.0"; 

// Базовая память (Граф Знаний)
// Формат: "сущность": { "свойство": "значение" }
let KNOWLEDGE_GRAPH = {
    "привет": { "тип": "приветствие" },
    "пушкин": { "профессия": "поэт", "описание": "великий русский поэт" },
    "илон маск": { "профессия": "предприниматель", "компания": "spacex" },
    "spacex": { "деятельность": "космические полеты" }
};

let lastCity = localStorage.getItem('shtabLastCity') || "Москва";
let chatContext = []; // Контекст беседы

// Загрузка графа из памяти
const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalKG');
    localStorage.removeItem('shtabContext');
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    const savedKG = localStorage.getItem('shtabLocalKG');
    if (savedKG) KNOWLEDGE_GRAPH = JSON.parse(savedKG);
} catch(e) { console.error("Ошибка загрузки KG", e); }

function saveKG() {
    localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH));
}

// Загрузка контекста за 24 часа
try {
    const savedContext = localStorage.getItem('shtabContext');
    if (savedContext) {
        const parsed = JSON.parse(savedContext);
        const now = Date.now();
        chatContext = parsed.filter(c => now - c.timestamp < 24 * 60 * 60 * 1000);
    }
} catch(e) { }

function updateContext(role, text) {
    chatContext.push({ role: role, text: text.toLowerCase(), timestamp: Date.now() });
    if (chatContext.length > 100) chatContext.shift();
    localStorage.setItem('shtabContext', JSON.stringify(chatContext));
}

// === АЛГОРИТМ ЛЕВЕНШТЕЙНА (Нечеткий поиск слов) ===
// Позволяет находить слова, даже если в них есть опечатка или другое окончание
function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // замена
                    matrix[i][j - 1] + 1,     // вставка
                    matrix[i - 1][j] + 1      // удаление
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Поиск наилучшего совпадения в графе
function findEntity(word) {
    let bestMatch = null;
    let minDistance = 999;
    
    for (const entity of Object.keys(KNOWLEDGE_GRAPH)) {
        // Прямое совпадение
        if (entity.includes(word) || word.includes(entity)) return entity;
        
        // Нечеткое совпадение (расстояние <= 2 символа)
        const dist = levenshtein(word.toLowerCase(), entity.toLowerCase());
        if (dist < minDistance && dist <= 2) {
            minDistance = dist;
            bestMatch = entity;
        }
    }
    return bestMatch;
}

function getKeywords(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит'];
    return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.includes(word));
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    updateContext("user", msg);

    // === 1. ПОГОДА ===
    if (/погод|градус|температур|на завтра/i.test(msg)) {
        let isTomorrow = /завтра/i.test(msg);
        let cleanText = msg.replace(/[?.!,]/g, '').replace(/(?:что|думаешь|насчет|расскажи|какая|какой|узнай|найди|покажи|сейчас)?\s*(?:погода|погоды|погоду|погоде)\s*(?:в|во|на)?\s*/gi, '').replace(/(?:в|во|на)\s*/gi, '');
        let city = cleanText.trim() || lastCity;
        localStorage.setItem('shtabLastCity', city);

        const weatherRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }),
            signal: signal
        });
        if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
        const weatherData = await weatherRes.json();
        
        if (weatherData.success) {
            let ans = `🌤️ Данные из сети: ${weatherData.results}`;
            updateContext("assistant", ans);
            return ans;
        }
        return `Не удалось получить данные о погоде.`;
    } 

    // === 2. ОБУЧЕНИЕ (Парсер сущностей) ===
    // Ищем паттерны: "X это Y", "X - Y", "X является Y"
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    if (teachMatch) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '');
        
        // Создаем сущность в графе, если её нет
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        
        // Определяем свойство (пока просто пихаем в "описание" или пытаемся угадать)
        if (fact.includes("поэт") || fact.includes("писатель")) KNOWLEDGE_GRAPH[subject]["профессия"] = fact;
        else if (fact.includes("предприниматель") || fact.includes("бизнесмен")) KNOWLEDGE_GRAPH[subject]["профессия"] = fact;
        else KNOWLEDGE_GRAPH[subject]["описание"] = fact;
        
        saveKG();
        return `🧠 Обновил граф знаний. Сущность "${subject}" теперь имеет свойство: ${fact}.`;
    }

    // === 3. ПОИСК В ГРАФЕ (Ассоциативный) ===
    const keywords = getKeywords(msg);
    const isQuestion = msg.includes('?') || /^(кто|что|где|когда|как|почему|зачем|какой|какая|какие|сколько)/i.test(msg);

    if (keywords.length > 0 && isQuestion) {
        let foundEntities = [];
        
        // Ищем сущности по ключевым словам (с учетом опечаток)
        for (const kw of keywords) {
            const entity = findEntity(kw);
            if (entity && !foundEntities.includes(entity)) foundEntities.push(entity);
        }

        if (foundEntities.length > 0) {
            let answers = [];
            // Собираем факты о найденных сущностях
            for (const entity of foundEntities) {
                const properties = KNOWLEDGE_GRAPH[entity];
                for (const [key, value] of Object.entries(properties)) {
                    if (key === "описание" || key === "профессия" || key === "деятельность") {
                        answers.push(`${entity.charAt(0).toUpperCase() + entity.slice(1)} — ${value}`);
                    } else {
                        answers.push(`${entity.charAt(0).toUpperCase() + entity.slice(1)} (${key}): ${value}`);
                    }
                }
            }
            
            // Если нашли инфу, выдаем её (генерация по шаблону)
            if (answers.length > 0) {
                let finalAns = `🧠 Из графа знаний: ${answers.join('. ')}.`;
                updateContext("assistant", finalAns);
                return finalAns;
            }
        }
    }

    // === 4. БАЗОВЫЕ ФРАЗЫ (Приветствия) ===
    for (const [key, data] of Object.entries(KNOWLEDGE_GRAPH)) {
        if (msg === key || (msg.length < 15 && msg.includes(key) && data["тип"] === "приветствие")) {
             return "Привет, Босс! Чем займемся?";
        }
    }

    // === 5. ИНТЕРНЕТ (Если граф пуст) ===
    try {
        let searchQuery = keywords.join(' '); 
        if (!searchQuery) searchQuery = msg.replace(/[?.!]/g, '');

        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        
        if (searchData.success && searchData.results) {
            let rawText = searchData.results.substring(0, 300);
            if (searchData.results.length > 300) rawText += "...";
            let cleanFact = rawText.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/^-\s*/, '').trim();
            
            // СОХРАНЯЕМ В ГРАФ (как "описание" сущности)
            const mainSubject = keywords[0] || msg;
            if (!KNOWLEDGE_GRAPH[mainSubject]) KNOWLEDGE_GRAPH[mainSubject] = {};
            KNOWLEDGE_GRAPH[mainSubject]["описание"] = cleanFact;
            saveKG();

            let finalAnswer = `🔎 Я сходил в интернет и обновил граф знаний: ${cleanFact}`;
            updateContext("assistant", finalAnswer);
            return finalAnswer;
        } else {
            return `Я проверил интернет, но не нашел информации.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка сети: ${e.message}`;
    }
}
