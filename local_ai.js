// local_ai.js

const BRAIN_VERSION = "5.0"; // Очистка старой памяти

// Базовая память (чему он уже "научен" с рождения)
const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме.", "Отлично, жду задач."], weights: [1, 1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь.", "Обращайся."], weights: [1, 1, 1] },
    "код": { answers: ["Давай посмотрим код.", "Где-то ошибка?", "Нужно проверить переменные."], weights: [1, 1, 1] }
};

let LOCAL_BRAIN = {};
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";

// Автоочистка при смене версии (чтобы не тащить старые ошибки)
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

// ФУНКЦИЯ САМООБУЧЕНИЯ (Агент запоминает то, что нашел)
function rememberFact(questionKey, answerText) {
    if (!answerText || answerText.includes("Не удалось") || answerText.includes("Ошибка")) return;
    
    if (!LOCAL_BRAIN[questionKey]) {
        LOCAL_BRAIN[questionKey] = { answers: [], weights: [] };
    }
    if (!LOCAL_BRAIN[questionKey].answers.includes(answerText)) {
        LOCAL_BRAIN[questionKey].answers.push(answerText);
        // Даем высокий вес (2), чтобы он запомнил это как важный факт
        LOCAL_BRAIN[questionKey].weights.push(2); 
        saveLocalBrain();
        console.log(`🧠 Агент выучил новый факт: "${questionKey}"`);
    }
}

async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();

    // === 1. СПЕЦИАЛЬНЫЕ ЗАПРОСЫ (Погода) ===
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

    // === 2. ПРОВЕРКА СВОЕЙ ПАМЯТИ ===
    let bestMatchKey = null;
    let maxScore = 0;
    
    // Ищем совпадения в том, что уже знаем
    for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
        // Проверяем, есть ли ключ из памяти в вопросе пользователя
        if (msg.includes(key)) {
            const score = data.weights.reduce((a, b) => a + b, 0);
            if (score > maxScore) {
                maxScore = score;
                bestMatchKey = key;
            }
        }
    }

    // Если нашли в памяти - ВЫДАЕМ ОТВЕТ (без интернета)
    if (bestMatchKey) {
        const data = LOCAL_BRAIN[bestMatchKey];
        let totalWeight = data.weights.reduce((a, b) => a + b, 0);
        let randomPick = Math.random() * totalWeight;
        let currentSum = 0;
        let selectedIndex = 0;
        
        for (let i = 0; i < data.answers.length; i++) {
            currentSum += data.weights[i];
            if (randomPick <= currentSum) { selectedIndex = i; break; }
        }
        return `${data.answers[selectedIndex]}`;
    }

    // === 3. САМООБУЧЕНИЕ (ЕСЛИ НЕ ЗНАЕМ - ИДЕМ В ИНТЕРНЕТ) ===
    try {
        // Очищаем запрос от лишних слов для поиска
        let searchQuery = msg.replace(/(?:что|как|кто|где|когда|думаешь|насчет|расскажи|найди|поищи|погугли|узнай|такое|такой|это|мне|тебе|а|и|в|на)/gi, ' ').replace(/\s+/g, ' ').trim();
        if (!searchQuery) searchQuery = userMessage;

        // Идем в интернет через Deno
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: searchQuery }),
            signal: signal
        });

        if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        
        if (searchData.success && searchData.results) {
            // Берем первые 300 символов для ответа
            let rawText = searchData.results.substring(0, 300);
            if (searchData.results.length > 300) rawText += "...";
            
            let finalAnswer = `🔎 Я сходил в интернет и нашел: ${rawText}`;
            
            // ГЛАВНЫЙ ШАГ: СОХРАНЯЕМ В ПАМЯТЬ (САМООБУЧЕНИЕ)
            // Ключом делаем очищенный запрос
            rememberFact(searchQuery.toLowerCase(), finalAnswer);
            
            return finalAnswer;
        } else {
            return `Я проверил интернет, но не нашел информации по запросу "${searchQuery}".`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка при попытке выйти в интернет: ${e.message}`;
    }
}
