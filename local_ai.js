const BRAIN_VERSION = "82.0_OPEN_ACCESS";

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

// Автозапуск
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.bootAllBrains);
} else {
    window.bootAllBrains();
}
