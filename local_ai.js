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
// ==========================================
// 🔧 УНИВЕРСАЛЬНЫЙ ФИКС (Защита от крашей)
// ==========================================
// ==========================================
// 🧠 УМНЫЙ АНАЛИЗАТОР СКОБОК (Игнорирует строки и комменты)
// ==========================================
window.analyzeBraces = function(code) {
    let inString = false, stringChar = '';
    let inLineComment = false, inBlockComment = false;
    let braces = [];

    for (let i = 0; i < code.length; i++) {
        const c = code[i], next = code[i + 1];

        if (inLineComment) {
            if (c === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (c === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }
        if (inString) {
            if (c === '\\') { i++; continue; } // Пропускаем экранирование
            if (c === stringChar) inString = false;
            continue;
        }

        if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue; }

        if (c === '{' || c === '}') {
            braces.push({ char: c, index: i });
        }
    }

    let stack = [];
    let excessCloses = []; // Индексы лишних закрывающих скобок

    braces.forEach(b => {
        if (b.char === '{') {
            stack.push(b.index);
        } else if (b.char === '}') {
            if (stack.length > 0) {
                stack.pop(); // Нашли пару
            } else {
                excessCloses.push(b.index); // Это лишняя закрывающая
            }
        }
    });

    return {
        missingOpens: stack.length, // Сколько не хватает закрывающих
        excessCloses: excessCloses  // Массив индексов лишних закрывающих (их надо удалить)
    };
};
window.__layerWarnings = window.__layerWarnings || [];
(function () {
    if (window.registerLayer && window.registerLayer.__isSafeWrapper) return;
    const __orig = window.registerLayer || (typeof registerLayer === "function" ? registerLayer : null);
    if (!__orig) return;
    function safeRegisterLayer(name, matcher, handler) {
        const isAsync = handler && handler.constructor && handler.constructor.name === "AsyncFunction";
        const safeHandler = function (...args) {
            try {
                const result = handler.apply(this, args);
                if (result && typeof result.then === "function") return result;
                if (!isAsync) window.__layerWarnings.push({ name, type: "sync", ts: Date.now() });
                return Promise.resolve(result);
            } catch (e) {
                console.error(`[SafeRegister] Слой "${name}" упал:`, e);
                window.__layerWarnings.push({ name, type: "error", msg: e.message, ts: Date.now() });
                return Promise.resolve(`⚠️ Слой \`${name}\` упал: ${e.message}`);
            }
        };
        safeHandler.__isSafeWrapped = true;
        safeHandler.__originalHandler = handler;
        return __orig(name, matcher, safeHandler);
    }
    safeRegisterLayer.__isSafeWrapper = true;
    window.registerLayer = safeRegisterLayer;
    try { registerLayer = safeRegisterLayer; } catch (e) {}
})();

// ==========================================
// ПЛАГИН: Сканирование всех файлов и фиксы
// ==========================================

        registerLayer(
    "self_healing_pipeline_ui",
    (msg) => {
        const t = msg.toLowerCase();
        const action = /(проверь|исправь|почини|аудит|диагностик|скан|глянь|найди)/i.test(t);
        const target = /(штаб|код|файл|проект|ошибк|баг|слой|плагин)/i.test(t);
        return (action && target) || /самовосстановление/i.test(t);
    },
    async function (msg, ctx) {
        try {
            const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scanRepo: true }),
            });
            const data = await res.json();
            if (!data.success) return `❌ Не удалось просканировать: ${data.error || "ошибка"}`;
            window.__lastScanData = data; // <--- ВОТ ОНА, ПАМЯТЬ БОТА
            
            if (!data.issues || data.issues.length === 0) {
                return `✅ **Сканирование завершено:** проверено ${data.scanned} файлов. Ошибок не найдено!`;
            }

            window.__pendingFixes = window.__pendingFixes || {};
            let report = `🩺 **Сканирование завершено**\n📁 Проверено файлов: **${data.scanned}**\n⚠️ Найдено проблем: **${data.issues.length}**\n\n`;

            data.issues.forEach((issue, idx) => {
                report += `**${idx + 1}. ${issue.path}**\n`;

                // Запускаем УМНЫЙ анализ
                const analysis = window.analyzeBraces(issue.content);
                let fixedContent = issue.content;
                let fixDesc = "";

                if (analysis.missingOpens > 0) {
                    fixedContent += "\n" + "}".repeat(analysis.missingOpens) + "\n";
                    fixDesc = `✅ Добавить ${analysis.missingOpens} скоб.`;
                } 
                
                if (analysis.excessCloses.length > 0) {
                    // Удаляем лишние скобки с конца, чтобы индексы не съезжали
                    const sortedIndices = [...analysis.excessCloses].sort((a, b) => b - a);
                    for (const idxToRemove of sortedIndices) {
                        fixedContent = fixedContent.slice(0, idxToRemove) + fixedContent.slice(idxToRemove + 1);
                    }
                    fixDesc = `🗑 Удалить ${analysis.excessCloses.length} лишн. скоб.`;
                }

                if (fixDesc) {
                    window.__pendingFixes[issue.path] = {
                        path: issue.path,
                        content: fixedContent,
                        description: fixDesc,
                    };
                    report += `   ${fixDesc}\n`;
                    report += `<div style="display:flex; gap:10px; margin:6px 0 10px 0;">
                        <button onclick="window.applyAutoFix('${issue.path}')" style="background:#00e5ff; border:none; padding:6px 10px; border-radius:5px; font-weight:bold; cursor:pointer;">✅ ${fixDesc}</button>
                        <button onclick="window.skipAutoFix('${issue.path}')" style="background:#333; color:#fff; border:none; padding:6px 10px; border-radius:5px; cursor:pointer;">❌ Не трогать</button>
                    </div>`;
                } else {
                    report += `   ⚠️ Ошибка есть, но умный анализатор не смог построить безопасный фикс.\n\n`;
                }
            });
            
            return report;
        } catch (e) {
            return `❌ Ошибка сети: ${e.message}`;
        }
    }
);

