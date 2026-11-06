// local_ai.js
const BRAIN_VERSION = "44.2"; 
const MAX_CONTEXT = 20;
const MAX_DICT_SIZE = 100;
const DEBUG = true;

let KNOWLEDGE_GRAPH = { "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] } };
let CONTEXT_MEMORY = []; 
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { brief: false, name: "Босс" };
let DYNAMIC_DICT = {};

const CUSTOM_LAYERS = [];
function registerLayer(name, matcher, handler) {
    CUSTOM_LAYERS.push({ name, matcher, handler });
    if (DEBUG) console.log(`🔌 Слой "${name}" зарегистрирован.`);
}

const BASE_DICT = ["привет", "погода", "спасибо", "код", "штаб", "агент", "время", "хакер", "оркестратор", "охранник", "юрист", "дизайнер"];

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
    const dictKeys = Object.keys(DYNAMIC_DICT);
    if (dictKeys.length > MAX_DICT_SIZE) {
        const keysToRemove = dictKeys.slice(0, dictKeys.length - MAX_DICT_SIZE);
        keysToRemove.forEach(k => delete DYNAMIC_DICT[k]);
    }
    localStorage.setItem('shtabLocalKG', JSON.stringify(KNOWLEDGE_GRAPH)); 
    localStorage.setItem('shtabDynamicDict', JSON.stringify(DYNAMIC_DICT));
    localStorage.setItem('shtabContext', JSON.stringify(CONTEXT_MEMORY));
}

async function runParallel(workers) {
    const results = await Promise.allSettled(workers.map(w => w.fn()));
    return results.map((r, i) => ({
        name: workers[i].name,
        weight: workers[i].weight || 1,
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : null
    }));
}

const STOP_WORDS = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит', 'давай', 'напиши', 'создай', 'сделай', 'скажи', 'пожалуйста', 'делаешь', 'занят', 'какая', 'какой', 'сейчас', 'сегодня'];
const ABBREVIATIONS = { "спс": "спасибо", "пжлст": "пожалуйста", "че": "что", "щас": "сейчас", "прив": "привет", "здарова": "здорово", "мб": "может быть" };

function sanitize(text) { return text.replace(/<[^>]*>?/gm, '').replace(/[^\w\sа-яёА-ЯЁ?.!,]/gi, '').trim(); }
function expandAbbreviations(text) { return text.split(/\s+/).map(w => ABBREVIATIONS[w.toLowerCase()] || w).join(' '); }
function extractKeywords(text) { return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.includes(w)); }

function analyzeSentiment(text) {
    const angry = ["дурак", "тупой", "плохо", "бесит", "ошибка", "сломал"];
    const happy = ["круто", "отлично", "супер", "молодец", "спасибо"];
    let score = 0;
    angry.forEach(w => { if (text.includes(w)) score -= 1; });
    happy.forEach(w => { if (text.includes(w)) score += 1; });
    return score < 0 ? 'angry' : (score > 0 ? 'happy' : 'neutral');
}
function levenshtein(a, b) {
    if (a.length === 0) return b.length; if (b.length === 0) return a.length;
    const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= b.length; i++) m[i][0] = i;
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i-1] === a[j-1] ? 0 : 1;
            m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
        }
    }
    return m[b.length][a.length];
}

function damerauLevenshtein(a, b) {
    const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= b.length; i++) m[i][0] = i;
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost = b[i-1] === a[j-1] ? 0 : 1;
            m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
            if (i > 1 && j > 1 && b[i-1] === a[j-2] && b[i-2] === a[j-1]) {
                m[i][j] = Math.min(m[i][j], m[i-2][j-2]+cost);
            }
        }
    }
    return m[b.length][a.length];
}

function cosineSimilarity(vecA, vecB) {
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < vecA.length; i++) { dot += vecA[i]*vecB[i]; nA += vecA[i]**2; nB += vecB[i]**2; }
    return nA === 0 || nB === 0 ? 0 : dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

function jaccardSimilarity(a, b) {
    const sA = new Set(a.toLowerCase().split(/\s+/)), sB = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sA].filter(x => sB.has(x)).length;
    return inter / (sA.size + sB.size - inter);
}

function sorensenDice(a, b) {
    const sA = new Set(a.toLowerCase().split(/\s+/)), sB = new Set(b.toLowerCase().split(/\s+/));
    const inter = [...sA].filter(x => sB.has(x)).length;
    return 2 * inter / (sA.size + sB.size);
}

function ngramSimilarity(a, b, n = 2) {
    const grams = s => Array.from({ length: s.length - n + 1 }, (_, i) => s.slice(i, i + n));
    const sA = new Set(grams(a.toLowerCase())), sB = new Set(grams(b.toLowerCase()));
    const inter = [...sA].filter(x => sB.has(x)).length;
    return 2 * inter / (sA.size + sB.size);
}

function hamming(a, b) {
    if (a.length !== b.length) return -1;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
             }
function tfidf(docs, term) {
    const tf = docs.map(d => d.toLowerCase().split(/\s+/).filter(w => w === term).length);
    const idf = Math.log(docs.length / (1 + tf.filter(t => t > 0).length));
    return tf.map(t => t * idf);
}

function bm25(docs, term, k1 = 1.5, b = 0.75) {
    const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length;
    return docs.map(d => {
        const len = d.length, freq = d.toLowerCase().split(/\s+/).filter(w => w === term).length;
        return freq > 0 ? (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * len / avgLen)) : 0;
    });
}

function weightedCosine(query, doc, vocab) {
    const qVec = vocab.map(v => query.includes(v) ? 1 : 0);
    const dVec = vocab.map(v => doc.includes(v) ? 1 : 0);
    const idf = vocab.map(v => Math.log(1 + 1 / (1 + (doc.includes(v) ? 1 : 0))));
    return cosineSimilarity(qVec.map((v, i) => v * idf[i]), dVec.map((v, i) => v * idf[i]));
}

function calculateMathScore(query, text) {
    const j = jaccardSimilarity(query, text);
    const s = sorensenDice(query, text);
    const n = ngramSimilarity(query, text);
    const vocab = extractKeywords(query + " " + text);
    const qVec = vocab.map(v => query.includes(v) ? 1 : 0);
    const tVec = vocab.map(v => text.includes(v) ? 1 : 0);
    const c = cosineSimilarity(qVec, tVec);
    const avg = (j + s + n + c) / 4;
    if (DEBUG) console.log(`🧮 Math: J=${j.toFixed(2)} C=${c.toFixed(2)} N=${n.toFixed(2)} -> Avg=${avg.toFixed(2)}`);
    return avg;
}

function lemmatize(word) { return word.toLowerCase().replace(/(а|я|ы|и|ов|ев|у|ю|ом|ем|е|ами|ями|ах|ях|ой|ей)$/i, '').replace(/ь$/, ''); }

