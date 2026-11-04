// local_ai.js

// ВЕРСИЯ МОЗГА (Если изменить, память автоматически очистится)
const BRAIN_VERSION = "2.0"; 

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме.", "Отлично, жду задач."], weights: [1, 1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь.", "Обращайся."], weights: [1, 1, 1] },
    "код": { answers: ["Давай посмотрим код.", "Где-то ошибка?", "Нужно проверить переменные."], weights: [1, 1, 1] }
};

let LOCAL_BRAIN = {};

// АВТООЧИСТКА ПРИ СМЕНЕ ВЕРСИИ
const savedVersion = localStorage.getItem('shtabBrainVersion');
if (savedVersion !== BRAIN_VERSION) {
    localStorage.removeItem('shtabLocalBrain');
    localStorage.removeItem('shtabLastInteraction');
    localStorage.setItem('shtabBrainVersion', BRAIN_VERSION);
    console.log("Мозг ИИ обновлен до версии " + BRAIN_VERSION + ". Память очищена.");
}

// ЗАГРУЗКА МОЗГА
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
        console.log(`Агент выучил новое: "${questionKey}"`);
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

    // === 1. СНАЧАЛА ПРОВЕРЯЕМ СЕТЕВЫЕ ЗАПРОСЫ ===
    const isWeatherIntent = /погода|погоду|температура|градус/i.test(msg);
    const isSearchIntent = /найди|поищи|погугли|узнай|кто такой|что такое/i.test(msg);

    if (isWeatherIntent) {
        let cleanText = msg.replace(/[?.!,]/g, '');
        cleanText = cleanText.replace(/(?:какая|какой|узнай|найди|покажи|сейчас)?\s*(?:погода|погоду)\s*(?:в|во|на)?\s*/gi, '');
        let city = cleanText.replace(/[^А-Яа-яA-Za-z\-\s]/g, '').trim() || "Москва";

        const weatherRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weatherQuery: city }),
            signal: signal
        });
        
        if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
        const weatherData = await weatherRes.json();
        
        if (weatherData.success) {
            return `По данным сети, сейчас в городе ${city}: ${weatherData.results}`;
        } else {
            return `Не удалось получить данные о погоде для "${city}". Попробуйте позже.`;
        }
    } 
    
    if (isSearchIntent) {
        const searchRes = await fetch(proxyUrl, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchQuery: userMessage }),
            signal: signal
        });

        if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        
        if (searchData.success) {
            let rawText = searchData.results.substring(0, 300);
            if (searchData.results.length > 300) rawText += "...";
            let finalAnswer = `Я нашел в интернете следующее: ${rawText}`;
            
            const keyForMemory = msg.split(' ').slice(0, 3).join(' '); 
            rememberFact(keyForMemory, finalAnswer);
            return finalAnswer;
        } else {
            return `Поиск в интернете не дал результатов.`;
        }
    } 

    // === 2. ЕСЛИ НЕ ПОГОДА И НЕ ПОИСК, ИЩЕМ В ПАМЯТИ ===
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

    // === 3. ЕСЛИ СОВСЕМ НЕ ЗНАЕМ ===
    return `Я не знаю ответа на "${userMessage}". Попробуйте спросить меня о погоде или скажите "найди...".`;
    }