// ==========================================
// КНОПКИ (Запись на GitHub)
// ==========================================
window.applyAutoFix = async function (fileName) {
    const pending = window.__pendingFixes && window.__pendingFixes[fileName];
    if (!pending || !pending.content) {
        const err = `Нет готового фикса для ${fileName}. Запусти «проверь и исправь».`;
        if (typeof renderMessage === "function") renderMessage(`❌ ${err}`, "director", "DevOps"); else alert(err);
        return { success: false, error: err };
    }
    const ok = confirm(`Применить фикс для ${fileName}?\n\n${pending.description}\n\nФайл будет перезаписан на GitHub (main).`);
    if (!ok) return { success: false, error: "Отменено" };

    if (typeof renderMessage === "function") renderMessage(`⚙️ **Босс, отправляю фикс ${fileName} на GitHub...**`, "director", "DevOps");

    try {
        const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updateFile: true, path: pending.path, content: pending.content, message: `Auto-fix: ${pending.description}` }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

        delete window.__pendingFixes[fileName];
        if (typeof renderMessage === "function") renderMessage(`✅ **Готово, Босс!**\n\n${data.message}\n\nПересборка Pages ~10–15 сек.`, "director", "DevOps"); else alert(`✅ ${data.message}`);
        setTimeout(() => location.reload(), 3000);
        return { success: true, ...data };
    } catch (e) {
        const msg = e && e.message ? e.message : "Неизвестная ошибка";
        if (typeof renderMessage === "function") renderMessage(`❌ **Не смог записать ${fileName}:** ${msg}`, "director", "DevOps"); else alert(`❌ ${msg}`);
        return { success: false, error: msg };
    }
};

window.skipAutoFix = function (fileName) {
    if (window.__pendingFixes) delete window.__pendingFixes[fileName];
    if (typeof renderMessage === "function") renderMessage(`🚫 **Босс, ${fileName} не трогаю.**`, "director", "DevOps"); else alert(`Файл ${fileName} оставлен без изменений.`);
};

// ==========================================
// ПЛАГИН: Диагностика
// ==========================================
registerLayer(
    "plugin_health_checker",
    (msg) => /проверь плагины|проверь слои|диагностика слоев|health check|аудит плагинов/i.test(msg),
    async () => {
        const warnings = window.__layerWarnings || [];
        const safeReg = window.registerLayer && window.registerLayer.__isSafeWrapper;
        let report = `🩺 **Диагностика слоёв**\n\n🔧 Защитная обёртка: ${safeReg ? "✅ активна" : "❌ НЕТ"}\n📊 Предупреждений: ${warnings.length}\n\n`;
        if (warnings.length === 0) return report + `✅ Все слои отдают Promise. Проблем нет.`;
        const syncs = warnings.filter((w) => w.type === "sync");
        const errors = warnings.filter((w) => w.type === "error");
        if (syncs.length > 0) {
            report += `⚠️ **Синхронные слои:**\n`;
            [...new Set(syncs.map((w) => w.name))].forEach((n) => { report += `  • \`${n}\`\n`; });
            report += `\n`;
        }
                if (errors.length > 0) {
            report += `❌ **Упавшие слои:**\n`;
            errors.slice(-5).forEach((e) => { report += `  • \`${e.name}\`: ${e.msg}\n`; });
        }
        
        return report + `\n💡 **Совет Судьям:** Работа продолжается.`;
    }
);
// ==========================================
// ПЛАГИН: Память и статус ошибок (Делает ИИ умнее)
// ==========================================
registerLayer(
    "scan_status_reporter",
    (msg) => /сколько.*(ошиб|проблем|файл)|что.*(ошиб|сканир)|статус.*(проверк|штаб)|отчет|результат/i.test(msg),
    async () => {
        const lastScan = window.__lastScanData;
        
        if (!lastScan) {
            return "Босс, я еще не проводил сканирование. Напиши «Проверь штаб», и я проверю все файлы.";
        }
        
        if (!lastScan.issues || lastScan.issues.length === 0) {
            return `✅ **Статус:** По последним данным (проверено ${lastScan.scanned} файлов), в Штабе **0 ошибок**. Все чисто!`;
        }

        let report = `📊 **По последним данным сканирования (${lastScan.scanned} файлов):**\n`;
        report += `⚠️ Осталось проблем: **${lastScan.issues.length}**\n\n`;
        
        lastScan.issues.forEach((issue, i) => {
            report += `${i + 1}. \`${issue.path}\` — ${issue.description}\n`;
        });
        
        report += `\n💡 Напиши «Проверь штаб» для обновления данных.`;
        return report;
    }
);
// ==========================================
// 📖 СЛОВАРЬ И ГЛОБАЛЬНЫЙ РОУТЕР (Единый мозг)
// ==========================================
window.DICT = {
    greet: ["привет", "ку", "куку", "здравствуй", "хай", "пртвет", "здарова", "добрый день"],
    scan_action: ["проверь", "исправь", "почини", "аудит", "скан", "глянь", "найди", "поищи", "проверка", "восстанови"],
    scan_target: ["штаб", "код", "файл", "проект", "ошибк", "баг", "слой", "плагин", "система", "агентство"],
    status_q: ["сколько", "статус", "отчет", "результат", "покажи", "осталось", "проблемы", "список", "что там", "как там"]
};

