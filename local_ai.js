// local_ai.js
const BRAIN_VERSION = "17.0"; 
const MAX_CONTEXT = 20;

// СЛОЙ 3: БАЗА ЗНАНИЙ (Граф)
let KNOWLEDGE_GRAPH = {
    "привет": { "тип": ["приветствие"] },
    "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] },
    "онегин": { "тип": ["произведение"] }
};

// СЛОЙ 5: ОКНО КОНТЕКСТА
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

// СЛОЙ 1: NLP-ПАРСЕР И СТЕММЕР (Обрезка окончаний для понимания смысла)
function getRoot(word) {
    // Примитивный стеммер: убираем частые русские окончания
    return word.replace(/(а|я|ы|и|ов|ев|у|ю|ом|ем|е|ами|ями|ах|ях)$/i, '');
}

function extractTokens(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит', 'давай', 'напиши', 'создай', 'сделай', 'код', 'скрипт'];
    const words = text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/);
    return words.filter(w => w.length > 2 && !stopWords.includes(w)).map(w => getRoot(w));
                       }
// СЛОЙ 4: ЛОГИЧЕСКИЙ ДВИЖОК (Reasoning)
function reasonAbout(rootWord) {
    let facts = [];
    // Ищем сущность по корню слова (например, "пушкин")
    const entity = Object.keys(KNOWLEDGE_GRAPH).find(k => getRoot(k) === rootWord || k === rootWord);
    
    if (!entity) return null;
    
    const relations = KNOWLEDGE_GRAPH[entity];
    for (const [rel, objects] of Object.entries(relations)) {
        if (rel === "тип") continue;
        objects.forEach(obj => {
            facts.push(`${entity.charAt(0).toUpperCase() + entity.slice(1)} — ${rel}: ${obj}`);
            // Логическая цепочка (глубина 2)
            const subEntity = Object.keys(KNOWLEDGE_GRAPH).find(k => getRoot(k) === getRoot(obj));
            if (subEntity) {
                for (const [subRel, subObjs] of Object.entries(KNOWLEDGE_GRAPH[subEntity])) {
                    if (subRel !== "тип") facts.push(`  -> Связано с "${obj}" — ${subRel}: ${subObjs.join(', ')}`);
                }
            }
        });
    }
    return facts.length > 0 ? facts : null;
}

// СЛОЙ 7: ГЕНЕРАТОР ОТВЕТОВ (Шаблоны)
function generateReply(type, data) {
    if (type === 'learning') return `🧠 **Слой обучения:** Я обновил граф знаний. ${data}`;
    if (type === 'memory') return `🧠 **Слой логики (Из памяти):**\n- ${data.join('\n- ')}`;
    if (type === 'context') return `🧠 **Слой контекста:** Я понял, что ты продолжаешь спрашивать про "${data.entity}".\n- ${data.facts.join('\n- ')}`;
    if (type === 'network') return `🔎 **Слой поиска (Из сети):** ${data.fact}\n\n*[Знание добавлено в память]*`;
    if (type === 'error') return `❌ Ошибка Сети: ${data}`;
    return data;
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    const tokens = extractTokens(msg); // Слой 1

    // СЛОЙ 2: АНАЛИЗ ИНТЕНТА
    const isQuestion = msg.includes('?') || /^(кто|что|где|когда|как|почему|зачем|какой|какая)/i.test(msg);
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    
    // СЛОЙ 8: ОБУЧЕНИЕ
    if (teachMatch && !isQuestion) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '').toLowerCase();
        
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        let relation = "описание";
        if (fact.includes("поэт") || fact.includes("писатель")) relation = "профессия";
        
        if (!KNOWLEDGE_GRAPH[subject][relation]) KNOWLEDGE_GRAPH[subject][relation] = [];
        if (!KNOWLEDGE_GRAPH[subject][relation].includes(fact)) KNOWLEDGE_GRAPH[subject][relation].push(fact);
        
        saveBrain();
        CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: [subject] });
        if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
        saveContext();
        
        return generateReply('learning', `Запомнил: "${subject}" -> "${relation}" -> "${fact}".`);
    }

    // СЛОЙ 4: ПОИСК В ПАМЯТИ
    let finalFacts = [];
    let foundEntities = [];
    if (isQuestion && tokens.length > 0) {
        tokens.forEach(token => {
            const facts = reasonAbout(token);
            if (facts) { finalFacts = finalFacts.concat(facts); foundEntities.push(token); }
        });
        if (finalFacts.length > 0) {
            CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: foundEntities });
            if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
            saveContext();
            return generateReply('memory', finalFacts);
        }
    }

    // СЛОЙ 5: КОНТЕКСТНЫЙ ВЫВОД (Если прямых совпадений нет)
    if (isQuestion && CONTEXT_MEMORY.length > 0) {
        let lastEntity = null;
        for (let i = CONTEXT_MEMORY.length - 1; i >= 0; i--) {
            if (CONTEXT_MEMORY[i].entities && CONTEXT_MEMORY[i].entities.length > 0) {
                lastEntity = CONTEXT_MEMORY[i].entities[0]; break;
            }
        }
        if (lastEntity) {
            const facts = reasonAbout(lastEntity);
            if (facts) return generateReply('context', { entity: lastEntity, facts: facts });
        }
    }

    // СЛОЙ 6: ПОИСК В ИНТЕРНЕТЕ
    try {
        const searchQuery = tokens.join(' ') || msg;
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        const searchData = await searchRes.json();
        if (searchData.success && searchData.results) {
            let cleanFact = searchData.results.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/^-\s*/, '').trim().substring(0, 250) + "...";
            
            const mainSubject = tokens[0] || "информация";
            if (!KNOWLEDGE_GRAPH[mainSubject]) KNOWLEDGE_GRAPH[mainSubject] = {};
            if (!KNOWLEDGE_GRAPH[mainSubject]["из_интернета"]) KNOWLEDGE_GRAPH[mainSubject]["из_интернета"] = [];
            KNOWLEDGE_GRAPH[mainSubject]["из_интернета"].push(cleanFact);
            saveBrain();
            
            CONTEXT_MEMORY.push({ role: 'user', text: msg, entities: [mainSubject] });
            if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
            saveContext();

            return generateReply('network', { fact: cleanFact });
        } else {
            return generateReply('error', 'Я проанализировал запрос, но в графе знаний и в сети нет ответа.');
        }
    } catch (e) {
        return generateReply('error', e.message);
    }
}