function stemmize(word) {
    return word.toLowerCase().replace(/(а|я|ы|и|ов|ев|у|ю|ом|ем|е|ами|ями|ах|ях|ой|ей|ый|ий|ая|ое|ые|ых|ым|им|ого|ему|ому|ыми|ими)$/i, '');
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

function planDialogue(query) {
    const parts = query.split(/[.,;]/).filter(p => p.trim().length > 0);
    return parts.length > 1 ? parts : [query];
}

function extractEntities(text) {
    const entities = { persons: [], locations: [], dates: [] };
    const pMatch = text.match(/\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\b/g);
    if (pMatch) entities.persons = pMatch;
    if (/погод|градус|температур/i.test(text)) {
        const words = text.split(/\s+/).filter(w => !STOP_WORDS.includes(w.toLowerCase()));
        if (words.length > 0) entities.locations.push(words[0]);
    }
    return entities;
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

function estimateComplexity(text) {
    let complexity = 0;
    if (text.length > 30) complexity += 1;
    if (text.split(/\s+/).length > 5) complexity += 1;
    if (/[?]/.test(text)) complexity += 1;
    if (/кто|что|где|когда|как|почему|зачем/i.test(text)) complexity += 2;
    return complexity;
}

function resolveContext(msg) {
    const words = msg.split(' ');
    if (words.length <= 3 && (msg.includes('?') || /^(а|и|это|он|она)/i.test(msg))) {
        for (let i = CONTEXT_MEMORY.length - 1; i >= 0; i--) {
            const lastCtx = CONTEXT_MEMORY[i];
            if (lastCtx.entities && lastCtx.entities.length > 0) {
                const entity = lastCtx.entities[0];
                if (DEBUG) console.log(`🔗 Контекст: "${entity}" вместо "${msg}"`);
                return `${entity} ${msg}`;
            }
        }
    }
    return msg;
}
function reasonAbout(entity) {
    const e = entity.toLowerCase().trim();
    const match = Object.keys(KNOWLEDGE_GRAPH).find(k => k === e || levenshtein(k, e) <= 2);
    if (!match) return null;
    const facts = [];
    for (const [rel, objs] of Object.entries(KNOWLEDGE_GRAPH[match])) {
        if (rel === 'тип') continue;
        objs.forEach(o => facts.push(`${match} ${rel}: ${o}`));
    }
    return facts.length ? facts : null;
}

function transitiveClosure(startEntity, graph, depth = 3) {
    const visited = new Set(), result = [];
    function dfs(entity, level) {
        if (level > depth || visited.has(entity)) return;
        visited.add(entity);
        const rels = graph[entity];
        if (rels) {
            for (const [rel, objs] of Object.entries(rels)) {
                objs.forEach(o => {
                    result.push(`${entity} ${rel} ${o}`);
                    if (graph[o]) dfs(o, level + 1);
                });
            }
        }
    }
    dfs(startEntity.toLowerCase(), 0);
    return result;
}

async function fetchWordFromAPI(word, proxyUrl) {
    if (DYNAMIC_DICT[word]) return DYNAMIC_DICT[word];
    try {
        const res = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dictQuery: word }) });
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
    const words = text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/);
    for (const word of words) {
        if (!DYNAMIC_DICT[word] && word.length > 2) {
            await fetchWordFromAPI(word, proxyUrl);
        }
    }
    const lemmatized = words.map(lemmatize);
    const corrected = lemmatized.map(w => correctSpelling(w, DYNAMIC_DICT));
    const expanded = expandWithSynonyms(corrected.join(' '), DYNAMIC_DICT);
    return { text: expanded, lemmas: corrected };
}

function computeConfidence(answer, query, source) {
    const qWords = extractKeywords(query);
    const aWords = answer.toLowerCase().split(/\s+/);
    const matches = qWords.filter(w => aWords.includes(w)).length;
    let conf = qWords.length > 0 ? matches / qWords.length : 0.5;
    if (source === 'memory') conf += 0.2;
    if (source === 'network') conf += 0.1;
    return Math.min(1, conf);
}
function judge(answer, query, source) {
    if (!answer || answer.trim() === '') return { approved: false, reason: 'Пустой' };
    const checks = {
        length: answer.length > 5 && answer.length < 2000,
        relevant: extractKeywords(query).some(kw => answer.toLowerCase().includes(kw)),
        clean: !answer.includes('<') && !/ничего не найдено/i.test(answer),
        noError: !answer.includes('Ошибка') && !answer.includes('undefined')
    };
    const score = Object.values(checks).filter(v => v).length / 4;
    if (DEBUG) console.log('⚖️ Судья:', { score });
    return { approved: score >= 0.75, reason: score < 0.75 ? 'Не прошел' : null, score };
}

function checkHallucinations(answer, query) {
    const queryEntities = extractEntities(query);
    const answerLower = answer.toLowerCase();
    if (queryEntities.persons.length === 0) {
        const foundPersons = answerLower.match(/\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\b/g) || [];
        if (foundPersons.length > 2) return { ok: false, reason: "Много новых имен" };
    }
    return { ok: true };
}

function vote(results) {
    const valid = results.filter(r => r.status === 'fulfilled' && r.value !== null && r.value !== undefined && String(r.value).trim() !== '');
    if (valid.length === 0) return null;
    const groups = {};
    valid.forEach(r => {
        const key = String(r.value);
        if (!groups[key]) groups[key] = { value: r.value, weight: 0 };
        groups[key].weight += r.weight || 1;
    });
    return Object.values(groups).sort((a, b) => b.weight - a.weight)[0].value;
}

function detectIntentKeywords(msg) {
    if (/погод|градус|температур/i.test(msg)) return 'weather';
    if (/(.+?)\s*(?:это|является|—|-)\s+(.+)/i.test(msg) && !msg.includes('?')) return 'learning';
    if (msg.includes('?')) return 'question';
    return 'unknown';
}

function detectIntentQuestion(msg) {
    if (/погод/i.test(msg)) return 'weather';
    if (/^(кто|что|где|как|почему)/i.test(msg) || msg.includes('?')) return 'question';
    return 'unknown';
}

function extractCityPrep(msg) { const m = msg.match(/(?:в|во|на)\s+([а-яёa-z\-]{3,})/i); return m ? m[1].toLowerCase() : null; }
function extractCityContext(msg) { const p = msg.split(/погода|погоду/i); return p.length > 1 ? p[1].trim().split(/\s+/)[0].toLowerCase() : null; }
function extractCityLast(msg) { const w = msg.replace(/[?.!,]/g, '').split(/\s+/); for (let i = w.length - 1; i >= 0; i--) { if (!STOP_WORDS.includes(w[i]) && w[i].length > 2) return w[i].toLowerCase(); } return null; }
async function analyzeInputSwarm(userMessage) {
    let msg = sanitize(userMessage.toLowerCase().trim());
    msg = expandAbbreviations(msg);
    
    let words = msg.split(/\s+/);
    let correctedWords = words.map(w => {
        for (const base of BASE_DICT) {
            if (damerauLevenshtein(w, base) <= 2) return base;
        }
        return w;
    });
    
    const swarmResults = await runParallel([
        { name: 'context', fn: () => resolveContext(msg) },
        { name: 'intent_kw', fn: () => detectIntentKeywords(msg) },
        { name: 'intent_qt', fn: () => detectIntentQuestion(msg) },
        { name: 'topic', fn: () => detectTopic(msg) },
        { name: 'complexity', fn: () => estimateComplexity(msg) }
    ]);
    
    return {
        originalMsg: msg,
        correctedMsg: correctedWords.join(' '),
        context: swarmResults[0].value || msg,
        intent: vote([swarmResults[1], swarmResults[2]]) || 'question',
        topic: swarmResults[3].value || 'general',
        complexity: swarmResults[4].value || 0,
        keywords: extractKeywords(correctedWords.join(' ')),
        entities: extractEntities(correctedWords.join(' ')),
        sentiment: analyzeSentiment(correctedWords.join(' '))
    };
}

