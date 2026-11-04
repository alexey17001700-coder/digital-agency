// local_ai.js
const BRAIN_VERSION = "23.0"; 
const MAX_CONTEXT = 20;

let KNOWLEDGE_GRAPH = {
    "пушкин": { "профессия": ["поэт"], "автор": ["онегин"] },
    "онегин": { "тип": ["произведение"] }
};

let CONTEXT_MEMORY = []; 
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";
let userPrefs = JSON.parse(localStorage.getItem('shtabPrefs')) || { brief: false, name: "Босс" };

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
function savePrefs() { localStorage.setItem('shtabPrefs', JSON.stringify(userPrefs)); }
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

function extractTokens(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'является', 'значит', 'давай', 'напиши', 'создай', 'сделай', 'скажи', 'пожалуйста'];
    return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
}

function getVocab() {
    let vocab = new Set(["поэт", "автор", "произведение", "привет", "погод", "время"]);
    Object.keys(KNOWLEDGE_GRAPH).forEach(k => vocab.add(k));
    return Array.from(vocab);
}

function textToVector(text) {
    const vocab = getVocab(); const vector = new Array(vocab.length).fill(0);
    text.toLowerCase().split(/\s+/).forEach(word => {
        vocab.forEach((v, i) => { if (word.includes(v) || v.includes(word)) vector[i] = 1; });
    });
    return vector;
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccardSimilarity(textA, textB) {
    const setA = new Set(textA.toLowerCase().split(/\s+/));
    const setB = new Set(textB.toLowerCase().split(/\s+/));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
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

function validateIntent(msg, currentIntent) {
    if (currentIntent === 'weather' && !/погод|градус|температур/i.test(msg)) return false;
    if (currentIntent === 'learning' && !/(это|является|—|-)/i.test(msg)) return false;
    return true;
}
// СЛОЙ ИЗВЛЕЧЕНИЯ: Разбиваем текст на предложения и ищем самые релевантные
function extractRelevantSentences(rawText, queryTokens) {
    // Разбиваем текст на предложения
    const sentences = rawText.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
    let scoredSentences = [];

    sentences.forEach(sentence => {
        let score = 0;
        const lowerSentence = sentence.toLowerCase();
        
        // Считаем, сколько ключевых слов из вопроса есть в предложении
        queryTokens.forEach(token => {
            if (lowerSentence.includes(token) || levenshtein(lowerSentence, token) <= 2) score += 1;
        });
        
        // Дополнительный балл, если предложение содержит ключевые слова определения
        if (lowerSentence.includes("это") || lowerSentence.includes("является") || lowerSentence.includes("называется")) score += 0.5;
        
        if (score > 0) scoredSentences.push({ text: sentence.trim(), score });
    });

    // Сортируем по релевантности (самые нужные наверх)
    scoredSentences.sort((a, b) => b.score - a.score);
    return scoredSentences;
}

// СЛОЙ СИНТЕЗА: Собираем ответ из лучших предложений
function synthesizeAnswer(scoredSentences, originalQuery) {
    if (scoredSentences.length === 0) return null;
    
    // Берем топ-3 предложения (или меньше, если нет)
    const topCount = userPrefs.brief ? 1 : 3;
    const bestSentences = scoredSentences.slice(0, topCount).map(s => s.text);
    
    // Склеиваем и добавляем вступление
    let answer = bestSentences.join(' ');
    
    // Если предложения обрывочные, добавляем контекст
    if (!answer.toLowerCase().includes(originalQuery.toLowerCase())) {
        answer = `По вашему вопросу "${originalQuery}" найдено: ${answer}`;
    }
    return answer;
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    const tokens = extractTokens(msg);
    let ctx = { msg, tokens, intent: 'unknown', data: null, valid: true, output: null };

    // --- РЕФЛЕКСЫ ---
    if (/^(привет|куку|здорово|хай|здравствуй)/i.test(msg)) return `Привет, ${userPrefs.name}! На связи.`;
    if (/как дела/i.test(msg)) return `Все системы в норме, ${userPrefs.name}.`;
    if (/спасибо/i.test(msg)) return "Всегда пожалуйста!";
    if (/время|который час/i.test(msg)) return `🕒 Сейчас ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`;

    // --- ОПРЕДЕЛЕНИЕ ИНТЕНТА ---
    if (/погод|градус|температур/i.test(msg)) ctx.intent = 'weather';
    else if (/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i.test(msg) && !msg.includes('?')) ctx.intent = 'learning';
    else if (/напиши|создай/i.test(msg) && /код|скрипт/i.test(msg)) ctx.intent = 'code';
    else if (msg.includes('?') || /^(кто|что|где|как|почему)/i.test(msg)) ctx.intent = 'question';

    // Валидация интента (Слой проверки)
    if (!validateIntent(ctx.msg, ctx.intent)) ctx.intent = 'question';

    // Маршрутизация
    if (ctx.intent === 'weather') return await processWeather(ctx, proxyUrl, signal);
    if (ctx.intent === 'learning') return processLearning(ctx);
    if (ctx.intent === 'code') return processCode(ctx);
    return await processQuestion(ctx, proxyUrl, signal);
}
async function processWeather(ctx, proxyUrl, signal) {
    let isTomorrow = /завтра/i.test(ctx.msg);
    let city = lastCity;
    const cityMatch = ctx.msg.match(/(?:в|во|на)\s+([а-яёa-z\-]+)/i);
    if (cityMatch) city = cityMatch[1];
    else {
        const parts = ctx.msg.split(/погода|погоду|погоды|погоде/i);
        if (parts.length > 1) city = parts[1].replace(/[?.!,]/g, '').replace(/(?:скажи|пожалуйста|мне)/gi, '').trim();
    }
    city = city.replace(/[?.!,]/g, '').trim() || lastCity;
    localStorage.setItem('shtabLastCity', city);

    try {
        const weatherRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }),
            signal: signal
        });
        const weatherData = await weatherRes.json();
        if (weatherData.success && !weatherData.results.includes("Не удалось")) {
            ctx.output = `🌤️ Данные из сети: ${weatherData.results}`;
            return finalizeOutput(ctx);
        }
    } catch(e) {}
    ctx.output = `❌ Не удалось узнать погоду для "${city}".`;
    return finalizeOutput(ctx);
}

