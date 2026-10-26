'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../pagemain.html'), 'utf8');
function section(start, end) {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `source section exists: ${start}`);
    return html.slice(from, to);
}

function setup() {
    const initial = [{ time: '2026/10/21 10:00:00', remark: 'existing record' }];
    const state = { blocked: false, saved: JSON.stringify(initial), renders: 0, recordClosed: 0, editClosed: 0, toasts: [] };
    const elements = {
        'record-version': { value: 'local' },
        'record-remark': { value: ' keep this draft ' },
        'record-form': { addEventListener(event, handler) { state.submit = handler; } }
    };
    const context = {
        console: { warn() {} },
        document: { getElementById: id => elements[id] },
        localStorage: {
            setItem(key, value) {
                assert.equal(key, 'timeRecords');
                if (state.blocked) throw new Error('QuotaExceededError');
                state.saved = value;
            }
        },
        formatRecordTime: () => '2026/10/22 10:00:00',
        showToast: (message, kind) => state.toasts.push({ message, kind }),
        openConfirmModal: action => { state.confirm = action; },
        closeRecordModal: () => { state.recordClosed++; },
        closeEditModal: () => { state.editClosed++; },
        renderSharedRecords: () => { state.renders++; }
    };
    vm.createContext(context);
    vm.runInContext(
        section('function safeSetStorage(', 'function updateRecordMetrics(') +
        section('const localApp = {', '// --- 云端版 (Gist) 核心逻辑 ---') +
        '\nglobalThis.localApp = localApp;\n' +
        section("document.getElementById('record-form').addEventListener", "['cancel-record-btn', 'cancel-record-btn-secondary']"),
        context
    );
    context.localApp.records = initial;
    return { app: context.localApp, state, elements, initial };
}

function assertUnchanged(fixture) {
    const { app, state, initial } = fixture;
    assert.equal(app.records, initial);
    assert.equal(state.saved, JSON.stringify(initial));
    assert.equal(state.renders, 0);
    assert.equal(state.toasts.filter(toast => toast.kind === 'success').length, 0);
    assert.equal(state.toasts.at(-1).kind, 'error');
}

test('local form keeps its draft and modal when storage fails, and retries once storage recovers', () => {
    const fixture = setup();
    const { app, state, elements } = fixture;
    state.blocked = true;
    state.submit({ preventDefault() {} });
    assertUnchanged(fixture);
    assert.equal(state.recordClosed, 0);
    assert.equal(elements['record-remark'].value, ' keep this draft ');

    state.blocked = false;
    state.submit({ preventDefault() {} });
    assert.equal(app.records.length, 2);
    assert.equal(app.records[0].remark, 'keep this draft');
    assert.equal(state.saved, JSON.stringify(app.records));
    assert.equal(state.recordClosed, 1);
    assert.equal(state.renders, 1);
    assert.equal(state.toasts.at(-1).kind, 'success');
});

test('failed edit preserves the old record and edit dialog until retry succeeds', () => {
    const fixture = setup();
    const { app, state, initial } = fixture;
    state.blocked = true;
    assert.equal(app.handleEditSave(0, '2026/10/22 11:00:00', 'edited'), false);
    assertUnchanged(fixture);
    assert.equal(initial[0].remark, 'existing record');
    assert.equal(state.editClosed, 0);

    state.blocked = false;
    assert.equal(app.handleEditSave(0, '2026/10/22 11:00:00', 'edited'), true);
    assert.equal(app.records[0].remark, 'edited');
    assert.equal(state.saved, JSON.stringify(app.records));
    assert.equal(state.editClosed, 1);
});

test('failed deletion leaves the visible and persisted record available for retry', () => {
    const fixture = setup();
    const { app, state } = fixture;
    state.blocked = true;
    app.handleDeleteRecord(0);
    assert.equal(state.confirm(), false);
    assertUnchanged(fixture);

    state.blocked = false;
    app.handleDeleteRecord(0);
    assert.equal(state.confirm(), true);
    assert.equal(app.records.length, 0);
    assert.equal(state.saved, '[]');
    assert.equal(state.renders, 1);
});

test('failed CSV import does not alter records or report success, and can be retried', () => {
    const fixture = setup();
    const { app, state } = fixture;
    const csv = '序号,时间,备注\n1,2026/10/22 12:00:00,"imported, offline"\n';
    state.blocked = true;
    assert.equal(app.importFromCsv(csv), false);
    assertUnchanged(fixture);

    state.blocked = false;
    assert.equal(app.importFromCsv(csv), true);
    assert.equal(app.records.length, 2);
    assert.equal(app.records[1].remark, 'imported, offline');
    assert.equal(state.saved, JSON.stringify(app.records));
    assert.equal(state.renders, 1);
});
