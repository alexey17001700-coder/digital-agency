const BRAIN_VERSION = "81.0_STRICT_NO_KEYS";

window.__bootComplete = false;

// Имитация загрузки для красивого интерфейса
window.bootAllBrains = async function() {
    if (window.parent && typeof window.parent.updateAILoading === 'function') {
        window.parent.updateAILoading(100, "ИИ готов!", "");
    }
    window.__bootComplete = true;
    if (window.parent && typeof window.parent.aiLoadingComplete === 'function') {
        window.parent.aiLoadingComplete();
    }
};

// Эта функция вызывается из chat.js, ТОЛЬКО если у пользователя нет ключей
window.generateLocalResponse = async function(agentName, userMessage) {
    return `⚠️ **API ключи не найдены!**\n\nШтаб работает только на твоих личных ключах. Нажми на иконку ключа 🔑 вверху и введи ключ DeepSeek или Yandex, чтобы я начал думать.`;
};

// Автозапуск
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bootAllBrains);
} else {
    window.bootAllBrains();
}
