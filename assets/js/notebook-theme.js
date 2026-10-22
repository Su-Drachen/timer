/* Restore the existing homepage appearance preference before the page is painted.
 * This file does not change application data, credentials or network behaviour. */
(function () {
    'use strict';
    var theme = 'blue';
    try {
        var saved = localStorage.getItem('userTheme');
        if (['blue', 'white', 'dark'].indexOf(saved) !== -1) theme = saved;
    } catch (_) { /* The default theme also works without browser storage. */ }
    document.documentElement.setAttribute('data-theme', theme);
})();