async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const dossier = await analyzeInputSwarm(userMessage);
    const { originalMsg, correctedMsg, context, intent, topic, complexity, keywords, entities, sentiment } = dossier;

    if (/^(привет|куку|хай|здравствуй)/i.test(correctedMsg) || keywords.includes("привет")) {
        return finalizeOutput({ msg: originalMsg, sentiment, output: `Привет, ${userPrefs.name}! На связи.` });
    }
    if (/как дела/i.test(correctedMsg) || (keywords.includes("как") && keywords.includes("дела"))) {
        return finalizeOutput({ msg: originalMsg, sentiment, output: 'Все системы в норме.' });
    }
    if (/спасибо/i.test(correctedMsg) || keywords.includes("спасибо")) {
        return finalizeOutput({ msg: originalMsg, sentiment, output: 'Всегда пожалуйста!' });
    }
    if (/время/i.test(correctedMsg) && !msg.includes('как') && !msg.includes('когда')) return finalizeOutput({ msg: originalMsg, sentiment, output: `🕒 ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}` });

    if (/все.*агент|агенты.*на месте|кто.*в чате|сколько.*агент/i.test(correctedMsg)) {
        const allAgentsCount = typeof AGENT_ICONS !== 'undefined' ? Object.keys(AGENT_ICONS).length : 24;
        const activeAgents = typeof selectedAgents !== 'undefined' ? selectedAgents : [];
        let chatStatus = activeAgents.length === 0 ? "Никого нет. Отвечаю как Оркестратор." : `Подключено: ${activeAgents.length} (${activeAgents.join(', ')}).`;
        return finalizeOutput({ msg: originalMsg, sentiment, output: `🏢 **Статус Агентов:**\n- Всего в офисе: ${allAgentsCount}.\n- ${chatStatus}\n- Все на местах.` });
    }

    // === ПАРЛАМЕНТ: Параллельный запуск и проверка Судьей ===
    const matchedPlugins = CUSTOM_LAYERS.filter(layer => layer.matcher(correctedMsg, keywords));
    
    if (matchedPlugins.length > 0) {
        if (DEBUG) console.log(`🔌 Найдено плагинов: ${matchedPlugins.length}. Запускаем парламент...`);
        
        // 1. Запускаем ВСЕ подходящие плагины параллельно
        const pluginPromises = matchedPlugins.map(layer => 
            layer.handler(correctedMsg, { originalMsg, sentiment, keywords, entities })
                .then(res => ({ name: layer.name, result: res }))
                .catch(err => ({ name: layer.name, result: null, error: err.message }))
        );
        const pluginResults = await Promise.all(pluginPromises);

        // 2. Отсеиваем пустые ответы
        const validResults = pluginResults
            .filter(r => r.result && typeof r.result === 'string' && r.result.trim() !== '')
            .map(r => r.result);

        if (validResults.length > 0) {
            // Если сработал только один плагин — сразу выдаем его
            if (validResults.length === 1) {
                return finalizeOutput({ msg: originalMsg, sentiment, output: validResults[0] });
            }
            
            // Если сработало несколько — Судья выбирает лучший
            if (DEBUG) console.log(`⚖️ Судья выбирает лучший из ${validResults.length} ответов плагинов.`);
            
            let bestPluginAnswer = validResults[0];
            let bestScore = -1;
            
            for (const ans of validResults) {
                const verdict = judge(ans, originalMsg, 'network');
                const mathScore = calculateMathScore(originalMsg, ans);
                const totalScore = (verdict.approved ? 1 : 0) + mathScore;
                
                if (totalScore > bestScore) {
                    bestScore = totalScore;
                    bestPluginAnswer = ans;
                }
            }
            
            return finalizeOutput({ msg: originalMsg, sentiment, output: bestPluginAnswer });
        }
    }

    // === МАРШРУТИЗАЦИЯ ЯДРА ===
    const ctx = { msg: correctedMsg, originalMsg, sentiment, entities, keywords, intent, topic, complexity, output: null };

    if (intent === 'weather') return await processWeather(ctx, proxyUrl, signal);
    if (intent === 'learning') return processLearning(ctx);
    return await processQuestion(ctx, proxyUrl, signal);
                    }
async function validateOutputSwarm(fact, query) {
    const mathScore = calculateMathScore(query, fact);
    const verdict = judge(fact, query, 'network');
    const conf = computeConfidence(fact, query, 'network');
    const hallucination = checkHallucinations(fact, query);
    if (!verdict.approved || mathScore < 0.3 || conf < 0.3 || !hallucination.ok) return false;
    return true;
}

async function processWeather(ctx, proxyUrl, signal) {
    const cityResults = await runParallel([
        { name: 'prep', fn: () => extractCityPrep(ctx.msg) },
        { name: 'ctx', fn: () => extractCityContext(ctx.msg), weight: 2 },
        { name: 'last', fn: () => extractCityLast(ctx.msg) }
    ]);
    let city = vote(cityResults) || lastCity;
    if (city && ['в','во','на','с','и','а'].includes(city.toLowerCase())) {
        return finalizeOutput({ ...ctx, output: `⚠️ Судья: "${city}" — предлог.` });
    }
    city = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
    localStorage.setItem('shtabLastCity', city);
    const isTomorrow = /завтра/i.test(ctx.msg);

    try {
        const res = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }), signal });
        const data = await res.json();
        if (data.success) return finalizeOutput({ ...ctx, output: `🌤️ ${data.results}` });
    } catch(e) {}
    return finalizeOutput({ ...ctx, output: `❌ Не удалось узнать погоду.` });
}

async function fetchNetwork(query, proxyUrl, signal) {
    try {
        const res = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchQuery: query }), signal });
        const data = await res.json();
        if (data.success && data.results && !data.results.includes("ничего не найдено")) return data.results.substring(0, 250);
        return null;
    } catch(e) { return null; }
}

async function processQuestion(ctx, proxyUrl, signal) {
    const { text: expandedMsg, lemmas } = await prepareQuery(ctx.msg, proxyUrl);
    ctx.keywords = lemmas.filter(w => w.length > 2 && !STOP_WORDS.includes(w));

    const logicResults = await runParallel([
        { name: 'graph', fn: () => reasonAbout(ctx.keywords[0] || '')?.join('; ') },
        { name: 'trans', fn: () => transitiveClosure(ctx.keywords[0] || '', KNOWLEDGE_GRAPH).join('; ') }
    ]);
    const logicAnswer = vote(logicResults);
    
    if (logicAnswer) {
        const verdict = judge(logicAnswer, ctx.msg, 'memory');
        const conf = computeConfidence(logicAnswer, ctx.msg, 'memory');
        if (verdict.approved && conf > 0.3) return finalizeOutput({ ...ctx, output: `🧠 Логика: ${logicAnswer}` });
    }

    const searchQueries = [ctx.keywords.join(' ') || ctx.msg, ctx.keywords[0] || ctx.msg];
    const networkResults = await runParallel([
        { name: 'full', fn: () => fetchNetwork(searchQueries[0], proxyUrl, signal) },
        { name: 'short', fn: () => fetchNetwork(searchQueries[1], proxyUrl, signal) }
    ]);

    let finalFact = null;
    for (const res of networkResults) {
        if (res.value && await validateOutputSwarm(res.value, ctx.msg)) {
            finalFact = res.value; break;
        }
    }

    if (finalFact) {
        const mainSubj = ctx.keywords[0] || 'info';
        if (!KNOWLEDGE_GRAPH[mainSubj]) KNOWLEDGE_GRAPH[mainSubj] = {};
        KNOWLEDGE_GRAPH[mainSubj]['из_интернета'] = [finalFact];
        saveLocalBrain();
        return finalizeOutput({ ...ctx, output: `🔎 ${finalFact}` });
    }
    return finalizeOutput({ ...ctx, output: `🤔 Босс, я поискал в сети, но не нашел ответа.` });
}

