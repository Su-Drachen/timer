/* Browser regression checks. GitHub requests use synthetic fixtures and all other
 * external requests are blocked; no real credentials or author key are used.
 * Project scripts, styles, Chart and icon font are served from an explicit allowlist.
 * Service Workers are blocked here; tests/offline.test.cjs covers the real worker. */
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
const CONFIG = { GITHUB_USERNAME: 'TestAuthor', GIST_ID: MAIN, COMMENT_GIST_ID: CHILD };
const nativeNote = (id, text = '这是一条访客留言', extra = {}) => ({ id: id.length * 100, body: JSON.stringify({ app: 'observer-desk', version: 1, kind: 'note', data: { id, kind: 'note', author: '测试访客', text, createdAt: '2026-10-22T05:00:00.000Z', parentId: null, recordTime: null, ownerId: 'test-visitor', deleted: false, ...extra } }) });
const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = keyPair.publicKey.export({ format: 'jwk' });
const privateKey = keyPair.privateKey.export({ format: 'jwk' });
const authorFile = { app: 'observer-desk-author', version: 1, privateKey };
let browser, server, origin;

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: options.reducedMotion || 'no-preference', serviceWorkers: 'block' });
  const requests = [], errors = [];
  const fixture = { comments: options.comments || [nativeNote('note-1')], records: [], failure: 0, postFailure: 0, deferred: null };
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'api.github.com') {
      const item = { method: req.method(), path: url.pathname, search: url.search, body: req.postData() };
      requests.push(item);
      if (url.pathname === '/gists/' + MAIN) {
        if (item.method === 'PATCH') fixture.records = JSON.parse(JSON.parse(item.body).files['records.json'].content);
        return route.fulfill({ status: 200, json: { files: { 'records.json': { content: JSON.stringify(fixture.records) } } } });
      }
      if (url.pathname.startsWith('/gists/' + CHILD) || url.pathname.startsWith('/gists/' + OTHER)) {
        if (item.method === 'POST') {
          if (fixture.postFailure) return route.fulfill({ status: fixture.postFailure, json: { message: 'Synthetic failure' } });
          const native = { id: 10000 + requests.length, body: JSON.parse(item.body).body };
          fixture.comments.push(native);
          return route.fulfill({ status: 201, json: native });
        }
        if (fixture.failure) return route.fulfill({ status: fixture.failure, json: { message: 'Synthetic failure' } });
        if (fixture.deferred) await fixture.deferred;
        return route.fulfill({ status: 200, json: url.pathname.endsWith('/comments') ? fixture.comments : { files: { 'Interaction.json': { content: '[]' } } } });
      }
      return route.fulfill({ status: 404, json: { message: 'Unexpected test endpoint' } });
    }
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(({ config, theme, ownerId }) => {
    if (!sessionStorage.getItem('test.initialized')) {
      sessionStorage.setItem('test.initialized', 'yes');
      if (config) { localStorage.setItem('timeRecorderConfig', JSON.stringify(config)); localStorage.setItem('timeRecorderPat', 'synthetic-test-token'); }
      if (theme) localStorage.setItem('userTheme', theme);
      if (ownerId) localStorage.setItem('observer.desk.' + config.COMMENT_GIST_ID + '.ownerId', ownerId);
    }
  }, { config: options.config === undefined ? CONFIG : options.config, theme: options.theme, ownerId: options.ownerId });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.clock.install({ time: new Date('2026-10-22T06:00:00Z') });
  await page.goto(origin + '/pagemain.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.TimerFeedback);
  const childRequests = () => requests.filter(req => req.path.startsWith('/gists/' + CHILD) || req.path.startsWith('/gists/' + OTHER));
  return { page, context, fixture, requests, errors, childRequests, close: () => context.close() };
}
async function ready(t, count = 1) {
  await t.page.waitForFunction(n => document.querySelector('.tf-status')?.textContent.includes('已读取 ' + n + ' 条留言'), count);
}
async function openPanel(t) {
  if (!(await t.page.locator('#timer-feedback-panel').isVisible())) await t.page.locator('.tf-inbox').click();
}
async function refresh(t, count) {
  const before = t.childRequests().length;
  await t.page.getByRole('button', { name: '刷新留言', exact: true }).click();
  await ready(t, count);
  assert.equal(t.childRequests().length, before + 2, 'one manual refresh performs one two-request read sequence');
}
async function finishBarrage(t) {
  // CSS animations run on the compositor, independently of Playwright's clock.
  await t.page.locator('.tf-barrage').dispatchEvent('animationend');
}
async function playbackStorage(t) {
  return t.page.evaluate(id => ({
    played: JSON.parse(localStorage.getItem('timer.feedback.' + id + '.played') || '[]'),
    read: JSON.parse(localStorage.getItem('timer.feedback.' + id + '.read') || '[]')
  }), CHILD);
}
async function recordCycle(t, mode) {
  const page = t.page;
  if (mode === 'gist') {
    await page.locator('#tab-gist').click();
    await page.waitForFunction(() => !gistApp.isLoading && gistApp.isInitialized);
  } else await page.locator('#tab-local').click();
  await page.locator('#' + mode + '-record-btn').click();
  await page.locator('#record-remark').fill('记录功能回归测试');
  await page.locator('#save-record-btn').click();
  await page.waitForFunction(id => document.getElementById(id).textContent === '1', mode + '-record-count-badge');
  await page.locator('#' + mode + '-records-container').getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.locator('#edit-remark').fill('编辑后仍可保存');
  await page.locator('#save-edit-btn').click();
  await page.waitForFunction(id => document.getElementById(id).textContent.includes('编辑后仍可保存'), mode + '-records-container');
  await page.locator('#' + mode + '-records-container').getByRole('button', { name: '删除记录', exact: true }).click();
  await page.locator('#confirm-action-btn').click();
  await page.waitForFunction(id => document.getElementById(id).textContent === '0', mode + '-record-count-badge');
  if (mode === 'local') assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('timeRecords'))), []);
  else assert.deepEqual(t.fixture.records, []);
}
async function saveConfig(t, childId) {
  await t.page.locator('#tab-gist').click();
  await t.page.waitForFunction(() => gistApp.isInitialized && !gistApp.isLoading);
  await t.page.locator('#gist-config-open-btn').click();
  await t.page.locator('#gist-commentId').fill(childId);
  await t.page.locator('#gist-config-form button[type=submit]').click();
  await t.page.waitForFunction(() => !gistApp.isLoading);
}
const tests = [
  ['unconfigured entry stays silent; local add/edit/delete work', async () => {
    const t = await setup({ config: null });
    try {
      assert.equal(await t.page.locator('#timer-feedback-root').isVisible(), false);
      assert.equal(await t.page.locator('#gist-config-overlay').isVisible(), false);
      assert.equal(t.childRequests().length, 0);
      await recordCycle(t, 'local');
      assert.equal(t.requests.length, 0);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['optional blank child ID preserves local and cloud records; save does not read feedback', async () => {
    const t = await setup({ config: { ...CONFIG, COMMENT_GIST_ID: '' } });
    try {
      assert.equal(await t.page.locator('#gist-commentId').getAttribute('required'), null);
      assert.equal(await t.page.locator('#timer-feedback-root').isVisible(), false);
      await recordCycle(t, 'local');
      await recordCycle(t, 'gist');
      assert.equal(t.childRequests().length, 0);
      await saveConfig(t, CHILD);
      assert.equal(t.childRequests().length, 0);
      assert.equal(await t.page.locator('#timer-feedback-root').isVisible(), true);
      assert.equal(await t.page.locator('.tf-barrage-host').isVisible(), true);
      assert.match(await t.page.locator('.tf-lane-hint').innerText(), /读取|刷新/);
      assert.match(await t.page.locator('.tf-status').innerText(), /刷新留言/);
      assert.equal(await t.page.evaluate(() => JSON.parse(localStorage.getItem('timeRecorderConfig')).COMMENT_GIST_ID), CHILD);
      await refresh(t, 1);
      await saveConfig(t, '');
      assert.equal(t.childRequests().length, 2);
      assert.equal(await t.page.locator('#timer-feedback-root').isVisible(), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['first entry and manual refresh play feedback; elapsed time and UI activity never poll', async () => {
    const t = await setup();
    try {
      await ready(t);
      assert.equal(t.childRequests().length, 2);
      assert.equal(await t.page.locator('#tab-local').getAttribute('aria-selected'), 'true');
      assert.equal(await t.page.locator('.tf-barrage-host').isVisible(), true);
      assert.equal(await t.page.locator('.tf-barrage').count(), 1, 'first entry plays already available feedback');
      assert.match(await t.page.locator('.tf-barrage').innerText(), /这是一条访客留言/);
      await finishBarrage(t);
      assert.equal(await t.page.locator('.tf-barrage').count(), 0);
      assert.match(await t.page.locator('.tf-lane-hint').innerText(), /播放|播完|重播/);
      await openPanel(t);
      await t.page.getByRole('button', { name: '收起', exact: true }).click();
      await t.page.locator('#tab-gist').click();
      await t.page.locator('#tab-local').click();
      await t.page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await t.page.clock.fastForward(125000);
      assert.equal(t.childRequests().length, 2);
      await refresh(t, 1);
      assert.equal(await t.page.locator('.tf-barrage').count(), 1, 'manual refresh replays existing feedback');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['latest five play in order; replay and toggles use loaded data; reload starts a fresh queue', async () => {
    const comments = [2, 6, 1, 4, 3, 5].map(n => nativeNote('note-' + n, '访客留言 ' + n, { createdAt: '2026-10-22T05:0' + n + ':00.000Z' }));
    comments.push(nativeNote('my-own-note', '不播放本机作者留言', { ownerId: 'this-author', createdAt: '2026-10-22T05:09:00.000Z' }));
    comments.push(nativeNote('deleted-note', '不播放已删除留言', { deleted: true, createdAt: '2026-10-22T05:08:00.000Z' }));
    const t = await setup({ comments, ownerId: 'this-author' });
    try {
      await ready(t, 7);
      for (const n of [6, 5, 4, 3, 2]) {
        assert.equal(await t.page.locator('.tf-barrage').count(), 1, 'exactly one barrage is presented');
        assert.match(await t.page.locator('.tf-barrage').innerText(), new RegExp('访客留言 ' + n + '$'));
        const storage = await playbackStorage(t);
        assert.ok(storage.played.includes('note-' + n));
        if (n > 2) assert.ok(!storage.played.includes('note-' + (n - 1)), 'queued notes are not marked played before presentation');
        assert.deepEqual(storage.read, [], 'presentation never marks a message read');
        await finishBarrage(t);
      }
      assert.equal(await t.page.locator('.tf-barrage').count(), 0);
      const played = (await playbackStorage(t)).played;
      assert.ok(!played.includes('note-1') && !played.includes('my-own-note') && !played.includes('deleted-note'));
      assert.equal(t.childRequests().length, 2);
      await t.page.getByRole('button', { name: '重播弹幕', exact: true }).click();
      assert.match(await t.page.locator('.tf-barrage').innerText(), /访客留言 6$/);
      assert.equal(t.childRequests().length, 2, 'replay does not fetch');
      await t.page.getByRole('button', { name: '弹幕开启', exact: true }).click();
      assert.equal(await t.page.locator('.tf-barrage').count(), 0);
      assert.match(await t.page.locator('.tf-lane-hint').innerText(), /关闭/);
      await t.page.getByRole('button', { name: '弹幕关闭', exact: true }).click();
      assert.match(await t.page.locator('.tf-barrage').innerText(), /访客留言 6$/);
      assert.equal(t.childRequests().length, 2, 'enabling uses the loaded feed');
      await finishBarrage(t);
      assert.match(await t.page.locator('.tf-barrage').innerText(), /访客留言 5$/);
      await refresh(t, 7);
      assert.match(await t.page.locator('.tf-barrage').innerText(), /访客留言 6$/, 'refresh rebuilds the queue');
      // Intentionally moving buttons require forced click in automation.
      await t.page.locator('.tf-barrage').click({ force: true });
      assert.equal(await t.page.locator('#timer-feedback-panel').isVisible(), true);
      await t.page.reload({ waitUntil: 'networkidle' }); await ready(t, 7);
      assert.equal(t.childRequests().length, 6);
      assert.match(await t.page.locator('.tf-barrage').innerText(), /访客留言 6$/);
      await openPanel(t);
      await t.page.getByRole('button', { name: '全部标为已读', exact: true }).click();
      assert.equal(await t.page.locator('.tf-unread').count(), 0);
      assert.equal(t.childRequests().length, 6);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['reply sends only POST to child with correct parent; XSS is literal', async () => {
    const xss = '<img src=x onerror="window.feedbackXss=true"> & <script>window.feedbackXss=true</script>';
    const t = await setup({ comments: [nativeNote('note-xss', xss)] });
    try {
      await ready(t); await openPanel(t);
      assert.equal(await t.page.locator('.tf-owner-label').innerText(), '作者 · TestAuthor');
      assert.equal(await t.page.locator('.tf-identity summary').innerText(), '作者签名 · 未设置');
      assert.equal(await t.page.locator('.tf-note-text').innerText(), xss);
      assert.equal(await t.page.locator('#timer-feedback-root img, #timer-feedback-root script').count(), 0);
      await t.page.getByRole('button', { name: '回复', exact: true }).click();
      assert.equal(await t.page.locator('.tf-send-row .tf-hint').innerText(), 'TestAuthor · 作者');
      await t.page.locator('#timer-feedback-text').fill('收到！<b>这也是普通文字</b>');
      await t.page.getByRole('button', { name: '发送回复', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-compose-status').textContent.includes('回复已发送'));
      assert.equal(t.childRequests().length, 3);
      const post = t.childRequests()[2];
      assert.equal(post.method, 'POST'); assert.equal(post.path, '/gists/' + CHILD + '/comments');
      const envelope = JSON.parse(JSON.parse(post.body).body);
      assert.equal(envelope.app, 'observer-desk'); assert.equal(envelope.data.parentId, 'note-xss');
      assert.equal(envelope.data.author, 'TestAuthor'); assert.equal(envelope.data.authorProof, undefined);
      assert.equal(await t.page.evaluate(() => !!window.feedbackXss), false);
      assert.equal(await t.page.locator('.tf-child').count(), 1);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['author signature is optional; imported synthetic key restores and signed replies are excluded from barrage', async () => {
    const t = await setup();
    try {
      await ready(t); await openPanel(t);
      await t.page.locator('.tf-identity summary').click();
      await t.page.locator('input[aria-label="导入作者钥匙"]').setInputFiles({ name: 'synthetic-author.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(authorFile)) });
      await t.page.waitForFunction(() => document.querySelector('.tf-identity summary').textContent === '作者签名 · 已启用');
      assert.equal(await t.page.locator('.tf-owner-label').innerText(), '作者 · TestAuthor');
      assert.equal(t.childRequests().length, 2, 'key import does not fetch');
      await t.page.getByRole('button', { name: '回复', exact: true }).click();
      await t.page.locator('#timer-feedback-text').fill('作者签名回复');
      await t.page.getByRole('button', { name: '发送回复', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-compose-status').textContent.includes('回复已发送'));
      assert.equal(t.childRequests().length, 3);
      const payload = JSON.parse(JSON.parse(t.childRequests()[2].body).body).data;
      assert.equal(payload.authorProof.v, 1);
      assert.equal(await t.page.evaluate(async payload => TimerFeedbackCore.createAuth(TimerFeedbackCore.authorPublicKey).verify(payload), payload), true);
      assert.equal(await t.page.locator('.tf-child .tf-badge').innerText(), '作者');
      await t.page.evaluate(id => localStorage.setItem('observer.desk.' + id + '.ownerId', 'different-device-id'), CHILD);
      await t.page.reload({ waitUntil: 'networkidle' }); await ready(t, 2);
      assert.equal(t.childRequests().length, 5, 'reload performs only the initial feed read');
      assert.equal(await t.page.locator('.tf-identity summary').innerText(), '作者签名 · 已启用');
      assert.match(await t.page.locator('.tf-barrage').innerText(), /这是一条访客留言/);
      await finishBarrage(t);
      assert.equal(await t.page.locator('.tf-barrage').count(), 0, 'verified author reply from another device does not enter barrage');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['barrage pauses for keyboard focus, reply input and record dialogs without additional reads', async () => {
    const t = await setup();
    try {
      await ready(t);
      await t.page.locator('.tf-barrage').evaluate(el => { el.getAnimations()[0].currentTime = 5000; });
      const lane = await t.page.locator('.tf-lane').boundingBox();
      await t.page.mouse.move(lane.x + 2, lane.y + 2);
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationPlayState), 'running', 'hovering blank track does not hide an incoming message');
      await t.page.locator('.tf-barrage').hover({ force: true });
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationPlayState), 'paused', 'hovering the actual message pauses it');
      await t.page.mouse.move(0, 0);
      await t.page.locator('.tf-barrage').focus();
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
      assert.equal(await t.page.locator('.tf-barrage').isVisible(), true);
      assert.match(await t.page.locator('.tf-lane-hint').innerText(), /暂停/);
      await t.page.locator('.tf-barrage').press('Enter');
      assert.equal(await t.page.locator('#timer-feedback-panel').isVisible(), true, 'keyboard activation opens the panel');
      assert.equal(await t.page.locator('#timer-feedback-text').evaluate(el => document.activeElement === el), true, 'activation selects the message for reply');
      await t.page.getByRole('button', { name: '重播弹幕', exact: true }).click();
      await t.page.getByRole('button', { name: '回复', exact: true }).click();
      await t.page.locator('#timer-feedback-text').fill('输入草稿时暂停');
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
      assert.match(await t.page.locator('.tf-lane-hint').innerText(), /暂停/);
      await t.page.locator('#timer-feedback-text').evaluate(el => el.blur());
      await t.page.waitForFunction(() => getComputedStyle(document.querySelector('.tf-barrage')).animationPlayState === 'running');
      await t.page.locator('#local-record-btn').click();
      assert.equal(await t.page.locator('#record-modal-overlay').isVisible(), true);
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
      await t.page.locator('#cancel-record-btn').click();
      await t.page.waitForFunction(() => getComputedStyle(document.querySelector('.tf-barrage')).animationPlayState === 'running');
      assert.equal(t.childRequests().length, 2);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['clicking a barrage from an older hidden thread selects that exact reply', async () => {
    const comments = Array.from({ length: 22 }, (_, i) => nativeNote('old-root-' + i, '较早留言 ' + i, { createdAt: '2026-10-' + String(i + 1).padStart(2, '0') + 'T01:00:00.000Z' }));
    comments.push(nativeNote('latest-reply', '旧线程中的最新回复', { parentId: 'old-root-0', createdAt: '2026-10-23T01:00:00.000Z' }));
    const t = await setup({ comments, reducedMotion: 'reduce' });
    try {
      await ready(t, 23);
      assert.match(await t.page.locator('.tf-barrage').innerText(), /旧线程中的最新回复/);
      await t.page.locator('.tf-barrage').click();
      assert.match(await t.page.locator('.tf-reply-label').innerText(), /旧线程中的最新回复/);
      await t.page.locator('#timer-feedback-text').fill('回复这条旧线程的新消息');
      await t.page.getByRole('button', { name: '发送回复', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-compose-status').textContent.includes('回复已发送'));
      const payload = JSON.parse(JSON.parse(t.childRequests()[2].body).body).data;
      assert.equal(payload.parentId, 'latest-reply');
      assert.equal(t.childRequests().length, 3);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['empty feed keeps a visible explanation; reduced motion uses static mobile feedback', async () => {
    const empty = await setup({ comments: [] });
    try {
      await ready(empty, 0);
      assert.equal(await empty.page.locator('.tf-barrage-host').isVisible(), true);
      assert.equal(await empty.page.locator('.tf-barrage').count(), 0);
      assert.match(await empty.page.locator('.tf-lane-hint').innerText(), /没有|暂无|还没有/);
      assert.equal(empty.childRequests().length, 2);
      assert.deepEqual(empty.errors, []);
    } finally { await empty.close(); }
    const t = await setup({ mobile: true, reducedMotion: 'reduce' });
    try {
      await ready(t);
      assert.equal(await t.page.locator('.tf-barrage').isVisible(), true);
      assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationName), 'none');
      await t.page.clock.fastForward(125000);
      assert.equal(await t.page.locator('.tf-barrage').count(), 1, 'reduced motion keeps a readable static message');
      assert.equal(t.childRequests().length, 2);
      await t.page.locator('.tf-barrage').click();
      assert.equal(await t.page.locator('#timer-feedback-panel').isVisible(), true);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['feedback read/send errors preserve local records and require explicit retry', async () => {
    const t = await setup();
    try {
      await ready(t); t.fixture.failure = 403;
      await t.page.getByRole('button', { name: '刷新留言', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-status').textContent.includes('403'));
      assert.equal(t.childRequests().length, 3);
      await recordCycle(t, 'local');
      assert.equal(t.childRequests().length, 3);
      t.fixture.failure = 0; await refresh(t, 1); await openPanel(t);
      await t.page.getByRole('button', { name: '回复', exact: true }).click();
      await t.page.locator('#timer-feedback-text').fill('暂时发送失败的草稿');
      t.fixture.postFailure = 503;
      await t.page.getByRole('button', { name: '发送回复', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-compose-status').textContent.includes('发送结果未确认'));
      assert.equal(t.childRequests().length, 6);
      assert.equal(await t.page.locator('#timer-feedback-text').inputValue(), '暂时发送失败的草稿');
      assert.equal(await t.page.getByRole('button', { name: '发送回复', exact: true }).isDisabled(), true);
      await t.page.clock.fastForward(90000);
      assert.equal(t.childRequests().length, 6);
      await recordCycle(t, 'local');
      await refresh(t, 1);
      assert.equal(t.childRequests().length, 8);
      assert.equal(await t.page.getByRole('button', { name: '发送回复', exact: true }).isEnabled(), true);
      const originalId = JSON.parse(JSON.parse(t.childRequests()[5].body).body).data.id;
      t.fixture.postFailure = 0;
      await t.page.getByRole('button', { name: '发送回复', exact: true }).click();
      await t.page.waitForFunction(() => document.querySelector('.tf-compose-status').textContent.includes('回复已发送'));
      assert.equal(t.childRequests().length, 9);
      assert.equal(t.childRequests()[8].method, 'POST');
      assert.equal(JSON.parse(JSON.parse(t.childRequests()[8].body).body).data.id, originalId, 'manual reconciliation preserves reply identity on explicit retry');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['desktop dark and mobile feedback fit viewport with readable reply controls', async () => {
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    for (const mobile of [false, true]) {
      const t = await setup({ mobile, theme: 'dark', comments: [nativeNote('layout-note', '长留言测试。'.repeat(35))] });
      try {
        await ready(t); await openPanel(t);
        assert.equal(await t.page.locator('.tf-barrage').evaluate(el => getComputedStyle(el).animationName), 'tf-drift', 'desktop and mobile both use scrolling barrage');
        await t.page.locator('.tf-barrage').evaluate(el => {
          for (const animation of el.getAnimations()) {
            const duration = Number(animation.effect.getComputedTiming().duration);
            animation.pause();
            animation.currentTime = duration * 0.4;
          }
        });
        await t.page.locator('.tf-barrage-host').screenshot({ path: path.join(__dirname, 'artifacts', 'feedback-barrage-' + (mobile ? 'mobile' : 'desktop') + '-dark.png') });
        await t.page.getByRole('button', { name: '回复', exact: true }).click();
        await t.page.locator('#timer-feedback-text').fill('可以在这里回复。');
        assert.equal(await t.page.locator('html').getAttribute('data-theme'), 'dark');
        const box = await t.page.locator('#timer-feedback-root').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= (mobile ? 390 : 1280));
        assert.equal(await t.page.locator('#timer-feedback-root').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        assert.equal(await t.page.getByRole('button', { name: '发送回复', exact: true }).isVisible(), true);
        await t.page.locator('#timer-feedback-root').screenshot({ path: path.join(__dirname, 'artifacts', 'feedback-' + (mobile ? 'mobile' : 'desktop') + '-dark.png'), animations: 'disabled' });
        assert.deepEqual(t.errors, []);
      } finally { await t.close(); }
    }
  }]
];

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'pagemain.html'), 'utf8');
  let index = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc=/.test(match[1])) new vm.Script(match[2], { filename: 'pagemain-inline-' + (++index) });
  for (const file of ['assets/js/app-config.js', 'assets/js/feedback-core.js', 'assets/js/feedback-ui.js']) new vm.Script(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  console.log('PASS JavaScript parse: main inline scripts and feedback modules');
  const allowed = new Set([
    '/pagemain.html', '/assets/js/app-config.js', '/assets/js/feedback-core.js', '/assets/js/feedback-ui.js',
    '/assets/css/feedback.css', '/assets/css/notebook.css', '/assets/js/notebook-theme.js',
    '/assets/css/tailwind.css', '/assets/css/offline.css', '/assets/js/offline.js',
    '/assets/vendor/chart.umd.min.js', '/assets/vendor/font-awesome.min.css',
    '/assets/vendor/fonts/fontawesome-webfont.woff2'
  ]);
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2' };
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!allowed.has(pathname)) { res.writeHead(404).end(); return; }
    let body = fs.readFileSync(path.join(ROOT, pathname.slice(1)));
    if (pathname === '/assets/js/feedback-core.js') body = body.toString('utf8') + '\nwindow.TimerFeedbackCore.authorPublicKey=' + JSON.stringify(publicKey) + ';';
    res.writeHead(200, { 'Content-Type': mime[path.extname(pathname)] }); res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(tests.length - failed + '/' + tests.length + ' browser regression groups passed. External network mocked or blocked; project scripts, styles and icon font served locally.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); });
