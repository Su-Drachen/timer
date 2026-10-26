/* Real Service Worker regression tests. Only synthetic data and credentials. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Longsu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const PREFIX = '/timer/';
const FIXTURE = [{ time: '2026/10/20 08:00:00', remark: '合成本地记录' }];
const PRIVATE = 'synthetic-private-offline-test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
let server, browser, origin;
// Update fixtures live only in this local server, never in production source files.
const serverOverrides = new Map();
const publicFiles = new Set(['index.html', 'pagemain.html', 'manifest.json', 'sw.js', ...Array.from({ length: 7 }, (_, i) => 'page' + i + '.html')]);
function collectAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) collectAssets(name);
    else publicFiles.add(path.relative(ROOT, name).replaceAll('\\', '/'));
  }
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, serviceWorkers: 'allow' });
  const outsideRequests = [], apiRequests = [], errors = [];
  let offline = false;
  // Do not intercept local resources: installation, reload and cached navigation use a real SW.
  await context.route(url => url.origin !== origin, async route => {
    const request = route.request(), url = new URL(request.url());
    outsideRequests.push(request.url());
    if (url.hostname === 'api.github.com') {
      apiRequests.push({ method: request.method(), path: url.pathname });
      if (offline) return route.abort('internetdisconnected');
      if (url.pathname.endsWith('/comments')) return route.fulfill({ status: 200, json: [] });
      return route.fulfill({ status: 200, json: { files: { 'records.json': { content: '[]' }, 'Interaction.json': { content: '[]' } } } });
    }
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(({ records, configured }) => {
    if (localStorage.getItem('offline-test.initialized')) return;
    localStorage.setItem('offline-test.initialized', 'yes');
    localStorage.setItem('timeRecords', JSON.stringify(records));
    localStorage.setItem('mySecretDecoyPassword', 'synthetic-entry-password');
    if (configured) {
      localStorage.setItem('timeRecorderConfig', JSON.stringify({ GITHUB_USERNAME: 'SyntheticOffline', GIST_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', COMMENT_GIST_ID: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }));
      localStorage.setItem('timeRecorderPat', 'synthetic-private-offline-test');
    }
  }, { records: FIXTURE, configured: !!options.configured });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + PREFIX + 'pagemain.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  return {
    context, page, outsideRequests, apiRequests, errors,
    async offline(value) { offline = value; await context.setOffline(value); },
    async close() { await context.close(); }
  };
}

async function storedRecords(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timeRecords')));
}
async function cacheSnapshot(page) {
  return page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        result.push({ name, url: request.url, authorization: request.headers.get('authorization'), contentType: response.headers.get('content-type'), body: await response.text() });
      }
    }
    return result;
  });
}

async function offlineState(page, expected) {
  await page.waitForFunction(state => document.querySelector('#offline-status')?.dataset.state === state, expected);
  return page.locator('#offline-message').innerText();
}

async function removeCachedFile(page, name, relative) {
  assert.equal(await page.evaluate(async ({ cacheName, url }) => {
    return (await caches.open(cacheName)).delete(url);
  }, { cacheName: name, url: origin + PREFIX + relative }), true);
}

function updateFixture(label, complete) {
  const source = fs.readFileSync(path.join(ROOT, 'assets/js/offline-manifest.js'), 'utf8');
  const build = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
  const changedFile = 'assets/css/offline.css';
  const previousBody = fs.readFileSync(path.join(ROOT, changedFile), 'utf8');
  const nextBody = previousBody + '\n/* Synthetic offline test version: ' + label + ' */\n';
  build.version += '-test-' + label;
  build.hashes[changedFile] = createHash('sha256').update(nextBody.replace(/\r\n?/g, '\n')).digest('hex');
  serverOverrides.set('sw.js', fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') + '\n// Synthetic update ' + label + '\n');
  serverOverrides.set('assets/js/offline-manifest.js', 'self.TIMER_OFFLINE_BUILD = ' + JSON.stringify(build) + ';\n');
  if (complete) serverOverrides.set(changedFile, nextBody);
  return { changedFile, previousBody, nextBody, version: build.version };
}

