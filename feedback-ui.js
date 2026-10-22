/* Homepage feedback. Network reads happen only on initial entry or an explicit refresh. */
(function () {
    'use strict';
    if (window.TimerFeedback) return;
    var ui, state, epoch = 0, modalOpen = false;
    var core = window.TimerFeedbackCore;
    var gestures = { coffee: '☕ 递一杯咖啡', light: '☼ 留一盏灯', sit: '⌑ 在旁边坐坐' };
    var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    function read(key, session) { try { return (session ? sessionStorage : localStorage).getItem(key); } catch (_) { return null; } }
    function save(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Feedback remains usable in memory. */ } }
    function parse(value, fallback) { try { return JSON.parse(value) || fallback; } catch (_) { return fallback; } }
    function node(tag, className, text) {
        var item = document.createElement(tag);
        if (className) item.className = className;
        if (text !== undefined) item.textContent = text;
        return item;
    }
    function button(label, callback, extra) {
        var item = node('button', 'tf-button' + (extra ? ' ' + extra : ''), label);
        item.type = 'button'; item.addEventListener('click', callback); return item;
    }
    function uuid() {
        if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        return 'home-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    function safeError(error) { return error && error.safeMessage === true ? error.message : '留言操作暂未完成，请检查网络后重试。'; }
    function status(text, error) { ui.status.textContent = text; ui.status.classList.toggle('tf-error', !!error); }
    function composeStatus(text, error) { ui.composeStatus.textContent = text; ui.composeStatus.classList.toggle('tf-error', !!error); }
    function owned() { return !!(state.auth && state.auth.isOwner()); }
    function alive(version) { return state && epoch === version; }
    function liveNotes() { return state.notes.filter(function (item) { return !item.deleted; }); }
    function recentMessages() {
        return liveNotes().map(function (item, index) { return { note: item, index: index }; })
            .filter(function (item) { return item.note.ownerId !== state.ownerId && !item.note.verified; })
            .sort(function (a, b) { return (Date.parse(b.note.createdAt) || 0) - (Date.parse(a.note.createdAt) || 0) || b.index - a.index; })
            .slice(0, 5).map(function (item) { return item.note; });
    }
    function setOf(value) { return new Set(Array.isArray(value) ? value.filter(function (id) { return typeof id === 'string'; }) : []); }
    function persist() {
        if (!state.gistId) return;
        save(state.prefix + 'seen', JSON.stringify(Array.from(state.seen).slice(-4000)));
        save(state.prefix + 'played', JSON.stringify(Array.from(state.played).slice(-4000)));
        save(state.prefix + 'read', JSON.stringify(Array.from(state.read).slice(-4000)));
    }
    function updateControls() {
        var unread = liveNotes().filter(function (item) { return !state.read.has(item.id); }).length;
        ui.open.textContent = '留言' + (unread ? ' · ' + unread + ' 未读' : ' · ' + liveNotes().length);
        ui.refresh.disabled = !state.store || state.loading || state.sending;
        ui.refresh.textContent = state.loading ? '读取中…' : '刷新留言';
        ui.toggle.textContent = state.barrage ? '弹幕开启' : '弹幕关闭';
        ui.toggle.setAttribute('aria-pressed', String(state.barrage));
        ui.ownerLabel.textContent = '作者 · ' + (state.username || '我');
        ui.replay.disabled = !state.loaded || state.loading || !state.barrage || !recentMessages().length;
        ui.readAll.disabled = !unread;
        ui.send.disabled = !state.loaded || state.loading || state.sending || !state.target || state.uncertain;
        ui.send.textContent = state.sending ? '发送中…' : '发送回复';
        ui.text.disabled = state.sending || state.uncertain;
        ui.cancel.disabled = state.sending || state.uncertain;
        ui.file.disabled = state.sending || state.loading || state.uncertain || !state.auth || !state.auth.supported();
        ui.forget.disabled = state.sending || state.loading || state.uncertain;
        ui.forget.hidden = !owned();
        ui.identityLabel.textContent = owned() ? '作者签名 · 已启用' : '作者签名 · 未设置';
        ui.identityHint.textContent = owned() ? '已自动使用本机作者钥匙，回复会在 see 显示认证作者标记。' : '主页默认由作者使用，回复名使用配置中的用户名。若要在 see 显示认证作者标记，请首次导入原有作者 JSON 钥匙；同一浏览器、同一站点下会自动记住。';
        ui.sendHint.textContent = (state.username || '我') + ' · 作者' + (owned() ? ' · 签名已启用' : '');
        ui.targetLabel.textContent = state.target ? '回复 ' + state.target.author + '：' + state.target.text.slice(0, 50) : '选择一条留言回复';
        ui.form.hidden = !state.target;
        presentationHint();
    }
    function dateLabel(value) {
        var date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function selectReply(note) {
        if (state.sending || state.uncertain) { composeStatus('请先完成当前回复；发送未确认时需手动刷新留言。', true); return; }
        if (state.target && state.target.id !== note.id) state.pending = null;
        state.target = note; ui.panel.hidden = false; ui.open.setAttribute('aria-expanded', 'true');
        updateControls(); ui.text.focus();
    }
    function markRead(id) { state.read.add(id); persist(); render(); }
    function renderNote(note, child) {
        var card = node('article', 'tf-note' + (child ? ' tf-child' : '') + (!note.deleted && !state.read.has(note.id) ? ' tf-unread' : ''));
        var meta = node('div', 'tf-note-meta');
        meta.appendChild(node('span', 'tf-author', note.deleted ? '已删除的留言' : note.author || '访客'));
        if (note.verified && !note.deleted) meta.appendChild(node('span', 'tf-badge', '作者'));
        if (note.pinned && !note.deleted) meta.appendChild(node('span', 'tf-badge', '置顶'));
        meta.appendChild(node('time', '', dateLabel(note.createdAt)));
        card.appendChild(meta);
        if (!note.deleted) {
            if (child && note.replyToName) card.appendChild(node('div', 'tf-note-context', '回复 ' + note.replyToName));
            card.appendChild(node('p', 'tf-note-text', note.text || ''));
            if (gestures[note.gesture]) card.appendChild(node('p', 'tf-note-context', gestures[note.gesture]));
            if (note.recordTime) card.appendChild(node('p', 'tf-note-context', '关联打卡：' + note.recordTime));
            var actions = node('div', 'tf-note-actions');
            actions.appendChild(button('回复', function () { selectReply(note); }));
            if (!state.read.has(note.id)) actions.appendChild(button('标为已读', function () { markRead(note.id); }));
            card.appendChild(actions);
        }
        return card;
    }
    function render() {
        ui.list.replaceChildren();
        var roots = state.roots.filter(function (item) { return !item.deleted || item.replies.some(function (reply) { return !reply.deleted; }); });
        if (!roots.length) ui.list.appendChild(node('div', 'tf-empty', state.loaded ? '还没有留言。' : '读取后，可在这里查看留言并回复。'));
        roots.slice(0, state.shown).forEach(function (root) {
            var thread = node('div', 'tf-thread'); thread.appendChild(renderNote(root, false));
            root.replies.forEach(function (reply) { if (!reply.deleted) thread.appendChild(renderNote(reply, true)); });
            ui.list.appendChild(thread);
        });
        ui.more.hidden = roots.length <= state.shown;
        updateControls();
    }
    function openPanel() { ui.panel.hidden = !ui.panel.hidden; ui.open.setAttribute('aria-expanded', String(!ui.panel.hidden)); }
    function close() { if (ui) { ui.panel.hidden = true; ui.open.setAttribute('aria-expanded', 'false'); } }
    function inputFocused() {
        var active = document.activeElement;
        return active && (active.matches('input,textarea,select') || active.isContentEditable);
    }
    function paused() { return modalOpen || document.hidden || inputFocused() || !!(document.activeElement && document.activeElement.classList.contains('tf-barrage')); }
    function presentationHint() {
        var text;
        if (!state.barrage) text = '弹幕已关闭，仍可打开留言查看和回复。';
        else if (!state.loaded) text = state.loading ? '正在读取访客留言…' : '读取留言后，最近的访客留言会从这里飘过。';
        else if (!recentMessages().length) text = '暂时没有访客留言，有人留言后可手动刷新查看。';
        else if (paused() && (state.presented || state.queue.length)) text = '弹幕已暂停，移开焦点或关闭弹窗后继续。';
        else if (state.presented || state.queue.length) text = '最近 ' + recentMessages().length + ' 条访客留言 · 点击弹幕查看和回复';
        else text = '本轮播放结束，可以重播或打开留言回复。';
        ui.laneHint.textContent = text;
    }
    function syncPresentation() {
        if (!state) return;
        ui.lane.classList.toggle('tf-paused', paused());
        if (!paused()) showNext();
        presentationHint();
    }
    function clearLane() { state.queue = []; state.presented = null; ui.lane.replaceChildren(); ui.lane.hidden = true; }
    function replay() {
        clearLane();
        if (state.barrage) state.queue = recentMessages();
        syncPresentation();
    }
    function showNext() {
        if (!state.barrage || paused() || state.presented || !state.queue.length) return;
        var note = state.queue.shift(), version = epoch; state.presented = note;
        state.played.add(note.id); persist();
        var item = button(note.author + '：' + (note.text || gestures[note.gesture] || '留下一条消息'), function () {
            ui.panel.hidden = false; ui.open.setAttribute('aria-expanded', 'true'); selectReply(note); finish();
        }, 'tf-barrage');
        item.classList.remove('tf-button'); item.title = '点击查看留言';
        function finish() {
            if (!alive(version) || !state.presented || state.presented.id !== note.id) return;
            state.presented = null; ui.lane.replaceChildren(); ui.lane.hidden = true; showNext(); presentationHint();
        }
        item.addEventListener('animationend', finish, { once: true });
        if (motion && motion.matches) item.title = '点击查看留言并收起提示';
        ui.lane.replaceChildren(item); ui.lane.hidden = false;
    }
    function acceptFeed(feed, playMessages) {
        state.notes = feed.notes; state.roots = feed.roots;
        var byId = new Map(liveNotes().map(function (item) { return [item.id, item]; }));
        state.queue = state.queue.map(function (item) { return byId.get(item.id); }).filter(Boolean);
        if (state.presented) {
            state.presented = byId.get(state.presented.id) || null;
            if (!state.presented) { ui.lane.replaceChildren(); ui.lane.hidden = true; }
            else if (ui.lane.firstElementChild) ui.lane.firstElementChild.textContent = state.presented.author + '：' + (state.presented.text || gestures[state.presented.gesture] || '留下一条消息');
        }
        var incoming = liveNotes().filter(function (item) { return !state.seen.has(item.id); });
        incoming.forEach(function (item) {
            state.seen.add(item.id);
        });
        persist();
        if (state.target) {
            var target = state.notes.find(function (item) { return item.id === state.target.id && !item.deleted; });
            if (target) state.target = target;
            else { state.target = null; composeStatus('原留言已删除或暂不可用，草稿仍保留。', true); }
        }
        render();
        if (playMessages) replay(); else syncPresentation();
    }
    async function refresh() {
        if (!state.store || state.loading || state.sending) return;
        var version = epoch, current = state; current.loading = true; status('正在读取留言…'); updateControls();
        try {
            await current.auth.initialized;
            if (!alive(version)) return;
            var data = await current.store.load();
            var feed = await core.prepareFeed(data, current.auth);
            if (!alive(version)) return;
            current.raw = data; current.loaded = true;
            acceptFeed(feed, true);
            if (current.uncertain) {
                current.uncertain = false;
                var found = current.pending && data.comments.some(function (item) { return item.id === current.pending.id; });
                if (found) { current.read.add(current.pending.id); persist(); current.pending = null; ui.text.value = ''; current.target = null; composeStatus('已确认上一条回复发送成功。'); }
                else composeStatus('刷新未找到上一条回复。可以再次发送，系统会复用同一条回复标识。');
            }
            var warnings = (feed.warnings || []).filter(function (item) { return typeof item === 'string'; });
            status('已读取 ' + liveNotes().length + ' 条留言' + (warnings.length ? '；' + warnings.join(' ') : '。仅进入主页或手动刷新时读取。'), false);
        } catch (error) {
            if (alive(version)) status(safeError(error) + ' 打卡功能不受影响。', true);
        } finally { if (alive(version)) { current.loading = false; render(); } }
    }
    async function send(event) {
        event.preventDefault();
        if (!state.loaded || !state.target || state.loading || state.sending || state.uncertain) return;
        var message = ui.text.value.trim();
        if (!message || message.length > 2000) { composeStatus('请填写 1–2000 字的回复。', true); ui.text.focus(); return; }
        var current = state, version = epoch; current.sending = true; updateControls(); composeStatus('正在发送回复…');
        var confirmed = false;
        try {
            var payload = current.pending;
            if (!payload) {
                payload = { id: uuid(), kind: 'note', parentId: current.target.id, replyToName: current.target.author,
                    author: current.username || '我', text: message, ownerId: current.ownerId, createdAt: new Date().toISOString(),
                    likes: 0, deleted: false, recordTime: current.target.recordTime || null, gesture: null };
                if (owned()) payload = await current.auth.sign(payload);
                if (!alive(version)) return;
                current.pending = payload;
            }
            var result = await current.store.append(payload); confirmed = true;
            if (!alive(version)) return;
            var saved = result && result.id === payload.id ? result : payload;
            current.raw.comments = current.raw.comments.filter(function (item) { return item.id !== saved.id; }).concat([saved]);
            current.read.add(saved.id); current.seen.add(saved.id); current.played.add(saved.id); persist();
            current.pending = null; current.target = null; ui.text.value = '';
            var feed = await core.prepareFeed(current.raw, current.auth);
            if (!alive(version)) return;
            acceptFeed(feed, false); composeStatus('回复已发送；see 手动刷新后即可看到。'); status('回复已发送。其他留言可点击“刷新留言”读取。');
        } catch (error) {
            if (!alive(version)) return;
            current.uncertain = !confirmed && !!(error && (error.uncertain || error.code === 'MANUAL_REFRESH_REQUIRED'));
            composeStatus(confirmed ? '回复已保存，显示暂未更新，请手动刷新留言。' : current.uncertain ? '发送结果未确认，草稿已保留。请先点“刷新留言”核对，再继续发送。' : safeError(error) + ' 草稿已保留。', true);
        } finally { if (alive(version)) { current.sending = false; render(); } }
    }
    async function importAuthor() {
        var file = ui.file.files && ui.file.files[0];
        if (!file || state.sending || state.loading || state.uncertain || !state.auth) return;
        var version = epoch, current = state;
        try {
            if (file.size > 20000) throw new Error('oversize');
            await current.auth.importKey(await file.text());
            if (!alive(version)) return;
            ui.identityStatus.textContent = current.auth.isPersistent() ? '作者钥匙已启用，仅保存在本机浏览器。' : '作者钥匙已启用，本次打开期间有效。';
            current.pending = null; updateControls();
        } catch (_) { if (alive(version)) ui.identityStatus.textContent = '无法导入，请选择此书桌的原始作者 JSON 钥匙文件。'; }
        finally { ui.file.value = ''; }
    }
    function configure() {
        if (!ui) return false;
        ++epoch;
        var config = parse(read('timeRecorderConfig'), {});
        var gistId = typeof config.COMMENT_GIST_ID === 'string' ? config.COMMENT_GIST_ID.trim() : '';
        var token = read('timeRecorderPat') || read('timeRecorderPat', true) || config.GITHUB_PAT || '';
        var prefix = 'timer.feedback.' + gistId + '.';
        var savedSeen = read(prefix + 'seen');
        state = { gistId: gistId, prefix: prefix, username: typeof config.GITHUB_USERNAME === 'string' ? config.GITHUB_USERNAME.trim().slice(0, 39) : '',
            store: null, auth: null, raw: { comments: [], pins: [], deletions: [], warnings: [] }, notes: [], roots: [], loaded: false,
            loading: false, sending: false, uncertain: false, target: null, pending: null, shown: 20, queue: [], presented: null,
            seen: setOf(parse(savedSeen, [])), read: setOf(parse(read(prefix + 'read'), [])),
            played: setOf(parse(read(prefix + 'played'), [])), barrage: read('timer.feedback.barrage') !== 'off', ownerId: '' };
        ui.root.hidden = !gistId; close(); ui.text.value = ''; ui.file.value = ''; ui.identityStatus.textContent = ''; composeStatus(''); clearLane();
        if (!gistId) { render(); return false; }
        if (!core || !/^[a-fA-F0-9]{5,64}$/.test(gistId)) { status('留言 Gist ID 格式无效，请在配置中检查。打卡功能不受影响。', true); render(); return false; }
        if (typeof token !== 'string' || !token.trim()) { status('尚未配置访问令牌，留言暂不可用。打卡功能不受影响。', true); render(); return false; }
        try {
            state.store = core.createStore({ gistId: gistId, token: token }); state.auth = core.createAuth(core.authorPublicKey);
            var ownerKey = 'observer.desk.' + gistId + '.ownerId'; state.ownerId = read(ownerKey) || uuid(); save(ownerKey, state.ownerId);
            var version = epoch;
            Promise.resolve(state.auth.initialized).then(function () { if (alive(version)) updateControls(); }).catch(function () {});
            status('点击“刷新留言”读取。'); render(); return true;
        } catch (_) { state.store = null; status('留言配置暂不可用，请检查配置。打卡功能不受影响。', true); render(); return false; }
    }
    function boot() {
        var root = document.getElementById('timer-feedback-root');
        if (!root) return;
        ui = { root: root };
        var shell = node('section', 'tf-shell'); shell.setAttribute('aria-label', '留言反馈');
        var toolbar = node('div', 'tf-toolbar');
        ui.ownerLabel = node('span', 'tf-owner-label'); toolbar.appendChild(ui.ownerLabel);
        ui.open = button('留言', openPanel, 'tf-inbox'); ui.open.setAttribute('aria-expanded', 'false'); ui.open.setAttribute('aria-controls', 'timer-feedback-panel');
        ui.refresh = button('刷新留言', refresh); ui.toggle = button('弹幕开启', function () {
            state.barrage = !state.barrage; save('timer.feedback.barrage', state.barrage ? 'on' : 'off');
            replay(); updateControls();
        });
        toolbar.append(ui.open, ui.refresh); shell.appendChild(toolbar);
        ui.status = node('div', 'tf-status'); ui.status.setAttribute('role', 'status'); shell.appendChild(ui.status);
        var barrageHost = node('section', 'tf-barrage-host'); barrageHost.setAttribute('aria-label', '访客留言弹幕');
        var barrageHead = node('div', 'tf-barrage-head'); barrageHead.appendChild(node('span', 'tf-barrage-title', '留言弹幕'));
        ui.replay = button('重播弹幕', replay, 'tf-replay'); barrageHead.append(ui.toggle, ui.replay); barrageHost.appendChild(barrageHead);
        ui.lane = node('div', 'tf-lane'); ui.lane.hidden = true; barrageHost.appendChild(ui.lane);
        ui.laneHint = node('p', 'tf-lane-hint'); barrageHost.appendChild(ui.laneHint); shell.appendChild(barrageHost);
        ui.panel = node('section', 'tf-panel'); ui.panel.id = 'timer-feedback-panel'; ui.panel.hidden = true;
        var head = node('div', 'tf-panel-head'); head.appendChild(node('h2', 'tf-title', '留言与回复'));
        ui.readAll = button('全部标为已读', function () { liveNotes().forEach(function (item) { state.read.add(item.id); }); persist(); render(); });
        head.append(ui.readAll, button('收起', close)); ui.panel.appendChild(head);
        ui.list = node('div', 'tf-list'); ui.panel.appendChild(ui.list);
        ui.more = button('查看更多留言', function () { state.shown += 20; render(); }, 'tf-more'); ui.panel.appendChild(ui.more);
        ui.form = node('form', 'tf-reply'); ui.form.hidden = true; ui.form.addEventListener('submit', send);
        var replyHead = node('div', 'tf-reply-heading'); ui.targetLabel = node('label', 'tf-reply-label'); ui.targetLabel.htmlFor = 'timer-feedback-text';
        ui.cancel = button('取消回复', function () { if (state.sending || state.uncertain) return; state.target = null; state.pending = null; composeStatus(''); updateControls(); });
        replyHead.append(ui.targetLabel, ui.cancel); ui.form.appendChild(replyHead);
        ui.text = node('textarea', 'tf-textarea'); ui.text.id = 'timer-feedback-text'; ui.text.maxLength = 2000; ui.text.rows = 3; ui.text.placeholder = '写一句回复…';
        ui.text.addEventListener('input', function () { if (!state.sending && !state.uncertain) state.pending = null; }); ui.form.appendChild(ui.text);
        var row = node('div', 'tf-send-row'); ui.sendHint = node('span', 'tf-hint'); ui.send = node('button', 'tf-button tf-primary', '发送回复'); ui.send.type = 'submit'; row.append(ui.sendHint, ui.send); ui.form.appendChild(row); ui.panel.appendChild(ui.form);
        ui.composeStatus = node('p', 'tf-hint tf-compose-status'); ui.composeStatus.setAttribute('role', 'status'); ui.panel.appendChild(ui.composeStatus);
        var identity = node('details', 'tf-identity'); ui.identityLabel = node('summary'); identity.appendChild(ui.identityLabel);
        ui.identityHint = node('p', 'tf-hint'); identity.appendChild(ui.identityHint);
        ui.file = node('input', 'tf-file'); ui.file.type = 'file'; ui.file.accept = '.json,application/json'; ui.file.setAttribute('aria-label', '导入作者钥匙'); ui.file.addEventListener('change', importAuthor); identity.appendChild(ui.file);
        ui.forget = button('清除本机作者钥匙', function () { if (!state.auth || state.sending || state.loading || state.uncertain) return; state.auth.forget(); state.pending = null; ui.identityStatus.textContent = '已清除本机作者钥匙，主页仍按作者模式使用。'; updateControls(); }); identity.appendChild(ui.forget);
        ui.identityStatus = node('p', 'tf-hint'); ui.identityStatus.setAttribute('role', 'status'); identity.appendChild(ui.identityStatus); ui.panel.appendChild(identity);
        shell.appendChild(ui.panel); root.appendChild(shell);
        modalOpen = ['record-modal-overlay', 'confirm-modal-overlay', 'edit-modal-overlay', 'gist-config-overlay'].some(function (id) {
            var modal = document.getElementById(id); return modal && !modal.classList.contains('hidden') && !modal.hidden;
        });
        window.addEventListener('timer:feedback-config', configure);
        window.addEventListener('timer:feedback-modal', function (event) { modalOpen = !!(event.detail && event.detail.open); syncPresentation(); });
        document.addEventListener('visibilitychange', syncPresentation);
        document.addEventListener('focusin', syncPresentation);
        document.addEventListener('focusout', function () { Promise.resolve().then(syncPresentation); });
        if (configure()) refresh();
    }
    window.TimerFeedback = { configure: configure, close: close };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