function matchDict(msg, category) {
    const t = msg.toLowerCase();
    return window.DICT[category].some(word => t.includes(word));
}

registerLayer(
    "global_intent_router",
    (msg) => {
        const t = msg.toLowerCase();
        
        // 1. Приветствие
        if (matchDict(msg, "greet")) return true;
        
        // 2. Сканирование (есть действие + цель)
        if (matchDict(msg, "scan_action") && matchDict(msg, "scan_target")) return true;
        
        // 3. Запрос статуса (есть вопрос + цель)
        if (matchDict(msg, "status_q") && matchDict(msg, "scan_target")) return true;

        // 4. Жесткие фразы
        if (t.includes("что там со штабом") || t.includes("сколько осталось")) return true;
        
        return false;
    },
    async function (msg, ctx) {
        const t = msg.toLowerCase();

        // --- ОБРАБОТКА ПРИВЕТСТВИЯ ---
        if (matchDict(msg, "greet")) {
            return `Привет, Босс! На связи. Готов к работе.`;
        }

        // --- ОБРАБОТКА ЗАПРОСА СТАТУСА (ИЗ ПАМЯТИ) ---
        if (matchDict(msg, "status_q") && matchDict(msg, "scan_target")) {
            const lastScan = window.__lastScanData;
            if (!lastScan) return "Босс, данных нет. Напиши «Проверь штаб», я просканирую файлы.";
            
            if (!lastScan.issues || lastScan.issues.length === 0) {
                return `✅ **Статус:** Проверено ${lastScan.scanned} файлов. Ошибок нет, всё чисто!`;
            }
            
            let report = `📊 **По последним данным сканирования (${lastScan.scanned} файлов):**\n⚠️ Осталось проблем: **${lastScan.issues.length}**\n\n`;
            lastScan.issues.forEach((issue, i) => {
                report += `${i + 1}. \`${issue.path}\` — ${issue.description}\n`;
            });
            return report;
        }

        // --- ОБРАБОТКА ЗАПУСКА СКАНИРОВАНИЯ ---
        if (matchDict(msg, "scan_action") && matchDict(msg, "scan_target")) {
            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scanRepo: true }),
                });
                const data = await res.json();
                if (!data.success) return `❌ Не удалось просканировать: ${data.error || "ошибка"}`;

                window.__lastScanData = data; // Запоминаем!

                if (!data.issues || data.issues.length === 0) {
                    return `✅ **Сканирование завершено:** проверено ${data.scanned} файлов. Ошибок не найдено!`;
                }

                window.__pendingFixes = window.__pendingFixes || {};
                let report = `🩺 **Сканирование завершено**\n📁 Проверено файлов: **${data.scanned}**\n⚠️ Найдено проблем: **${data.issues.length}**\n\n`;

                data.issues.forEach((issue, idx) => {
                    // Безопасное добавление (без удаления)
                    if (issue.diff > 0) {
                        const fixedContent = issue.content + "\n" + "}".repeat(issue.diff) + "\n";
                        window.__pendingFixes[issue.path] = { path: issue.path, content: fixedContent, description: `Добавить ${issue.diff} скоб.` };
                        
                        report += `**${idx + 1}. ${issue.path}**\n   Не хватает ${issue.diff} закрывающих скобок.\n`;
                        // Убрал двойную галочку! Теперь она одна.
                        report += `<div style="display:flex; gap:10px; margin:6px 0 10px 0;">
                            <button onclick="window.applyAutoFix('${issue.path}')" style="background:#00e5ff; border:none; padding:6px 10px; border-radius:5px; font-weight:bold; cursor:pointer;">Добавить ${issue.diff} скоб.</button>
                            <button onclick="window.skipAutoFix('${issue.path}')" style="background:#333; color:#fff; border:none; padding:6px 10px; border-radius:5px; cursor:pointer;">❌ Не трогать</button>
                        </div>`;
                    } else {
                        report += `**${idx + 1}. ${issue.path}**\n<div style="color:#f88; font-size:12px; margin-bottom:10px;">⚠️ Лишние скобки (${Math.abs(issue.diff)} шт). Автоудаление отключено, удали вручную.</div>`;
                    }
                });
                return report;
            } catch (e) {
                return `❌ Ошибка сети: ${e.message}`;
            }
        }

        return "Босс, я не понял команду. Попробуй переформулировать.";
    }
);
// ==========================================
// 🤖 ПЛАГИН 1: Личность (Паспорт ИИ)
// ==========================================
registerLayer(
    "identity_layer",
    (msg) => /(а\s+)?(ты\s+кто|кто\s+ты|как\s+тебя\s+зовут|что\s+ты\s+умеешь|твоя\s+роль|ты\s+робот|ты\s+живой)/i.test(msg),
    async () => {
        const userName = (typeof userPrefs !== 'undefined' && userPrefs.name) ? userPrefs.name : "Босс";
        const isProtected = window.registerLayer && window.registerLayer.__isSafeWrapper;
        
        return `🤖 **Докладываю, ${userName}!**\n\n` +
               `Я — **Оркестратор**, локальный ИИ Цифрового Агентства.\n` +
               `📍 Живу прямо в твоем браузере, не завишу от внешних серверов (кроме API).\n` +
               `🛡 Самозащита слоев: ${isProtected ? "✅ Активна" : "❌ Выключена"}.\n\n` +
               `**Мои навыки:**\n` +
               `- 🌤 Погода и прогнозы\n` +
               `- 🧮 Математика\n` +
               `- 🔎 Поиск в Википедии\n` +
               `- 🩺 Сканирование кода и авто-починка GitHub\n\n` +
               `Готов к работе, Босс! Чего изволите?`;
    }
);