async function requestUpdate(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    window.offlineTestOriginalController = navigator.serviceWorker.controller;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Synthetic SW update did not finish')), 20000);
      const finish = state => { clearTimeout(timeout); resolve(state); };
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        const changed = () => {
          if (worker.state === 'installed' || worker.state === 'redundant') finish(worker.state);
        };
        worker.addEventListener('statechange', changed);
        changed();
      }, { once: true });
      registration.update().catch(error => { clearTimeout(timeout); reject(error); });
    });
  });
}

const tests = [
  ['real SW supports offline reload, fresh entry tab, and persistent local add/edit/delete', async () => {
    const t = await setup({ mobile: true });
    try {
      assert.deepEqual(t.outsideRequests, [], 'main page must not depend on external scripts, fonts or styles');
      await t.offline(true);
      const response = await t.page.reload({ waitUntil: 'networkidle' });
      assert.equal(response.fromServiceWorker(), true);
      await t.page.waitForFunction(() => document.querySelector('#offline-message').textContent.includes('本地记录可查看、新增、编辑和导出'));
      assert.match(await offlineState(t.page, 'offline'), /当前离线.*云端功能需联网/);
      assert.equal(await t.page.locator('#local-record-count-badge').innerText(), '1');
      assert.equal(await t.page.evaluate(() => typeof Chart), 'function');
      const visual = await t.page.evaluate(async () => {
        await document.fonts.ready;
        const icon = document.querySelector('#local-record-btn .fa');
        const canvas = document.querySelector('#local-records-chart');
        return { display: getComputedStyle(document.querySelector('#local-record-btn')).display, hidden: getComputedStyle(document.querySelector('#record-modal-overlay')).display, iconFont: getComputedStyle(icon).fontFamily, iconContent: getComputedStyle(icon, '::before').content, fonts: [...document.fonts].filter(font => /FontAwesome/.test(font.family)).map(font => font.status), chartWidth: canvas.width, chartHeight: canvas.height, chart: !!Chart.getChart(canvas), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(visual.display, 'flex');
      assert.equal(visual.hidden, 'none');
      assert.match(visual.iconFont, /FontAwesome/);
      assert.ok(visual.iconContent !== 'none' && visual.iconContent !== 'normal');
      assert.ok(visual.fonts.includes('loaded'), 'local icon font must be loaded offline');
      assert.ok(visual.chart && visual.chartWidth > 0 && visual.chartHeight > 0);
      assert.equal(visual.overflow, false);

      await t.page.locator('#local-record-btn').click();
      await t.page.locator('#record-remark').fill('离线新增的合成记录');
      await t.page.locator('#save-record-btn').click();
      assert.equal(await t.page.locator('#record-modal-overlay').isVisible(), false);
      assert.equal((await storedRecords(t.page)).length, 2);
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.ok((await t.page.locator('#local-records-container').innerText()).includes('离线新增的合成记录'));
      const added = t.page.locator('#local-records-container .record-item').filter({ hasText: '离线新增的合成记录' });
      await added.locator('[aria-label="编辑记录"]').click();
      await t.page.locator('#edit-remark').fill('离线编辑后已保存');
      await t.page.locator('#save-edit-btn').click();
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.ok((await storedRecords(t.page)).some(record => record.remark === '离线编辑后已保存'));
      const edited = t.page.locator('#local-records-container .record-item').filter({ hasText: '离线编辑后已保存' });
      await edited.locator('[aria-label="删除记录"]').click();
      await t.page.locator('#confirm-action-btn').click();
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await storedRecords(t.page), FIXTURE);

      const entry = await t.context.newPage();
      entry.on('pageerror', error => t.errors.push(error.message));
      const entryResponse = await entry.goto(origin + PREFIX, { waitUntil: 'networkidle' });
      assert.equal(entryResponse.fromServiceWorker(), true, 'GitHub Pages directory entry works offline');
      await entry.locator('#searchInput').fill('synthetic-entry-password');
      await entry.locator('#searchButton').click();
      await entry.waitForURL('**/timer/pagemain.html');
      assert.equal(await entry.locator('#local-record-count-badge').innerText(), '1');
      fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
      await entry.screenshot({ path: path.join(__dirname, 'artifacts', 'offline-main-mobile.png'), fullPage: true, animations: 'disabled' });
      await entry.setViewportSize({ width: 1280, height: 900 });
      await entry.screenshot({ path: path.join(__dirname, 'artifacts', 'offline-main-desktop.png'), fullPage: true, animations: 'disabled' });
      assert.equal(await entry.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['storage failures preserve local records and unsaved input instead of claiming success', async () => {
    const t = await setup();
    try {
      await t.offline(true);
      await t.page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'timeRecords') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return original.call(this, key, value);
        };
      });
      await t.page.locator('#local-record-btn').click();
      await t.page.locator('#record-remark').fill('存储失败仍需保留的备注');
      await t.page.locator('#save-record-btn').click();
      assert.equal(await t.page.locator('#record-modal-overlay').isVisible(), true);
      assert.equal(await t.page.locator('#record-remark').inputValue(), '存储失败仍需保留的备注');
      assert.match(await t.page.locator('#toast-message').innerText(), /存储|空间|失败/);
      assert.deepEqual(await storedRecords(t.page), FIXTURE);
      assert.equal(await t.page.locator('#local-record-count-badge').innerText(), '1');
      await t.page.locator('#cancel-record-btn').click();
      await t.page.locator('#local-records-container [aria-label="编辑记录"]').click();
      await t.page.locator('#edit-remark').fill('编辑失败仍保留');
      await t.page.locator('#save-edit-btn').click();
      assert.equal(await t.page.locator('#edit-modal-overlay').isVisible(), true);
      assert.equal(await t.page.locator('#edit-remark').inputValue(), '编辑失败仍保留');
      assert.deepEqual(await storedRecords(t.page), FIXTURE);
      await t.page.locator('#cancel-edit-btn').click();
      await t.page.locator('#local-records-container [aria-label="删除记录"]').click();
      await t.page.locator('#confirm-action-btn').click();
      assert.deepEqual(await storedRecords(t.page), FIXTURE);
      assert.equal(await t.page.locator('#local-record-count-badge').innerText(), '1');
      assert.match(await t.page.locator('#toast-message').innerText(), /存储|空间|失败/);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['missing active cache resource is reported and explicit retry repairs offline startup', async () => {
    const t = await setup();
    try {
      await offlineState(t.page, 'ready');
      const original = await cacheSnapshot(t.page);
      const cacheName = original[0].name;
      const missingFile = 'assets/vendor/fonts/fontawesome-webfont.woff2';
      await removeCachedFile(t.page, cacheName, missingFile);
      await t.page.reload({ waitUntil: 'networkidle' });
      assert.match(await offlineState(t.page, 'error'), /离线准备未完成/);
      assert.equal(await t.page.locator('#offline-retry').isVisible(), true);
      assert.equal((await cacheSnapshot(t.page)).some(entry => entry.url.endsWith(missingFile)), false,
        'network fallback must not silently claim to have repaired the cache');
      await t.page.locator('#offline-retry').click();
      assert.match(await offlineState(t.page, 'ready'), /离线已就绪/);
      assert.equal(await t.page.locator('#offline-retry').isVisible(), false);
      assert.equal((await cacheSnapshot(t.page)).length, original.length);
      await t.offline(true);
      assert.equal((await t.page.reload({ waitUntil: 'networkidle' })).fromServiceWorker(), true);
      await t.page.waitForFunction(() => document.querySelector('#offline-message').textContent.includes('本地记录可查看、新增、编辑和导出'));
      assert.deepEqual(await storedRecords(t.page), FIXTURE);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['hash mismatch rejects a partial upgrade and preserves the previous worker and cache', async () => {
    const t = await setup();
    try {
      await offlineState(t.page, 'ready');
      const original = await cacheSnapshot(t.page);
      const update = updateFixture('mismatch', false);
      assert.equal(await requestUpdate(t.page), 'redundant');
      const state = await t.page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { sameController: navigator.serviceWorker.controller === window.offlineTestOriginalController,
          active: registration.active.state, waiting: !!registration.waiting };
      });
      assert.deepEqual(state, { sameController: true, active: 'activated', waiting: false });
      const after = await cacheSnapshot(t.page);
      assert.deepEqual(after.map(entry => [entry.name, entry.url, entry.body]), original.map(entry => [entry.name, entry.url, entry.body]));
      assert.equal(after.some(entry => entry.name.endsWith(update.version)), false);
      assert.match(await offlineState(t.page, 'ready'), /离线已就绪/);
      await t.offline(true);
      assert.equal((await t.page.reload({ waitUntil: 'networkidle' })).fromServiceWorker(), true);
      assert.deepEqual(await storedRecords(t.page), FIXTURE);
      assert.equal(await t.page.evaluate(relative => fetch(relative).then(response => response.text()), update.changedFile), update.previousBody);
      assert.deepEqual(t.errors, []);
    } finally { serverOverrides.clear(); await t.close(); }
  }],
  ['complete upgrade waits without reloading and incomplete active cache explains how to activate it', async () => {
    const t = await setup();
    try {
      await offlineState(t.page, 'ready');
      const original = await cacheSnapshot(t.page);
      const oldCacheName = original[0].name;
      await t.page.locator('#local-record-btn').click();
      await t.page.locator('#record-remark').fill('更新等待期间保留的合成草稿');
      await t.page.evaluate(() => { window.offlineTestPageMarker = 'same-open-page'; });
      const update = updateFixture('complete', true);
      assert.equal(await requestUpdate(t.page), 'installed');
      await t.page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
      const state = await t.page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return { sameController: navigator.serviceWorker.controller === window.offlineTestOriginalController,
          marker: window.offlineTestPageMarker, active: registration.active.state, waiting: registration.waiting.state };
      });
      assert.deepEqual(state, { sameController: true, marker: 'same-open-page', active: 'activated', waiting: 'installed' });
      assert.equal(await t.page.locator('#record-modal-overlay').isVisible(), true);
      assert.equal(await t.page.locator('#record-remark').inputValue(), '更新等待期间保留的合成草稿');
      await t.page.waitForFunction(() => document.querySelector('#offline-message').textContent.includes('新版本'));
      assert.match(await offlineState(t.page, 'ready'), /关闭.*所有页面/);
      const installed = await cacheSnapshot(t.page);
      assert.equal(new Set(installed.map(entry => entry.name)).size, 2);
      assert.ok(installed.some(entry => entry.name.endsWith(update.version) && entry.url.endsWith(update.changedFile) && entry.body === update.nextBody));
      assert.equal(await t.page.evaluate(relative => fetch(relative).then(response => response.text()), update.changedFile), update.previousBody,
        'an open page continues using its original build while the upgrade waits');

      await t.page.locator('#save-record-btn').click();
      assert.equal((await storedRecords(t.page)).length, 2);
      await removeCachedFile(t.page, oldCacheName, 'assets/vendor/fonts/fontawesome-webfont.woff2');
      await t.page.reload({ waitUntil: 'networkidle' });
      const guidance = await offlineState(t.page, 'update');
      assert.match(guidance, /保存/);
      assert.match(guidance, /关闭.*所有页面/);
      assert.match(guidance, /新版本|新版/);
      assert.equal(await t.page.locator('#offline-retry').isVisible(), false,
        'do not offer a repair of old hashes when a complete replacement is waiting');
      assert.equal((await storedRecords(t.page)).length, 2);
      assert.deepEqual(t.errors, []);
    } finally { serverOverrides.clear(); await t.close(); }
  }],
  ['cache contains only public static assets and excludes auth, query, see, and API responses', async () => {
    const t = await setup({ configured: true });
    try {
      const before = await cacheSnapshot(t.page);
      assert.ok(before.some(entry => entry.url.endsWith('/timer/pagemain.html')));
      assert.ok(before.some(entry => entry.url.endsWith('/timer/index.html')));
      const responses = await t.page.evaluate(async ({ privateValue }) => {
        const auth = await fetch('assets/js/app-config.js', { headers: { Authorization: 'Bearer ' + privateValue } }).then(response => response.text());
        const query = await fetch('assets/js/app-config.js?private=' + privateValue).then(response => response.text());
        const excluded = await fetch('see/offline-deny-test.txt').then(response => response.text());
        const api = await fetch('https://api.github.com/gists/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { headers: { Authorization: 'Bearer ' + privateValue } }).then(response => response.json());
        return { auth, query, excluded, api: !!api.files };
      }, { privateValue: PRIVATE });
      assert.equal(responses.auth, PRIVATE, 'authorized requests bypass a matching cached static URL');
      assert.equal(responses.query, PRIVATE, 'sensitive query requests bypass plain static cache');
      assert.equal(responses.excluded, PRIVATE);
      assert.equal(responses.api, true);
      const after = await cacheSnapshot(t.page);
      assert.deepEqual(after.map(entry => entry.url).sort(), before.map(entry => entry.url).sort(), 'runtime sensitive requests add no cache entries');
      for (const entry of after) {
        const url = new URL(entry.url);
        assert.equal(url.origin, origin);
        assert.equal(url.search, '');
        assert.equal(entry.authorization, null);
        assert.ok(url.pathname.startsWith(PREFIX));
        const relative = url.pathname.slice(PREFIX.length);
        assert.ok(publicFiles.has(relative) || relative === '', 'unexpected cached file ' + relative);
        assert.ok(!entry.body.includes(PRIVATE), 'synthetic credential or private response entered cache');
        assert.ok(!entry.body.includes('合成本地记录'), 'local records must not enter static cache');
      }
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['restoring connectivity does not automatically fetch or write cloud data', async () => {
    const t = await setup({ configured: true });
    try {
      await t.offline(true);
      await t.page.reload({ waitUntil: 'networkidle' });
      const requestsBeforeReconnect = t.apiRequests.length;
      await t.page.clock.install();
      await t.offline(false);
      await t.page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await t.page.clock.fastForward(180000);
      await pause(300);
      assert.equal(t.apiRequests.length, requestsBeforeReconnect, 'online/focus/visibility events do not poll or sync');
      assert.equal(t.apiRequests.some(request => request.method !== 'GET'), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }]
];

(async () => {
  collectAssets(path.join(ROOT, 'assets'));
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(PREFIX)) return res.writeHead(404).end();
    const relative = url.pathname.slice(PREFIX.length) || 'index.html';
    if ((relative === 'assets/js/app-config.js' && (req.headers.authorization || url.search)) || relative === 'see/offline-deny-test.txt') {
      return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(PRIVATE);
    }
    if (!publicFiles.has(relative)) return res.writeHead(404).end();
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Service-Worker-Allowed': PREFIX });
    if (serverOverrides.has(relative)) return res.end(serverOverrides.get(relative));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const selected = process.env.OFFLINE_TEST_FILTER ? tests.filter(([name]) => name.includes(process.env.OFFLINE_TEST_FILTER)) : tests;
  let failed = 0;
  for (const [name, run] of selected) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${selected.length - failed}/${selected.length} offline regression groups passed. Real Service Worker; synthetic data only.`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
