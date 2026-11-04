// local_ai.js
const BRAIN_VERSION = "32.0"; 
const MAX_CONTEXT = 20;

let KNOWLEDGE_GRAPH = { "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] } };
let CONTEXT_MEMORY = []; 
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { brief: false, name: "Босс" };
let DYNAMIC_DICT = {};

const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalKG'); 
    localStorage.removeItem('shtabContext'); 
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    if (localStorage.getItem('shtabLocalKG')) KNOWLEDGE_GRAPH = JSON.parse(localStorage.getItem('shtabLocalKG'));
    if (localStorage.getItem('shtabContext')) CONTEXT_MEMORY = JSON.parse(localStorage.getItem('shtabContext'));
    if (localStorage.getItem('shtabDynamicDict')) DYNAMIC_DICT = JSON.parse(localStorage.getItem('shtabDynamicDict'));
} catch(e) {}

function saveLocalBrain() { 
    localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH)); 
    localStorage.setItem('shtabDynamicDict', JSON.stringify(DYNAMIC_DICT));
    localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY));
}
const ABBREVIATIONS = {
    "спс": "спасибо", "пжлст": "пожалуйста", "че": "что", "щас": "сейчас",
    "прив": "привет", "здарова": "здорово", "мб": "может быть", "нзч": "не за что"
};

function sanitizeInput(text) {
    return text.replace(/<[^>]*>?/gm, '').replace(/[^\w\sа-яёА-ЯЁ?.!,]/gi, '').trim();
}

function expandAbbreviations(text) {
    return text.split(/\s+/).map(w => ABBREVIATIONS[w.toLowerCase()] || w).join(' ');
}

function analyzeSentiment(text) {
    const angry = ["дурак", "тупой", "плохо", "ужасно", "бесит", "ошибка", "сломал"];
    const happy = ["круто", "отлично", "супер", "молодец", "класс", "спасибо"];
    let score = 0;
    const lower = text.toLowerCase();
    angry.forEach(w => { if (lower.includes(w)) score -= 1; });
    happy.forEach(w => { if (lower.includes(w)) score += 1; });
    return score < 0 ? 'angry' : (score > 0 ? 'happy' : 'neutral');
}

function hasNegation(text) {
    return /\b(не|нет|никогда|нигде|никто|ничто)\b/i.test(text);
}
// 1. Левенштейн
function levenshtein(a, b) {
    if (a.length === 0) return b.length; if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
        }
    }
    return matrix[b.length][a.length];
}

// 2. Дамерау-Левенштейн
function damerauLevenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && b.charAt(i - 1) === a.charAt(j - 2) && b.charAt(i - 2) === a.charAt(j - 1)) {
                matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
            }
        }
    }
    return matrix[b.length][a.length];
}

// 3. Косинусное сходство
function cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) { dot += vecA[i] * vecB[i]; normA += vecA[i] ** 2; normB += vecB[i] ** 2; }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 4. Жаккар
function jaccardSimilarity(a, b) {
    const setA = new Set(a.toLowerCase().split(/\s+/)), setB = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...setA].filter(x => setB.has(x)).length;
    return inter / (setA.size + setB.size - inter);
}

// 5. Сёренсен-Дайс
function sorensenDice(a, b) {
    const setA = new Set(a.toLowerCase().split(/\s+/)), setB = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...setA].filter(x => setB.has(x)).length;
    return 2 * inter / (setA.size + setB.size);
}
// 6. Хэмминг
function hamming(a, b) {
    if (a.length !== b.length) return -1;
    let dist = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
    return dist;
}

// 7. TF-IDF
function tfidf(docs, term) {
    const tf = docs.map(d => d.toLowerCase().split(/\s+/).filter(w => w === term).length);
    const idf = Math.log(docs.length / (1 + tf.filter(t => t > 0).length));
    return tf.map(t => t * idf);
}

// 8. BM25
function bm25(docs, term, k1 = 1.5, b = 0.75) {
    const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;
    return docs.map(d => {
        const len = d.length, freq = d.toLowerCase().split(/\s+/).filter(w => w === term).length;
        return freq > 0 ? (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * len / avgLen)) : 0;
    });
}

