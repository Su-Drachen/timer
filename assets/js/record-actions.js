/* Record actions use the same entry identities for the list, retries, CSVs and undo. */
function appFor(source) { return source === 'local' ? localApp : gistApp; }
function preferences() { return window.TimerPreferences?.read() || { quickRecord: true, timerEnabled: false, tags: [] }; }
function occurrenceAt(records, index) {
    const item = records[index];
    if (item.id) return undefined;
    return records.slice(0, index).filter(row => JSON.stringify(row) === JSON.stringify(item)).length;
}
function targetIndex(rows, target, occurrence) {
    if (target.id || occurrence === undefined) return RecordEntries.locate(rows, target);
    const matches = rows.map((row, index) => JSON.stringify(row) === JSON.stringify(target) ? index : -1).filter(index => index >= 0);
    if (matches[occurrence] === undefined) throw new Error('原记录已变更，请重新查看');
    return matches[occurrence];
}
const transactionQueue = new Map();
function withRecordLock(key, action) {
    if (navigator.locks?.request) return navigator.locks.request(key, action);
    const previous = transactionQueue.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    transactionQueue.set(key, pending);
    const clear = () => { if (transactionQueue.get(key) === pending) transactionQueue.delete(key); };
    pending.then(clear, clear);
    return pending;
}