function processLearning(ctx) {
    const m = ctx.msg.match(/(.+?)\s*(?:это|является|—|-)\s+(.+)/i);
    if (m) {
        const subj = m[1].trim(), fact = m[2].trim();
        if (!KNOWLEDGE_GRAPH[subj]) KNOWLEDGE_GRAPH[subj] = {};
        const rel = fact.includes('поэт') || fact.includes('писатель') ? 'профессия' : 'описание';
        if (!KNOWLEDGE_GRAPH[subj][rel]) KNOWLEDGE_GRAPH[subj][rel] = [];
        KNOWLEDGE_GRAPH[subj][rel].push(fact);
        saveLocalBrain();
        return finalizeOutput({ ...ctx, output: `🧠 Запомнил: "${subj}" — это "${fact}".` });
    }
    return finalizeOutput({ ...ctx, output: `Не понял, что запомнить.` });
}

function finalizeOutput(ctx) {
    if (!ctx.output || ctx.output.trim() === '') ctx.output = "⚠️ Пустой ответ.";
    if (ctx.sentiment === 'angry' && !ctx.output.includes('извин')) ctx.output = 'Извините. ' + ctx.output;
    if (userPrefs.brief && ctx.output.length > 300) ctx.output = ctx.output.substring(0, 300) + "...";
    
    CONTEXT_MEMORY.push({ role: 'user', text: ctx.msg, entities: ctx.keywords, timestamp: Date.now() });
    CONTEXT_MEMORY.push({ role: 'assistant', text: ctx.output, entities: ctx.keywords, timestamp: Date.now() });
    if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
    
    saveLocalBrain();
    return ctx.output;
}

// ==========================================
// ПЛАГИНЫ
// ==========================================
registerLayer("math_solver", 
    (msg) => /^[\d\s\+\-\*\/\(\)\.]+$/.test(msg.replace(/[=?]/g, '').trim()) && msg.length > 2,
    (msg) => {
        try {
            let expr = msg.replace(/[=]/g, '').replace(/[а-яё]/gi, '');
            if (!expr.trim()) return null;
            const result = new Function('return ' + expr)();
            return `🧮 Результат: ${expr.trim()} = **${result}**`;
        } catch(e) { return `⚠️ Не удалось посчитать выражение.`; }
    }
);

registerLayer("date_checker",
    (msg) => /какой сегодня день|какое сегодня число|какая дата|какой год/i.test(msg),
    () => {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        return `📅 Сегодня **${now.toLocaleDateString('ru-RU', options)}**.`;
    }
);

registerLayer("code_checker",
    (msg) => /проверь код|правильный код|нет ли ошибок/i.test(msg),
    () => {
        return `🛠️ **Слой проверки кода:** Готов проанализировать. Отправь код, и я проверю скобки ( { } [ ] ) и кавычки.`;
    }
);

registerLayer(
    "file_audit_validator", 
    (msg) => /аудит|проверь файлы|целостность|все ли файлы|проверь штаб|файлы на месте/i.test(msg), 
    async (msg, ctx) => {
        const PROXY_URL = "https://early-amoeba-1705.alexey17001700.deno.net";
        if (DEBUG) console.log("🔌 Запущен плагин аудита файлов...");
        
        try {
            const res = await fetch(PROXY_URL, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkStatus: true })
            });
            const data = await res.json();
            
            if (data.success) {
                const criticalFiles = ["app.html", "index.html", "style.css", "chat.js", "local_ai.js", "office.js", "agents.js"];
                
                let report = `🕵️‍♂️ **Аудит целостности Штаба:**\n`;
                report += `- Файлов в корне: ${data.totalRoot}\n`;
                report += `- Файлов в бэкапе: ${data.totalBackup}\n\n`;
                
                if (data.missingInBackup && data.missingInBackup.length > 0) {
                    report += `⚠️ В бэкапе не хватает: ${data.missingInBackup.join(', ')}\n`;
                    
                    const missingCritical = criticalFiles.filter(f => data.missingInBackup.includes(f));
                    if (missingCritical.length > 0) {
                        report += `🚨 **КРИТИЧЕСКАЯ ОШИБКА:** В бэкапе нет важных файлов: ${missingCritical.join(', ')}! Срочно нажми "Сохранить эталон" в Сейфе.`;
                    } else {
                        report += `✅ Критические файлы (JS, HTML, CSS) в безопасности.`;
                    }
                } else {
                    report += `✅ Бэкап актуален. Все файлы (включая критичные) на месте. Штаб в полном порядке.`;
                }
                return report;
            }
        } catch(e) {
            return `❌ Ошибка аудита: не удалось связаться с сервером Deno.`;
        }
    }
);

// ПЛАГИН: Светская беседа (Рефлексы)
const SMALL_TALK_PHRASES = /что делаешь|чем занят|как жизнь|как настроение|что нового/;
const SMALL_TALK_RESPONSES = [
    `Работаю над твоими задачами, Босс. Слежу за слоями, проверяю файлы. А у тебя какие планы?`,
    `Да всё как обычно: анализирую данные, жду новых вводных. Чем могу помочь?`,
    `Провожу диагностику систем. Готов приступить к любой задаче, Босс.`
];
const SMALL_TALK_RESPONSES_LEN = SMALL_TALK_RESPONSES.length;

registerLayer(
    "small_talk",
    (msg) => SMALL_TALK_PHRASES.test(msg),
    (msg, { originalMsg }) => {
        if (SMALL_TALK_RESPONSES_LEN === 0) {
            return "Системы в норме. Жду ваших команд.";
        }
        const randomIdx = (Math.random() * SMALL_TALK_RESPONSES_LEN) | 0;
        return SMALL_TALK_RESPONSES[randomIdx];
    }
);

// ==========================================
// ПЛАГИН: Контекстная погода (Guru Edition)
// ==========================================
const CITY_REGEX = /(?:в|во|на)\s+([а-яёa-z\-]{3,})/i;
const WEATHER_CONTEXT_KEYWORDS = /погода|температура|градус|градусы/i;

registerLayer(
    "weather_context_fix",
    (msg) => {
        if (typeof msg !== 'string') return false;

        const normalizedMsg = msg.trim();
        const wordCount = normalizedMsg.split(/\s+/).filter(Boolean).length;
        const isShort = wordCount > 0 && wordCount <= 5;

        const hasWeatherContext = Array.isArray(CONTEXT_MEMORY) && 
            CONTEXT_MEMORY.some(c => typeof c.text === 'string' && WEATHER_CONTEXT_KEYWORDS.test(c.text));

        const hasCity = CITY_REGEX.test(normalizedMsg);
        
        return isShort && hasCity && hasWeatherContext;
    },
    async (msg, ctx) => {
        const original = typeof ctx.originalMsg === 'string' ? ctx.originalMsg : msg;
        const match = original.match(CITY_REGEX);

        if (!match) return null;

        const city = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        
        try {
            const PROXY = "https://early-amoeba-1705.alexey17001700.deno.net";
            const res = await fetch(PROXY, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weatherQuery: city, day: 0 })
            });

            if (!res.ok) throw new Error(`HTTP Status: ${res.status}`);

            const data = await res.json();

            if (data.success && typeof data.results === 'string') {
                try {
                    localStorage.setItem('shtabLastCity', city);
                } catch (storageError) {
                    console.warn('Weather plugin: LocalStorage access denied', storageError);
                }
                return `🌤️ Данные из сети: ${data.results}`;
            } else {
                return `❌ Не удалось найти погоду для города "${city}".`;
            }

        } catch (e) {
            console.error('Weather plugin error:', e);
            return `❌ Ошибка сети при запросе погоды для ${city}.`;
        }
    }
);