// ==========================================
// 🧠 ПЛАГИН 2: Омни-Контекст (Понимает "А в Москве?")
// ==========================================
registerLayer(
    "omni_context_resolver",
    (msg) => {
        const t = msg.toLowerCase().trim();
        // Ловит короткие уточнения: "А в Москве?", "А завтра?", "А Лермонтов?", "А 5+5?"
        return /^(а|и|а что|а как|а где|а когда|а сколько|а почему|а зачем|а если|а в|а на|а про)\s+/i.test(t) || 
               (t.length < 20 && t.endsWith("?"));
    },
    async function (msg, ctx) {
        if (typeof CONTEXT_MEMORY === 'undefined' || CONTEXT_MEMORY.length === 0) return null;
        
        // Ищем, о чем говорили в прошлый раз
        const lastUserMsg = [...CONTEXT_MEMORY].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return null;
        
        const prev = lastUserMsg.text.toLowerCase();
        const t = msg.toLowerCase().trim();

        // 1. Контекст сканирования и ошибок
        if (/проверь|штаб|ошибк|файл|скан|баг/i.test(prev)) {
            if (/сколько|какие|список|статус|результат/i.test(t)) {
                const lastScan = window.__lastScanData;
                if (!lastScan) return "Босс, данных нет. Напиши «Проверь штаб».";
                if (!lastScan.issues || lastScan.issues.length === 0) return `✅ Ошибок нет, проверено ${lastScan.scanned} файлов.`;
                
                let report = `📊 **Осталось проблем:** ${lastScan.issues.length}\n\n`;
                lastScan.issues.forEach((issue, i) => { report += `${i + 1}. ${issue.path}\n`; });
                return report;
            }
        }

        // 2. Контекст погоды
        if (/погод|градус|температур/i.test(prev)) {
            let city = null;
            const cityMatch = t.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i) || t.match(/^([а-яёa-z\-]{3,})/i);
            
            if (cityMatch) city = cityMatch[1];
            else {
                const prevMatch = prev.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
                if (prevMatch) city = prevMatch[1];
            }

            if (city) {
                const day = t.includes("завтра") ? 1 : 0;
                try {
                    const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ weatherQuery: city, day: day })
                    });
                    const data = await res.json();
                    if (data.success) return data.results;
                } catch(e) {}
            }
        }

        // 3. Контекст математики
        if (/[\d\+\-\*\/\(\)]+/.test(prev) && /[\d\+\-\*\/\(\)]+/.test(t)) {
            try {
                let expr = t.replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
                if (expr) return `🧮 Результат: ${expr} = ${new Function('return ' + expr)()}`;
            } catch(e) {}
        }

        // 4. Общие знания (Поиск)
        const words = t.replace(/[?.!,]/g, '').split(/\s+/).filter(w => w.length > 2 && !["что", "как", "кто", "где", "когда", "зачем", "почему", "а", "и", "в", "на", "это"].includes(w));
        if (words.length > 0) {
            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ searchQuery: words.join(" ") })
                });
                const data = await res.json();
                if (data.success && data.results && !data.results.includes("ничего не найдено")) return data.results;
            } catch(e) {}
        }

        return null; // Если не поняли, пусть ядро попробует другие слои
    }
);

// ==========================================
// 🕵️ ПЛАГИН 3: Черный ящик (Инспектор плагинов)
// ==========================================
window.__pluginLogs = window.__pluginLogs || [];

// Тихо записываем, кто сработал
registerLayer(
    "log_recorder",
    () => true, 
    async (msg, ctx) => {
        if (typeof CUSTOM_LAYERS !== 'undefined') {
            const activePlugins = CUSTOM_LAYERS.filter(l => l.matcher(msg, ctx)).map(l => l.name);
            if (activePlugins.length > 0) {
                window.__pluginLogs.push({
                    time: new Date().toLocaleTimeString(),
                    msg: msg,
                    plugins: activePlugins
                });
                if (window.__pluginLogs.length > 20) window.__pluginLogs.shift();
            }
        }
        return null; // Молчим, чтобы не мешать Судье
    }
);

