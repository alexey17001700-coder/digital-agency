// local_ai.js

const BRAIN_VERSION = "3.1"; // Очистка памяти

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме.", "Отлично, жду задач."], weights: [1, 1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь.", "Обращайся."], weights: [1, 1, 1] },
    "код": { answers: ["Давай посмотрим код.", "Где-то ошибка?", "Нужно проверить переменные."], weights: [1, 1, 1] }
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

function teachAgent(wasGood) {
    try {
        const lastInteraction = JSON.parse(localStorage.getItem('shtabLastInteraction'));
        if (!lastInteraction) return;
        const { key, index } = lastInteraction;
        if (LOCAL_BRAIN[key] && LOCAL_BRAIN[key].weights[index] !== undefined) {
            if (wasGood) LOCAL_BRAIN[key].weights[index] += 1;
            else LOCAL_BRAIN[key].weights[index] = Math.max(0.1, LOCAL_BRAIN[key].weights[index] - 0.5);
            saveLocalBrain();
        }
    } catch (e) { console.error("Ошибка обучения:", e); }
}

async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();

    // === 1. СПЕЦИАЛЬНЫЙ ЗАПРОС (Погода) - Ищем любой корень "погод" ===
    if (/погод|градус|температур|на завтра/i.test(msg)) {
        let isTomorrow = /завтра/i.test(msg);
        
        // Вычищаем ВСЕ лишние слова, оставляя только город
        let cleanText = msg.replace(/[?.!,]/g, '');
        cleanText = cleanText.replace(/(?:что|думаешь|насчет|расскажи|какая|какой|узнай|найди|покажи|сейчас)?\s*(?:погода|погоды|погоду|погоде)\s*(?:в|во|на)?\s*/gi, '');
        cleanText = cleanText.replace(/(?:в|во|на)\s*/gi, ''); // На случай если "в" осталась
        
        let city = cleanText.trim() || lastCity;

        const weatherRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weatherQuery: city, day: isTomorrow ? 1 : 0 }),
            signal: signal
        });
        
        if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
        const weatherData = await weatherRes.json();
        
        if (weatherData.success) {
            return `Данные из сети (${isTomorrow ? 'на завтра' : 'сейчас'}): ${weatherData.results}`;
        } else {
            return `Не удалось получить данные о погоде для "${city}".`;
        }
    } 

    // === 2. ИЩЕМ В ЛОКАЛЬНОЙ ПАМЯТИ ===
    let bestMatchKey = null;
    let maxScore = 0;
    for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
        if (msg.includes(key)) {
            const score = data.weights.reduce((a, b) => a + b, 0);
            if (score > maxScore) {
                maxScore = score;
                bestMatchKey = key;
            }
        }
    }

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
        localStorage.setItem('shtabLastInteraction', JSON.stringify({ key: bestMatchKey, index: selectedIndex }));
        return `${data.answers[selectedIndex]}`;
    }

    // === 3. АВТОНОМНЫЙ ПОИСК В ИНТЕРНЕТЕ ===
    // Вычищаем "мусорные" слова из запроса перед отправкой в Википедию
    let searchQuery = msg.replace(/(?:что|как|кто|где|когда|думаешь|насчет|расскажи|найди|поищи|погугли|узнай|такое|такой|это|мне|тебе)/gi, ' ').replace(/\s+/g, ' ').trim();
    
    // Если после чистки ничего не осталось, берем оригинальный текст
    if (!searchQuery) searchQuery = userMessage;

    try {
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
            let finalAnswer = `Я сходил в интернет и нашел: ${rawText}`;
            
            const keyForMemory = searchQuery.split(' ').slice(0, 3).join(' '); 
            rememberFact(keyForMemory, finalAnswer);
            return finalAnswer;
        } else {
            return `Я не нашел информации по запросу "${searchQuery}" в интернете.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка при попытке выйти в интернет: ${e.message}`;
    }
}