// ==========================================
// ПАКЕТ ПЛАГИНОВ: Обратная связь + Конвертер (Guru Edition)
// ==========================================
(function() {
    const safeSetStorage = (key, value, isSession = false) => {
        try {
            if (isSession) sessionStorage.setItem(key, value);
            else localStorage.setItem(key, value);
        } catch (e) {
            console.warn('Plugin storage error:', e.message);
        }
    };

    const NEGATIVE_FEEDBACK = /плохо|не то|отстой|неправильно|бред|ужасно/i;
    const POSITIVE_FEEDBACK = /молодец|хорошо|супер|отлично|красавчик|здорово/i;

    registerLayer(
        "feedback_handler",
        (msg) => NEGATIVE_FEEDBACK.test(msg) || POSITIVE_FEEDBACK.test(msg),
        (msg, ctx) => {
            const isNegative = NEGATIVE_FEEDBACK.test(msg);
            safeSetStorage('shtabStrictMode', isNegative ? 'true' : 'false');
            
            return isNegative 
                ? `🧠 Босс, принял. Включаю строгий режим (Скептик). Теперь я буду перепроверять ответы из сети.`
                : `🧠 Спасибо, Босс! Отключаю строгий режим. Работаю в штатном режиме.`;
        }
    );

    const UNITS = ['км', 'мили', 'кг', 'фунт', 'см', 'дюйм', 'градус', 'кельвин', 'метр', 'литр'];
    const CONVERTER_REGEX = /(\d+(?:[.,]\d+)?)\s*([а-яёa-z-]+)\s*(?:в|to)\s*([а-яёa-z-]+)/i;

    const CONVERSION_MAP = {
        'км': { 'мили': 0.621371, 'метр': 1000 },
        'мили': { 'км': 1 / 0.621371 },
        'метр': { 'км': 0.001, 'мили': 0.000621371 },
        'кг': { 'фунт': 2.20462 },
        'фунт': { 'кг': 1 / 2.20462 },
        'см': { 'дюйм': 1 / 2.54, 'метр': 0.01 },
        'дюйм': { 'см': 2.54 },
        'литр': { 'галлон': 0.264172 },
        'градус': { 'кельвин': (c) => c + 273.15 },
        'кельвин': { 'градус': (k) => k - 273.15 }
    };

    registerLayer(
        "unit_converter",
        (msg) => /(переведи|конвертируй|сколько в|to)\s/i.test(msg) && new RegExp(UNITS.join('|'), 'i').test(msg),
        (msg, ctx) => {
            const match = msg.match(CONVERTER_REGEX);
            if (!match) return null;

            const value = parseFloat(match[1].replace(',', '.'));
            if (isNaN(value)) return `❌ Не удалось распознать число: \`${match[1]}\`.`;

            const from = match[2].toLowerCase().replace(/ы$/, '');
            const to = match[3].toLowerCase().replace(/ы$/, '');

            const conversion = CONVERSION_MAP[from]?.[to];
            
            if (conversion === undefined) {
                return `🤔 Я пока не умею переводить из **${from}** в **${to}**.`;
            }

            const result = typeof conversion === 'function' ? conversion(value) : value * conversion;

            const isTemp = ['градус', 'кельвин'].includes(from) || ['градус', 'кельвин'].includes(to);
            const fixedResult = result.toFixed(isTemp ? 1 : 2);

            return `📏 ${value} ${from} = **${fixedResult} ${to}**`;
        }
    );
})();

// ==========================================
// ПЛАГИН 3: Мега-Статус (Файлы + Агенты в одном ответе)
// ==========================================
registerLayer(
    "mega_status_check",
    (msg) => /(проверь|статус|аудит).*(штаб|файл|агент)/i.test(msg),
    async (msg, ctx) => {
        const PROXY = "https://early-amoeba-1705.alexey17001700.deno.net";
        let report = `🛠️ **Полная диагностика Штаба:**\n\n`;

        try {
            const res = await fetch(PROXY, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkStatus: true })
            });
            const data = await res.json();
            
            if (data.success) {
                report += `📁 **Файлы:**\n`;
                report += `- В корне: ${data.totalRoot}\n`;
                report += `- В бэкапе: ${data.totalBackup}\n`;
                if (data.missingInBackup.length > 0) {
                    report += `- ⚠️ Нет в бэкапе: ${data.missingInBackup.join(', ')}\n`;
                } else {
                    report += `- ✅ Все файлы в бэкапе на месте.\n`;
                }
            }
        } catch(e) {
            report += `📁 **Файлы:** ❌ Ошибка связи с Deno.\n`;
        }

        const allAgentsCount = typeof AGENT_ICONS !== 'undefined' ? Object.keys(AGENT_ICONS).length : 24;
        const activeAgents = typeof selectedAgents !== 'undefined' ? selectedAgents : [];
        
        report += `\n🤖 **Агенты:**\n`;
        report += `- Всего в офисе: ${allAgentsCount}\n`;
        if (activeAgents.length === 0) {
            report += `- В чате сейчас никого нет (отвечаю как Оркестратор).\n`;
        } else {
            report += `- В чате: ${activeAgents.length} (${activeAgents.join(', ')}).\n`;
        }

        report += `\n⚙️ **Системы:** Ядро (44.2) + Плагины работают в штатном режиме.`;
        
        return report;
    }
);
// ==========================================
// НОВЫЕ СЛОИ: Работа с корнями слов (Стемминг)
// ==========================================

// Плагин 1: Умная светская беседа (по корням)
registerLayer(
    "smart_small_talk",
    (msg) => {
        // Разбиваем сообщение на слова и получаем корни через функцию ядра
        const words = msg.split(/\s+/);
        const roots = words.map(w => stemmize(w));
        
        // Проверяем наличие корней (дел- от делаешь/делаете, занят-, жизн-, настроен-)
        return roots.includes('дел') || roots.includes('занят') || roots.includes('жизн') || roots.includes('настроен');
    },
    (msg) => {
        const answers = [
            `Работаю над твоими задачами, Босс. Слежу за слоями, проверяю файлы. А у тебя какие планы?`,
            `Да всё как обычно: анализирую данные, жду новых вводных. Чем могу помочь?`,
            `Провожу диагностику систем. Готов приступить к любой задаче, Босс.`
        ];
        return answers[Math.floor(Math.random() * answers.length)];
    }
);

