/* Record preferences shared by the home form and personal settings. */
(function (root) {
    'use strict';
    const storageKey = 'timer.recordPreferences';
    function normalize(value) {
        const options = value && typeof value === 'object' ? value : {};
        const tags = [];
        if (Array.isArray(options.tags)) {
            for (const tag of options.tags) {
                const word = typeof tag === 'string' ? tag.trim() : '';
                if (word && !tags.includes(word)) tags.push(word);
                if (tags.length === 3) break;
            }
        }
        return {
            quickRecord: typeof options.quickRecord === 'boolean' ? options.quickRecord : true,
            timerEnabled: options.timerEnabled === true,
            tags
        };
    }
    function read() {
        try { return normalize(JSON.parse(root.localStorage.getItem(storageKey))); }
        catch (_) { return normalize(); }
    }
    function notify(detail) {
        root.dispatchEvent(new root.CustomEvent('timer:preferences-changed', { detail }));
    }
    function save(changes) {
        const next = normalize({ ...read(), ...changes });
        root.localStorage.setItem(storageKey, JSON.stringify(next));
        notify(next);
        return next;
    }
    root.addEventListener('storage', event => {
        if (event.key === storageKey || event.key === null) notify(read());
    });
    root.TimerPreferences = { read, save };
})(window);
