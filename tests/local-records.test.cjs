'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function script(name) {
    return fs.readFileSync(path.join(__dirname, '../assets/js', name + '.js'), 'utf8');
}
function setup() {
    const initial = [{ time: '2026/10/21 10:00:00', remark: 'existing record' }];
    const storage = new Map([['timeRecords', JSON.stringify(initial)]]);
    const state = { blocked: false, recordClosed: 0, editClosed: 0, renders: 0, messages: [] };
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, { value: '', disabled: false, querySelector: () => ({}), querySelectorAll: () => [] });
        return elements.get(id);
    }
    const ctx = vm.createContext({
        crypto: require('node:crypto').webcrypto, console, navigator: {},
        window: {}, document: { addEventListener() {}, getElementById: element },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem(key, value) { if (state.blocked) throw new Error('QuotaExceededError'); storage.set(key, value); },
            removeItem: key => storage.delete(key)
        }
    });
    for (const module of ['record-entries', 'records', 'record-actions']) vm.runInContext(script(module), ctx);
    const run = code => vm.runInContext(code, ctx);
    const app = run('localApp'); app.records = initial; app.renderRecords = () => state.renders++;
    ctx.showToast = message => state.messages.push(message);
    ctx.closeRecordModal = () => state.recordClosed++;
    ctx.closeEditModal = () => state.editClosed++;
    ctx.refreshTimers = () => {};
    return { initial, storage, state, app, ctx, run, element, rows: () => JSON.parse(storage.get('timeRecords')) };
}
test('a failed form save keeps the frozen timestamp and draft until the retry succeeds', async () => {
    const f = setup();
    f.state.blocked = true;
    f.run("recordDraft = { version: 'local', entry: {id:'test',time:'2026/10/22 10:00:00',remark:''}, day:'' }");
    f.element('record-remark').value = ' frozen entry ';
    await f.ctx.submitDraft({ preventDefault() {} });
    assert.deepEqual(f.rows(), f.initial);
    assert.equal(f.state.recordClosed, 0);
    assert.equal(f.element('record-remark').value, ' frozen entry ');
    f.state.blocked = false;
    await f.ctx.submitDraft({ preventDefault() {} });
    assert.equal(f.rows()[0].time, '2026/10/22 10:00:00');
    assert.equal(f.rows()[0].remark, 'frozen entry');
    assert.equal(f.state.recordClosed, 1);
});
test('undo identifies only the saved id even when another tab inserted the same timestamp; failed and uncertain writes can retry', async () => {
    const f = setup();
    const saved = { id:'one', time:f.initial[0].time, remark:'' };
    assert.equal(await f.ctx.saveEntry('local', saved), true);
    await f.ctx.saveEntry('local', saved);
    assert.equal(f.rows().length, 2);
    const receipt = f.app.receipt;
    const other = {...saved,id:'two'};
    f.storage.set('timeRecords',JSON.stringify([other,...f.rows()]));
    f.state.blocked = true;
    await f.ctx.undoEntry('local', receipt);
    assert.equal(f.rows().length,3);
    f.state.blocked = false;
    await f.app.receipt.retry();
    assert.deepEqual(f.rows(), [other,...f.initial]);
});
test('undo refuses to delete a changed record or ambiguous duplicated ids', async () => {
    const f = setup();
    const saved = { id:'one', time:f.initial[0].time, remark:'first' };
    await f.ctx.saveEntry('local', saved);
    const receipt = f.app.receipt;
    for (const rows of [[{...saved,remark:'changed'}], [saved,saved]]) {
        f.storage.set('timeRecords',JSON.stringify(rows));
        await f.ctx.undoEntry('local',receipt);
        assert.deepEqual(f.rows(),rows);
        assert.match(f.app.receipt.message,/撤销失败/);
    }
});
test('failed edit uses its original snapshot until a successful retry', async () => {
    const f=setup(); f.state.blocked=true;
    f.run('editTarget = { record: localApp.records[0], occurrence:0 }');
    f.element('edit-version').value='local';
    f.element('edit-time').value='2026/10/22 11:00:00';
    f.element('edit-remark').value='edited';
    await f.ctx.submitEdit({preventDefault(){}});
    assert.deepEqual(f.rows(),f.initial);assert.equal(f.state.editClosed,0);
    f.state.blocked=false;
    await f.ctx.submitEdit({preventDefault(){}});
    assert.equal(f.rows()[0].remark,'edited');assert.equal(f.state.editClosed,1);
});
test('failed CSV import leaves original records intact; old CSVs and explicit timer entries round trip',async()=>{
    const f=setup();
    const old='序号,时间,备注\n1,2026/10/22 12:00:00,"imported, offline"\n';
    f.state.blocked=true;
    await assert.rejects(f.ctx.importCsv('local',old),/存储/);
    assert.deepEqual(f.rows(),f.initial);
    f.state.blocked=false;
    await f.ctx.importCsv('local',old);
    await f.ctx.importCsv('local',old);
    assert.equal(f.rows().length,2);
    const start=+new Date(2026,9,22,23,59);
    const timed=f.ctx.RecordEntries.timed({id:'timer',start,end:start+120000});
    const moved=f.ctx.RecordEntries.edit(timed,'2026/10/21 10:00:00','note');
    assert.equal(moved.endTime,'2026/10/21 10:02:00');
    assert.equal(moved.durationSeconds,120);
    const csv=f.ctx.RecordEntries.csv([moved]);
    await f.ctx.importCsv('local',csv);
    assert.deepEqual(f.rows().at(-1),{...moved});
});
test('timer ending after a failed save retries the original frozen end and persists once',async()=>{
    const f=setup();
    f.ctx.preferences=()=>({quickRecord:true,timerEnabled:true,tags:[]});
    const start=+new Date(2026,9,22,12);
    await f.ctx.toggleTimer('local','',start);
    const timer=JSON.parse(f.storage.get('timeRecords.activeTimer.v1'));
    const set=f.ctx.localStorage.setItem;
    f.ctx.localStorage.setItem=(key,v)=>{if(key==='timeRecords')throw Error('quota');set(key,v);};
    await f.ctx.toggleTimer('local',timer.id,start+5000);
    assert.equal(JSON.parse(f.storage.get('timeRecords.activeTimer.v1')).end,start+5000);
    f.ctx.localStorage.setItem=set;
    f.ctx.preferences=()=>({quickRecord:true,timerEnabled:false,tags:[]});
    await f.ctx.toggleTimer('local',timer.id,start+15000);
    await f.ctx.toggleTimer('local',timer.id,start+19000);
    assert.equal(f.rows()[0].durationSeconds,5);
    assert.equal(f.rows().length,2);
    assert.equal(f.storage.has('timeRecords.activeTimer.v1'),false);
});

