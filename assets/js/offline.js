/* Static app preparation only: no Gist reads, writes, polling or credential access. */
(function () {
    'use strict';
    const scriptUrl = document.currentScript.src;
    const workerUrl = new URL('../../sw.js', scriptUrl);
    const scopeUrl = new URL('./', workerUrl);
    const box = document.getElementById('offline-status');
    const message = document.getElementById('offline-message');
    const retry = document.getElementById('offline-retry');
    let registration;
    let ready = false;
    let failed = false;
    let pendingUpdate = false;
    let supported = true;

    function render() {
        retry.hidden = !failed || !navigator.onLine || !supported || pendingUpdate;
        if (!supported) {
            box.dataset.state = 'error';
            message.textContent = '此打开方式不支持离线启动，请联网通过 HTTPS 网站打开主页。';
        } else if (pendingUpdate && !ready) {
            box.dataset.state = 'update';
            message.textContent = '新版本已准备好 · 请先保存当前内容，关闭本应用所有页面后重新打开，即可恢复离线使用。';
        } else if (!navigator.onLine) {
            box.dataset.state = 'offline';
            message.textContent = ready
                ? '当前离线 · 本地记录可查看、新增、编辑和导出；云端功能需联网。'
                : '当前离线 · 可操作已打开的本地记录；重新打开前需联网完成离线准备。';
        } else if (ready) {
            box.dataset.state = 'ready';
            message.textContent = pendingUpdate
                ? '离线已就绪 · 新版本将在关闭本应用所有页面后，下次打开时启用。'
                : '离线已就绪 · 断网后仍可打开主页，使用本地记录。';
        } else if (failed) {
            box.dataset.state = 'error';
            message.textContent = '离线准备未完成，当前页面仍可使用；请联网后重试。';
        } else {
            box.dataset.state = 'preparing';
            message.textContent = '正在准备离线使用…';
        }
    }

    function checkReady(worker, repair = false) {
        if (!worker) return;
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            channel.port1.close();
            if (!ready) { failed = true; render(); }
        }, repair ? 40000 : 10000);
        channel.port1.onmessage = function (event) {
            if (event.data?.type !== 'TIMER_OFFLINE_STATUS') return;
            clearTimeout(timeout);
            channel.port1.close();
            ready = event.data.ready === true;
            failed = !ready;
            render();
        };
        worker.postMessage({ type: repair ? 'TIMER_OFFLINE_REPAIR' : 'TIMER_OFFLINE_STATUS' }, [channel.port2]);
    }

    function watch(worker) {
        if (!worker) return;
        function changed() {
            if (worker.state === 'activated') checkReady(worker);
            if (worker.state === 'installed' && registration.active) {
                pendingUpdate = true;
                render();
            }
            if (worker.state === 'redundant' && !ready) { failed = true; render(); }
        }
        worker.addEventListener('statechange', changed);
        changed();
    }

    async function prepare() {
        if (!('serviceWorker' in navigator) || !window.isSecureContext || !/^https?:$/.test(location.protocol)) {
            supported = false;
            render();
            return;
        }
        failed = false;
        render();
        try {
            // A working controller remains usable even if an offline update check fails.
            if (navigator.serviceWorker.controller?.scriptURL === workerUrl.href) {
                checkReady(navigator.serviceWorker.controller);
            }
            const existing = await navigator.serviceWorker.getRegistration(scopeUrl.href);
            if (existing?.scope === scopeUrl.href && existing.active) {
                registration = existing;
                checkReady(existing.active);
            }
            registration = await navigator.serviceWorker.register(workerUrl.href, {
                scope: scopeUrl.href, updateViaCache: 'none'
            });
            if (registration.active) checkReady(registration.active);
            pendingUpdate = !!registration.waiting;
            registration.addEventListener('updatefound', () => watch(registration.installing));
            watch(registration.installing);
            render();
        } catch (_) {
            failed = !ready;
            render();
        }
    }

    retry.addEventListener('click', function () {
        if (registration?.active) {
            failed = false;
            render();
            checkReady(registration.active, true);
        } else prepare();
    });
    // Returning online only changes this label. Cloud reads remain user-initiated.
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => checkReady(navigator.serviceWorker.controller));
    }
    prepare();
})();