async function changeRecords(source, transform, connection = appFor(source).config) {
    const app = appFor(source);
    return withRecordLock('timeRecords:' + (source === 'local' ? source : connection.GIST_ID), async () => {
        if (source === 'gist' && (connection !== app.config || !app.canWrite || app.isLoading)) throw new Error('请先读取当前云端记录');
        let rows;
        if (source === 'local') rows = JSON.parse(localStorage.getItem('timeRecords') || '[]');
        else rows = await app.fetchDirectFromApi(connection);
        if (!Array.isArray(rows)) throw new Error('读取记录失败，请检查数据');
        if (app.config !== connection) throw new Error('云端配置已变化，请重新打开');
        const next = transform(rows);
        let confirmed = next;
        if (next !== rows) {
            if (source === 'local') {
                try { localStorage.setItem('timeRecords', JSON.stringify(next)); }
                catch (_) { throw new Error('浏览器存储空间不可用，请检查隐私设置'); }
            } else confirmed = await app.saveAndVerify(next);
        }
        if (app.config !== connection) throw new Error('云端配置已变化，请重新打开');
        app.records = confirmed;
        app.renderRecords();
        return next !== rows;
    });
}
function canRecord(source) {
    if (source === 'local') return true;
    if (!gistApp.hasConnection()) openGistConfig();
    else if (gistApp.canWrite && !gistApp.isLoading) return true;
    else showToast('请先读取云端记录', 'error');
    return false;
}
function paintReceipt(source) {
    const box = document.getElementById(source + '-receipt');
    const receipt = appFor(source).receipt;
    box.hidden = !receipt;
    if (!receipt) return;
    box.querySelector('p').textContent = receipt.message;
    for (const button of box.querySelectorAll('button')) {
        button.hidden = receipt.retry ? button.dataset.receipt !== 'retry' : button.dataset.receipt === 'retry' || !receipt.record;
        button.disabled = !!receipt.busy;
    }
}
function receiptFor(source, receipt) {
    appFor(source).receipt = receipt;
    paintReceipt(source);
}
async function saveEntry(source, entry, connection = appFor(source).config) {
    const app = appFor(source);
    try {
        await changeRecords(source, rows => RecordEntries.insert(rows, entry), connection);
        receiptFor(source, { record: { ...entry }, connection, message: '已记录 ' + entry.time.slice(-8) });
        return true;
    } catch (error) {
        if (connection === app.config) receiptFor(source, { message: '保存失败 · ' + error.message, retry: () => saveEntry(source, entry, connection) });
        return false;
    }
}
async function undoEntry(source, receipt) {
    const app = appFor(source);
    if (receipt.connection !== app.config || !receipt.record?.id) return;
    try {
        await changeRecords(source, rows => {
            if (!rows.some(row => row.id === receipt.record.id)) return rows;
            const index = RecordEntries.locate(rows, receipt.record);
            return rows.filter((_, i) => i !== index);
        }, receipt.connection);
        receiptFor(source, { message: '已撤销这条记录' });
    } catch (error) {
        if (receipt.connection === app.config) receiptFor(source, { message: '撤销失败 · ' + error.message, retry: () => undoEntry(source, receipt) });
    }
}
async function runButton(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    try { return await action(); }
    catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; }
}
function bindSource(source) {
    const app = appFor(source);
    const nowButton = document.getElementById(source + '-record-btn');
    nowButton.addEventListener('click', () => {
        const entry = RecordEntries.create(new Date());
        if (!canRecord(source)) return;
        if (preferences().quickRecord) runButton(nowButton, () => saveEntry(source, entry));
        else openRecordModal(source, entry);
    });
    document.getElementById(source + '-backfill').addEventListener('click', () => {
        if (canRecord(source) && app.calendar.selected) openRecordModal(source, RecordEntries.create(new Date()), app.calendar.selected);
    });
    document.getElementById(source + '-download-btn').addEventListener('click', () => exportCsv(source));
    document.getElementById(source + '-import-btn').addEventListener('click', () => {
        if (canRecord(source)) document.getElementById('csv-file-input').click();
    });
    document.getElementById(source + '-receipt').addEventListener('click', event => {
        const button = event.target.closest('[data-receipt]');
        const receipt = app.receipt;
        if (!button || !receipt) return;
        runButton(button, async () => {
            if (button.dataset.receipt === 'retry') return receipt.retry();
            if (button.dataset.receipt === 'undo') return undoEntry(source, receipt);
            const index = RecordEntries.locate(app.records, receipt.record);
            openEditModal(source, index);
        });
    });
    const timerButton = document.getElementById(source + '-timer-btn');
    timerButton.addEventListener('click', () => {
        const at = Date.now();
        const expected = timerButton.dataset.timerId || '';
        runButton(timerButton, () => toggleTimer(source, expected, at));
    });
    document.getElementById(source + '-timer-cancel').addEventListener('click', () => {
        const targetId = timerButton.dataset.timerId;
        openConfirmModal(() => withRecordLock(activeTimerKey, () => {
            if (readTimer()?.id !== targetId) return;
            localStorage.removeItem(activeTimerKey);
            refreshTimers();
        }).catch(error => showToast(error.message, 'error')), '清除当前计时，不生成新的记录。', '取消这次计时？');
    });
}
async function submitDraft(event) {
    event.preventDefault();
    const draft = recordDraft;
    if (!draft) return;
    const button = document.getElementById('save-record-btn');
    await runButton(button, async () => {
        const time = draft.day ? document.getElementById('record-date').value + 'T' + document.getElementById('record-clock-input').value : draft.entry.time;
        const date = RecordEntries.parse(time);
        if (!date) throw new Error('请填写有效的日期与时间');
        const entry = { ...draft.entry, time: RecordEntries.format(date), remark: document.getElementById('record-remark').value.trim() };
        if (await saveEntry(draft.version, entry, draft.connection)) {
            if (recordDraft === draft) closeRecordModal();
        } else showToast(appFor(draft.version).receipt?.message || '未能保存，请重试', 'error');
    });
}
async function submitEdit(event) {
    event.preventDefault();
    const source = document.getElementById('edit-version').value;
    const target = editTarget;
    await runButton(document.getElementById('save-edit-btn'), async () => {
        const time = document.getElementById('edit-time').value.trim();
        const remark = document.getElementById('edit-remark').value;
        const end = target.record.endTime ? document.getElementById('edit-end').value.trim() : undefined;
        const updated = RecordEntries.edit(target.record, time, remark, end);
        await changeRecords(source, rows => {
            if (updated.id && rows.some(row => row.id === updated.id && JSON.stringify(row) === JSON.stringify(updated))) return rows;
            const index = targetIndex(rows, target.record, target.occurrence);
            return rows.map((row, i) => i === index ? updated : row);
        }, target.connection);
        const receipt = appFor(source).receipt;
        if (updated.id && receipt?.record?.id === updated.id) receiptFor(source, { ...receipt, record: updated, message: '备注与时间已保存' });
        if (editTarget === target) closeEditModal();
        showToast('记录已更新', 'success');
    });
}
function confirmDeletion(source, index) {
    const app = appFor(source), target = app.records[index], connection = app.config;
    if (!target) return;
    const occurrence = occurrenceAt(app.records, index);
    openConfirmModal(async () => {
        try {
            await changeRecords(source, rows => {
                const position = targetIndex(rows, target, occurrence);
                return rows.filter((_, i) => i !== position);
            }, connection);
            if (target.id && app.receipt?.record?.id === target.id) receiptFor(source, null);
            showToast('记录已删除', 'success');
        } catch (error) { showToast(error.message, 'error'); }
    });
}
async function importCsv(source, content, connection) {
    const records = parseRecordCsv(content);
    let added = 0;
    await changeRecords(source, rows => {
        const next = RecordEntries.merge(rows, records);
        added = next.length - rows.length;
        return next;
    }, connection);
    showToast(added ? '已导入 ' + added + ' 条记录' : '数据已是最新', 'success');
}
function exportCsv(source) {
    const records = appFor(source).records;
    if (!records.length) return showToast('暂无记录可导出', 'error');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([RecordEntries.csv(records)], { type: 'text/csv;charset=utf-8;' }));
    link.download = `时间记录_${source === 'local' ? '本地' : '云端'}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

const activeTimerKey = 'timeRecords.activeTimer.v1';
function readTimer() { return parseStoredJson(activeTimerKey, null); }
function refreshTimers(now = new Date()) {
    const running = readTimer();
    const enabled = preferences().timerEnabled;
    for (const source of ['local', 'gist']) {
        const button = document.getElementById(source + '-timer-btn');
        document.getElementById(source + '-timer-cancel').hidden = !running;
        button.hidden = !enabled && !running;
        button.dataset.timerId = running?.id || '';
        let label = '开始计时';
        if (running) {
            const elapsed = RecordEntries.duration(Math.max(0, Math.floor(((running.end ?? +now) - running.start) / 1000)));
            if (running.source !== source) label = '返回' + (running.source === 'local' ? '本机' : '云端') + '计时 · ' + elapsed;
            else label = (running.end ? '重试保存计时' : '结束计时') + ' · ' + elapsed;
        }
        if (button.textContent !== label) button.textContent = label;
    }
    const nav = document.getElementById('home-show-records');
    if (nav) {
        nav.classList.toggle('has-active-timer', !!running);
        nav.setAttribute('aria-label', running ? '记录，计时进行中' : '记录');
    }
}
async function toggleTimer(source, expected, at) {
    await withRecordLock(activeTimerKey, async () => {
        const current = readTimer();
        if ((current?.id || '') !== expected) return;
        if (current && current.source !== source) {
            document.getElementById('tab-' + current.source).click();
            return;
        }
        const app = appFor(source);
        if (!current) {
            if (!preferences().timerEnabled || !canRecord(source)) return;
            const timer = { id: crypto.randomUUID(), source, start: at, gistId: app.config?.GIST_ID || '' };
            if (!safeSetStorage(localStorage, activeTimerKey, JSON.stringify(timer))) return;
        } else {
            if (!current.end) {
                current.end = Math.max(at, current.start);
                if (!safeSetStorage(localStorage, activeTimerKey, JSON.stringify(current))) return;
            }
            refreshTimers();
            if (current.gistId !== (app.config?.GIST_ID || '')) throw new Error('计时已暂停，请恢复原云端连接后重试，或取消这次计时');
            if (!canRecord(source)) return;
            const entry = RecordEntries.timed(current);
            try {
                await changeRecords(source, rows => RecordEntries.insert(rows, entry), app.config);
                localStorage.removeItem(activeTimerKey);
                receiptFor(source, { record: entry, connection: app.config, message: '计时已保存 · ' + RecordEntries.duration(entry.durationSeconds) });
            } catch (error) { showToast('计时已保留，请重试 · ' + error.message, 'error'); }
        }
        refreshTimers();
    });
}