// 9. Сходство по общим n-граммам
function ngramSimilarity(a, b, n = 2) {
    const grams = s => Array.from({ length: s.length - n + 1 }, (_, i) => s.slice(i, i + n));
    const setA = new Set(grams(a.toLowerCase())), setB = new Set(grams(b.toLowerCase()));
    const inter = [...setA].filter(x => setB.has(x)).length;
    return 2 * inter / (setA.size + setB.size);
}

// 10. Взвешенный косинус с IDF
function weightedCosine(query, doc, vocab) {
    const qVec = vocab.map(v => query.includes(v) ? 1 : 0);
    const dVec = vocab.map(v => doc.includes(v) ? 1 : 0);
    const idf = vocab.map(v => Math.log(1 + 1 / (1 + (doc.includes(v) ? 1 : 0))));
    return cosineSimilarity(qVec.map((v, i) => v * idf[i]), dVec.map((v, i) => v * idf[i]));
}
function lemmatize(word) {
    return word.toLowerCase().replace(/(а|я|ы|и|ов|ев|у|ю|ом|ем|е|ами|ями|ах|ях|ой|ей)$/i, '').replace(/ь$/, '');
}

function correctSpelling(word, dictionary) {
    let best = word, minDist = 3;
    for (const dictWord of Object.keys(dictionary)) {
        const dist = damerauLevenshtein(word.toLowerCase(), dictWord);
        if (dist < minDist) { minDist = dist; best = dictWord; }
    }
    return best;
}

function expandWithSynonyms(text, dict) {
    const words = text.split(/\s+/); const expanded = new Set(words);
    words.forEach(w => { if (dict[w]?.synonyms) dict[w].synonyms.forEach(s => expanded.add(s)); });
    return Array.from(expanded).join(' ');
}

function extractEntities(text) {
    const entities = { persons: [], locations: [], dates: [] };
    const personMatch = text.match(/\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\b/g);
    if (personMatch) entities.persons = personMatch;
    const cityMatch = text.match(/\b(?:в|во|на)\s+([А-ЯЁ][а-яё]+)/);
    if (cityMatch) entities.locations.push(cityMatch[1]);
    const dateMatch = text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/);
    if (dateMatch) entities.dates.push(dateMatch[0]);
    return entities;
}

function planDialogue(query) {
    const parts = query.split(/[.,;]/).filter(p => p.trim().length > 0);
    return parts.length > 1 ? parts : [query];
}
function reasonAbout(entity) {
    const e = entity.toLowerCase().trim();
    let matchedEntity = Object.keys(KNOWLEDGE_GRAPH).find(k => k === e || levenshtein(k, e) <= 2);
    if (!matchedEntity) return null;
    let facts = [];
    const relations = KNOWLEDGE_GRAPH[matchedEntity];
    for (const [rel, objects] of Object.entries(relations)) {
        if (rel === "тип") continue;
        objects.forEach(obj => facts.push(`${matchedEntity.charAt(0).toUpperCase() + matchedEntity.slice(1)} — ${rel}: ${obj}`));
    }
    return facts.length > 0 ? facts : null;
}

function transitiveClosure(startEntity, graph, depth = 3) {
    let visited = new Set(), result = [];
    function dfs(entity, level) {
        if (level > depth || visited.has(entity)) return;
        visited.add(entity);
        const rels = graph[entity];
        if (rels) {
            for (const [rel, objs] of Object.entries(rels)) {
                objs.forEach(obj => {
                    result.push(`${entity} ${rel} ${obj}`);
                    if (graph[obj]) dfs(obj, level + 1);
                });
            }
        }
    }
    dfs(startEntity.toLowerCase(), 0);
    return result;
}

function computeConfidence(answer, query, source) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const answerWords = answer.toLowerCase().split(/\s+/);
    const matches = queryWords.filter(w => answerWords.includes(w)).length;
    let conf = queryWords.length > 0 ? matches / queryWords.length : 0.5;
    if (source === 'memory') conf += 0.2;
    if (source === 'network') conf += 0.1;
    return Math.min(1, conf);
}