test('the calendar keeps every record from the same day and measures elapsed time from the latest past record', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/record-calendar.js'), 'utf8'), context);
    vm.runInContext(script('record-entries'), context);
    const { indexRecords, metrics } = context.RecordCalendar;
    const times = [
        '2026/10/21 09:00:00', '2026-10-21 10:15:00', '2026/10/20 23:00:00',
        '2026/10/31 11:30:00', '旧的无效时间'
    ];
    const index = indexRecords(times.map(time => ({ time })), context.RecordEntries.parse);
    assert.deepEqual(Array.from(index.byDay.get('2026-10-21')), [0, 1]);
    const summary = metrics(index, new Date(2026, 9, 21, 12, 40));
    assert.deepEqual({ ...summary }, { today: 2, week: 3, elapsed: '2 小时' });
    assert.equal(metrics(indexRecords([], context.RecordEntries.parse), new Date()).elapsed, '—');
});

test('ending an unavailable cloud timer freezes its end before reconnection', async () => {
    const f = setup();
    const gist = f.run('gistApp');
    gist.config = { GIST_ID: 'test', GITHUB_PAT: 'fixture' };
    gist.canWrite = false;
    const start = +new Date(2026, 9, 22, 10);
    f.storage.set('timeRecords.activeTimer.v1', JSON.stringify({ id: 'cloud', source: 'gist', gistId: 'test', start }));
    await f.ctx.toggleTimer('gist', 'cloud', start + 12500);
    assert.equal(JSON.parse(f.storage.get('timeRecords.activeTimer.v1')).end, start + 12500);
    gist.canWrite = true;
    gist.fetchDirectFromApi = async () => [];
    gist.saveAndVerify = async rows => rows;
    gist.renderRecords = () => {};
    await f.ctx.toggleTimer('gist', 'cloud', start + 60000);
    assert.equal(gist.records[0].durationSeconds, 12);
    assert.equal(f.storage.has('timeRecords.activeTimer.v1'), false);
});

test('organizing multiple daily entries includes the first one and keeps selections explicit', () => {
    const repair = fs.readFileSync(path.join(__dirname, '../page3.html'), 'utf8');
    const start = repair.indexOf('const dataRepairApp =');
    const end = repair.indexOf("document.addEventListener('DOMContentLoaded'", start);
    assert.ok(start >= 0 && end > start);
    const app = vm.runInNewContext(repair.slice(start, end) + '\ndataRepairApp;');
    app.records = [{ time: '2026/4/3 11:00:00' }, { time: '2026-04-03 19:30:00' }, { time: '2026/04/04 10:00:00' }];
    app.currentFilter = 'multiple_per_day';
    assert.deepEqual(Array.from(app.getFilteredRecords(), item => item.originalIdx), [0, 1]);
    assert.equal(app.selectedIndices.size, 0);
    assert.equal(app.records.length, 3);
});
