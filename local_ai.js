// local_ai.js

const BRAIN_VERSION = "11.0"; 

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "куку": { answers: ["Куку! Я на связи.", "Ку-ку, Босс! Какие задачи?", "Куку! Слушаю внимательно."], weights: [1, 1, 1] },
    "здорово": { answers: ["Здорово, Босс!", "Приветствую!"], weights: [1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь."], weights: [1, 1] }
};

let LOCAL_BRAIN = {};
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";

const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalBrain');
    localStorage.removeItem('shtabLastInteraction');
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
}

try {
    const saved = localStorage.getItem('shtabLocalBrain');
    LOCAL_BRAIN = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_BRAIN));
} catch (e) {
    LOCAL_BRAIN = JSON.parse(JSON.stringify(DEFAULT_BRAIN));
}

function saveLocalBrain() {
    localStorage.setItem('shtabLocalBrain', JSON.stringify(LOCAL_BRAIN));
}

function rememberFact(questionKey, answerText) {
    if (!answerText || answerText.includes("Не удалось") || answerText.includes("Ошибка")) return;
    if (!LOCAL_BRAIN[questionKey]) {
        LOCAL_BRAIN[questionKey] = { answers: [], weights: [] };
    }
    if (!LOCAL_BRAIN[questionKey].answers.includes(answerText)) {
        LOCAL_BRAIN[questionKey].answers.push(answerText);
        LOCAL_BRAIN[questionKey].weights.push(2); 
        saveLocalBrain();
    }
}

function getKeywords(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'такого', 'такая', 'является', 'значит'];
    return text.toLowerCase().replace(/[?.!,]/g, '').split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.includes(word));
}
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();

    // === 1. ПОГОДА ===
    if (/погод|градус|температур|на завтра/i.test(msg)) {
        let isTomorrow = /завтра/i.test(msg);
        let cleanText = msg.replace(/[?.!,]/g, '');
        cleanText = cleanText.replace(/(?:что|думаешь|насчет|расскажи|какая|какой|узнай|найди|покажи|сейчас)?\s*(?:погода|погоды|погоду|погоде)\s*(?:в|во|на)?\s*/gi, '');
        cleanText = cleanText.replace(/(?:в|во|на)\s*/gi, '');
        
        let city = cleanText.trim() || lastCity;

        const weatherRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }),
            signal: signal
        });
        
        if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
        const weatherData = await weatherRes.json();
        
        if (weatherData.success) {
            return `🌤️ Данные из сети: ${weatherData.results}`;
        } else {
            return `Не удалось получить данные о погоде.`;
        }
    } 

    // === 2. АНАЛИЗ ИНТЕНТА (СМЫСЛА) ===
    const questionWords = ['кто', 'что', 'где', 'когда', 'как', 'почему', 'зачем', 'какой', 'какая', 'какие', 'сколько'];
    const isQuestion = msg.includes('?') || questionWords.some(w => msg.startsWith(w + ' '));
    const teachMatch = msg.match(/(.+?)\s*(?:это|является|значит|—|-)\s+(.+)/i);
    const isTeach = !!teachMatch;
    const isSearchCmd = /^(найди|поищи|погугли|узнай)\b/i.test(msg);

    // === 3. ОБУЧЕНИЕ ===
    if (isTeach && !isSearchCmd) {
        let subject = teachMatch[1].trim().replace(/[!.?]/g, '');
        let fact = teachMatch[2].trim().replace(/[!.?]/g, '');
        
        let fullFact = `${subject.charAt(0).toUpperCase() + subject.slice(1)} — это ${fact}.`;
        
        const subjectKeywords = getKeywords(subject);
        const keyForMemory = subjectKeywords.length > 0 ? subjectKeywords.join(' ') : subject.toLowerCase();
        
        rememberFact(keyForMemory, fullFact);
        return `🧠 Записал в память: ${fullFact}`;
    }

    // === 4. БАЗОВЫЕ ФРАЗЫ (Приветствия) ===
    for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
        // Если короткая фраза (например, "Куку") точно совпадает с ключом
        if (msg === key || (msg.length < 15 && msg.includes(key))) {
             // Выбираем случайный ответ из базы для вариативности
             let randomIndex = Math.floor(Math.random() * data.answers.length);
             return `${data.answers[randomIndex]}`;
        }
    }

    // === 5. ПОИСК В ПАМЯТИ (С вариативностью) ===
    const keywords = getKeywords(msg);
    let bestKey = null;
    let bestScore = 0; 
    let bestAnswer = "";

    if (keywords.length > 0) {
        for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
            let matchCount = keywords.filter(kw => key.includes(kw) || kw.includes(key)).length;
            
            if (matchCount > bestScore) {
                bestScore = matchCount;
                bestKey = key;
                // Выбираем ответ с самым высоким весом
                let maxWeight = Math.max(...data.weights);
                let bestIndices = data.weights.reduce((acc, w, i) => w === maxWeight ? [...acc, i] : acc, []);
                // Если ответов с одинаковым весом несколько, выбираем случайный
                let randomIndex = bestIndices[Math.floor(Math.random() * bestIndices.length)];
                bestAnswer = data.answers[randomIndex];
            }
        }
    }

    // Если это вопрос и мы нашли ответ в памяти
    if (isQuestion && bestScore > 0 && bestScore >= Math.ceil(keywords.length / 2)) {
        // Генератор случайных вступлений, чтобы не повторяться
        const memoryPrefixes = [
            "🧠 Вспоминаю:", 
            "🧠 Из моих архивов:", 
            "🧠 Как я уже говорил:", 
            "🧠 Я это знаю:"
        ];
        let prefix = memoryPrefixes[Math.floor(Math.random() * memoryPrefixes.length)];
        return `${prefix} ${bestAnswer}`;
    }

    // === 6. ИНТЕРНЕТ ===
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
            
            // Очищаем текст от заголовков Википедии и лишних символов
            let cleanFact = rawText.replace(/Результаты поиска в Википедии по запросу "[^"]+":/i, '').replace(/^-\s*/, '').trim();

            let finalAnswer = "";
            
            if (bestScore > 0 && bestAnswer && isQuestion) {
                finalAnswer = `🔎 Я кое-что знал (${bestAnswer}), а теперь узнал в интернете: ${cleanFact}`;
            } else {
                finalAnswer = `🔎 Я сходил в интернет и нашел: ${cleanFact}`;
            }
            
            const keyForMemory = keywords.join(' ') || msg;
            rememberFact(keyForMemory, cleanFact);
            
            return finalAnswer;
        } else {
            return `Я проверил интернет, но не нашел информации.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка сети: ${e.message}`;
    }
}
