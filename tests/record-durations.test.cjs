'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../assets/js/record-entries.js');
const durations = require('../assets/js/record-durations.js');

const measured = {
    id: 'test-session', time: '2026/12/31 23:59:52', startTime: '2026/12/31 23:59:52',
    endTime: '2027/01/01 00:00:13', durationSeconds: 21, remark: '测试'
};
test('a local timer needs no second source, keeps seconds and crosses a year boundary', () => {
    const [row] = durations.collect([measured], []);
    assert.equal(row.durationSeconds, 21);
    assert.equal(row.isCrossDay, true);
    assert.equal(durations.label(row), '本机计时');
    assert.equal(durations.formatSeconds(row.durationSeconds), '21 秒');
});
test('imported copies of the same session count once and its endpoints cannot match a legacy point', () => {
    const [row, ...extra] = durations.collect([measured], [{ ...measured }, { time: '2027/01/01 00:03:00' }]);
    assert.equal(row.measured, true);
    assert.equal(extra.length, 0);
});
test('old pairs keep chronological matching, source labels, interval limits, and order', () => {
    const rows = durations.collect([
        { time: '2026/12/31 08:00:00' }, measured, { time: '2026/12/31 23:54:00' }
    ], [
        { time: '2026/12/31 08:00:59' }, { time: '2026/12/31 08:02:00' }, { time: '2026/12/31 23:52:30' }
    ]);
    assert.deepEqual(rows.map(row => row.durationSeconds), [21, 90, 120]);
    assert.deepEqual(rows.map(durations.label), ['本机计时', '配对估算 · 云端 → 本机', '配对估算 · 本机 → 云端']);
});
