// local_ai.js
const BRAIN_VERSION = "18.0"; 
const MAX_CONTEXT = 20;

// База знаний (остается как текст, но теперь мы будем считать к ней векторы)
let KNOWLEDGE_GRAPH = {
    "привет": { "тип": ["приветствие"] },
    "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] },
    "онегин": { "тип": ["произведение"] }
};

let CONTEXT_MEMORY = []; 

const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalKG'); localStorage.removeItem('shtabContext'); localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    if (localStorage.getItem('shtabLocalKG')) KNOWLEDGE_GRAPH = JSON.parse(localStorage.getItem('shtabLocalKG'));
    if (localStorage.getItem('shtabContext')) CONTEXT_MEMORY = JSON.parse(localStorage.getItem('shtabContext'));
} catch(e) {}

function saveBrain() { localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH)); }
function saveContext() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

// ==========================================
// МАТЕМАТИЧЕСКИЙ СЛОЙ 1: EMBEDDING (Векторизация)
// Превращаем текст в набор чисел (вектор)
// ==========================================
function textToVector(text) {
    const vocab = ["пушкин", "онегин", "поэт", "автор", "произведение", "привет", "илон", "маск", "космос"];
    const vector = new Array(vocab.length).fill(0);
    const words = text.toLowerCase().split(/\s+/);
    
    words.forEach(word => {
        vocab.forEach((v, i) => {
            // Если слово есть в словаре (или похоже), ставим 1
            if (word.includes(v) || v.includes(word)) vector[i] = 1;
        });
    });
    return vector;
}

// ==========================================
// МАТЕМАТИЧЕСКИЙ СЛОЙ 2: ATTENTION (Косинусное сходство)
// Считаем угол между векторами (насколько они близки)
// ==========================================
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Функция поиска самого близкого факта в памяти через математику
function mathSearch(query) {
    const queryVec = textToVector(query);
    let bestMatch = null;
    let highestScore = 0;

    for (const [entity, relations] of Object.entries(KNOWLEDGE_GRAPH)) {
        for (const [rel, objects] of Object.entries(relations)) {
            if (rel === "тип") continue;
            
            objects.forEach(obj => {
                const factText = `${entity} ${rel} ${obj}`;
                const factVec = textToVector(factText);
                const score = cosineSimilarity(queryVec, factVec);
                
                // Если математическая близость больше 30%
                if (score > highestScore && score > 0.3) {
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

// ==========================================
// ГЛАВНАЯ ФУНКЦИЯ (Оркестратор слоев)
// ==========================================
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    const tokens = extractTokens(msg);

    // 1. ОБУЧЕНИЕ (Правила)
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    if (teachMatch && !msg.includes('?')) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '').toLowerCase();
        
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        let relation = "описание";
        if (fact.includes("поэт") || fact.includes("писатель")) relation = "профессия";
        if (fact.includes("автор")) relation = "автор";
        
        if (!KNOWLEDGE_GRAPH[subject][relation]) KNOWLEDGE_GRAPH[subject][relation] = [];
        if (!KNOWLEDGE_GRAPH[subject][relation].includes(fact)) KNOWLEDGE_GRAPH[subject][relation].push(fact);
        
        saveBrain();
        return `🧠 **Слой обучения:** Запомнил связь.`;
    }

    // 2. МАТЕМАТИЧЕСКИЙ ПОИСК В ПАМЯТИ (Embedding + Attention)
    const mathResult = mathSearch(msg);
    
    if (mathResult && (msg.includes('?') || /^(кто|что|где|когда)/i.test(msg))) {
        // Если математика нашла точное совпадение
        return `🧮 **Математический слой (Attention):**\n${mathResult}`;
    }

    // 3. КОНТЕКСТНЫЙ ВЫВОД (Продолжение беседы)
    if (msg.includes('?') && CONTEXT_MEMORY.length > 0) {
        let lastEntity = null;
        for (let i = CONTEXT_MEMORY.length - 1; i >= 0; i--) {
            if (CONTEXT_MEMORY[i].entities && CONTEXT_MEMORY[i].entities.length > 0) {
                lastEntity = CONTEXT_MEMORY[i].entities[0]; break;
            }
        }
        if (lastEntity && KNOWLEDGE_GRAPH[lastEntity]) {
            return `🧠 **Слой контекста:** Мы говорили про "${lastEntity}".`;
        }
    }

    // 4. ПОИСК В ИНТЕРНЕТЕ (Если математика не справилась)
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

            return `🔎 **Слой поиска (Из сети):** ${cleanFact}\n\n*[Добавлено в память]*`;
        }
        return `❌ Я проанализировал запрос, но в памяти и в сети нет ответа.`;
    } catch (e) {
        return `❌ Ошибка Сети: ${e.message}`;
    }
}
