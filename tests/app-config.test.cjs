'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/app-config.js'), 'utf8');
function reader(local = {}, session = {}, blocked = false) {
    const context = { localStorage: { getItem: key => local[key] ?? null }, sessionStorage: { getItem: key => session[key] ?? null } };
    if (blocked) Object.defineProperty(context, 'localStorage', { get() { throw new Error('storage blocked'); } });
    vm.runInNewContext(source, context);
    return context.TimerConfig;
}
test('shared configuration is optional and malformed storage never breaks entry', () => {
    for (const value of [undefined, '{broken', 'null', '[]', '7']) {
        const config = reader({ timeRecorderConfig: value }).read();
        assert.deepEqual(Object.values(config), ['', '', '', '']);
    }
    assert.equal(reader({}, {}, true).read().GIST_ID, '');
});
test('current local token wins, then tab session, then legacy embedded configuration', () => {
    const local = { timeRecorderConfig: JSON.stringify({ GITHUB_USERNAME: ' TestAuthor ', GIST_ID: ' aaaaa ', COMMENT_GIST_ID: ' bbbbb ', GITHUB_PAT: 'synthetic-legacy' }), timeRecorderPat: ' synthetic-local ' };
    const session = { timeRecorderPat: 'synthetic-session' };
    const api = reader(local, session);
    assert.equal(api.read().GITHUB_PAT, 'synthetic-local');
    delete local.timeRecorderPat;
    assert.equal(api.read().GITHUB_PAT, 'synthetic-session');
    delete session.timeRecorderPat;
    assert.equal(api.read().GITHUB_PAT, 'synthetic-legacy');
    assert.equal(api.read().GITHUB_USERNAME, 'TestAuthor');
    assert.equal(api.read().COMMENT_GIST_ID, 'bbbbb');
    assert.equal(api.read().GIST_ID, 'aaaaa');
});
test('read reflects saved changes without copying unknown fields or persisting secrets', () => {
    const local = { timeRecorderConfig: JSON.stringify({ GIST_ID: 'aaaaa', unexpected: 'not exported', GITHUB_PAT: {} }) };
    const api = reader(local);
    assert.equal(api.read().GITHUB_PAT, '');
    assert.equal(api.read().unexpected, undefined);
    local.timeRecorderConfig = JSON.stringify({ GIST_ID: 'bbbbb' });
    assert.equal(api.read().GIST_ID, 'bbbbb');
    assert.equal(local.timeRecorderPat, undefined);
    assert.equal(api.isGistId('bbbbb'), true);
    assert.equal(api.isGistId('https://example.test/gist'), false);
    assert.equal(api.isGistId('../secret'), false);
});
