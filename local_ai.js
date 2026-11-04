// local_ai.js
const BRAIN_VERSION = "16.1"; 
const MAX_CONTEXT_MESSAGES = 20; // Держим в голове 20 сообщений

let KNOWLEDGE_GRAPH = {
    "привет": { "тип": ["приветствие"] },
    "пушкин": { "профессия": ["поэт"], "произведение": ["евгений онегин"] }
};

let CONTEXT_MEMORY = []; 

const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalKG');
    localStorage.removeItem('shtabContext');
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    const savedKG = localStorage.getItem('shtabLocalKG');
    if (savedKG) KNOWLEDGE_GRAPH = JSON.parse(savedKG);
    const savedCtx = localStorage.getItem('shtabContext');
    if (savedCtx) CONTEXT_MEMORY = JSON.parse(savedCtx);
} catch(e) { }

function saveBrain() { localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH)); }
function saveContext() { localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY)); }

// Логический вывод: ищем сущность и ее связи
function reasonAbout(entity) {
    const e = entity.toLowerCase().trim();
    if (!KNOWLEDGE_GRAPH[e]) return null;

    let facts = [];
    const relations = KNOWLEDGE_GRAPH[e];

    for (const [rel, objects] of Object.entries(relations)) {
        if (rel === "тип") continue;
        objects.forEach(obj => {
            facts.push(`${e.charAt(0).toUpperCase() + e.slice(1)} — ${rel}: ${obj}`);
            if (KNOWLEDGE_GRAPH[obj]) {
                for (const [subRel, subObjs] of Object.entries(KNOWLEDGE_GRAPH[obj])) {
                    if (subRel !== "тип") facts.push(`  -> Связано с "${obj}" — ${subRel}: ${subObjs.join(', ')}`);
                }
            }
        });
    }
    return facts.length > 0 ? facts : null;
}

function extractKeywords(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит', 'давай', 'напиши', 'создай', 'сделай', 'код', 'скрипт'];
    return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
    }
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    const keywords = extractKeywords(msg);

    // СЛОЙ 1: ОПРЕДЕЛЕНИЕ ИНТЕНТА
    const isQuestion = msg.includes('?') || /^(кто|что|где|когда|как|почему|зачем|какой|какая)/i.test(msg);
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    
    // --- РЕЖИМ ОБУЧЕНИЯ ---
    if (teachMatch && !isQuestion) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '').toLowerCase();
        
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        
        let relation = "описание";
        if (fact.includes("поэт") || fact.includes("писатель")) relation = "профессия";
        
        if (!KNOWLEDGE_GRAPH[subject][relation]) KNOWLEDGE_GRAPH[subject][relation] = [];
        if (!KNOWLEDGE_GRAPH[subject][relation].includes(fact)) {
            KNOWLEDGE_GRAPH[subject][relation].push(fact);
        }
        
        saveBrain();
        CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: [subject] });
        if (CONTEXT_MEMORY.length > MAX_CONTEXT_MESSAGES) CONTEXT_MEMORY.shift();
        saveContext();
        
        return `🧠 **Слой обучения:** Я запомнил, что "${subject}" имеет связь "${relation}" со значением "${fact}".`;
    }

    // --- РЕЖИМ ВОПРОСА (Прямой поиск в памяти) ---
    let finalFacts = [];
    let foundEntities = [];
    
    if (isQuestion && keywords.length > 0) {
        keywords.forEach(kw => {
            const facts = reasonAbout(kw);
            if (facts) {
                finalFacts = finalFacts.concat(facts);
                foundEntities.push(kw);
            }
        });

        if (finalFacts.length > 0) {
            CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: foundEntities });
            if (CONTEXT_MEMORY.length > MAX_CONTEXT_MESSAGES) CONTEXT_MEMORY.shift();
            saveContext();
            return `🧠 **Слой логики (Из графа):**\n- ${finalFacts.join('\n- ')}`;
        }
    }

    // --- РЕЖИМ ВОПРОСА (Использование Окна Контекста) ---
    // Если прямых совпадений нет (например, вопрос "А он кто?"), ищем в последних 20 сообщениях
    if (isQuestion && CONTEXT_MEMORY.length > 0) {
        let lastEntity = null;
        
        // Идем с конца истории и ищем, о ком или о чем говорили
        for (let i = CONTEXT_MEMORY.length - 1; i >= 0; i--) {
            if (CONTEXT_MEMORY[i].entities && CONTEXT_MEMORY[i].entities.length > 0) {
                lastEntity = CONTEXT_MEMORY[i].entities[0];
                break;
            }
        }

        if (lastEntity) {
            const facts = reasonAbout(lastEntity);
            if (facts) {
                CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: [lastEntity] });
                if (CONTEXT_MEMORY.length > MAX_CONTEXT_MESSAGES) CONTEXT_MEMORY.shift();
                saveContext();
                return `🧠 **Слой контекста:** Я понял, что ты продолжаешь спрашивать про "${lastEntity}".\n- ${facts.join('\n- ')}`;
            }
        }
    }

    // --- РЕЖИМ ГЕНЕРАЦИИ КОДА ---
    if (/напиши|создай/i.test(msg) && /код|скрипт/i.test(msg)) {
        return `💻 **Слой действий:** Босс, я могу написать код только если он есть в моих шаблонах.`;
    }

    // --- ИНТЕРНЕТ (Если в памяти пусто) ---
    try {
        const searchQuery = keywords.join(' ') || msg;
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        const searchData = await searchRes.json();
        
        if (searchData.success && searchData.results) {
            let cleanFact = searchData.results.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/^-\s*/, '').trim();
            cleanFact = cleanFact.substring(0, 200) + "...";
            
            const mainSubject = keywords[0] || "информация";
            if (!KNOWLEDGE_GRAPH[mainSubject]) KNOWLEDGE_GRAPH[mainSubject] = {};
            if (!KNOWLEDGE_GRAPH[mainSubject]["из_интернета"]) KNOWLEDGE_GRAPH[mainSubject]["из_интернета"] = [];
            
            KNOWLEDGE_GRAPH[mainSubject]["из_интернета"].push(cleanFact);
            saveBrain();
            
            CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: [mainSubject] });
            if (CONTEXT_MEMORY.length > MAX_CONTEXT_MESSAGES) CONTEXT_MEMORY.shift();
            saveContext();

            return `🔎 **Слой поиска (Из сети):** ${cleanFact}\n\n*[Знание добавлено в память]*`;
        } else {
            return `Я проанализировал запрос, но в моем графе знаний и в интернете нет ответа.`;
        }
    } catch (e) {
        return `Ошибка Сети: ${e.message}`;
    }
                }