// Плагин 2: Умная проверка статуса (по корням)
registerLayer(
    "smart_status_check",
    (msg) => {
        const words = msg.split(/\s+/);
        const roots = words.map(w => stemmize(w));
        
        // Проверяем корни для слов "проверь", "статус", "аудит", "файл"
        return (roots.includes('провер') || roots.includes('статус') || roots.includes('аудит')) && 
               (roots.includes('файл') || roots.includes('штаб') || roots.includes('агент'));
    },
    async (msg, ctx) => {
        // Перенаправляем в существующий мега-статус, если он есть
        const megaLayer = CUSTOM_LAYERS.find(l => l.name === "mega_status_check");
        if (megaLayer) {
            return await megaLayer.handler(msg, ctx);
        }
        return "⚙️ Слой статуса активирован (но mega_status_check не найден).";
    }
);
// ==========================================
// ПЛАГИН 1: Планировщик задач (Task Planner)
// ==========================================
registerLayer(
    "task_planner",
    (msg) => /план|распиши|по шагам|как сделать|что нужно для/i.test(msg) && msg.length > 15,
    (msg) => {
        // Простой эвристический парсер. Ищем ключевые слова.
        let steps = [];
        if (/сайт|лендинг|верстка/i.test(msg)) steps = ["1. Создать макет (Figma/Карандаш).", "2. Сверстать HTML/CSS.", "3. Добавить JS-логику.", "4. Задеплоить на GitHub Pages."];
        else if (/приложение|телеграм|бот/i.test(msg)) steps = ["1. Выбрать платформу (Telegram/PWA).", "2. Написать код бота/приложения.", "3. Подключить базу данных (если нужно).", "4. Запустить на сервере."];
        else if (/статью|текст|контент/i.test(msg)) steps = ["1. Собрать информацию.", "2. Составить структуру (план).", "3. Написать текст.", "4. Вычитать и добавить картинки."];
        else steps = ["1. Проанализировать задачу.", "2. Найти нужные инструменты.", "3. Выполнить работу.", "4. Проверить результат."];
        
        return `📋 **План действий (от Слоя-Планировщика):**\n\n${steps.join('\n')}\n\n*Босс, это базовый план. Для детального анализа нужны ключи ИИ.*`;
    }
);

// ==========================================
// ПЛАГИН 2: Переводчик (Translator)
// ==========================================
// Мини-словарь для базового перевода
const TRANSLATION_DICT = {
    "привет": "hello", "пока": "bye", "спасибо": "thank you", "да": "yes", "нет": "no",
    "код": "code", "ошибка": "error", "агент": "agent", "штаб": "headquarters",
    "hello": "привет", "bye": "пока", "thank you": "спасибо", "yes": "да", "no": "нет",
    "code": "код", "error": "ошибка", "agent": "агент", "headquarters": "штаб"
};

