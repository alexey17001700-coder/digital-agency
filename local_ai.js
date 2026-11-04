// local_ai.js

const BRAIN_VERSION = "7.0"; // Очистка памяти

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
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

// Очистка запроса от "мусорных" слов
function getKeywords(text) {
    const stopWords = ['что', 'как', 'кто', 'где', 'когда', 'зачем', 'почему', 'это', 'такое', 'такой', 'мне', 'тебе', 'расскажи', 'найди', 'поищи', 'узнай', 'а', 'и', 'в', 'во', 'на', 'с', 'про', 'такого', 'такая'];
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

    // === 2. ПОИСК В ПАМЯТИ С ПРОВЕРКОЙ УВЕРЕННОСТИ (ПРЕДСКАЗАНИЕ) ===
    const keywords = getKeywords(msg);
    let bestKey = null;
    let bestScore = 0; // Считаем, сколько слов совпало
    let bestAnswer = "";

    if (keywords.length > 0) {
        for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
            // Считаем, сколько слов из вопроса есть в ключе памяти
            let matchCount = keywords.filter(kw => key.includes(kw)).length;
            
            if (matchCount > bestScore) {
                bestScore = matchCount;
                bestKey = key;
                // Берем ответ с самым высоким весом
                let maxWeightIndex = data.weights.indexOf(Math.max(...data.weights));
                bestAnswer = data.answers[maxWeightIndex];
            }
        }
    }

    // ПРЕДСКАЗАНИЕ: Если мы нашли ВСЕ слова (или больше половины), выдаем из памяти
    if (bestScore > 0 && bestScore >= Math.ceil(keywords.length / 2)) {
        return `🧠 Из памяти (Уверенность: ${Math.round((bestScore/keywords.length)*100)}%): ${bestAnswer}`;
    }

    // === 3. ЕСЛИ УВЕРЕННОСТЬ НИЗКАЯ - ИДЕМ В ИНТЕРНЕТ ===
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
            
            // Если у нас была ЧАСТИЧНАЯ информация из памяти, мы объединяем её с новой
            let finalAnswer = "";
            if (bestScore > 0 && bestAnswer) {
                finalAnswer = `🔎 Я кое-что знал (${bestAnswer}), а теперь узнал в интернете: ${rawText}`;
            } else {
                finalAnswer = `🔎 Я сходил в интернет и нашел: ${rawText}`;
            }
            
            // УЧИМСЯ: Сохраняем полный ответ под ключом из главных слов
            const keyForMemory = keywords.join(' ') || msg;
            rememberFact(keyForMemory, finalAnswer);
            
            return finalAnswer;
        } else {
            return `Я проверил интернет, но не нашел информации.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка сети: ${e.message}`;
    }
}
