/* Restore the applied pack before paint. Previews write to their own element only. */
(() => {
    'use strict';
    const catalog = window.TimerThemeCatalog;
    const packs = new Map(catalog.map(pack => [pack.id, pack]));
    const preferenceKey = 'timer.appearance.v1';
    const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

    function normalize(value) {
        return {
            theme: packs.has(value?.theme) ? value.theme : 'classic',
            mode: ['light', 'dark', 'system'].includes(value?.mode) ? value.mode : 'system',
            decoration: value?.decoration === 'simple' ? 'simple' : 'full'
        };
    }
    function read() {
        let legacy;
        try {
            legacy = localStorage.getItem('userTheme');
            const saved = localStorage.getItem(preferenceKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (packs.has(parsed?.theme)) return normalize(parsed);
            }
        } catch (_) { /* An older preference can still be used if the new one is unreadable. */ }
        return normalize({
            theme: legacy === 'white' ? 'minimal' : 'classic',
            mode: legacy === 'dark' ? 'dark' : ['white', 'blue'].includes(legacy) ? 'light' : 'system'
        });
    }
    function resolve(value = read()) {
        const selection = normalize(value);
        const dark = selection.mode === 'system' ? darkScheme.matches : selection.mode === 'dark';
        return { ...selection, tone: dark ? 'dark' : packs.get(selection.theme).lightTone };
    }
    function preview(element, selection) {
        const appearance = resolve(selection);
        element.dataset.skin = appearance.theme;
        element.dataset.theme = appearance.tone;
        element.dataset.decoration = appearance.decoration;
        return appearance;
    }
    function refresh() {
        const appearance = preview(document.documentElement, read());
        window.dispatchEvent(new CustomEvent('timer:theme-change', { detail: appearance }));
        return appearance;
    }
    function apply(value) {
        const selection = normalize(value);
        try { localStorage.setItem(preferenceKey, JSON.stringify(selection)); }
        catch (_) { throw new Error('外观设置未保存，请检查浏览器存储权限。'); }
        return refresh();
    }
    window.TimerThemes = { list: () => catalog.slice(), read, resolve, preview, apply };
    preview(document.documentElement, read());
    window.addEventListener('storage', event => {
        if (event.key === null || event.key === preferenceKey || event.key === 'userTheme') refresh();
    });
    window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
    if (darkScheme.addEventListener) darkScheme.addEventListener('change', refresh);
    else darkScheme.addListener(refresh);
})();