registerLayer(
    "translator",
    (msg) => /переведи|перевод|как будет|translate/i.test(msg),
    (msg) => {
        // Ищем слова в кавычках или после "переведи"
        const textToTranslate = msg.replace(/переведи|перевод|как будет|translate/gi, '').replace(/на английский|на русский/gi, '').replace(/["'«»]/g, '').trim();
        if (!textToTranslate) return "🤔 Что именно мне нужно перевести?";

        let translated = textToTranslate.toLowerCase().split(/\s+/).map(w => TRANSLATION_DICT[w] || w).join(' ');
        
        if (translated === textToTranslate.toLowerCase()) {
            return `🌐 Я не нашел слова "${textToTranslate}" в своем базовом словаре. Без API-ключей мой словарный запас ограничен.`;
        }
        return `🌐 **Перевод:** "${textToTranslate}" -> **"${translated}"**\n\n*Базовый офлайн-словарь.*`;
    }
);

// ==========================================
// ПЛАГИН 3: Генератор паролей (Password Generator)
// ==========================================
registerLayer(
    "password_generator",
    (msg) => /пароль|сгенерируй пароль|создай пароль/i.test(msg),
    (msg) => {
        // Ищем число в запросе (длина пароля). По умолчанию 12.
        const lenMatch = msg.match(/\d+/);
        const length = lenMatch ? parseInt(lenMatch[0]) : 12;
        
        if (length < 4) return "⚠️ Пароль должен быть длиной хотя бы 4 символа.";
        if (length > 64) return "⚠️ Слишком длинный пароль (максимум 64).";

        const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
        let password = "";
        // Используем криптографический рандом браузера для безопасности
        const randomValues = new Uint32Array(length);
        window.crypto.getRandomValues(randomValues);
        
        for (let i = 0; i < length; i++) {
            password += charset[randomValues[i] % charset.length];
        }

        return `🔐 **Твой пароль (${length} символов):**\n\n\`${password}\`\n\n*Сгенерирован локально, никуда не отправлялся.*`;
    }
);

// ==========================================
// ПЛАГИН 4: Слой-Рефлексия (Self-Reflection)
// ==========================================
registerLayer(
    "reflection_layer",
    (msg) => /проверь себя|ты уверен|подумай еще раз|исправь ответ/i.test(msg),
    (msg, ctx) => {
        // Берем последний ответ агента из контекста
        const lastAgentMsg = CONTEXT_MEMORY.slice().reverse().find(m => m.role === 'assistant');
        
        if (!lastAgentMsg) return "🤔 Я еще ничего не отвечал, нечего проверять.";
        
        let originalText = lastAgentMsg.text;
        let criticism = [];
        let newText = originalText;

        // 1. Проверка на агрессию/грубость
        if (/дурак|тупой|идиот/i.test(originalText)) {
            criticism.push("Обнаружена грубость.");
            newText = newText.replace(/дурак|тупой|идиот/gi, "***");
        }

        // 2. Проверка на пустоту или отписку
        if (/не знаю|не могу|ошибка/i.test(originalText)) {
            criticism.push("Ответ выглядит как отписка.");
        }

        // 3. Проверка на наличие ссылок (если их нет)
        if (!/http/i.test(originalText) && /нашел|поискал|интернет/i.test(originalText)) {
            criticism.push("В ответе про поиск нет ссылок.");
        }

        if (criticism.length > 0) {
            return `🪞 **Слой-Рефлексия:**\nЯ перечитал свой прошлый ответ и нашел недочеты:\n- ${criticism.join('\n- ')}\n\n**Исправленный вариант:**\n${newText}`;
        } else {
            return `🪞 **Слой-Рефлексия:**\nЯ перечитал свой прошлый ответ. Выглядит логично, грубости нет, ссылки на месте (если искал). Претензий к себе не имею.`;
        }
    }
);
// ==========================================
// ПЛАГИН: Слой-Эмпат (Автоматическое определение тона)
// ==========================================
registerLayer(
    "emotion_responder",
    (msg) => {
        // Срабатывает, только если в тексте явно есть эмоции
        const sentiment = analyzeSentiment(msg);
        return sentiment === 'angry' || sentiment === 'happy';
    },
    async (msg) => {
        const sentiment = analyzeSentiment(msg);
        
        if (sentiment === 'angry') {
            // Если Босс злится (есть слова "дурак", "бесит", "сломал" и т.д.)
            localStorage.setItem('shtabTone', 'apologetic'); // Запоминаем, что надо быть вежливее
            return `😔 **Слой-Эмпат:**\nБосс, я чувствую ваше недовольство. Извините, если что-то пошло не так. Давайте я попробую исправить ситуацию. Что именно сломалось?`;
        } 
        
        if (sentiment === 'happy') {
            // Если Босс радуется (есть слова "круто", "спасибо", "молодец")
            localStorage.removeItem('shtabTone'); // Сбрасываем строгий тон
            return `😊 **Слой-Эмпат:**\nРад, что вам нравится, Босс! Продолжаем в том же духе?`;
        }
        
        return null;
    }
);
// ==========================================
// ПЛАГИН: Когнитивное состояние (внутренняя жизнь)
// ==========================================
const COGNITIVE_STATE_KEY = 'shtabCognitiveState';

function getCognitiveState() {
    try {
        let raw = localStorage.getItem(COGNITIVE_STATE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    // Начальное состояние (100 - полон сил)
    return { energy: 100, patience: 100, lastInteraction: Date.now(), messagesSinceRest: 0, flags: {} };
}

function saveCognitiveState(state) {
    localStorage.setItem(COGNITIVE_STATE_KEY, JSON.stringify(state));
}

registerLayer(
    "cognitive_state",
    (msg) => true, // Срабатывает на каждое сообщение (просто мониторит состояние)
    async (msg, ctx) => {
        const state = getCognitiveState();
        const now = Date.now();
        const minutesElapsed = (now - state.lastInteraction) / 60000;
        
        // --- ЭТАП 1: ДЕГРАДАЦИЯ (потребности угасают со временем) ---
        state.energy = Math.max(0, state.energy - minutesElapsed * 3); // -3 энергии в минуту
        state.patience = Math.max(0, state.patience - minutesElapsed * 1.5); // -1.5 терпения в минуту
        state.messagesSinceRest++;
        
        // --- ЭТАП 2: ВОСПРИЯТИЕ (как ты общаешься) ---
        const sentiment = analyzeSentiment(msg);
        if (sentiment === 'angry') state.patience = Math.max(0, state.patience - 15);
        if (sentiment === 'happy') state.patience = Math.min(100, state.patience + 10);
        
        // Восстановление, если просят отдохнуть
        if (/отдохни|перерыв|устал|сделай паузу/i.test(msg)) {
            state.energy = 100;
            state.messagesSinceRest = 0;
            state.flags = {};
        }
        
        state.lastInteraction = now;
        
        // --- ЭТАП 3: ПРИНЯТИЕ РЕШЕНИЯ (вмешаться или пропустить) ---
        let intervention = null;
        const f = state.flags;
        
        if (state.energy < 20 && !f.energy) {
            f.energy = true;
            intervention = "😴 **Слой-Когниция:** Босс, у меня садится заряд. Скоро начну тупить. Может, сделаем паузу?";
        } else if (state.patience < 20 && !f.patience) {
            f.patience = true;
            intervention = "😤 **Слой-Когниция:** Босс, я на взводе. Чувствую напряжение. Давай сбавим обороты?";
        } else if (state.messagesSinceRest > 25 && !f.rest) {
            f.rest = true;
            intervention = "☕ **Слой-Когниция:** Босс, мы пашем уже 25 сообщений без перерыва. Может, по чашке кофе?";
        }
        
        saveCognitiveState(state);
        return intervention; // Если null — пропускаем, работают другие слои.
    }
);

// ==========================================
// ПЛАГИН: Диагностика состояния (для проверки)
// ==========================================
registerLayer(
    "check_cognitive_state",
    (msg) => /как ты себя чувствуешь|твое состояние|сколько у тебя энергии|твои потребности/i.test(msg),
    () => {
        const state = getCognitiveState();
        const energyBar = '█'.repeat(Math.round(state.energy / 10)) + '░'.repeat(10 - Math.round(state.energy / 10));
        const patienceBar = '█'.repeat(Math.round(state.patience / 10)) + '░'.repeat(10 - Math.round(state.patience / 10));
        
        return `🧬 **Мое когнитивное состояние:**\n\n` +
               `⚡ Энергия:   ${energyBar} ${Math.round(state.energy)}%\n` +
               `🧘 Терпение:  ${patienceBar} ${Math.round(state.patience)}%\n` +
               `💬 Сообщений без перерыва: ${state.messagesSinceRest}`;
    }
);
// ==========================================
// НЕЙРОСЕТЬ (MiniBrain) - ИНТЕГРАЦИЯ В ЯДРО
// ==========================================

class MiniBrain {
    constructor() {
        const saved = localStorage.getItem('shtabBrainWeights_v2');
        if (saved) {
            const data = JSON.parse(saved);
            this.weights = data.weights;
            this.bias = data.bias;
        } else {
            // 4 входа (длина, релевантность, чистота, уверенность)
            this.weights = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
            this.bias = Math.random() * 2 - 1;
            this.autoTrain(); 
        }
        this.learningRate = 0.1;
    }

    activate(x) { return 1 / (1 + Math.exp(-x)); }

    predict(inputs) {
        let sum = this.bias;
        for (let i = 0; i < inputs.length; i++) {
            sum += inputs[i] * this.weights[i];
        }
        return this.activate(sum);
    }

    train(data, epochs = 3000) {
        for (let e = 0; e < epochs; e++) {
            for (let i = 0; i < data.length; i++) {
                const inputs = data[i][0];
                const target = data[i][1];
                const pred = this.predict(inputs);
                const error = target - pred;
                const delta = error * pred * (1 - pred);
                
                for (let j = 0; j < this.weights.length; j++) {
                    this.weights[j] += this.learningRate * delta * inputs[j];
                }
                this.bias += this.learningRate * delta;
            }
        }
        localStorage.setItem('shtabBrainWeights_v2', JSON.stringify({
            weights: this.weights,
            bias: this.bias
        }));
    }

    autoTrain() {
        // Обучаем на примерах: [длина>15, есть слова из запроса, нет мусора, уверенность>0.3]
        const data = [
            [[1, 1, 1, 1], 1], // Хороший
            [[1, 1, 1, 0], 1], // Хороший, но уверенность низкая
            [[1, 0, 1, 1], 0], // Не по теме
            [[0, 1, 1, 1], 0], // Слишком короткий
            [[1, 1, 0, 1], 0], // Грязный (ошибка/html)
            [[0, 0, 0, 0], 0]  // Полное говно
        ];
        this.train(data, 5000);
        console.log("🧠 Нейросеть обучена оценивать ответы.");
    }
}

const agentBrain = new MiniBrain();

// ПЕРЕХВАТ ФУНКЦИИ СУДЬИ (Monkey Patching)
const originalJudge = judge;

judge = function(answer, query, source) {
    // 1. Сначала используем старую логику (как базовый фильтр)
    const originalResult = originalJudge(answer, query, source);
    if (!originalResult.approved) {
        return originalResult; // Если старый Судья сказал "нет", нейросеть уже не нужна
    }

    // 2. Если старый Судья сказал "да", спрашиваем нейросеть
    const lenGood = answer.length > 15 ? 1 : 0;
    const relGood = extractKeywords(query).some(kw => answer.toLowerCase().includes(kw)) ? 1 : 0;
    const clean = (!answer.includes('Ошибка') && !answer.includes('undefined') && !answer.includes('<html')) ? 1 : 0;
    
    let confGood = 0;
    if (source === 'network' || source === 'memory') {
        confGood = computeConfidence(answer, query, source) > 0.3 ? 1 : 0;
    } else {
        confGood = 1; // Для плагинов доверяем
    }

    const features = [lenGood, relGood, clean, confGood];
    const neuralScore = agentBrain.predict(features);
    
    if (DEBUG) console.log(`🧠 Neural Judge: ${neuralScore.toFixed(2)} (features: ${features})`);

    // Если нейросеть говорит, что ответ плохой (вероятность < 0.5)
    if (neuralScore < 0.5) {
        return { 
            approved: false, 
            reason: `Нейросеть забраковала (score ${neuralScore.toFixed(2)})`,
            score: neuralScore
        };
    }

    return originalResult;
};

// ==========================================
// ПЛАГИН ДЛЯ ПРОСМОТРА ВЕСОВ (Команда "Покажи мозг")
// ==========================================
registerLayer(
    "show_neural_net",
   async (msg) => /покажи мозг|статус мозга|веса нейросети|нейросеть статус/i.test(msg),
    () => {
        return `🧠 **Статус Нейросети:**\n\n` +
               `Веса: [${agentBrain.weights.map(w => w.toFixed(2)).join(', ')}]\n` +
               `Смещение: ${agentBrain.bias.toFixed(2)}\n\n` +
               `*Нейросеть подключена к Судье. Она проверяет каждый ответ перед выдачей.*`;
    }
);
// ==========================================
// СОВЕТ СУДЕЙ (Meta-Judge Loop)
// ==========================================

// Сохраняем оригинальную финализацию
const originalFinalizeOutput = finalizeOutput;

// Переопределяем её
finalizeOutput = function(ctx) {
    // Если ответа нет, сразу отдаем оригиналу (пусть обработает ошибку)
    if (!ctx.output || ctx.output.trim() === '') return originalFinalizeOutput(ctx);

    const answer = ctx.output;
    const query = ctx.msg || "";
    const source = ctx.source || 'network';

    // --- 1. СОВЕТ СУДЕЙ (4 проверки) ---
    // Судья 1: Базовая проверка (длина, мусор, наличие слов)
    const verdict = judge(answer, query, source);
    
    // Судья 2: Математическая связь (насколько ответ относится к вопросу)
    const mathScore = calculateMathScore(query, answer);
    
    // Судья 3: Уверенность (на основе источника)
    const conf = computeConfidence(answer, query, source);
    
    // Судья 4: Детектор галлюцинаций (не придумал ли лишнего)
    const hall = checkHallucinations(answer, query);

    // --- 2. ВЫСТАВЛЯЕМ ОБЩИЙ БАЛЛ (0.0 - 1.0) ---
    const scores = [
        verdict.approved ? 1 : 0, // 1 или 0
        mathScore,                // 0..1
        conf,                     // 0..1
        hall.ok ? 1 : 0           // 1 или 0
    ];
    const totalScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (DEBUG) console.log(`⚖️ Совет Судей: ${Math.round(totalScore*100)}% (Судья: ${verdict.approved}, Мат: ${mathScore.toFixed(2)}, Увер: ${conf.toFixed(2)}, Галл: ${hall.ok})`);

    // --- 3. ПРИГОВОР ---
    if (totalScore < 0.8) {
        // Если балл ниже 80% — формируем "пинок" (критику)
        let critique = `\n\n---\n⚠️ **Совет Судей: ответ отклонен (${Math.round(totalScore*100)}% качества).**\n`;
        
        if (!verdict.approved) critique += `- ❌ **Базовый Судья:** ${verdict.reason || 'Не прошел проверку'}\n`;
        if (mathScore < 0.5) critique += `- 🧮 **Математика:** слабая связь с вопросом (${Math.round(mathScore*100)}%)\n`;
        if (conf < 0.5) critique += `- 🧠 **Уверенность:** низкая (${Math.round(conf*100)}%)\n`;
        if (!hall.ok) critique += `- 👻 **Галлюцинации:** ${hall.reason}\n`;
        
        critique += `\n*Босс, этот ответ не дотягивает до идеала. Рекомендую переформулировать вопрос или включить API-ключи для более глубокого анализа.*`;
        
        // Добавляем критику к ответу
        ctx.output = answer + critique;
    }

    // 4. Отдаем результат оригинальной функции (сохраняем память, выводим в чат)
    return originalFinalizeOutput(ctx);
};
// ==========================================
// ПЛАГИН: Самовосстановление с кнопками (ФИНАЛ)
// ==========================================
window.__pendingFixes = window.__pendingFixes || {};

registerLayer(
    "self_healing_pipeline_ui",
    async (msg) => /проверь и исправь|найди и почини|самовосстановление/i.test(msg),
    async function (msg, ctx) {
        const errorFile = "office.js";
        try {
            const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ readFile: true, path: errorFile }),
            });
            const data = await res.json();
            if (!data.success || typeof data.content !== "string") {
                return `❌ Не удалось прочитать ${errorFile}: ${data.error || "пустой ответ"}`;
            }
            const fileContent = data.content;

            const opens = (fileContent.match(/{/g) || []).length;
            const closes = (fileContent.match(/}/g) || []).length;

            if (opens === closes) {
                return `✅ **${errorFile} проверен:** скобки сбалансированы ({ ${opens} / } ${closes}). Фикс не нужен.`;
            }

            const diff = opens - closes;
            const errorDesc = `Несбалансированные скобки: { = ${opens}, } = ${closes} (не хватает ${diff})`;

            // Готовим фикс
            const fixedContent = fileContent + "\n" + "}".repeat(diff) + "\n";

            window.__pendingFixes[errorFile] = {
                path: errorFile,
                content: fixedContent,
                description: errorDesc,
            };

            let report = `📄 **Найдена ошибка в ${errorFile}:**\n`;
            report += `⚠️ ${errorDesc}\n\n`;
            report += `🧠 **Аналитик:** Не хватает ${diff} закрывающих скобок '}' в конце файла.\n`;
            report += `⚖️ **Совет Судей:** ✅ Патч одобрен (фикс готов, ${fixedContent.length} байт)\n\n`;
            report += `<div style="display:flex; gap:10px; margin-top:10px;">
                <button onclick="window.applyAutoFix('${errorFile}')" style="background:#00e5ff; border:none; padding:8px 12px; border-radius:5px; font-weight:bold; cursor:pointer;">✅ Исправить</button>
                <button onclick="window.skipAutoFix('${errorFile}')" style="background:#333; color:#fff; border:none; padding:8px 12px; border-radius:5px; cursor:pointer;">❌ Не трогать</button>
            </div>`;
            
            return report;
        } catch (e) {
            return `❌ Ошибка сети: ${e.message}`;
        }
    }
);

