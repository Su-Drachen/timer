/* Bridge the isolated friends document and its shared comment player. */
(() => {
    'use strict';
    const feedback = window.TimerFeedback;
    const view = document.getElementById('home-desk-view');
    const nav = document.getElementById('mobile-home-nav');
    const status = document.getElementById('home-desk-status');
    const message = document.getElementById('home-desk-message');
    const retry = document.getElementById('home-desk-retry');
    let visible = false;
    let frame, desk, modalObserver, laneObserver;

    function updatePlayback() {
        const open = visible && !!desk;
        const modal = open && desk.document.documentElement.classList.contains('app-dialog-open');
        document.body.classList.toggle('home-desk-dialog', !!modal);
        nav.inert = !!modal;
        const bounds = open && desk.EmbeddedDesk.barrageSlot?.getBoundingClientRect();
        feedback.setPageVisible(!!(bounds && bounds.height && bounds.bottom > 0 && bounds.top < frame.clientHeight && !modal));
    }

    function updateTheme() {
        if (desk) desk.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    }

    function ready(source) {
        if (source !== frame?.contentWindow || !source.EmbeddedDesk) return;
        desk = source;
        updateTheme();
        status.hidden = true;
        frame.hidden = false;
        modalObserver?.disconnect();
        modalObserver = new MutationObserver(updatePlayback);
        modalObserver.observe(desk.document.documentElement, { attributes: true, attributeFilter: ['class'] });
        const slot = desk.EmbeddedDesk.barrageSlot;
        laneObserver?.disconnect();
        if (slot) {
            feedback.mountDeskBarrage(slot, desk.EmbeddedDesk);
            laneObserver = new IntersectionObserver(updatePlayback);
            laneObserver.observe(slot);
        }
        updatePlayback();
    }

    function loadDesk() {
        if (frame) return;
        status.hidden = false;
        retry.hidden = true;
        message.textContent = '正在打开朋友留言…';
        frame = document.createElement('iframe');
        frame.id = 'home-desk-frame';
        frame.title = '朋友留言';
        frame.hidden = true;
        frame.addEventListener('load', () => {
            if (desk) return;
            message.textContent = '朋友留言暂时无法打开。';
            retry.hidden = false;
        });
        frame.src = 'page6.html?view=friends';
        view.append(frame);
    }

    function setVisible(next) {
        visible = next;
        if (visible) loadDesk();
        updatePlayback();
    }
    function resetDesk() {
        modalObserver?.disconnect();
        laneObserver?.disconnect();
        feedback.restoreBarrage();
        desk = null;
        frame?.remove();
        frame = null;
        setVisible(visible);
    }

    function openConfig(section = 'comments') {
        const target = ['cloud', 'comments', 'author'].includes(section) ? section : 'comments';
        location.hash = 'personal/' + target + '?return=friends';
    }
    window.TimerHomeDesk = { ready, openConfig, setVisible };
    retry.addEventListener('click', resetDesk);
    new MutationObserver(updateTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('timer:feedback-summary', event => {
        const unread = event.detail.unread;
        const button = document.getElementById('home-show-feedback');
        const badge = document.getElementById('home-unread');
        button.setAttribute('aria-label', unread ? '朋友，' + unread + ' 条未读' : '朋友');
        badge.hidden = !unread;
        badge.textContent = unread > 99 ? '99+' : String(unread);
    });
    window.addEventListener('timer:feedback-config', resetDesk);
    window.addEventListener('timer:feedback-data', () => {
        if (desk) desk.dispatchEvent(new desk.Event('desk:feedchange'));
    });
    window.addEventListener('storage', event => {
        if ([null, 'timeRecorderConfig', 'timeRecorderPat'].includes(event.key)) {
            window.dispatchEvent(new Event('timer:feedback-config'));
        }
    });
})();
