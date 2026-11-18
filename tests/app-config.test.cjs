'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/app-config.js'), 'utf8');
function reader(local = {}, session = {}, blocked = false) {
    const area = data => ({
        getItem: key => data[key] ?? null,
        setItem: (key, value) => { data[key] = value; },
        removeItem: key => { delete data[key]; }
    });
    const context = { localStorage: area(local), sessionStorage: area(session) };
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
test('profile updates one service without resetting other services or persisting a session-only token', () => {
    const local = { timeRecorderConfig: JSON.stringify({ GIST_ID: 'abcde', unknownPreference: true }) };
    const session = { timeRecorderPat: 'synthetic-session' };
    const api = reader(local, session);
    api.saveGist({ COMMENT_GIST_ID: 'fedcb' });
    assert.equal(api.read().GIST_ID, 'abcde');
    assert.equal(api.read().GITHUB_PAT, 'synthetic-session');
    assert.equal(api.read().COMMENT_GIST_ID, 'fedcb');
    assert.equal(JSON.parse(local.timeRecorderConfig).unknownPreference, true);
    assert.equal(JSON.parse(local.timeRecorderConfig).GITHUB_PAT, undefined);
    assert.equal(local.timeRecorderPat, undefined);
    api.saveGist({ GITHUB_PAT: 'replacement' });
    assert.equal(local.timeRecorderPat, 'replacement');
    assert.equal(JSON.parse(local.timeRecorderConfig).GITHUB_PAT, 'replacement');
    assert.equal(session.timeRecorderPat, undefined);
});
test('AI configuration uses the existing keys and rolls back a partial write', () => {
    const local = { glm_api_key: 'original' };
    const api = reader(local);
    assert.ok(api.readAi().assistantId);
    Object.defineProperty(local, 'glm_api_secret', { configurable: true, set() { throw Error('quota'); } });
    assert.throws(() => api.saveAi({ apiKey: 'updated', apiSecret: 'synthetic', assistantId: 'assistant' }));
    assert.equal(local.glm_api_key, 'original');
    delete local.glm_api_secret;
    api.saveAi({ apiKey: 'updated', apiSecret: 'synthetic', assistantId: 'assistant' });
    assert.equal(local.glm_api_secret, 'synthetic');
    api.saveAi({});
    assert.equal(api.readAi().apiKey, '');
    assert.equal(local.glm_assistant_id, undefined);
});
test('settings return targets are limited to known tabs and local feature pages', () => {
    const api = reader();
    for (const target of ['friends', '#friends', 'tools', '#records']) assert.equal(api.returnPath(target), '#' + target.replace(/^#/, ''));
    assert.equal(api.returnPath('page5.html'), 'page5.html');
    assert.equal(api.returnPath('page7.html'), 'page7.html');
    assert.equal(api.returnPath('page12.html'), 'page12.html');
    for (const target of ['//other.test', 'https://other.test', '../page5.html', 'javascript:123', 'page5.html?x=1', 'page0.html', 'page01.html', '#personal/ai', null]) assert.equal(api.returnPath(target), '');
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