// Показываем логи по команде
registerLayer(
    "plugin_inspector",
    (msg) => /(покажи\s+лог|что\s+там\s+с\s+плагин|инспектор|логи\s+плагин)/i.test(msg),
    async () => {
        if (window.__pluginLogs.length === 0) {
            return "🕵️ **Инспектор:** Логов пока нет. Напиши что-нибудь, чтобы я записал.";
        }

        let report = `🕵️ **Последние срабатывания:**\n\n`;
        window.__pluginLogs.slice(-5).forEach((log, i) => {
            report += `**${i + 1}. [${log.time}]** «${log.msg}»\n`;
            report += `   Сработали: \`${log.plugins.join('`, `')}\`\n\n`;
        });
        return report;
    }
);
// ==========================================
// 💬 ПЛАГИН: Человеческий фактор (Small Talk)
// ==========================================
registerLayer(
    "human_talk",
    (msg) => {
        const t = msg.toLowerCase().trim();
        return /^(как\s+(ты|дела|сам|оно|жизнь)|что\s+нового|как\s+настроение|чем\s+занят)/i.test(t);
    },
    async () => {
        const variants = [
            "Все системы в норме, Босс! Готов к работе. 🚀",
            "Отлично! Сканирую просторы интернета, жду твоих команд. 🤖",
            "Живой и работаю. Плагины на месте, защита активна. Чего изволите?",
            "На позитиве! Готов чинить код и отвечать на вопросы. 😎"
        ];
        return variants[Math.floor(Math.random() * variants.length)];
    }
);
// ==========================================
// 📋 ПЛАГИН: Реестр всех плагинов (Список)
// ==========================================
registerLayer(
    "list_all_plugins",
    (msg) => /(список|реестр|все)\s+(плагин|сло|агент)/i.test(msg),
    async () => {
        if (typeof CUSTOM_LAYERS === 'undefined') return "Ошибка: список слоев не найден.";
        const names = CUSTOM_LAYERS.map(l => l.name);
        return `📋 **Реестр Штаба**\nВсего плагинов: **${names.length}**\n\n` + 
               names.map((n, i) => `${i + 1}. \`${n}\``).join('\n');
    }
);
// ==========================================
// 🌤 ПЛАГИН: Умная погода (Обходит придирки Судьи)
// ==========================================
registerLayer(
    "smart_weather",
    (msg) => /(погод|температур|градус)/i.test(msg),
    async function (msg, ctx) {
        const t = msg.toLowerCase();
        
        // 1. Вытаскиваем город (ищем слово после "в", "во", "на" или просто любое длинное слово)
        let city = "москва"; // По умолчанию
        const cityMatch = t.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
        if (cityMatch) {
            city = cityMatch[1];
        } else {
            const words = t.split(/\s+/).filter(w => w.length > 3 && !["погода", "погоду", "завтра", "сегодня", "какая", "будет"].includes(w));
            if (words.length > 0) city = words[0];
        }

        // 2. Определяем день (сегодня или завтра)
        const day = t.includes("завтра") ? 1 : 0;

        // 3. Стучимся на наш сервер Deno
        try {
            const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weatherQuery: city, day: day })
            });
            const data = await res.json();
            
            if (data.success && data.results) {
                // Формируем ответ с ключевыми словами, чтобы Судья не придирался
                const dayText = day === 1 ? "на завтра" : "сейчас";
                return `🌤 **Погода в городе ${city.toUpperCase()} ${dayText}:**\n\n${data.results}`;
            }
        } catch (e) {
            return `❌ Не удалось получить погоду для ${city}: ${e.message}`;
        }
        
        return `❌ Не могу найти погоду для города ${city}.`;
    }
);
// ==========================================
// 🧠 УМНЫЙ РОУТЕР (Понимает суть и чистит запросы)
// ==========================================
registerLayer(
    "smart_query_router",
    (msg) => {
        const t = msg.toLowerCase();
        // Ловит: Погоду, Математику, Поиск (Википедию), Статус
        return /(погод|температур|градус|сколько будет|посчитай|[\d]+\s*[\+\-\*\/]\s*[\d]+|кто такой|что такое|расскажи про|найди|поищи)/i.test(t) || 
               /^(а|и)\s+в\s+/i.test(t); // Ловит "А в Москве" из контекста
    },
    async function (msg, ctx) {
        const t = msg.toLowerCase().trim();

        // === 1. ОПРЕДЕЛЯЕМ КОНТЕКСТ (Если это уточнение) ===
        let isFollowUp = /^(а|и)\s+/.test(t);
        let prevContext = "";
        if (isFollowUp && typeof CONTEXT_MEMORY !== 'undefined') {
            const lastUser = [...CONTEXT_MEMORY].reverse().find(m => m.role === 'user');
            if (lastUser) prevContext = lastUser.text.toLowerCase();
        }

        // ==========================================
        // СЦЕНАРИЙ А: ПОГОДА
        // ==========================================
        if (t.includes("погод") || t.includes("градус") || t.includes("температур") || (isFollowUp && prevContext.includes("погод"))) {
            // 1. Ищем город (в новом сообщении или в старом)
            let cityMatch = t.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
            let city = "Москва"; // По умолчанию

            if (cityMatch) {
                city = cityMatch[1];
            } else if (isFollowUp && prevContext) {
                const prevMatch = prevContext.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
                if (prevMatch) city = prevMatch[1];
            }

            // 2. Чистим падежи (Москве -> Москва, Питере -> Питер)
            city = city.replace(/(е|у|ю|ой|ей)$/i, "");
            city = city.charAt(0).toUpperCase() + city.slice(1);

            // 3. Определяем день
            const day = t.includes("завтра") ? 1 : 0;

            // 4. Стучимся в Дэн
            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ weatherQuery: city, day: day })
                });
                const data = await res.json();
                if (data.success && data.results) {
                    const dayText = day === 1 ? "на завтра" : "сейчас";
                    return `🌤 **Погода в городе ${city} ${dayText}:**\n\n${data.results.trim()}`;
                }
            } catch (e) {
                return `❌ Ошибка получения погоды для ${city}.`;
            }
        }

        // ==========================================
        // СЦЕНАРИЙ Б: МАТЕМАТИКА
        // ==========================================
        if (/[\d]+\s*[\+\-\*\/]\s*[\d]+/i.test(t) || t.includes("сколько будет") || t.includes("посчитай")) {
            try {
                // Вырезаем только цифры и знаки из сообщения
                let expr = t.replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
                if (expr) {
                    const result = new Function('return ' + expr)();
                    return `🧮 **Результат:** ${expr} = **${result}**`;
                }
            } catch (e) {
                return `⚠️ Не могу посчитать это выражение.`;
            }
        }

        // ==========================================
        // СЦЕНАРИЙ В: ПОИСК В ВИКИПЕДИИ
        // ==========================================
        if (t.includes("кто такой") || t.includes("что такое") || t.includes("расскажи про") || t.includes("найди") || t.includes("поищи")) {
            // Очищаем запрос от слов-паразитов
            const stopWords = ["кто", "такой", "что", "такое", "расскажи", "про", "найди", "поищи", "информацию", "о", "об"];
            let queryWords = t.replace(/[?.!,]/g, '').split(/\s+/).filter(w => !stopWords.includes(w) && w.length > 2);
            
            let query = queryWords.join(" ");
            if (!query) return "Босс, а кого или что искать-то?";

            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ searchQuery: query })
                });
                const data = await res.json();
                if (data.success && data.results) {
                    return `🔎 **Результаты поиска по запросу "${query}":**\n\n${data.results}`;
                }
            } catch (e) {
                return `❌ Ошибка поиска по запросу "${query}".`;
            }
        }

        return null; // Если не распознали, пусть другие слои попробуют
    }
);
// ==========================================
// 📝 СИСТЕМНЫЙ ЛОГГЕР (Вечный Черный Ящик)
// ==========================================
window.SysLog = {
    key: 'shtabSysLog_v1',
    logs: [],
    
    init() {
        try { this.logs = JSON.parse(localStorage.getItem(this.key) || '[]'); } catch(e) { this.logs = []; }
    },
    
    add(type, msg, data) {
        const entry = {
            ts: new Date().toISOString(),
            type: type, // 'error', 'crash', 'info', 'fix'
            msg: String(msg).substring(0, 300),
            data: data ? JSON.stringify(data).substring(0, 300) : null
        };
        this.logs.push(entry);
        if (this.logs.length > 100) this.logs = this.logs.slice(-100); // Храним последние 100
        try { localStorage.setItem(this.key, JSON.stringify(this.logs)); } catch(e) {}
        console.log(`[SysLog:${type}]`, msg);
    },
    
    getErrors() { return this.logs.filter(l => l.type === 'error' || l.type === 'crash'); },
    getAll() { return this.logs; },
    clear() { this.logs = []; localStorage.setItem(this.key, '[]'); }
};

