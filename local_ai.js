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

    if (/в порядке.*штаб|проверь.*файл|статус.*штаб|сверь.*бэкап/i.test(correctedMsg)) {
        try {
            const statusRes = await fetch(proxyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkStatus: true }), signal });
            const statusData = await statusRes.json();
            if (statusData.success) {
                let report = `🛠️ **Диагностика:**\n- В корне: ${statusData.totalRoot}.\n- В бэкапе: ${statusData.totalBackup}.\n`;
                report += statusData.missingInBackup.length > 0 ? `⚠️ Нет в бэкапе: ${statusData.missingInBackup.join(', ')}` : `✅ Бэкап актуален.`;
                return finalizeOutput({ msg: originalMsg, sentiment, output: report });
            }
        } catch (e) { return finalizeOutput({ msg: originalMsg, sentiment, output: `❌ Ошибка проверки: Deno недоступен.` }); }
    }

    const allAgentNames = typeof AGENT_ICONS !== 'undefined' ? Object.keys(AGENT_ICONS) : [];
    const mentionedAgent = allAgentNames.find(name => correctedMsg.includes(name.toLowerCase()));
    if (mentionedAgent && /тут|на месте|есть|здесь|статус|работает/i.test(correctedMsg)) {
        const activeAgents = typeof selectedAgents !== 'undefined' ? selectedAgents : [];
        const isSelected = activeAgents.includes(mentionedAgent);
        return finalizeOutput({ msg: originalMsg, sentiment, output: `🤖 Агент **${mentionedAgent}** ${isSelected ? 'подключен к чату' : 'в офисе, но не выбран'}.` });
    }

    for (const layer of CUSTOM_LAYERS) {
        if (layer.matcher(correctedMsg, keywords)) {
            if (DEBUG) console.log(`🔌 Сработал плагин: ${layer.name}`);
            const pluginResult = await layer.handler(correctedMsg, { originalMsg, sentiment, keywords, entities });
            if (pluginResult) {
                return finalizeOutput({ msg: originalMsg, sentiment, output: pluginResult });
            }
        }
    }

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
// ЗДЕСЬ МЫ ДОБАВЛЯЕМ НОВЫЕ СЛОИ (ПЛАГИНЫ)
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
        // Защита на случай, если массив ответов окажется пустым
        if (SMALL_TALK_RESPONSES_LEN === 0) {
            return "Системы в норме. Жду ваших команд.";
        }
        // Быстрый выбор случайного индекса через побитовый сдвиг
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

        // 1. Нормализация и подсчет слов
        const normalizedMsg = msg.trim();
        const wordCount = normalizedMsg.split(/\s+/).filter(Boolean).length;
        const isShort = wordCount > 0 && wordCount <= 5;

        // 2. Проверяем контекст (говорили ли про погоду)
        const hasWeatherContext = Array.isArray(CONTEXT_MEMORY) && 
            CONTEXT_MEMORY.some(c => typeof c.text === 'string' && WEATHER_CONTEXT_KEYWORDS.test(c.text));

        // 3. Ищем город в текущем сообщении
        const hasCity = CITY_REGEX.test(normalizedMsg);
        
        return isShort && hasCity && hasWeatherContext;
    },
    async (msg, ctx) => {
        // Берем оригинальное сообщение, чтобы контекстный парсер ядра не склеил лишнего
        const original = typeof ctx.originalMsg === 'string' ? ctx.originalMsg : msg;
        const match = original.match(CITY_REGEX);

        if (!match) return null;

        // Нормализация названия города
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
                // Синхронизируемся с ядром через localStorage
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
