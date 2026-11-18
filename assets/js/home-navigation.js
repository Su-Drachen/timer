/* Top-level navigation owns the URL and scroll positions. Each page owns its content. */
(() => {
    'use strict';
    const nav = document.getElementById('mobile-home-nav');
    const buttons = Array.from(nav.querySelectorAll('[data-page]'));
    const panels = new Map(buttons.map(button => [
        button.dataset.page, document.getElementById(button.getAttribute('aria-controls'))
    ]));
    const positions = new Map();
    let current;
    let currentRoute;

    function navigate() {
        const route = location.hash.slice(1) || 'records';
        const name = route.split(/[/?]/)[0];
        const next = panels.has(name) ? name : 'records';
        if (currentRoute === route) return;
        if (current) positions.set(currentRoute, window.scrollY);
        // Pause in the visible frame while its animation still has a currentTime.
        if (next !== 'friends') window.TimerHomeDesk.setVisible(false);
        document.body.dataset.homePage = next;
        document.getElementById('home-records-header').hidden = next !== 'records';
        panels.forEach((panel, id) => { panel.hidden = id !== next; });
        buttons.forEach(button => {
            if (button.dataset.page === next) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        if (next === 'friends') window.TimerHomeDesk.setVisible(true);
        window.scrollTo({ top: positions.get(route) || 0, behavior: 'instant' });
        current = next;
        currentRoute = route;
    }
    nav.addEventListener('click', event => {
        const button = event.target.closest('[data-page]');
        if (button) location.hash = button.dataset.page;
    });
    window.addEventListener('hashchange', navigate);
    window.addEventListener('pageshow', navigate);
    navigate();
})();