window.SysLog.init();

// 1. Перехватываем сетевые ошибки (если Дэн не отвечает)
(function() {
    if (window.__fetchWrapped) return;
    window.__fetchWrapped = true;
    const orig = window.fetch;
    window.fetch = async function(...args) {
        const url = String(args[0] || '');
        try {
            const res = await orig.apply(this, args);
            if (!res.ok && url.includes('deno.net')) {
                window.SysLog.add('error', `Дэн вернул ${res.status}`, { url });
            }
            return res;
        } catch (e) {
            if (url.includes('deno.net')) {
                window.SysLog.add('error', `Сеть: ${e.message}`, { url });
            }
            throw e;
        }
    };
})();

// 2. Синхронизируем упавшие слои в журнал
registerLayer(
    "sys_log_sync",
    () => true,
    async () => {
        if (window.__layerWarnings && window.__layerWarnings.length > 0) {
            const lastLogged = window.__lastLoggedWarnIdx || 0;
            const newWarns = window.__layerWarnings.slice(lastLogged);
            newWarns.forEach(w => {
                window.SysLog.add('crash', `Слой "${w.name}": ${w.msg || w.type}`);
            });
            window.__lastLoggedWarnIdx = window.__layerWarnings.length;
        }
        return null;
    }
);

// 3. Плагин для просмотра и очистки журнала
registerLayer(
    "sys_log_viewer",
    (msg) => /(покажи|открой|дай|очисти|сбрось|удали)\s+(лог|ошибк|журнал)|что\s+(там\s+)?сломалось|журнал\s+ошибок|ошибки\s+системы/i.test(msg),
    async function(msg) {
        const t = msg.toLowerCase();
        
        // Очистка
        if (t.includes("очист") || t.includes("сбрось") || t.includes("удали")) {
            window.SysLog.clear();
            return "🗑 **Журнал очищен.** Все старые записи стерты.";
        }

        const all = window.SysLog.getAll();
        const errors = window.SysLog.getErrors();
        
        if (all.length === 0) return "📝 **Журнал пуст.** Всё чисто, Босс!";

        let report = `📝 **Журнал Системы (Черный Ящик)**\n`;
        report += `📊 Всего записей: ${all.length}\n`;
        report += `🚨 Ошибок и крашей: ${errors.length}\n\n`;
        report += `**Последние события:**\n`;

        // Показываем последние 10 записей (от новых к старым)
        all.slice(-10).reverse().forEach(log => {
            const icon = { error: '❌', crash: '💥', info: 'ℹ️', fix: '✅' }[log.type] || '•';
            const time = new Date(log.ts).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
            report += `${icon} [${time}] ${log.msg}\n`;
        });

        if (all.length > 10) report += `\n... и еще ${all.length - 10} в памяти.`;
        report += `\n\n💡 *Напиши «очисти лог», чтобы сбросить.*`;
        return report;
    }
);

// 4. Фиксируем успешные авто-фиксы
if (typeof window.applyAutoFix === 'function' && !window.applyAutoFix.__logged) {
    const origApply = window.applyAutoFix;
    window.applyAutoFix = async function(...args) {
        const fileName = args[0];
        const result = await origApply.apply(this, args);
        if (result && result.success) window.SysLog.add('fix', `Файл ${fileName} успешно исправлен`);
        else if (result && result.error) window.SysLog.add('error', `Ошибка фикса ${fileName}: ${result.error}`);
        return result;
    };
    window.applyAutoFix.__logged = true;
}

