/* Mobile home navigation. The desk keeps its own document and scroll position. */
(function () {
    'use strict';
    const feedback = window.TimerFeedback;
    const mobile = window.matchMedia('(max-width: 767px), (pointer: coarse) and (max-width: 960px) and (max-height: 520px)');
    const nav = document.getElementById('mobile-home-nav');
    const recordsButton = document.getElementById('home-show-records');
    const deskButton = document.getElementById('home-show-feedback');
    const view = document.getElementById('home-desk-view');
    const status = document.getElementById('home-desk-status');
    const message = document.getElementById('home-desk-message');
    const retry = document.getElementById('home-desk-retry');
    const badge = document.getElementById('home-unread');
    let page = 'records';
    let recordScroll = 0;
    let frame, desk, modalObserver, laneObserver;

    function showingDesk() { return mobile.matches && page === 'feedback'; }
    function pauseDesk() { if (showingDesk()) feedback.setPageVisible(false); }

    function updatePlayback() {
        const open = showingDesk() && !!desk;
        const modal = open && desk.document.documentElement.classList.contains('app-dialog-open');
        document.body.classList.toggle('home-desk-dialog', !!modal);
        nav.inert = !!modal;
        const lane = desk?.EmbeddedDesk.barrageSlot;
        const bounds = open && lane?.getBoundingClientRect();
        const visible = bounds && bounds.height > 0 && bounds.bottom > 0 && bounds.top < frame.clientHeight;
        feedback.setPageVisible(!mobile.matches || !!(visible && !modal && desk.document.body.dataset.deskView === 'notes'));
    }

    function updateTheme() {
        if (desk) desk.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    }

    function mountPlayer() {
        const adapter = desk?.EmbeddedDesk;
        if (adapter && showingDesk()) feedback.mountDeskBarrage(adapter.barrageSlot, adapter);
    }

    function ready(source) {
        if (frame?.contentWindow !== source || !source.EmbeddedDesk) return;
        modalObserver?.disconnect();
        laneObserver?.disconnect();
        desk = source;
        updateTheme();
        status.hidden = true;
        frame.hidden = false;
        desk.addEventListener('desk:viewwillchange', pauseDesk);
        desk.addEventListener('desk:viewchange', updatePlayback);
        modalObserver = new MutationObserver(updatePlayback);
        modalObserver.observe(desk.document.documentElement, { attributes: true, attributeFilter: ['class'] });
        if (desk.IntersectionObserver) {
            laneObserver = new desk.IntersectionObserver(updatePlayback);
            laneObserver.observe(desk.EmbeddedDesk.barrageSlot);
        }
        mountPlayer();
        updatePlayback();
    }

    function loadDesk() {
        if (frame) return;
        status.hidden = false;
        retry.hidden = true;
        message.textContent = '正在打开观察书桌…';
        frame = document.createElement('iframe');
        frame.id = 'home-desk-frame';
        frame.title = '观察书桌，纸条与日历';
        frame.hidden = true;
        frame.addEventListener('load', () => {
            if (desk) return;
            message.textContent = '书桌暂时无法打开。';
            retry.hidden = false;
        });
        frame.src = 'page6.html';
        view.appendChild(frame);
    }

    function updateLayout() {
        const open = showingDesk();
        feedback.setPageVisible(false);
        if (!mobile.matches) feedback.restoreBarrage();
        nav.hidden = !mobile.matches;
        view.hidden = !open;
        if (mobile.matches) document.body.dataset.homePage = page;
        else delete document.body.dataset.homePage;
        recordsButton.setAttribute('aria-current', open ? 'false' : 'page');
        deskButton.setAttribute('aria-current', open ? 'page' : 'false');
        if (open && desk?.document.body.classList.contains('page6-config-locked')) {
            resetDesk();
            return;
        }
        if (open) { loadDesk(); mountPlayer(); }
        updatePlayback();
    }

    function select(next) {
        if (page === next) return;
        if (page === 'records') recordScroll = window.scrollY;
        page = next;
        updateLayout();
        if (next === 'records') window.scrollTo(0, recordScroll);
    }

    function openConfig() {
        select('records');
        document.getElementById('tab-gist').click();
        document.getElementById('gist-config-open-btn').click();
    }

    function resetDesk() {
        modalObserver?.disconnect();
        laneObserver?.disconnect();
        desk?.removeEventListener('desk:viewwillchange', pauseDesk);
        desk?.removeEventListener('desk:viewchange', updatePlayback);
        feedback.restoreBarrage();
        desk = null;
        frame?.remove();
        frame = null;
        queueMicrotask(updateLayout);
    }

    window.TimerHomeDesk = { ready, openConfig };
    retry.addEventListener('click', resetDesk);
    recordsButton.addEventListener('click', () => select('records'));
    deskButton.addEventListener('click', () => select('feedback'));
    document.querySelectorAll('a[href="page6.html"]').forEach(link => {
        if (view.contains(link)) return;
        link.addEventListener('click', event => {
            if (!mobile.matches || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            select('feedback');
            deskButton.focus({ preventScroll: true });
        });
    });
    mobile.addEventListener('change', updateLayout);
    new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('timer:feedback-summary', event => {
        const { unread } = event.detail;
        deskButton.setAttribute('aria-label', unread ? '弹幕，' + unread + ' 条未读' : '弹幕');
        badge.hidden = !unread;
        badge.textContent = unread > 99 ? '99+' : String(unread);
    });
    window.addEventListener('timer:feedback-config', resetDesk);
    window.addEventListener('timer:feedback-data', () => {
        if (desk) desk.dispatchEvent(new desk.Event('desk:feedchange'));
    });
    window.addEventListener('storage', event => {
        if (event.key === null || event.key === 'timeRecorderConfig' || event.key === 'timeRecorderPat') {
            window.dispatchEvent(new Event('timer:feedback-config'));
        }
    });
    updateLayout();
})();