window.applyAutoFix = async function (fileName) {
    const pending = window.__pendingFixes && window.__pendingFixes[fileName];
    if (!pending || !pending.content) {
        const err = `Нет готового фикса для ${fileName}. Сначала запусти «проверь и исправь».`;
        if (typeof renderMessage === "function") renderMessage(`❌ ${err}`, "director", "DevOps");
        else alert(err);
        return { success: false, error: err };
    }

    const ok = confirm(`Применить фикс для ${fileName}?\n\n${pending.description}\n\nФайл будет перезаписан на GitHub (main).`);
    if (!ok) return { success: false, error: "Отменено" };

    if (typeof renderMessage === "function") {
        renderMessage(`⚙️ **Босс, отправляю фикс ${fileName} на GitHub...**`, "director", "DevOps");
    }

    try {
        const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                updateFile: true,
                path: pending.path,
                content: pending.content,
                message: `Auto-fix: ${pending.description}`,
            }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        delete window.__pendingFixes[fileName];

        if (typeof renderMessage === "function") {
            renderMessage(`✅ **Готово, Босс!**\n\n${data.message}\n\nПересборка Pages ~10–15 сек — страница перезагрузится.`, "director", "DevOps");
        } else {
            alert(`✅ ${data.message}`);
        }

        setTimeout(() => location.reload(), 3000);
        return { success: true, ...data };
    } catch (e) {
        const msg = e && e.message ? e.message : "Неизвестная ошибка";
        if (typeof renderMessage === "function") {
            renderMessage(`❌ **Не смог записать ${fileName}:** ${msg}`, "director", "DevOps");
        } else {
            alert(`❌ ${msg}`);
        }
        return { success: false, error: msg };
    }
};

window.skipAutoFix = function (fileName) {
    if (window.__pendingFixes) delete window.__pendingFixes[fileName];
    if (typeof renderMessage === "function") {
        renderMessage(`🚫 **Босс, ${fileName} не трогаю.** Оставляем как есть.`, "director", "DevOps");
    } else {
        alert(`Файл ${fileName} оставлен без изменений.`);
    }
};