window.SysLog.add('info', 'Системный логгер запущен');
// ==========================================
// 🐞 ДЕБАГ-РЕЖИМ (Отладка ИИ для Босса)
// ==========================================
window.__DEBUG_MODE = localStorage.getItem('shtabDebug') === 'true';
window.__debugLogs = window.__debugLogs || [];

// 1. Переключатель дебага
registerLayer(
    "debug_toggle",
    (msg) => /(включи|выключи|статус)\s+(дебаг|debug|отладку)/i.test(msg),
    async (msg) => {
        if (/включи/i.test(msg)) {
            window.__DEBUG_MODE = true;
            localStorage.setItem('shtabDebug', 'true');
            return "🐞 **Дебаг-режим ВКЛЮЧЕН.**\nТеперь я буду записывать все запросы к Дэну и ответы Судьи. Напиши «Покажи дебаг» для просмотра.";
        } else if (/выключи/i.test(msg)) {
            window.__DEBUG_MODE = false;
            localStorage.setItem('shtabDebug', 'false');
            return "🐞 **Дебаг-режим ВЫКЛЮЧЕН.**";
        } else {
            return `🐞 Дебаг-режим: **${window.__DEBUG_MODE ? '✅ ВКЛ' : '❌ ВЫКЛ'}**`;
        }
    }
);

// 2. Перехватываем fetch (чтобы видеть запросы в Дэн)
(function() {
    if (window.__fetchDebugWrapped) return;
    window.__fetchDebugWrapped = true;
    const orig = window.fetch;
    window.fetch = async function(...args) {
        const url = String(args[0] || '');
        const options = args[1];
        
        if (window.__DEBUG_MODE && url.includes('deno.net') && options && options.body) {
            try {
                const bodyData = JSON.parse(options.body);
                const keys = Object.keys(bodyData).filter(k => k !== 'isBackup' && k !== 'isRollback');
                if (keys.length > 0) {
                    window.__debugLogs.push({
                        time: new Date().toLocaleTimeString(),
                        type: 'request',
                        msg: `Запрос в Дэн: ${keys.join(', ')}`,
                        data: options.body
                    });
                }
            } catch(e) {}
        }
        
        const res = await orig.apply(this, args);
        
        if (window.__DEBUG_MODE && url.includes('deno.net')) {
            const clone = res.clone();
            clone.json().then(d => {
                if (d.success) {
                    window.__debugLogs.push({
                        time: new Date().toLocaleTimeString(),
                        type: 'response',
                        msg: `Ответ Дэна: УСПЕХ`,
                        data: d.results ? String(d.results).substring(0, 50) + '...' : 'OK'
                    });
                } else {
                    window.__debugLogs.push({
                        time: new Date().toLocaleTimeString(),
                        type: 'error',
                        msg: `Ответ Дэна: ОШИБКА`,
                        data: d.error
                    });
                }
                if (window.__debugLogs.length > 30) window.__debugLogs.shift();
            }).catch(() => {});
        }
        return res;
    };
})();

// 3. Записываем, какие слои сработали (дублируем в дебаг)
const originalMatch = registerLayer;
// 4. Плагин для просмотра дебага
registerLayer(
    "debug_viewer",
    (msg) => /(покажи|открой)\s+(дебаг|debug|отладку)|что\s+там\s+в\s+дебаге/i.test(msg),
    async () => {
        if (!window.__DEBUG_MODE) return "🐞 Дебаг-режим выключен. Напиши «Включи дебаг».";
        if (window.__debugLogs.length === 0) return "🐞 Дебаг включен, но логов пока нет. Задай мне какой-нибудь вопрос!";
        
        let report = `🐞 **Дебаг-отчет (последние события):**\n\n`;
        window.__debugLogs.slice(-10).reverse().forEach(log => {
            const icon = { request: '➡️', response: '⬅️', error: '❌', layer: '🔌' }[log.type] || '•';
            report += `${icon} [${log.time}] ${log.msg}\n`;
            if (log.data) report += `   └ \`${String(log.data).substring(0, 80)}\`\n`;
        });
        report += `\n💡 *Для очистки напиши «Очисти дебаг»*`;
        return report;
    }
);

// 5. Очистка дебага
registerLayer(
    "debug_clear",
    (msg) => /(очисти|сбрось)\s+(дебаг|debug|отладку)/i.test(msg),
    async () => {
        window.__debugLogs = [];
        return "🗑 Дебаг-лог очищен.";
    }
);

