/* Shared browser configuration. Reading never saves credentials or makes requests. */
(function (root) {
    'use strict';
    function stored(area, key) {
        try {
            var storage = root[area];
            return storage && typeof storage.getItem === 'function' ? storage.getItem(key) : null;
        } catch (_) { return null; }
    }
    function text(value) { return typeof value === 'string' ? value.trim() : ''; }
    function read() {
        var config;
        try { config = JSON.parse(stored('localStorage', 'timeRecorderConfig') || '{}'); }
        catch (_) { config = {}; }
        if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
        return {
            GITHUB_USERNAME: text(config.GITHUB_USERNAME),
            GIST_ID: text(config.GIST_ID),
            COMMENT_GIST_ID: text(config.COMMENT_GIST_ID),
            GITHUB_PAT: text(stored('localStorage', 'timeRecorderPat')) ||
                text(stored('sessionStorage', 'timeRecorderPat')) || text(config.GITHUB_PAT)
        };
    }
    var api = {
        read: read,
        isGistId: function (value) { return typeof value === 'string' && /^[a-fA-F0-9]{5,64}$/.test(value); }
    };
    root.TimerConfig = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
