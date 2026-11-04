// local_ai.js

const BRAIN_VERSION = "6.0"; 

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме."], weights: [1, 1] },
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

// Вспомогательная функция: очистка слов от мусора
function getKeywords(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про'];
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
            return `Не удалось получить данные о погоде для "${city}".`;
        }
    } 

    // === 2. АССОЦИАТИВНЫЙ ПОИСК В ПАМЯТИ (Синтез) ===
    const keywords = getKeywords(msg);
    let foundAnswers = [];
    let matchedKeys = [];

    // Ищем совпадения по каждому слову
    for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
        // Если ключ из памяти содержит хотя бы одно из слов вопроса
        if (keywords.some(kw => key.includes(kw) || kw.includes(key))) {
            // Находим лучший ответ для этого ключа
            let maxWeightIndex = data.weights.indexOf(Math.max(...data.weights));
            let answer = data.answers[maxWeightIndex];
            
            if (!foundAnswers.includes(answer)) {
                foundAnswers.push(answer);
                matchedKeys.push(key);
            }
        }
    }

    // Если нашли ассоциации в памяти
    if (foundAnswers.length > 0) {
        // Если нашли несколько кусочков, склеиваем их
        if (foundAnswers.length > 1) {
            return `🧠 Я собрал ответ из своих знаний: ${foundAnswers.join(' ... А также: ')}`;
        }
        return `🧠 Из памяти: ${foundAnswers[0]}`;
    }

    // === 3. ЕСЛИ АССОЦИАЦИЙ НЕТ - ИДЕМ В ИНТЕРНЕТ И УЧИМСЯ ===
    try {
        let searchQuery = keywords.join(' '); 
        if (!searchQuery) searchQuery = userMessage;

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
            
            let finalAnswer = `🔎 Я сходил в интернет и нашел: ${rawText}`;
            
            // УЧИМСЯ: Сохраняем факт под ключом из главных слов
            const keyForMemory = keywords.slice(0, 3).join(' ') || msg;
            rememberFact(keyForMemory, finalAnswer);
            
            return finalAnswer;
        } else {
            return `Я проверил интернет, но не нашел информации.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка при попытке выйти в интернет: ${e.message}`;
    }
            }