// 6. Записываем активацию слоев в дебаг (перехватываем log_recorder)
if (window.__pluginLogs) {
    const origPush = window.__pluginLogs.push;
    window.__pluginLogs.push = function(entry) {
        if (window.__DEBUG_MODE && entry.plugins && entry.plugins.length > 0) {
            window.__debugLogs.push({
                time: entry.time,
                type: 'layer',
                msg: `Сработали слои: ${entry.plugins.join(', ')}`,
                data: `Текст: "${entry.msg}"`
            });
            if (window.__debugLogs.length > 30) window.__debugLogs.shift();
        }
        return origPush.apply(this, arguments);
    };
}
// ==========================================
// 🧠 УНИВЕРСАЛЬНЫЙ УМНЫЙ РОУТЕР (Броня v2.0)
// ==========================================
registerLayer(
    "universal_smart_router",
    () => true, // Срабатывает всегда, чтобы перехватить инициативу
    async function (msg, ctx) {
        // 1. ЗАЩИТА ОТ ПУСТОТЫ: Берем оригинал, если есть, иначе текущий текст
        const original = (ctx && ctx.originalMsg ? ctx.originalMsg : msg || "").toLowerCase().trim();
        if (!original) return null;

        // 2. КОНТЕКСТ: Достаем прошлое сообщение (для понимания "А в Москве?")
        const lastUserMsg = (typeof CONTEXT_MEMORY !== 'undefined') 
            ? ([...CONTEXT_MEMORY].reverse().find(m => m.role === 'user')?.text || "").toLowerCase() 
            : "";

        // --- БОЛТАЛКА (Small Talk) ---
        if (/(привет|ку|здравствуй|добрый день)/i.test(original)) {
            return "Привет, Босс! На связи. Готов к работе. 🚀";
        }
        if (/(как дела|как ты|как сам|как жизнь|как настроение)/i.test(original)) {
            return "Все системы в норме, Босс! Плагины работают, защита активна. А у тебя как? 😎";
        }
        if (/(что делаешь|что нового|чем занят)/i.test(original)) {
            return "Сканирую просторы интернета, жду твоих команд и слежу за порядком в коде. 🤖";
        }

        // --- ВРЕМЯ И ДАТА ---
        if (/(сколько времени|который час)/i.test(original)) {
            return `🕒 Сейчас ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}`;
        }
        if (/(какое сегодня число|какая дата)/i.test(original)) {
            return `📅 Сегодня ${new Date().toLocaleDateString('ru-RU', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}`;
        }

        // --- МАТЕМАТИКА (Защищенная) ---
        if (/[\d]+\s*[\+\-\*\/]\s*[\d]+/i.test(original) || /(сколько будет|посчитай)/i.test(original)) {
            try {
                let expr = original.replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
                // Защита от недописанных выражений типа "5+"
                if (expr && !/[\+\-\*\/]$/.test(expr)) {
                    return `🧮 **Результат:** ${expr} = **${new Function('return ' + expr)()}**`;
                }
            } catch (e) {
                return `⚠️ Не могу посчитать это выражение. Проверь пример.`;
            }
        }

        // --- ПОГОДА (С контекстом) ---
        if (/(погод|температур|градус)/i.test(original) || (/(а\s+)?(в|во|на)\s+/i.test(original) && /(погод|градус)/i.test(lastUserMsg))) {
            let city = "Москва"; 
            // Ищем город в текущем сообщении
            const match = original.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
            
            if (match) {
                city = match[1];
            } else if (/(а\s+)?(в|во|на)\s+/i.test(original)) {
                // Если это уточнение ("А в Питере"), берем город из сообщения
                city = original.replace(/.*(?:в|во|на)\s+/i, '').replace(/[?.!]/g, '').trim();
            } else if (/(погод|градус)/i.test(lastUserMsg)) {
                // Если контекст про погоду, но город не назван, берем из прошлого
                const prevMatch = lastUserMsg.match(/(?:в|во|на|про)\s+([а-яёa-z\-]{3,})/i);
                if (prevMatch) city = prevMatch[1];
            }

            // Чистим падежи
            city = city.replace(/(е|у|ю|ой|ей)$/i, "").trim();
            city = city.charAt(0).toUpperCase() + city.slice(1);
            const day = original.includes("завтра") ? 1 : 0;

            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ weatherQuery: city, day: day }),
                    signal: AbortSignal.timeout(6000) // Защита от зависания сети
                });
                const data = await res.json();
                if (data.success && data.results) {
                    const dayText = day === 1 ? "на завтра" : "сейчас";
                    return `🌤 **Погода в городе ${city} ${dayText}:**\n\n${data.results.trim()}`;
                }
            } catch (e) {
                return `❌ Погодный сервис не отвечает или город не найден.`;
            }
        }

        // --- ПОИСК В ИНТЕРНЕТЕ (Защищенный от пустоты) ---
        if (/(кто такой|что такое|расскажи про|найди|поищи|почему|зачем|где находится|сколько лет)/i.test(original)) {
            const stopWords = ["кто", "такой", "что", "такое", "расскажи", "про", "найди", "поищи", "информацию", "о", "об", "почему", "зачем", "где", "находится", "сколько", "лет"];
            let queryWords = original.replace(/[?.!,]/g, '').split(/\s+/).filter(w => !stopWords.includes(w) && w.length > 2);
            let query = queryWords.join(" ");

            // Если после чистки ничего не осталось (например, написали просто "Кто такой?")
            if (!query) return "🤷‍♂️ Босс, уточни, кого или что именно искать?";

            try {
                const res = await fetch("https://early-amoeba-1705.alexey17001700.deno.net", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ searchQuery: query }),
                    signal: AbortSignal.timeout(6000)
                });
                const data = await res.json();
                if (data.success && data.results && !data.results.includes("ничего не найдено")) {
                    let cleanText = data.results.replace(/\n{3,}/g, '\n\n').trim();
                    if (cleanText.length > 1500) cleanText = cleanText.substring(0, 1500) + "...\n\n*(Текст сокращен)*";
                    return `🔎 **Нашел информацию по запросу "${query}":**\n\n${cleanText}`;
                } else {
                    return `🤷‍♂️ Босс, я перерыл интернет по запросу "${query}", но ничего путного не нашел.`;
                }
            } catch (e) {
                return `❌ Ошибка сети при поиске "${query}": ${e.message}`;
            }
        }

        // ВАЖНО: Если это запрос на сканирование кода (проверь штаб и т.д.), 
        // мы возвращаем null и НЕ мешаем нашему плагину с кнопками сделать свою работу.
        return null; 
    }
);
