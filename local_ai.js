// local_ai.js
const BRAIN_VERSION = "39.0"; 
const MAX_CONTEXT = 20;
const MAX_DICT_SIZE = 100;
const DEBUG = true;

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

async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    let msg = sanitize(userMessage.toLowerCase().trim());
    msg = expandAbbreviations(msg);
    msg = resolveContext(msg);

    const sentiment = analyzeSentiment(msg);
    const entities = extractEntities(msg);
    const keywords = extractKeywords(msg);
    const topic = detectTopic(msg);

    if (/^(привет|куку|хай|здравствуй)/i.test(msg)) return finalizeOutput({ msg, sentiment, output: `Привет, ${userPrefs.name}! На связи.` });
    if (/как дела/i.test(msg)) return finalizeOutput({ msg, sentiment, output: 'Все системы в норме.' });
    if (/спасибо/i.test(msg)) return finalizeOutput({ msg, sentiment, output: 'Всегда пожалуйста!' });
    if (/время/i.test(msg)) return finalizeOutput({ msg, sentiment, output: `🕒 ${new Date().toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}` });
    
    if (/агент|штаб|офис|команда|сотрудник|на месте|статус/i.test(msg)) {
        const allAgentsCount = typeof AGENT_ICONS !== 'undefined' ? Object.keys(AGENT_ICONS).length : 24;
        const activeAgents = typeof selectedAgents !== 'undefined' ? selectedAgents : [];
        let chatStatus = activeAgents.length === 0 ? "В чате никого нет." : `В чате: ${activeAgents.length} (${activeAgents.join(', ')}).`;
        const report = `🏢 **Штаб:**\n- Всего: ${allAgentsCount}.\n- ${chatStatus}\n- ИИ v39.0: Активен.\n- Тема: ${topic}.`;
        return finalizeOutput({ msg, sentiment, output: report });
    }

    const intentResults = await runParallel([
        { name: 'kw', fn: () => detectIntentKeywords(msg) },
        { name: 'qt', fn: () => detectIntentQuestion(msg) }
    ]);
    const intent = vote(intentResults) || 'question';
    const ctx = { msg, sentiment, entities, keywords, intent, topic, output: null };

    if (intent === 'weather') return await processWeather(ctx, proxyUrl, signal);
    if (intent === 'learning') return processLearning(ctx);
    return await processQuestion(ctx, proxyUrl, signal);
}
async function processWeather(ctx, proxyUrl, signal) {
    const cityResults = await runParallel([
        { name: 'prep', fn: () => extractCityPrep(ctx.msg) },
        { name: 'ctx', fn: () => extractCityContext(ctx.msg), weight: 2 },
        { name: 'last', fn: () => extractCityLast(ctx.msg) }
    ]);
    let city = vote(cityResults) || lastCity;
    
    if (city && ['в','во','на','с','и','а'].includes(city.toLowerCase())) {
        ctx.output = `⚠️ Судья: "${city}" — предлог. Уточните город.`;
        return finalizeOutput(ctx);
    }
    
    city = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
    localStorage.setItem('shtabLastCity', city);
    const isTomorrow = /завтра/i.test(ctx.msg);

    try {
        const res = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }), signal });
        const data = await res.json();
        if (data.success) {
            const verdict = judge(data.results, ctx.msg, 'network');
            if (!verdict.approved) { ctx.output = `⚠️ Судья: ${verdict.reason}.`; return finalizeOutput(ctx); }
            ctx.output = `🌤️ ${data.results}`;
            return finalizeOutput(ctx);
        }
    } catch(e) {}
    ctx.output = `❌ Не удалось узнать погоду.`;
    return finalizeOutput(ctx);
}

async function fetchNetwork(query, proxyUrl, signal) {
    try {
        const res = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchQuery: query }), signal });
        const data = await res.json();
        return data.success && data.results ? data.results.substring(0, 250) : null;
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
        if (verdict.approved) { ctx.output = `🧠 Логика: ${logicAnswer}`; return finalizeOutput(ctx); }
    }

    let searchQuery = ctx.keywords.join(' ') || ctx.msg;
    let fact = await fetchNetwork(searchQuery, proxyUrl, signal);

    if (fact) {
        const mathScore = calculateMathScore(ctx.msg, fact);
        const verdict = judge(fact, ctx.msg, 'network');
        const conf = computeConfidence(fact, ctx.msg, 'network');
        
        if (!verdict.approved || mathScore < 0.3 || conf < 0.3) {
            if (DEBUG) console.log(`🔄 Самокоррекция (Math: ${mathScore.toFixed(2)}, Conf: ${conf.toFixed(2)})`);
            searchQuery = ctx.keywords[0] || ctx.msg;
            fact = await fetchNetwork(searchQuery, proxyUrl, signal);
        }
    }

    if (fact) {
        const mainSubj = ctx.keywords[0] || 'info';
        if (!KNOWLEDGE_GRAPH[mainSubj]) KNOWLEDGE_GRAPH[mainSubj] = {};
        KNOWLEDGE_GRAPH[mainSubj]['из_интернета'] = [fact];
        saveLocalBrain();
        ctx.output = `🔎 ${fact}`;
        return finalizeOutput(ctx);
    }
    
    ctx.output = `❌ Сеть не дала результатов.`;
    return finalizeOutput(ctx);
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
        ctx.output = `🧠 Запомнил: "${subj}" — это "${fact}".`;
    } else { ctx.output = `Не понял, что запомнить.`; }
    return finalizeOutput(ctx);
}

function finalizeOutput(ctx) {
    if (!ctx.output || ctx.output.trim() === '') ctx.output = "⚠️ Пустой ответ.";
    if (ctx.sentiment === 'angry' && !ctx.output.includes('извин')) ctx.output = 'Извините. ' + ctx.output;
    
    CONTEXT_MEMORY.push({ role: 'user', text: ctx.msg, entities: ctx.keywords, timestamp: Date.now() });
    CONTEXT_MEMORY.push({ role: 'assistant', text: ctx.output, entities: ctx.keywords, timestamp: Date.now() });
    if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
    
    saveLocalBrain();
    return ctx.output;
}