function processLearning(ctx) {
    const teachMatch = ctx.msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    if (teachMatch) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '').toLowerCase();
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '').toLowerCase();
        if (!KNOWLEDGE_GRAPH[subject]) KNOWLEDGE_GRAPH[subject] = {};
        let relation = fact.includes("поэт") || fact.includes("писатель") ? "профессия" : "описание";
        if (!KNOWLEDGE_GRAPH[subject][relation]) KNOWLEDGE_GRAPH[subject][relation] = [];
        if (!KNOWLEDGE_GRAPH[subject][relation].includes(fact)) KNOWLEDGE_GRAPH[subject][relation].push(fact);
        saveBrain();
        ctx.output = `🧠 **Слой обучения:** Запомнил, что "${subject}" — это "${fact}".`;
    } else { ctx.output = `Не понял, что запомнить.`; }
    return finalizeOutput(ctx);
}

function processCode(ctx) {
    if (ctx.msg.includes("змейк")) ctx.output = `💻 **Код змейки:**\n\n\`\`\`html\n<canvas id="game"></canvas><script>/* Змейка */</script>\n\`\`\``;
    else if (ctx.msg.includes("калькулятор")) ctx.output = `💻 **Калькулятор:**\n\n\`\`\`html\n<div><input type="text"><button>1</button></div>\n\`\`\``;
    else ctx.output = `💻 Босс, я могу написать код для: змейка, калькулятор.`;
    return finalizeOutput(ctx);
}
async function processQuestion(ctx, proxyUrl, signal) {
    // 1. Проверка контекста (Короткие вопросы)
    if (ctx.msg.length < 20 && (ctx.msg.includes('?') || /^(это|а|и)\s/i.test(ctx.msg)) && CONTEXT_MEMORY.length > 0) {
        const lastWeather = [...CONTEXT_MEMORY].reverse().find(c => c.text.includes("погод"));
        if (lastWeather) return await processWeather({...ctx, msg: lastWeather.text + " " + ctx.msg}, proxyUrl, signal);
    }

    // 2. Логический вывод (Reasoning)
    let foundFacts = [];
    ctx.tokens.forEach(token => {
        const facts = reasonAbout(token);
        if (facts) foundFacts = foundFacts.concat(facts);
    });
    if (foundFacts.length > 0) {
        ctx.output = `🧠 **Слой логики:**\n- ${foundFacts.join('\n- ')}`;
        return finalizeOutput(ctx);
    }

    // 3. Математика (Косинус)
    const queryVec = textToVector(ctx.msg);
    let bestScore = 0, bestFact = null;
    for (const [entity, relations] of Object.entries(KNOWLEDGE_GRAPH)) {
        for (const [rel, objects] of Object.entries(relations)) {
            objects.forEach(obj => {
                const score = cosineSimilarity(queryVec, textToVector(`${entity} ${rel} ${obj}`));
                if (score > bestScore && score > 0.4) { bestScore = score; bestFact = `${entity} — ${rel}: ${obj}`; }
            });
        }
    }
    if (bestFact) {
        ctx.output = `🧮 **Слой математики (Совпадение ${Math.round(bestScore*100)}%):** ${bestFact}`;
        return finalizeOutput(ctx);
    }

    // 4. Поиск в интернете
    return await processInternetSearch(ctx, proxyUrl, signal);
}
async function processInternetSearch(ctx, proxyUrl, signal) {
    try {
        const searchQuery = ctx.tokens.join(' ') || ctx.msg;
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        const searchData = await searchRes.json();
        
        if (searchData.success && searchData.results && !searchData.results.includes("ничего не найдено")) {
            // Очищаем от HTML-тегов Википедии
            let rawText = searchData.results.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/<\/?[^>]+(>|$)/g, "").trim();
            
            // ВЫЗЫВАЕМ НОВЫЕ СЛОИ ИЗВЛЕЧЕНИЯ И СИНТЕЗА
            const relevantSentences = extractRelevantSentences(rawText, ctx.tokens);
            const synthesizedAnswer = synthesizeAnswer(relevantSentences, ctx.msg);

            if (synthesizedAnswer) {
                // Сохраняем в граф (Автообучение)
                const mainSubject = ctx.tokens[0] || "информация";
                if (!KNOWLEDGE_GRAPH[mainSubject]) KNOWLEDGE_GRAPH[mainSubject] = {};
                if (!KNOWLEDGE_GRAPH[mainSubject]["из_интернета"]) KNOWLEDGE_GRAPH[mainSubject]["из_интернета"] = [];
                KNOWLEDGE_GRAPH[mainSubject]["из_интернета"].push(synthesizedAnswer);
                saveBrain();

                ctx.output = `🔎 **Слой поиска и синтеза:** ${synthesizedAnswer}\n\n*[Добавлено в память]*`;
                return finalizeOutput(ctx);
            }
        }
        throw new Error("Не удалось извлечь релевантный текст");
    } catch (e) {
        ctx.output = `❌ Я поискал в сети, но не нашел точного ответа.`;
        return finalizeOutput(ctx);
    }
}

// ФИНАЛИЗАЦИЯ (Последний слой контроля)
function finalizeOutput(ctx) {
    if (!ctx.output || ctx.output.trim() === "") ctx.output = "⚠️ Ошибка в слоях обработки. Ответ пуст.";

    CONTEXT_MEMORY.push({ role: 'user', text: ctx.msg, entities: ctx.tokens, timestamp: Date.now() });
    CONTEXT_MEMORY.push({ role: 'assistant', text: ctx.output, entities: ctx.tokens, timestamp: Date.now() });
    if (CONTEXT_MEMORY.length > MAX_CONTEXT) CONTEXT_MEMORY.shift();
    saveContext();

    return ctx.output;
}
