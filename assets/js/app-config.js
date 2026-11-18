/* Shared browser configuration. Reading never saves credentials or makes requests. */
(function (root) {
    'use strict';
    const DEFAULT_ASSISTANT='6a8564e18bde79fad1950bf2';
    function stored(area, key) {
        try {
            var storage = root[area];
            return storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
        } catch (_) { return null; }
    }
    function text(value) { return typeof value === 'string' ? value.trim() : ''; }
    function savedConfig() {
        var config;
        try { config = JSON.parse(stored('localStorage', 'timeRecorderConfig') || '{}'); }
        catch (_) { config = {}; }
        return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    }
    function read() {
        var config = savedConfig();
        return {
            GITHUB_USERNAME: text(config.GITHUB_USERNAME),
            GIST_ID: text(config.GIST_ID),
            COMMENT_GIST_ID: text(config.COMMENT_GIST_ID),
            GITHUB_PAT: text(stored('localStorage', 'timeRecorderPat')) ||
                text(stored('sessionStorage', 'timeRecorderPat')) || text(config.GITHUB_PAT)
        };
    }
    // Older feature pages and existing devices use both the separate and embedded PAT.
    // Roll back completed writes if a browser rejects a later write.
    function commit(entries) {
        var done = [];
        try {
            entries.forEach(function (entry) {
                var area = root[entry[0]], key = entry[1], next = entry[2];
                var previous = area.getItem(key);
                if (previous === next) return;
                if (next === null) area.removeItem(key);
                else area.setItem(key, next);
                done.push([area, key, previous]);
            });
        } catch (error) {
            done.reverse().forEach(function (entry) {
                try {
                    if (entry[2] === null) entry[0].removeItem(entry[1]);
                    else entry[0].setItem(entry[1], entry[2]);
                } catch (_) { /* Storage may have become unavailable. */ }
            });
            throw error;
        }
    }
    function saveGist(changes) {
        var config = Object.assign(savedConfig(), changes);
        var entries = [['localStorage', 'timeRecorderConfig', JSON.stringify(config)]];
        if (Object.hasOwn(changes, 'GITHUB_PAT')) {
            entries.push(['localStorage', 'timeRecorderPat', text(changes.GITHUB_PAT) || null]);
            if (stored('sessionStorage', 'timeRecorderPat') !== null) entries.push(['sessionStorage', 'timeRecorderPat', null]);
        }
        commit(entries);
    }
    function readAi() {
        return {
            apiKey: text(stored('localStorage', 'glm_api_key')),
            apiSecret: text(stored('localStorage', 'glm_api_secret')),
            assistantId: text(stored('localStorage', 'glm_assistant_id')) || DEFAULT_ASSISTANT
        };
    }
    function saveAi(config) {
        commit([
            ['localStorage', 'glm_api_key', text(config.apiKey) || null],
            ['localStorage', 'glm_api_secret', text(config.apiSecret) || null],
            ['localStorage', 'glm_assistant_id', text(config.assistantId) || null]
        ]);
    }
    var activeAuthor;
    function author() {
        if (!activeAuthor && root.TimerFeedbackCore) {
            activeAuthor = root.TimerFeedbackCore.createAuth(root.TimerFeedbackCore.authorPublicKey);
        }
        return activeAuthor;
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('storage', function (event) {
        if (event.key !== null && event.key !== 'observer-desk-author-key-v1') return;
        activeAuthor = null;
        root.dispatchEvent(new root.Event('timer:author-change'));
    });
    function returnPath(value) {
        if (typeof value !== 'string') return '';
        if (/^page[1-9]\d*\.html$/.test(value)) return value;
        var tab = value.replace(/^#/, '');
        return ['records', 'friends', 'tools', 'personal'].includes(tab) ? '#' + tab : '';
    }
    var api = {
        read: read,
        saveGist: saveGist, readAi: readAi, saveAi: saveAi, author: author, returnPath: returnPath,
        isGistId: function (value) { return typeof value === 'string' && /^[a-fA-F0-9]{5,64}$/.test(value); }
    };
    root.TimerConfig = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