function detectTopic(text) {
    const topics = {
        weather: ['погода', 'температура', 'градус', 'дождь', 'снег'],
        code: ['код', 'скрипт', 'программа', 'javascript', 'python'],
        history: ['история', 'война', 'древний', 'век'],
        science: ['наука', 'физика', 'химия', 'биология']
    };
    for (const [topic, words] of Object.entries(topics)) {
        if (words.some(w => text.toLowerCase().includes(w))) return topic;
    }
    return 'general';
}
async function fetchWordFromAPI(word, proxyUrl) {
    if (DYNAMIC_DICT[word]) return DYNAMIC_DICT[word];
    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dictQuery: word }) });
        const data = await res.json();
        if (data.success && data.definition) { 
            DYNAMIC_DICT[word] = data.definition; 
            saveLocalBrain(); 
            return DYNAMIC_DICT[word]; 
        }
    } catch (e) {}
    return null;
}

async function prepareQuery(text, proxyUrl) {
    let words = text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/);
    let lemmatized = words.map(lemmatize);
    let corrected = lemmatized.map(w => correctSpelling(w, DYNAMIC_DICT));
    let expanded = expandWithSynonyms(corrected.join(' '), DYNAMIC_DICT);
    return { text: expanded, lemmas: corrected };
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    let msg = sanitizeInput(userMessage.toLowerCase().trim());
    msg = expandAbbreviations(msg);
    
    const sentiment = analyzeSentiment(msg);
    const topic = detectTopic(msg);
    const entities = extractEntities(msg);
    const plan = planDialogue(msg);
    
    const { text: expandedMsg, lemmas } = await prepareQuery(msg, proxyUrl);
    const keywords = lemmas.filter(w => w.length > 2);
    
    let ctx = { msg, expandedMsg, keywords, sentiment, topic, entities, plan, output: null, intent: 'unknown' };

    if (/^(привет|куку|здорово|хай|здравствуй|hello|hi)/i.test(msg)) return `Привет, ${userPrefs.name}! На связи.`;
    if (/как дела|how are you/i.test(msg)) return `Все системы в норме, ${userPrefs.name}. Как ваши?`;
    if (/спасибо|thanks/i.test(msg)) return "Всегда пожалуйста!";
    if (/время|который час|time/i.test(msg)) return `🕒 Сейчас ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`;
    if (/что делаешь|чем занят/i.test(msg)) return `Работаю над вашими задачами, ${userPrefs.name}. А у вас какие планы?`;

    if (/погод|градус|температур|weather/i.test(msg)) ctx.intent = 'weather';
    else if (/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i.test(msg) && !msg.includes('?')) ctx.intent = 'learning';
    else if (/напиши|создай|code|script/i.test(msg) && /код|скрипт|змейк|калькулятор/i.test(msg)) ctx.intent = 'code';
    else if (msg.includes('?') || /^(кто|что|где|как|почему|who|what|where|how)/i.test(msg)) ctx.intent = 'question';

    if (ctx.intent === 'weather') return await processWeather(ctx, proxyUrl, signal);
    if (ctx.intent === 'learning') return processLearning(ctx);
    if (ctx.intent === 'code') return processCode(ctx);
    return await processQuestion(ctx, proxyUrl, signal);
}

async function processWeather(ctx, proxyUrl, signal) {
    let isTomorrow = /завтра|tomorrow/i.test(ctx.msg);
    let city = lastCity;
    const cityMatch = ctx.msg.match(/(?:в|во|на|in)\s+([А-ЯЁA-Z][а-яёa-z\-]+)/);
    if (cityMatch) city = cityMatch[1];
    city = city.replace(/[?.!,]/g, '').trim() || lastCity;
    localStorage.setItem('shtabLastCity', city);
    try {
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }), signal });
        const data = await res.json();
        if (data.success) { ctx.output = `🌤️ ${data.results}`; return finalizeOutput(ctx); }
    } catch(e) {}
    ctx.output = `❌ Не удалось узнать погоду для "${city}".`;
    return finalizeOutput(ctx);
}

