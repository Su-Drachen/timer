/* Page 6 regression checks. All remote requests use synthetic fixtures. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { generateKeyPairSync } = require('node:crypto');
const playwrightPath = process.env.PLAYWRIGHT_PATH || 'C:/Users/Longsu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const { chromium } = require(playwrightPath);
const ROOT = path.resolve(__dirname, '..');
const MAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CHILD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = 'cccccccccccccccccccccccccccccccc';
const CONFIG = { GITHUB_USERNAME: 'SyntheticAuthor', GIST_ID: MAIN, COMMENT_GIST_ID: CHILD };
const RECORDS = [{ time: '2026/10/22 08:00:00', remark: '合成记录，仅供本地测试' }, { time: '2026/10/21 08:00:00', remark: '昨日合成记录' }];
const note = (id = 'test-note', text = '合成访客留言', extra = {}) => ({ id: 1001, body: JSON.stringify({ app: 'observer-desk', version: 1, kind: 'note', data: { id, kind: 'note', author: '合成访客', text, createdAt: '2026-10-22T05:00:00.000Z', parentId: null, recordTime: null, ownerId: 'synthetic-visitor', deleted: false, ...extra } }) });
const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = keyPair.publicKey.export({ format: 'jwk' });
const privateKey = keyPair.privateKey.export({ format: 'jwk' });
const authorFile = { app: 'observer-desk-author', version: 1, privateKey };
let browser, server, origin;

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const requests = [], errors = [];
  const fixture = { records: options.records || RECORDS, comments: options.comments || [note()], failure: 0, postFailure: 0 };
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'api.github.com') {
      const item = { method: req.method(), path: url.pathname, search: url.search, body: req.postData(), authorization: req.headers().authorization };
      requests.push(item);
      if (url.pathname === '/gists/' + MAIN || url.pathname === '/gists/' + OTHER) {
        if (fixture.failure) return route.fulfill({ status: fixture.failure, json: { message: 'Synthetic failure' } });
        return route.fulfill({ status: 200, json: { files: { 'records.json': { content: JSON.stringify(fixture.records) } } } });
      }
      if (url.pathname.startsWith('/gists/' + CHILD)) {
        if (item.method === 'POST') {
          if (fixture.postFailure) return route.fulfill({ status: fixture.postFailure, json: { message: 'Synthetic failure' } });
          const native = { id: 10000 + requests.length, body: JSON.parse(item.body).body };
          fixture.comments.push(native);
          return route.fulfill({ status: 201, json: native });
        }
        if (fixture.failure) return route.fulfill({ status: fixture.failure, json: { message: 'Synthetic failure' } });
        return route.fulfill({ status: 200, json: url.pathname.endsWith('/comments') ? fixture.comments : { files: { 'Interaction.json': { content: '[]' } } } });
      }
      return route.fulfill({ status: 404, json: { message: 'Unexpected synthetic endpoint' } });
    }
    return route.fulfill({ status: 200, contentType: req.resourceType() === 'script' ? 'application/javascript' : 'text/css', body: '' });
  });
  const config = options.config === undefined ? CONFIG : options.config;
  await context.addInitScript(({ config, theme, localPat, sessionPat, cache }) => {
    if (sessionStorage.getItem('page6-test.initialized')) return;
    sessionStorage.setItem('page6-test.initialized', 'yes');
    if (config) localStorage.setItem('timeRecorderConfig', JSON.stringify(config));
    if (localPat !== null) localStorage.setItem('timeRecorderPat', localPat);
    if (sessionPat !== null) sessionStorage.setItem('timeRecorderPat', sessionPat);
    if (theme) localStorage.setItem('userTheme', theme);
    for (const [key, value] of Object.entries(cache || {})) localStorage.setItem(key, JSON.stringify(value));
  }, { config, theme: options.theme, localPat: options.localPat === undefined ? (config ? 'synthetic-local-token' : null) : options.localPat, sessionPat: options.sessionPat || null, cache: options.cache });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.clock.install({ time: new Date('2026-10-22T06:00:00Z') });
  await page.goto(origin + '/page6.html', { waitUntil: 'networkidle' });
  const childRequests = () => requests.filter(req => req.path.startsWith('/gists/' + CHILD));
  const mainRequests = () => requests.filter(req => req.path === '/gists/' + MAIN || req.path === '/gists/' + OTHER);
  return { page, context, fixture, requests, errors, childRequests, mainRequests, close: () => context.close() };
}
const tests = [
  ['missing config sends no requests or cache leakage and links to main config', async () => {
    const t = await setup({ config: null, cache: { ['observer-record-times-v1:' + MAIN]: RECORDS, 'observer-record-times-v1': RECORDS } });
    try {
      assert.equal(t.requests.length, 0);
      assert.match(await t.page.locator('#page6ConfigMessage').innerText(), /配置/);
      assert.ok(await t.page.locator('a[href*="pagemain.html"]').count());
      assert.ok(!(await t.page.locator('body').innerText()).includes('昨日合成记录'));
      await t.page.clock.fastForward(120000);
      assert.equal(t.requests.length, 0);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['optional child ID leaves records readable with no feedback request', async () => {
    const t = await setup({ config: { ...CONFIG, COMMENT_GIST_ID: '' } });
    try {
      assert.equal(t.mainRequests().length, 1);
      assert.equal(t.childRequests().length, 0);
      assert.equal((await t.page.locator('#total').innerText()).trim(), '2');
      assert.equal(await t.page.locator('#deskNotesOpen').isDisabled(), true);
      await t.page.locator('#refresh').click();
      await t.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
      assert.equal(t.mainRequests().length, 2);
      assert.equal(t.childRequests().length, 0);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['entry and explicit refresh are the only GET triggers; identity comes from config', async () => {
    const t = await setup();
    try {
      assert.equal(t.mainRequests().length, 1);
      assert.equal(t.childRequests().length, 2);
      assert.equal(await t.page.locator('#deskNickname').inputValue(), 'SyntheticAuthor');
      await t.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await t.page.clock.fastForward(180000);
      assert.equal(t.requests.length, 3, 'time/focus/visibility never poll');
      await t.page.locator('#refresh').click();
      await t.page.waitForFunction(() => !document.querySelector('#refresh').disabled);
      assert.equal(t.mainRequests().length, 2);
      assert.equal(t.childRequests().length, 2);
      await t.page.locator('#deskNotesRefresh').click();
      await t.page.waitForFunction(() => !document.querySelector('#deskNotesRefresh').disabled);
      assert.equal(t.mainRequests().length, 2);
      assert.equal(t.childRequests().length, 4);
      assert.ok(t.requests.every(req => req.method === 'GET'));
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['PAT resolution prefers local, then session, then legacy config without leaking to DOM', async () => {
    for (const item of [
      { localPat: 'synthetic-local-token', sessionPat: 'synthetic-session-token', expected: 'synthetic-local-token' },
      { localPat: null, sessionPat: 'synthetic-session-token', expected: 'synthetic-session-token' },
      { localPat: null, sessionPat: null, expected: 'synthetic-legacy-token' }
    ]) {
      const t = await setup({ ...item, config: { ...CONFIG, GITHUB_PAT: 'synthetic-legacy-token' } });
      try {
        assert.equal(t.requests.length, 3);
        assert.ok(t.requests.every(req => req.authorization?.endsWith(item.expected)));
        assert.ok(!(await t.page.locator('body').innerText()).includes('synthetic-'));
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    }
  }],
  ['record and note payloads cannot execute script or insert style', async () => {
    const xss = '<img src=x onerror="window.page6Xss=true"><style>body{display:none}</style><script>window.page6Xss=true</script>';
    const t = await setup({ records: [{ time: '2026/10/22 08:00:00', remark: xss }, { time: xss, remark: xss }], comments: [note('xss-note', xss, { author: xss, recordTime: xss })] });
    try {
      assert.equal(await t.page.evaluate(() => !!window.page6Xss), false);
      assert.equal(await t.page.locator('body img[src=x], body style').count(), 0);
      assert.equal(await t.page.locator('body').isVisible(), true);
      assert.ok((await t.page.locator('body').innerText()).includes('<img src=x'));
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['signed reply, pin, and delete each write only a child comment and update locally', async () => {
    const t = await setup();
    try {
      await t.page.locator('#deskOwnerImport').setInputFiles({ name: 'synthetic-author.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(authorFile)) });
      await t.page.waitForFunction(() => document.querySelector('#deskOwnerState').textContent.includes('作者钥匙已启用'));
      const before = t.requests.length;
      await t.page.locator('.desk-note-reply').first().click();
      assert.equal(await t.page.locator('#deskNickname').inputValue(), 'SyntheticAuthor');
      assert.equal(await t.page.locator('#deskNickname').getAttribute('readonly'), '');
      await t.page.locator('#deskText').fill('带合成作者签名的回复');
      await t.page.locator('#deskSubmit').click();
      await t.page.waitForFunction(() => document.querySelector('#deskComposer').hidden);
      assert.equal(t.requests.length, before + 1, 'successful write updates local UI without another GET');
      const writes = t.requests.filter(req => req.method !== 'GET');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].method, 'POST');
      assert.equal(writes[0].path, '/gists/' + CHILD + '/comments');
      const payload = JSON.parse(JSON.parse(writes[0].body).body).data;
      assert.equal(payload.author, 'SyntheticAuthor');
      assert.equal(payload.parentId, 'test-note');
      assert.equal(payload.text, '带合成作者签名的回复');
      assert.ok(payload.authorProof.signature);
      assert.equal(await t.page.evaluate(payload => TimerFeedbackCore.createAuth().verify(payload), payload), true);
      await t.page.locator('[data-note-id="test-note"] > .desk-note-actions .desk-note-pin').click();
      await t.page.waitForFunction(() => document.querySelector('[data-note-id="test-note"]').classList.contains('desk-note--pinned'));
      assert.equal(t.requests.length, before + 2);
      const pin = JSON.parse(JSON.parse(t.requests.at(-1).body).body).data;
      assert.equal(pin.kind, 'pin');
      assert.equal(pin.targetId, 'test-note');
      assert.equal(await t.page.evaluate(value => TimerFeedbackCore.createAuth().verify(value), pin), true);
      await t.page.locator('[data-note-id="' + payload.id + '"] .desk-note-delete').click();
      await t.page.locator('#deskDeleteConfirm').click();
      await t.page.waitForFunction(() => document.querySelector('#deskDeleteDialog').hidden);
      assert.equal(await t.page.locator('[data-note-id="' + payload.id + '"]').count(), 0);
      assert.equal(t.requests.length, before + 3);
      const deletion = JSON.parse(JSON.parse(t.requests.at(-1).body).body).data;
      assert.equal(deletion.kind, 'delete');
      assert.deepEqual(deletion.targetIds, [payload.id]);
      assert.equal(await t.page.evaluate(value => TimerFeedbackCore.createAuth().verify(value), deletion), true);
      assert.ok(t.requests.filter(req => req.method !== 'GET').every(req => req.method === 'POST' && req.path === '/gists/' + CHILD + '/comments'));
      assert.equal((await t.page.locator('#total').innerText()).trim(), '2');
      assert.equal(t.mainRequests().length, 1);
      await t.page.reload({ waitUntil: 'networkidle' });
      await t.page.waitForFunction(() => document.querySelector('#deskOwnerState').textContent.includes('作者钥匙已启用'));
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['record cache is scoped to selected main Gist', async () => {
    const t = await setup({ config: { ...CONFIG, COMMENT_GIST_ID: '' } });
    try {
      assert.equal((await t.page.locator('#total').innerText()).trim(), '2');
      const cachedKeys = await t.page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('observer-record-times-v1')));
      assert.deepEqual(cachedKeys, ['observer-record-times-v1:' + MAIN]);
      await t.page.evaluate(config => localStorage.setItem('timeRecorderConfig', JSON.stringify(config)), { ...CONFIG, GIST_ID: OTHER, COMMENT_GIST_ID: '' });
      t.fixture.failure = 503;
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.notEqual((await t.page.locator('#total').innerText()).trim(), '2');
      await t.page.evaluate(() => localStorage.removeItem('timeRecorderConfig'));
      const before = t.requests.length;
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.equal(t.requests.length, before);
      assert.notEqual((await t.page.locator('#total').innerText()).trim(), '2');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['cross-tab config or author-key changes require reopening and block stale writes', async () => {
    for (const storageKey of ['timeRecorderConfig', 'observer-desk-author-key-v1']) {
    const t = await setup();
    try {
      await t.page.locator('#deskNotesOpen').click();
      await t.page.locator('#deskText').fill('配置改变后不应发送');
      const before = t.requests.length;
      await t.page.evaluate(({ storageKey, config }) => {
        const oldValue = localStorage.getItem(storageKey);
        const newValue = JSON.stringify(config);
        localStorage.setItem(storageKey, newValue);
        window.dispatchEvent(new StorageEvent('storage', { key: storageKey, oldValue, newValue, storageArea: localStorage }));
      }, { storageKey, config: storageKey === 'timeRecorderConfig' ? { ...CONFIG, GIST_ID: OTHER } : { app: 'synthetic-changed-author-key' } });
      assert.match(await t.page.locator('#page6ConfigMessage').innerText(), /重新|变化|更改|更新/);
      assert.equal(await t.page.locator('#refresh').isDisabled(), true);
      assert.equal(await t.page.locator('#deskSubmit').isDisabled(), true);
      await t.page.locator('#deskComposerForm').dispatchEvent('submit');
      await t.page.clock.fastForward(120000);
      assert.equal(t.requests.length, before);
      assert.equal(await t.page.locator('#deskSubmit').isDisabled(), true);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
    }
  }],
  ['desktop/mobile views and composer fit viewport', async () => {
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    for (const mobile of [false, true]) {
      const t = await setup({ mobile, theme: mobile ? 'dark' : 'blue', comments: [note('layout-note', '长留言布局检查。'.repeat(60))] });
      try {
        assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await t.page.screenshot({ path: path.join(__dirname, 'artifacts', 'page6-' + (mobile ? 'mobile' : 'desktop') + '.png'), fullPage: true, animations: 'disabled' });
        await t.page.locator('#deskNotesOpen').click();
        assert.equal(await t.page.locator('#deskText').isVisible(), true);
        assert.equal(await t.page.locator('#deskSubmit').isVisible(), true);
        assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await t.page.screenshot({ path: path.join(__dirname, 'artifacts', 'page6-' + (mobile ? 'mobile' : 'desktop') + '-compose.png'), animations: 'disabled' });
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    }
  }]
];

(async () => {
  for (const file of ['assets/js/app-config.js', 'assets/js/page6.js']) new vm.Script(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  console.log('PASS JavaScript syntax');
  const allowed = new Set(['/page6.html', '/assets/js/app-config.js', '/assets/js/feedback-core.js', '/assets/js/page6.js', '/assets/js/notebook-theme.js', '/assets/css/notebook.css', '/assets/css/page6.css']);
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!allowed.has(pathname)) { res.writeHead(404).end(); return; }
    let body = fs.readFileSync(path.join(ROOT, pathname.slice(1)), 'utf8');
    if (pathname === '/assets/js/feedback-core.js') body += '\n(function(){var original=TimerFeedbackCore.createAuth;TimerFeedbackCore.authorPublicKey=' + JSON.stringify(publicKey) + ';TimerFeedbackCore.createAuth=function(key){return original(key||TimerFeedbackCore.authorPublicKey)}})();';
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let failed = 0;
  const selectedTests = process.env.PAGE6_TEST_FILTER ? tests.filter(([name]) => name.includes(process.env.PAGE6_TEST_FILTER)) : tests;
  for (const [name, run] of selectedTests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(selectedTests.length - failed + '/' + selectedTests.length + ' page6 regression groups passed. All remote requests mocked; only synthetic credentials used.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
