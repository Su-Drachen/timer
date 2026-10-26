/* Shared viewport and dialog behaviour. No storage or network access. */
(function () {
    'use strict';
    const root = document.documentElement;
    const stack = [];
    const inertStates = new Map();
    let bodyState;
    const focusable = 'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

    function viewport() {
        const visual = window.visualViewport;
        // Pinch zoom keeps the normal layout; never force the user's zoom level.
        if (visual && Math.abs(visual.scale - 1) > .05) return;
        root.style.setProperty('--app-viewport-height', (visual ? visual.height : window.innerHeight) + 'px');
        root.style.setProperty('--app-viewport-width', (visual ? visual.width : window.innerWidth) + 'px');
        root.style.setProperty('--app-viewport-top', (visual ? visual.offsetTop : 0) + 'px');
        root.style.setProperty('--app-viewport-left', (visual ? visual.offsetLeft : 0) + 'px');
        root.classList.toggle('app-keyboard-open', !!visual && window.innerHeight - visual.height > 140);
    }

    function visible(element) {
        return element && element.isConnected && element.getClientRects().length > 0 && !element.closest('[hidden],[inert]') && getComputedStyle(element).visibility !== 'hidden';
    }

    function focus(element) {
        if (visible(element) && typeof element.focus === 'function') element.focus({ preventScroll: true });
    }

    function restoreBackground() {
        for (const [element, wasInert] of inertStates) element.inert = wasInert;
        inertStates.clear();
    }

    function isolate(dialog) {
        restoreBackground();
        for (let branch = dialog; branch && branch !== document.body; branch = branch.parentElement) {
            for (const sibling of branch.parentElement.children) {
                if (sibling === branch || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) continue;
                inertStates.set(sibling, sibling.inert);
                sibling.inert = true;
            }
        }
    }

    function lockBody() {
        if (bodyState) return;
        const body = document.body;
        const keys = ['position', 'top', 'left', 'width', 'overflow', 'paddingRight'];
        bodyState = { x: window.scrollX, y: window.scrollY, styles: {} };
        for (const key of keys) bodyState.styles[key] = body.style[key];
        const gutter = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        if (gutter) body.style.paddingRight = (parseFloat(getComputedStyle(body).paddingRight) + gutter) + 'px';
        body.style.position = 'fixed';
        body.style.top = -bodyState.y + 'px';
        body.style.left = -bodyState.x + 'px';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        root.classList.add('app-dialog-open');
    }

    function unlockBody() {
        if (!bodyState) return;
        const saved = bodyState;
        bodyState = null;
        for (const [key, value] of Object.entries(saved.styles)) document.body.style[key] = value;
        root.classList.remove('app-dialog-open');
        const scrollBehaviour = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(saved.x, saved.y);
        root.style.scrollBehavior = scrollBehaviour;
    }

    function openDialog(dialog, options = {}) {
        if (typeof dialog === 'string') dialog = document.querySelector(dialog);
        if (!dialog || stack.some(entry => entry.dialog === dialog)) return;
        stack.push({ dialog, options, previous: document.activeElement });
        dialog.setAttribute('aria-hidden', 'false');
        dialog.setAttribute('tabindex', '-1');
        lockBody();
        isolate(dialog);
        viewport();
        let target = typeof options.initialFocus === 'string' ? dialog.querySelector(options.initialFocus) : options.initialFocus;
        // Open on the dialog first on phones, so the keyboard doesn't obscure its context.
        if (!options.focusInputOnMobile && matchMedia('(max-width: 767px)').matches && target?.matches('input,textarea,select')) target = null;
        focus(target || dialog);
    }

    function closeDialog(dialog) {
        if (typeof dialog === 'string') dialog = document.querySelector(dialog);
        if (!dialog) return;
        const index = stack.findIndex(entry => entry.dialog === dialog);
        if (index < 0) { dialog.setAttribute('aria-hidden', 'true'); return; }
        const wasTop = index === stack.length - 1;
        const [entry] = stack.splice(index, 1);
        restoreBackground();
        if (stack.length) isolate(stack[stack.length - 1].dialog);
        else unlockBody();
        if (wasTop) {
            const fallback = stack.length ? stack[stack.length - 1].dialog : document.querySelector('[data-mobile-focus-fallback]');
            focus(visible(entry.previous) ? entry.previous : fallback);
        }
        dialog.setAttribute('aria-hidden', 'true');
        viewport();
    }

    document.addEventListener('keydown', event => {
        const current = stack[stack.length - 1];
        if (!current) return;
        if (event.key === 'Escape' && !event.isComposing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (current.options.onClose) current.options.onClose();
        } else if (event.key === 'Tab') {
            const items = Array.from(current.dialog.querySelectorAll(focusable)).filter(visible);
            const first = items[0], last = items[items.length - 1];
            if (!first) { event.preventDefault(); focus(current.dialog); }
            else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) {
                event.preventDefault(); focus(last);
            } else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement))) {
                event.preventDefault(); focus(first);
            }
        }
    }, true);

    document.addEventListener('focusin', event => {
        const current = stack[stack.length - 1];
        if (current && !current.dialog.contains(event.target)) focus(current.dialog);
    });
    window.addEventListener('resize', viewport, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', viewport, { passive: true });
        window.visualViewport.addEventListener('scroll', viewport, { passive: true });
    }
    viewport();
    window.TimerMobile = { openDialog, closeDialog, updateViewport: viewport };
})();