function processLearning(ctx) {
    const teachMatch = ctx.msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    if (teachMatch) {
        let subj = teachMatch[1].trim(), fact = teachMatch[2].trim();
        if (!KNOWLEDGE_GRAPH[subj]) KNOWLEDGE_GRAPH[subj] = {};
        let rel = fact.includes("поэт") || fact.includes("писатель") ? "профессия" : "описание";
        if (!KNOWLEDGE_GRAPH[subj][rel]) KNOWLEDGE_GRAPH[subj][rel] = [];
        KNOWLEDGE_GRAPH[subj][rel].push(fact);
        saveLocalBrain();
        ctx.output = `🧠 Запомнил: "${subj}" — это "${fact}".`;
    } else { ctx.output = `Не понял, что запомнить.`; }
    return finalizeOutput(ctx);
}

function processCode(ctx) {
    if (ctx.msg.includes("змейк")) ctx.output = `💻 Код змейки готов.`;
    else if (ctx.msg.includes("калькулятор")) ctx.output = `💻 Калькулятор готов.`;
    else ctx.output = `💻 Могу написать код для змейки или калькулятора.`;
    return finalizeOutput(ctx);
}
function askForClarification(query) {
    return `🤔 Босс, я не уверен, что понял. Уточните: "${query}" — вы имели в виду что-то конкретное?`;
}

async function processQuestion(ctx, proxyUrl, signal) {
    // 1. Логический вывод
    let facts = [];
    ctx.keywords.forEach(k => { 
        const f = reasonAbout(k); 
        if (f) facts = facts.concat(f); 
    });
    if (facts.length > 0) {
        ctx.output = `🧠 Логика: ${facts.join('; ')}`;
        return finalizeOutput(ctx);
    }

    // 2. Транзитивное замыкание
    if (ctx.entities.persons.length > 0) {
        const closure = transitiveClosure(ctx.entities.persons[0], KNOWLEDGE_GRAPH);
        if (closure.length > 0) {
            ctx.output = `🔗 Связи: ${closure.join('; ')}`;
            return finalizeOutput(ctx);
        }
    }

    // 3. Поиск в интернете
    try {
        const query = ctx.keywords.join(' ') || ctx.msg;
        const res = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchQuery: query }), signal });
        const data = await res.json();
        if (data.success && data.results) {
            let fact = data.results.substring(0, 250);
            let conf = computeConfidence(fact, ctx.msg, 'network');
            
            // Если уверенность низкая, переспрашиваем
            if (conf < 0.3) {
                ctx.output = askForClarification(ctx.msg);
                return finalizeOutput(ctx);
            }
            
            const mainSubj = ctx.keywords[0] || 'информация';
            if (!KNOWLEDGE_GRAPH[mainSubj]) KNOWLEDGE_GRAPH[mainSubj] = {};
            KNOWLEDGE_GRAPH[mainSubj]['из_интернета'] = [fact];
            saveLocalBrain();
            
            ctx.output = `🔎 ${fact} (Уверенность: ${Math.round(conf*100)}%)`;
            return finalizeOutput(ctx);
        }
        throw new Error("Не найдено");
    } catch (e) {
        ctx.output = `❌ Не удалось найти ответ.`;
        return finalizeOutput(ctx);
    }
}
function finalizeOutput(ctx) {
    if (!ctx.output || ctx.output.trim() === "") {
        ctx.output = "⚠️ Ошибка в слоях обработки. Ответ пуст.";
    }
    
    // Эмпатия: если Босс злится, добавляем извинение
    if (ctx.sentiment === 'angry' && !ctx.output.includes("извин")) {
        ctx.output = "Я понимаю ваше недовольство. " + ctx.output;
    }

    // Сохраняем контекст беседы
    CONTEXT_MEMORY.push({ role: 'user', text: ctx.msg, entities: ctx.keywords, timestamp: Date.now() });
    CONTEXT_MEMORY.push({ role: 'assistant', text: ctx.output, entities: ctx.keywords, timestamp: Date.now() });
    
    if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
    saveLocalBrain();
    
    return ctx.output;
}
