// local_ai.js

const BRAIN_VERSION = "3.0"; // Очистка памяти

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме.", "Отлично, жду задач."], weights: [1, 1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь.", "Обращайся."], weights: [1, 1, 1] },
    "код": { answers: ["Давай посмотрим код.", "Где-то ошибка?", "Нужно проверить переменные."], weights: [1, 1, 1] }
};

let LOCAL_BRAIN = {};
let lastCity = localStorage.getItem('shtabLastCity') || "Москва";

// Автоочистка при смене версии
const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalBrain');
    localStorage.removeItem('shtabLastInteraction');
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
    console.log("Мозг ИИ обновлен до версии " + BRAIN_VERSION);
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

    // === 1. СПЕЦИАЛЬНЫЙ ЗАПРОС (Погода) ===
    // Погода требует отдельного API, поэтому мы ее выделяем
    if (/погода|погоду|градус|температура|на завтра/i.test(msg)) {
        let isTomorrow = /завтра/i.test(msg);
        let city = lastCity; 

        const cityMatch = msg.match(/(?:погода|погоду)(?:\s+в|\s+во)?\s+([а-яёa-z\-]+)/i);
        if (cityMatch && cityMatch[1] && !['завтра', 'сегодня', 'сейчас'].includes(cityMatch[1])) {
            city = cityMatch[1];
            city = city.charAt(0).toUpperCase() + city.slice(1);
            localStorage.setItem('shtabLastCity', city); 
        }

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
    // Сначала проверяем, знаем ли мы уже ответ на этот вопрос
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
    // Если мы не знаем ответа, мы НЕ ТРЕБУЕМ от Босса ключевых слов "найди".
    // Мы берем весь его текст и отправляем в поиск.
    try {
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: userMessage }),
            signal: signal
        });

        if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        
        if (searchData.success && searchData.results) {
            let rawText = searchData.results.substring(0, 300);
            if (searchData.results.length > 300) rawText += "...";
            let finalAnswer = `Я сходил в интернет и нашел: ${rawText}`;
            
            // Запоминаем этот факт, чтобы в следующий раз ответить мгновенно
            const keyForMemory = msg.split(' ').slice(0, 3).join(' '); 
            rememberFact(keyForMemory, finalAnswer);
            return finalAnswer;
        } else {
            return `Я не нашел информации по запросу "${userMessage}" в интернете.`;
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        return `Ошибка при попытке выйти в интернет: ${e.message}`;
    }
}
