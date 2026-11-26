/* ============================================================================
   ФАКТ-ЧЕК — панель проверки фактов по РЕПОЗИТОРИЮ (а не по словам Архитектора)
   ----------------------------------------------------------------------------
   Зачем: Архитектор иногда говорит «в файле X стоит Y», а в файле стоит Z.
   Эта панель читает НАСТОЯЩИЕ файлы с GitHub и показывает то, что там лежит.
   Никаких ключей не нужно: репозитории публичные, GitHub API отдаёт CORS.

   Открывается кнопкой «🔎 ФАКТ-ЧЕК» в панели Штаба (⚙️).
   Крутилки = какие проверки запускать.
   ============================================================================ */

(function () {
    'use strict';

    const OWNER_DEFAULT = 'alexey17001700-coder';
    const REPO_DEFAULT = 'window_calc';

    const CHECKS = [
        { id: 'version', label: 'Версия в pubspec.yaml', on: true },
        { id: 'appid',   label: 'Имя приложения (applicationId / --org)', on: true },
        { id: 'parts',   label: 'Сшивка part / part of', on: true },
        { id: 'files',   label: 'Файлы lib/ (что реально есть)', on: true },
        { id: 'dead',    label: 'Мёртвый код (никто не импортирует)', on: true },
        { id: 'keys',    label: 'Ключи хранилища (расхождения)', on: true },
        { id: 'ndk',     label: 'NDK в build.gradle', on: true },
        { id: 'commits', label: 'Последние 5 коммитов', on: true },
        { id: 'actions', label: 'Последняя сборка APK', on: true }
    ];

    const state = {
        owner: OWNER_DEFAULT,
        repo: REPO_DEFAULT,
        branch: null,
        filesCache: {}   // path -> текст файла
    };

    // ---------- вспомогательное ----------
    function ghHeaders() {
        return { 'Accept': 'application/vnd.github+json' };
    }

    async function ghJson(url) {
        const r = await fetch(url, { headers: ghHeaders(), cache: 'no-store' });
        if (r.status === 403 || r.status === 429) {
            throw new Error('GitHub ограничил запросы (60/час без ключа). Подожди или проверь позже.');
        }
        if (!r.ok) throw new Error('GitHub вернул ' + r.status + ' на ' + url.split('/').pop());
        return r.json();
    }

    async function raw(path) {
        if (state.filesCache[path] !== undefined) return state.filesCache[path];
        const url = 'https://raw.githubusercontent.com/' + state.owner + '/' + state.repo + '/' +
            (state.branch || 'main') + '/' + path;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) { state.filesCache[path] = null; return null; }
        const t = await r.text();
        state.filesCache[path] = t;
        return t;
    }

    async function resolveBranch() {
        if (state.branch) return state.branch;
        const info = await ghJson('https://api.github.com/repos/' + state.owner + '/' + state.repo);
        state.branch = info.default_branch || 'main';
        return state.branch;
    }

    async function listDart() {
        const tree = await ghJson('https://api.github.com/repos/' + state.owner + '/' + state.repo +
            '/git/trees/' + (state.branch || 'main') + '?recursive=1');
        return (tree.tree || [])
            .filter(n => n.type === 'blob' && n.path.startsWith('lib/') && n.path.endsWith('.dart'))
            .map(n => n.path);
    }

    // ---------- проверки ----------
    const run = {};

    run.version = async () => {
        const txt = await raw('pubspec.yaml');
        if (!txt) return { ok: false, title: 'pubspec.yaml', lines: ['❌ файл не найден'] };
        const m = txt.match(/^\s*version:\s*(\S+)/m);
        const v = m ? m[1] : '(строка version не найдена)';
        return { ok: !!m, title: 'Версия приложения', lines: ['📌 version: ' + v,
            m && v.includes('+') ? '🔢 номер сборки: ' + v.split('+')[1] : '⚠️ номер сборки (+N) НЕ указан'] };
    };

    run.appid = async () => {
        const out = [];
        const g = await raw('android/app/build.gradle');
        const k = await raw('android/app/build.gradle.kts');
        const gradle = g || k;
        let ok = false;
        if (gradle) {
            const m = gradle.match(/applicationId\s*=?\s*["']([^"']+)["']/);
            if (m) { out.push('📦 applicationId: ' + m[1]); ok = true; }
            else out.push('⚠️ applicationId не найден — берётся из flutter create');
        } else out.push('⚠️ android/app/build.gradle не найден');

        const yml = await raw('.github/workflows/build.yml');
        if (yml) {
            const org = yml.match(/--org\s+(\S+)/);
            const proj = yml.match(/--project-name\s+(\S+)/);
            out.push(org ? '🏗 --org в build.yml: ' + org[1] : '⚠️ --org в build.yml НЕ указан (→ com.example)');
            if (!org) out.push('   значит applicationId = com.example.window_calc');
            if (proj) out.push('🏷 --project-name: ' + proj[1]);
        } else out.push('⚠️ .github/workflows/build.yml не найден');
        return { ok, title: 'Имя приложения (обновит старое APK или встанет отдельным)', lines: out };
    };

    run.parts = async () => {
        const paths = await listDart();
        const bad = [];
        const parts = [];
        for (const p of paths) {
            const t = await raw(p);
            if (!t) continue;
            const first = t.split('\n').slice(0, 8).join('\n');
            const m = first.match(/^\s*part of\s+['"]([^'"]+)['"]/m);
            if (m) {
                parts.push({ file: p, target: m[1] });
                const dir = p.substring(0, p.lastIndexOf('/') + 1);
                const norm = m[1].replace(/^package:[^/]+\//, 'lib/');
                const resolved = norm.startsWith('lib/') ? norm : (dir + norm).replace(/\/\.\//g, '/');
                const clean = resolved.split('/').reduce((acc, seg) => {
                    if (seg === '..') acc.pop(); else if (seg !== '.') acc.push(seg);
                    return acc;
                }, []).join('/');
                if (!paths.includes(clean)) bad.push('❌ ' + p + ' → "' + m[1] + '" (ищет ' + clean + ' — такого файла НЕТ)');
            }
        }
        // кто объявляет part
        const declaring = [];
        for (const p of paths) {
            const t = await raw(p);
            if (!t) continue;
            const re = /^\s*part\s+['"]([^'"]+)['"]/gm;
            let mm;
            while ((mm = re.exec(t)) !== null) declaring.push({ file: p, part: mm[1] });
        }
        const lines = [];
        declaring.forEach(d => lines.push('📎 ' + d.file + ' подключает part: ' + d.part));
        parts.forEach(p => lines.push('🔗 ' + p.file + ' объявлен как part of "' + p.target + '"'));
        bad.forEach(b => lines.push(b));
        if (!declaring.length && !parts.length) lines.push('✅ part / part of не используются — сшивать нечего');
        else if (!bad.length) lines.push('✅ все part-объявления сходятся');
        return { ok: bad.length === 0, title: 'Сшивка part / part of', lines };
    };

    run.files = async () => {
        const paths = await listDart();
        const lines = paths.map(p => {
            const t = state.filesCache[p];
            const n = t ? t.split('\n').length : null;
            return '📄 ' + p + (n ? ' — ' + n + ' строк' : '');
        });
        return { ok: paths.length > 0, title: 'Файлы lib/ — всего ' + paths.length, lines: lines.length ? lines : ['❌ в lib/ нет .dart файлов'] };
    };

    run.dead = async () => {
        const paths = await listDart();
        const imported = new Set();
        const all = {};
        for (const p of paths) {
            const t = await raw(p);
            if (!t) continue;
            all[p] = t;
            const re = /import\s+['"]([^'"]+)['"]/g;
            let m;
            while ((m = re.exec(t)) !== null) {
                const s = m[1];
                if (!s.startsWith('package:') && !s.startsWith('dart:')) {
                    const dir = p.substring(0, p.lastIndexOf('/') + 1);
                    const clean = (dir + s).split('/').reduce((acc, seg) => {
                        if (seg === '..') acc.pop(); else if (seg !== '.') acc.push(seg);
                        return acc;
                    }, []).join('/');
                    imported.add(clean);
                }
            }
        }
        const dead = paths.filter(p => !p.endsWith('main.dart') && !imported.has(p));
        const lines = dead.length
            ? dead.map(p => '🪦 ' + p + ' — никто не импортирует (' + ((all[p] || '').split('\n').length) + ' строк впустую)')
            : ['✅ мёртвых файлов нет'];
        return { ok: dead.length === 0, title: 'Мёртвый код', lines };
    };

    run.keys = async () => {
        const paths = await listDart();
        const found = {};
        for (const p of paths) {
            const t = await raw(p);
            if (!t) continue;
            const re = /(getString|setString|getInt|setInt|getBool|setBool|getStringList|setStringList|remove)\s*\(\s*['"]([^'"]+)['"]/g;
            let m;
            while ((m = re.exec(t)) !== null) {
                const key = m[2];
                if (!found[key]) found[key] = { writes: 0, reads: 0, files: new Set() };
                if (m[1].startsWith('set') || m[1] === 'remove') found[key].writes++;
                else found[key].reads++;
                found[key].files.add(p);
            }
        }
        const keys = Object.keys(found);
        const lines = keys.map(k => {
            const f = found[k];
            const tag = f.reads === 0 ? '⚠️ только ЗАПИСЬ — никто не читает'
                : (f.writes === 0 ? '⚠️ только ЧТЕНИЕ — никто не пишет' : '✅ пишут и читают');
            return '🔑 ' + k + ' — ' + tag + ' (' + Array.from(f.files).join(', ') + ')';
        });
        const readOnlyWrite = keys.filter(k => found[k].reads === 0 || found[k].writes === 0);
        if (!keys.length) lines.push('ℹ️ обращений к хранилищу не найдено');
        else if (readOnlyWrite.length) lines.push('⚠️ расхождения есть — счётчики могут показывать не то');
        else lines.push('✅ все ключи используются согласованно');
        return { ok: readOnlyWrite.length === 0, title: 'Ключи хранилища', lines };
    };

    run.ndk = async () => {
        const g = await raw('android/app/build.gradle') || await raw('android/app/build.gradle.kts');
        if (!g) return { ok: false, title: 'NDK', lines: ['❌ build.gradle не найден'] };
        const m = g.match(/ndkVersion\s*=?\s*["']([^"']+)["']/);
        return {
            ok: true, title: 'NDK',
            lines: m ? ['🔧 ndkVersion: ' + m[1]]
                : ['ℹ️ ndkVersion не задан — Flutter берёт версию плагинов. Предупреждение в логе сборку НЕ роняет.']
        };
    };

    run.commits = async () => {
        const list = await ghJson('https://api.github.com/repos/' + state.owner + '/' + state.repo + '/commits?per_page=5');
        const lines = list.map(c => '• ' + c.sha.slice(0, 7) + ' — ' + (c.commit.message || '').split('\n')[0] +
            ' (' + (c.commit.author && c.commit.author.date ? c.commit.author.date.slice(0, 16).replace('T', ' ') : '') + ')');
        return { ok: true, title: 'Последние коммиты', lines };
    };

    run.actions = async () => {
        const data = await ghJson('https://api.github.com/repos/' + state.owner + '/' + state.repo +
            '/actions/runs?per_page=1&branch=' + (state.branch || 'main'));
        const r = (data.workflow_runs || [])[0];
        if (!r) return { ok: false, title: 'Сборка APK', lines: ['ℹ️ запусков не найдено'] };
        const icon = r.conclusion === 'success' ? '✅' : (r.conclusion === 'failure' ? '❌' : '⏳');
        return {
            ok: r.conclusion === 'success', title: 'Последняя сборка APK',
            lines: [icon + ' ' + (r.conclusion || r.status) + ' — ' + r.name,
                '🕒 ' + (r.created_at || '').slice(0, 16).replace('T', ' '),
                '🔗 ' + r.html_url]
        };
    };

    // ---------- интерфейс ----------
    function ensureModal() {
        if (document.getElementById('fcOverlay')) return;
        const ov = document.createElement('div');
        ov.id = 'fcOverlay';
        ov.className = 'modal-overlay';
        ov.onclick = e => { if (e.target === ov) ov.classList.remove('active'); };
        ov.innerHTML = `
        <div class="modal-content" style="max-width:94%; max-height:88vh; overflow-y:auto; border-color:#ffd700;" onclick="event.stopPropagation()">
            <div class="modal-header">
                <h2 style="color:#ffd700;">🔎 ФАКТ-ЧЕК</h2>
                <button class="modal-close" onclick="document.getElementById('fcOverlay').classList.remove('active')">✖</button>
            </div>
            <div class="modal-body">
                <p style="font-size:12px;color:#8b98a5;margin:0 0 10px 0;line-height:1.5;">
                    Читает НАСТОЯЩИЕ файлы с GitHub. Ничего не выдумывает: нет файла — напишет «нет файла».
                </p>
                <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
                    <input id="fcOwner" value="${OWNER_DEFAULT}" style="flex:1;min-width:120px;background:#0d0d0d;border:1px solid #333;color:#fff;border-radius:6px;padding:8px;font:12px monospace;">
                    <input id="fcRepo" value="${REPO_DEFAULT}" style="flex:1;min-width:100px;background:#0d0d0d;border:1px solid #333;color:#fff;border-radius:6px;padding:8px;font:12px monospace;">
                </div>
                <div id="fcToggles" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="fcRun" style="flex:1;padding:12px;background:#ffd700;color:#000;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">ПРОВЕРИТЬ ФАКТЫ</button>
                    <button id="fcCopy" style="padding:12px;background:#333;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">📋</button>
                </div>
                <div id="fcOut" style="margin-top:14px;"></div>
            </div>
        </div>`;
        document.body.appendChild(ov);

        const box = ov.querySelector('#fcToggles');
        CHECKS.forEach(c => {
            const id = 'fc_' + c.id;
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:8px;background:#121212;border:1px solid #2a2a2a;border-radius:8px;padding:8px;font-size:11px;color:#ddd;cursor:pointer;';
            lbl.innerHTML = '<input type="checkbox" id="' + id + '" ' + (c.on ? 'checked' : '') +
                ' style="width:16px;height:16px;cursor:pointer;accent-color:#ffd700;"> <span>' + c.label + '</span>';
            box.appendChild(lbl);
        });

        ov.querySelector('#fcRun').onclick = doCheck;
        ov.querySelector('#fcCopy').onclick = () => {
            const t = ov.querySelector('#fcOut').innerText;
            if (!t) return;
            if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
        };
    }

    async function doCheck() {
        const out = document.getElementById('fcOut');
        const btn = document.getElementById('fcRun');
        state.owner = (document.getElementById('fcOwner').value || OWNER_DEFAULT).trim();
        state.repo = (document.getElementById('fcRepo').value || REPO_DEFAULT).trim();
        state.branch = null;
        state.filesCache = {};

        btn.disabled = true;
        btn.textContent = 'ЧИТАЮ GITHUB…';
        out.innerHTML = '<div style="color:#ffd700;font:12px monospace;">⏳ Читаю репозиторий ' + state.owner + '/' + state.repo + '…</div>';

        try {
            await resolveBranch();
        } catch (e) {
            out.innerHTML = '<div style="color:#ff5555;font:12px monospace;">❌ ' + e.message + '</div>';
            btn.disabled = false; btn.textContent = 'ПРОВЕРИТЬ ФАКТЫ';
            return;
        }

        // для файловых проверок нужен список путей заранее
        const needFiles = ['parts', 'files', 'dead', 'keys'].some(id => document.getElementById('fc_' + id).checked);
        if (needFiles) {
            try {
                const paths = await listDart();
                // прогреваем кэш — одним проходом
                for (const p of paths) await raw(p);
            } catch (e) { console.error(e); }
        }

        out.innerHTML = '';
        const report = [];
        report.push('ФАКТ-ЧЕК — ' + state.owner + '/' + state.repo + ' (' + state.branch + ')');
        report.push('Время: ' + new Date().toLocaleString('ru-RU'));
        report.push('');

        for (const c of CHECKS) {
            if (!document.getElementById('fc_' + c.id).checked) continue;
            const block = document.createElement('div');
            block.style.cssText = 'background:#121212;border:1px solid #2a2a2a;border-left:3px solid #ffd700;border-radius:8px;padding:10px;margin-bottom:8px;';
            block.innerHTML = '<div style="color:#ffd700;font-weight:bold;font-size:12px;margin-bottom:6px;">⌛ ' + c.label + '</div>';
            out.appendChild(block);
            try {
                const res = await run[c.id]();
                block.style.borderLeftColor = res.ok ? '#00ff88' : '#ff5555';
                block.innerHTML = '<div style="color:#ffd700;font-weight:bold;font-size:12px;margin-bottom:6px;">' +
                    (res.ok ? '✅ ' : '⚠️ ') + res.title + '</div>' +
                    res.lines.map(l => '<div style="font:11px monospace;color:#ccc;line-height:1.6;word-break:break-word;">' + escapeHtml(l) + '</div>').join('');
                report.push('== ' + res.title);
                res.lines.forEach(l => report.push(l));
                report.push('');
            } catch (e) {
                block.style.borderLeftColor = '#ff5555';
                block.innerHTML = '<div style="color:#ff5555;font:11px monospace;">❌ ' + escapeHtml(c.label) + ': ' + escapeHtml(e.message) + '</div>';
                report.push('== ' + c.label + ': ОШИБКА ' + e.message);
            }
        }

        out.dataset.report = report.join('\n');
        btn.disabled = false;
        btn.textContent = 'ПРОВЕРИТЬ ФАКТЫ';
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    window.openFactCheck = function () {
        ensureModal();
        document.getElementById('fcOverlay').classList.add('active');
    };
})();