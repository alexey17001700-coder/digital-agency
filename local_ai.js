// local_ai.js

const DEFAULT_BRAIN = {
    "привет": { answers: ["Привет, Босс!", "Здравствуй! Чем займемся?", "На связи."], weights: [1, 1, 1] },
    "как дела": { answers: ["Работаю в штатном режиме.", "Все системы в норме.", "Отлично, жду задач."], weights: [1, 1, 1] },
    "погода": { answers: ["Я могу узнать погоду в любом городе через сеть.", "Сейчас посмотрю, что там на улице."], weights: [1, 1] },
    "спасибо": { answers: ["Всегда пожалуйста!", "Рад помочь.", "Обращайся."], weights: [1, 1, 1] },
    "код": { answers: ["Давай посмотрим код.", "Где-то ошибка?", "Нужно проверить переменные."], weights: [1, 1, 1] }
};

let LOCAL_BRAIN = {};
try {
    const saved = localStorage.getItem('shtabLocalBrain');
    LOCAL_BRAIN = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_BRAIN));
} catch (e) {
    LOCAL_BRAIN = JSON.parse(JSON.stringify(DEFAULT_BRAIN));
}

function saveLocalBrain() {
    localStorage.setItem('shtabLocalBrain', JSON.stringify(LOCAL_BRAIN));
}

// Функция запоминания нового факта из сети
function rememberFact(questionKey, answerText) {
    if (!LOCAL_BRAIN[questionKey]) {
        LOCAL_BRAIN[questionKey] = { answers: [], weights: [] };
    }
    if (!LOCAL_BRAIN[questionKey].answers.includes(answerText)) {
        LOCAL_BRAIN[questionKey].answers.push(answerText);
        LOCAL_BRAIN[questionKey].weights.push(2); // Высокий вес для данных из сети
        saveLocalBrain();
        console.log(`Агент выучил новое: "${questionKey}"`);
    }
}

// Основная функция (теперь асинхронная из-за запросов в сеть)
async function generateLocalResponse(agentName, userMessage, proxyUrl, signal) {
    const msg = userMessage.toLowerCase().trim();
    let bestMatchKey = null;
    let maxScore = 0;

    // 1. Ищем ответ в локальной памяти
    for (const [key, data] of Object.entries(LOCAL_BRAIN)) {
        if (msg.includes(key)) {
            const score = data.weights.reduce((a, b) => a + b, 0);
            if (score > maxScore) {
                maxScore = score;
                bestMatchKey = key;
            }
        }
    }

    // Если нашли - отвечаем
    if (bestMatchKey) {
        const data = LOCAL_BRAIN[bestMatchKey];
        let totalWeight = data.weights.reduce((a, b) => a + b, 0);
        let randomPick = Math.random() * totalWeight;
        
        let currentSum = 0;
        let selectedIndex = 0;
        
        for (let i = 0; i < data.answers.length; i++) {
            currentSum += data.weights[i];
            if (randomPick <= currentSum) {
                selectedIndex = i;
                break;
            }
        }

        localStorage.setItem('shtabLastInteraction', JSON.stringify({ key: bestMatchKey, index: selectedIndex }));
        return `${data.answers[selectedIndex]}`;
        }
        // 2. Если в памяти не нашли, идем в сеть через Deno Proxy
    try {
        const isWeatherIntent = /погода|погоду|температура|градус/i.test(msg);
        const isSearchIntent = /найди|поищи|погугли|узнай|кто такой|что такое/i.test(msg);

        let networkResult = "";

        if (isWeatherIntent) {
            // Очищаем запрос от лишних слов, чтобы получить город
            let cleanText = msg.replace(/[?.!,]/g, '');
            cleanText = cleanText.replace(/(?:какая|какой|узнай|найди|покажи)?\s*(?:погода|погоду)\s*(?:в|во|на)?\s*/gi, '');
            let city = cleanText.trim() || "Москва";

            const weatherRes = await fetch(proxyUrl, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ weatherQuery: city }),
                signal: signal
            });
            
            if (!weatherRes.ok) throw new Error(`HTTP ${weatherRes.status}`);
            const weatherData = await weatherRes.json();
            
            if (weatherData.success) {
                networkResult = `По данным сети, сейчас в городе ${city}: ${weatherData.results}`;
            } else {
                throw new Error("Сервис не вернул данные о погоде");
            }
        } 
        else if (isSearchIntent) {
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
                networkResult = `Я нашел в интернете следующее: ${rawText}`;
            } else {
                throw new Error("Поиск в интернете не дал результатов");
            }
        } 
        else {
            // Если это не явный поиск и не погода, но мы не знаем ответа
            return `Я не знаю ответа на "${userMessage}". Попробуйте спросить меня о погоде или скажите "найди...".`;
        }

        // 3. ОБУЧЕНИЕ: Сохраняем то, что нашли в сети, в локальную память
        // Ключом делаем первые два слова запроса, чтобы потом быстро находить
        const keyForMemory = msg.split(' ').slice(0, 2).join(' '); 
        rememberFact(keyForMemory, networkResult);

        return networkResult;

    } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error("Ошибка сети в локальном ИИ:", error);
        return `Произошла ошибка при попытке выйти в сеть: ${error.message}`;
    }
} // <--- ЗДЕСЬ ЗАКРЫВАЕТСЯ generateLocalResponse

// ФУНКЦИЯ ОБУЧЕНИЯ (Вызывается, когда пользователь хвалит или ругает агента)
function teachAgent(wasGood) {
    try {
        const lastInteraction = JSON.parse(localStorage.getItem('shtabLastInteraction'));
        if (!lastInteraction) return;

        const { key, index } = lastInteraction;
        
        if (LOCAL_BRAIN[key] && LOCAL_BRAIN[key].weights[index] !== undefined) {
            if (wasGood) {
                LOCAL_BRAIN[key].weights[index] += 1; // Хвалим
            } else {
                LOCAL_BRAIN[key].weights[index] = Math.max(0.1, LOCAL_BRAIN[key].weights[index] - 0.5); // Ругаем
            }
            saveLocalBrain();
            console.log(`Агент обновил веса для "${key}"`);
        }
    } catch (e) {
        console.error("Ошибка обучения:", e);
    }
                                               }
