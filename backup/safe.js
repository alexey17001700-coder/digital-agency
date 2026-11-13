/* =========================================================
   safe.js — XSS-фильтр Штаба.
   Подключается в app.html ПОСЛЕ marked и DOMPurify, но ДО чата.
   Правок в chat.js не требует: файл аккуратно оборачивает
   marked.parse, поэтому любые ответы модели и результаты
   поиска проходят через санитайзер автоматически.
   ========================================================= */
(function () {
  "use strict";

  // Теги, которых в ответах ИИ быть не должно ни при каких условиях.
  const FORBID_TAGS = [
    "script", "style", "iframe", "object", "embed", "form", "input",
    "button", "textarea", "select", "option", "link", "meta", "base", "svg", "math"
  ];

  // На всякий случай запрещаем и опасные атрибуты.
  const FORBID_ATTR = ["srcdoc", "formaction", "xlink:href"];

  const PURIFY_CONFIG = {
    FORBID_TAGS: FORBID_TAGS,
    FORBID_ATTR: FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    USE_PROFILES: { html: true }
  };

  // --- Резервный фильтр: если DOMPurify вдруг не загрузился ---
  const BAD_TAGS = FORBID_TAGS.slice();
  function fallbackSanitize(html) {
    try {
      const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
      const root = doc.body.firstElementChild;
      if (!root) return "";

      root.querySelectorAll(BAD_TAGS.join(",")).forEach((el) => el.remove());

      root.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase();
          const value = String(attr.value || "").replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
          const isDangerous =
            name.startsWith("on") ||
            name === "srcdoc" ||
            name === "formaction" ||
            ((name === "href" || name === "src" || name === "xlink:href") &&
              (value.startsWith("javascript:") || value.startsWith("data:text/html") || value.startsWith("vbscript:")));
          if (isDangerous) el.removeAttribute(attr.name);
        }
      });

      return root.innerHTML;
    } catch (e) {
      // Совсем крайний случай: показываем как текст, без разметки.
      return String(html).replace(/[<>]/g, "");
    }
  }

  function sanitizeHTML(html) {
    const src = String(html == null ? "" : html);
    if (!src) return "";
    try {
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
        return window.DOMPurify.sanitize(src, PURIFY_CONFIG);
      }
    } catch (e) {
      console.warn("[safe.js] DOMPurify дал сбой, включаю резервный фильтр:", e);
    }
    return fallbackSanitize(src);
  }

  // Отдаём наружу — можно пользоваться вручную из любого файла.
  window.sanitizeHTML = sanitizeHTML;

  // --- Оборачиваем marked.parse: все innerHTML в чате станут безопасными ---
  let patched = false;
  function patchMarked() {
    if (patched) return true;
    if (!window.marked || typeof window.marked.parse !== "function") return false;

    const originalParse = window.marked.parse.bind(window.marked);
    window.marked.parse = function (src, options) {
      let html;
      try {
        html = originalParse(src, options);
      } catch (e) {
        console.error("[safe.js] marked.parse упал:", e);
        html = String(src == null ? "" : src);
      }
      return sanitizeHTML(html);
    };

    patched = true;
    window.__markedPatched = true;
    console.log("[safe.js] marked.parse обёрнут санитайзером. Защита активна.");
    return true;
  }

  // marked грузится с CDN — ждём его появления, но не бесконечно.
  if (!patchMarked()) {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (patchMarked() || tries > 200) clearInterval(timer);
    }, 50);

    document.addEventListener("DOMContentLoaded", () => {
      if (!patchMarked()) {
        console.error(
          "[safe.js] ВНИМАНИЕ: marked не найден — защита разметки не активирована. " +
          "Проверь подключение marked.min.js в app.html."
        );
      }
    });
  }
})();