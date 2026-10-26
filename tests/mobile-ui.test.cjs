/* Mobile UI regression. Keyboard geometry is simulated with visualViewport;
 * this is not a substitute for a physical iPhone/Android keyboard check.
 * All data and credentials are synthetic. Remote API calls never reach the network.
 * Legacy CDN Tailwind is compiled in memory from each page's actual config. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Longsu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const tailwind = require(path.join(ROOT, 'node_modules/tailwindcss'));
const postcss = require(require.resolve('postcss', { paths: [path.dirname(require.resolve(path.join(ROOT, 'node_modules/tailwindcss')))] }));
const MAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CHILD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CONFIG = { GITHUB_USERNAME: 'SyntheticMobile', GIST_ID: MAIN, COMMENT_GIST_ID: CHILD, GITHUB_PAT: 'synthetic-mobile-token' };
const LOCAL = [{ time: '2026/10/26 08:00:00', remark: '合成手机记录' }, { time: '2026/10/25 08:00:00', remark: '合成历史记录' }];
const CLOUD = [{ time: '2026/10/26 08:30:00', remark: '合成云端记录' }, { time: '2026/10/25 08:30:00', remark: '合成历史云端记录' }];
const note = { id: 101, body: JSON.stringify({ app: 'observer-desk', version: 1, kind: 'note', data: { id: 'mobile-note', kind: 'note', author: '合成访客', text: '手机测试纸条', createdAt: '2026-10-26T05:00:00.000Z', parentId: null, recordTime: null, ownerId: 'synthetic-visitor', deleted: false } }) };
const HTML = ['pagemain.html', ...Array.from({ length: 7 }, (_, i) => 'page' + i + '.html')];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const allowed = new Set(HTML);
const legacyCss = new Map();
let browser, server, origin;

function collectAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collectAssets(file);
    else allowed.add(path.relative(ROOT, file).replaceAll('\\', '/'));
  }
}

async function compileLegacyCss() {
  for (const file of ['page1.html', 'page2.html', 'page3.html', 'page4.html']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const context = { tailwind: {} };
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].includes('tailwind.config')) vm.runInNewContext(match[1], context);
    }
    const config = { ...(context.tailwind.config || {}), content: [{ raw: source, extension: 'html' }], corePlugins: { preflight: true } };
    const result = await postcss([tailwind(config)]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined });
    legacyCss.set(file, result.css);
  }
}

async function setup(file = 'pagemain.html', options = {}) {
  const width = options.width || 390;
  const context = await browser.newContext({ viewport: { width, height: options.height || 844 }, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [], requests = [];
  const fixture = { records: [...CLOUD], comments: [note] };
  await context.route(url => url.origin !== origin, async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname === 'api.github.com') {
      requests.push({ method: req.method(), path: url.pathname });
      if (url.pathname === '/gists/' + MAIN) {
        if (req.method() === 'PATCH') fixture.records = JSON.parse(JSON.parse(req.postData()).files['records.json'].content);
        return route.fulfill({ json: { files: { 'records.json': { content: JSON.stringify(fixture.records) } } } });
      }
      if (url.pathname.startsWith('/gists/' + CHILD)) {
        if (req.method() === 'POST') {
          const item = { id: 1000 + fixture.comments.length, body: JSON.parse(req.postData()).body };
          fixture.comments.push(item);
          return route.fulfill({ status: 201, json: item });
        }
        return route.fulfill({ json: url.pathname.endsWith('/comments') ? fixture.comments : { files: { 'Interaction.json': { content: '[]' } } } });
      }
      return route.fulfill({ status: 404, json: { message: 'Synthetic unavailable endpoint' } });
    }
    if (url.hostname === 'gist.githubusercontent.com') return route.fulfill({ json: fixture.records });
    if (url.hostname === 'cdn.tailwindcss.com') {
      const css = legacyCss.get(file);
      if (!css) throw new Error('Missing legacy CSS fixture for ' + file);
      const script = 'window.tailwind={};const style=document.createElement("style");style.textContent=' + JSON.stringify(css) + ';document.currentScript.before(style);';
      return route.fulfill({ contentType: 'application/javascript', body: script });
    }
    if (/font-awesome\.min\.css$/.test(url.pathname)) return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(ROOT, 'assets/vendor/font-awesome.min.css')) });
    if (/fontawesome-webfont\.woff2$/.test(url.pathname)) return route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(ROOT, 'assets/vendor/fonts/fontawesome-webfont.woff2')) });
    if (/\/chart\.js(?:@[^/]+)?$/.test(url.pathname)) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'assets/vendor/chart.umd.min.js')) });
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(({ theme, config, records }) => {
    if (!sessionStorage.getItem('mobile-test.initialized')) {
      sessionStorage.setItem('mobile-test.initialized', 'yes');
      localStorage.setItem('userTheme', theme);
      localStorage.setItem('timeRecords', JSON.stringify(records));
      localStorage.setItem('timeRecorderConfig', JSON.stringify(config));
      localStorage.setItem('timeRecorderPat', config.GITHUB_PAT);
    }
    // Model the layout viewport remaining full-height while the keyboard reduces
    // the visual viewport and may pan it. No platform keyboard is invoked.
    const view = new EventTarget();
    Object.assign(view, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: view });
    window.__setMobileViewport = values => { Object.assign(view, values); view.dispatchEvent(new Event('resize')); view.dispatchEvent(new Event('scroll')); };
  }, { theme: options.theme || 'white', config: CONFIG, records: LOCAL });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(origin + '/' + file, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.TimerMobile);
  return { context, page, requests, errors, close: () => context.close() };
}

async function assertNoOverflow(page, label) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(size.scroll <= size.width + 1, label + ' page overflow: ' + JSON.stringify(size));
}
async function touchTargets(page, selector, label) {
  const sizes = await page.locator(selector).evaluateAll(elements => elements.filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => ({ label: el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 16), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  assert.ok(sizes.length, label + ' has visible controls');
  for (const size of sizes) assert.ok(size.height >= 43.5 && size.width >= 43.5, label + ' target too small: ' + JSON.stringify(size));
}
async function neutralColors(page, selector, properties = ['backgroundColor', 'color']) {
  const colors = await page.locator(selector).evaluateAll((elements, properties) => {
    const ctx = document.createElement('canvas').getContext('2d');
    return elements.filter(el => el.getClientRects().length).flatMap(el => properties.map(property => {
      const value = getComputedStyle(el)[property];
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
      return { selector: el.id || el.className, property, value, rgba: [...ctx.getImageData(0, 0, 1, 1).data] };
    }));
  }, properties);
  for (const color of colors) if (color.rgba[3]) assert.ok(Math.max(...color.rgba.slice(0, 3)) - Math.min(...color.rgba.slice(0, 3)) <= 1, 'white theme has a tint: ' + JSON.stringify(color));
}
async function keyboard(page, height = 400, offsetTop = 36) {
  await page.evaluate(({ height, offsetTop }) => __setMobileViewport({ height, offsetTop }), { height, offsetTop });
  await page.waitForFunction(h => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height')) - h) < 1, height);
}
async function keyboardReset(page) {
  await page.evaluate(() => __setMobileViewport({ height: innerHeight, offsetTop: 0 }));
}
async function assertPanelWithinKeyboard(page, panelSelector, actionSelector, height = 400, offsetTop = 36) {
  await page.waitForFunction(({ selector, height, offsetTop }) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box && box.top >= offsetTop - 2 && box.bottom <= offsetTop + height + 2;
  }, { selector: panelSelector, height, offsetTop }, { timeout: 3000 }).catch(() => {});
  const panel = await page.locator(panelSelector).boundingBox();
  const details = await page.locator(panelSelector).evaluate(el => {
    const overlay = el.closest('[data-mobile-dialog]');
    return { panelHeight: getComputedStyle(el).height, panelMaxHeight: getComputedStyle(el).maxHeight, overlayTop: getComputedStyle(overlay).top, overlayHeight: getComputedStyle(overlay).height, overlayVariable: getComputedStyle(overlay).getPropertyValue('--app-viewport-height'), inline: overlay.style.cssText, rootHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height'), rootTop: getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-top') };
  });
  assert.ok(panel && panel.y >= offsetTop - 2 && panel.y + panel.height <= offsetTop + height + 2, 'panel outside simulated visual viewport: ' + JSON.stringify({ panel, ...details }));
  const action = page.locator(actionSelector).first();
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();
  assert.ok(box && box.y >= offsetTop - 2 && box.y + box.height <= offsetTop + height + 2, 'action unreachable above keyboard: ' + JSON.stringify(box));
}
async function assertFocusContained(page, dialog) {
  const id = dialog.replace(/^#/, '');
  await page.evaluate(dialogId => {
    const dialog = document.getElementById(dialogId);
    const controls = [...dialog.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    controls[controls.length - 1]?.focus();
  }, id);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(dialogId => document.getElementById(dialogId).contains(document.activeElement), id), true, 'Tab must stay inside open dialog');
}
async function screenshot(page, name) {
  fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, 'artifacts', name), fullPage: false, animations: 'disabled' });
}

const tests = [
  ['all main-project pages fit 320/390 px; common touch controls are at least 44 px', async () => {
    const controls = {
      'pagemain.html': '#theme-btn-blue,#theme-btn-white,#theme-btn-dark,#local-record-btn,#local-import-btn,#local-download-btn,#local-records-container .icon-btn',
      'page0.html': '.nb-back,.btn',
      'page1.html': '.nb-back',
      'page2.html': '.nb-back',
      'page3.html': '.nb-back,.filter-btn,#batch-clear-remark-btn,#batch-delete-btn,#quick-dedup-btn,#records-table-body button',
      'page4.html': '.nb-back,#refresh-btn,.filter-btn',
      'page5.html': '.topbar button,.attach-btn,#sendButton',
      'page6.html': '#refresh,#viewToggle,#export,#sort,#deskNotesOpen,#deskNotesRefresh,#mobileNoteOpen'
    };
    for (const width of [320, 390]) for (const file of HTML) {
      const t = await setup(file, { width });
      try {
        await assertNoOverflow(t.page, file + ' at ' + width);
        await touchTargets(t.page, controls[file], file + ' at ' + width);
        assert.deepEqual(t.errors, [], file + ' runtime errors');
      } finally { await t.close(); }
    }
  }],
  ['white theme uses neutral surfaces and accents; blue and dark remain distinct', async () => {
    const t = await setup();
    try {
      await neutralColors(t.page, 'body,.hero-card,.nb-brand-icon,#local-record-btn,.quick-link > div:last-child,#local-records-container .icon-btn');
      await screenshot(t.page, 'mobile-white-home.png');
      await t.page.locator('#local-records-container [aria-label="删除记录"]').first().click();
      const confirmButton = t.page.locator('#confirm-action-btn');
      for (const state of ['normal', 'hover']) {
        if (state === 'hover') await confirmButton.hover();
        await neutralColors(t.page, '#confirm-action-btn');
        const contrast = await confirmButton.evaluate(el => {
          const style = getComputedStyle(el);
          const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
            const channel = value / 255;
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
          }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
          const foreground = luminance(style.color), background = luminance(style.backgroundColor);
          return { foreground, background, ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
        });
        assert.ok(contrast.foreground > contrast.background && contrast.ratio >= 4.5, 'white delete confirmation button lacks readable light-on-dark contrast (' + state + '): ' + JSON.stringify(contrast));
      }
      await t.page.locator('#cancel-confirm-btn').click();
      const white = await t.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nb-accent').trim());
      await t.page.locator('#theme-btn-blue').click();
      assert.equal(await t.page.locator('html').getAttribute('data-theme'), 'blue');
      const blue = await t.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nb-accent').trim());
      assert.notEqual(blue, white);
      await t.page.locator('#theme-btn-dark').click();
      assert.equal(await t.page.locator('html').getAttribute('data-theme'), 'dark');
      const surface = await t.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(surface, 'rgb(255, 255, 255)');
      await assertNoOverflow(t.page, 'dark home');
      await screenshot(t.page, 'mobile-dark-home.png');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['homepage record and edit dialogs stay usable above a simulated keyboard and restore focus', async () => {
    const t = await setup();
    try {
      await t.page.locator('#local-record-btn').click();
      await t.page.locator('#record-remark').fill('键盘测试备注');
      assert.ok(await t.page.locator('#record-remark').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      await keyboard(t.page);
      await assertPanelWithinKeyboard(t.page, '#record-modal-overlay [data-mobile-panel]', '#save-record-btn');
      await assertFocusContained(t.page, '#record-modal-overlay');
      const y = await t.page.evaluate(() => scrollY);
      await t.page.mouse.wheel(0, 400);
      assert.equal(await t.page.evaluate(() => scrollY), y, 'background must remain locked');
      await screenshot(t.page, 'mobile-record-keyboard.png');
      await keyboardReset(t.page);
      await t.page.locator('#save-record-btn').click();
      assert.equal(await t.page.locator('#record-modal-overlay').isVisible(), false);
      assert.equal(await t.page.evaluate(() => document.activeElement.id), 'local-record-btn');
      const item = t.page.locator('#local-records-container .record-item').filter({ hasText: '键盘测试备注' });
      await item.locator('[aria-label="编辑记录"]').click();
      await t.page.locator('#edit-remark').fill('编辑键盘测试备注');
      await keyboard(t.page, 360, 50);
      await assertPanelWithinKeyboard(t.page, '#edit-modal-overlay [data-mobile-panel]', '#save-edit-btn', 360, 50);
      await keyboardReset(t.page);
      await t.page.keyboard.press('Escape');
      assert.equal(await t.page.locator('#edit-modal-overlay').isVisible(), false);
      assert.equal(await t.page.evaluate(() => document.activeElement.getAttribute('aria-label')), '编辑记录');
      await assertNoOverflow(t.page, 'homepage after dialogs');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['homepage cloud configuration scrolls within keyboard space and can be dismissed', async () => {
    const t = await setup('pagemain.html', { width: 320 });
    try {
      await t.page.locator('#tab-gist').click();
      await t.page.waitForFunction(() => gistApp.isInitialized && !gistApp.isLoading);
      await t.page.locator('#gist-config-open-btn').click();
      await t.page.locator('#gist-commentId').focus();
      await keyboard(t.page, 340, 22);
      await assertPanelWithinKeyboard(t.page, '#gist-config-overlay [data-mobile-panel]', '#gist-config-form button[type="submit"]', 340, 22);
      for (const field of ['#gist-username', '#gist-gistId', '#gist-pat', '#gist-commentId']) {
        await t.page.locator(field).focus();
        const geometry = await t.page.locator(field).evaluate(el => {
          const input = el.getBoundingClientRect();
          const panel = el.closest('[data-mobile-panel]').getBoundingClientRect();
          const actions = el.closest('form').querySelector('[data-mobile-actions]').getBoundingClientRect();
          return { field: el.id, inputTop: input.top, inputBottom: input.bottom, panelTop: panel.top, actionsTop: actions.top };
        });
        assert.ok(geometry.inputTop >= geometry.panelTop - 1 && geometry.inputBottom <= geometry.actionsTop + 1, 'focused configuration field obscured: ' + JSON.stringify(geometry));
      }
      await assertFocusContained(t.page, '#gist-config-overlay');
      assert.ok(await t.page.locator('#gist-pat').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      await screenshot(t.page, 'mobile-config-keyboard.png');
      await keyboardReset(t.page);
      await t.page.keyboard.press('Escape');
      assert.equal(await t.page.locator('#gist-config-overlay').isVisible(), false);
      assert.equal(await t.page.evaluate(() => document.activeElement.id), 'gist-config-open-btn');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['achievement dialog has modal semantics and bounded scroll on a short viewport', async () => {
    const t = await setup('page2.html', { width: 320 });
    try {
      const card = t.page.locator('.achievement-card').first();
      await card.click();
      assert.equal(await t.page.locator('#achievement-modal').getAttribute('role'), 'dialog');
      await keyboard(t.page, 360, 0);
      await assertPanelWithinKeyboard(t.page, '#achievement-modal [data-mobile-panel]', '#achievement-modal button', 360, 0);
      await assertFocusContained(t.page, '#achievement-modal');
      await t.page.keyboard.press('Escape');
      assert.equal(await t.page.locator('#achievement-modal').evaluate(el => el.hidden || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none' || el.classList.contains('pointer-events-none')), true);
      await keyboardReset(t.page);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['data repair editing uses a reachable dialog and cancel restores the record action', async () => {
    const t = await setup('page3.html', { width: 320 });
    try {
      const edit = t.page.locator('#records-table-body button[title="编辑备注"]').first();
      await edit.click();
      await t.page.locator('#repair-edit-value').fill('合成修复备注');
      await keyboard(t.page, 350, 30);
      await assertPanelWithinKeyboard(t.page, '#repair-edit-dialog [data-mobile-panel]', '#repair-edit-form button[type="submit"]', 350, 30);
      await assertFocusContained(t.page, '#repair-edit-dialog');
      await touchTargets(t.page, '#repair-edit-dialog button', 'repair edit');
      await screenshot(t.page, 'mobile-repair-keyboard.png');
      await keyboardReset(t.page);
      await t.page.locator('#repair-edit-cancel').click();
      assert.equal(await t.page.locator('#repair-edit-dialog').isVisible(), false);
      assert.equal(await t.page.evaluate(() => document.activeElement.getAttribute('title')), '编辑备注');
      assert.equal(await t.page.evaluate(() => JSON.parse(localStorage.getItem('timeRecords'))[0].remark), LOCAL[0].remark);
      await edit.click();
      await t.page.locator('#repair-edit-value').fill('合成修复备注');
      await t.page.locator('#repair-edit-form button[type="submit"]').click();
      assert.ok(await t.page.evaluate(() => JSON.parse(localStorage.getItem('timeRecords')).some(r => r.remark === '合成修复备注')));
      assert.equal(await t.page.locator('#repair-edit-dialog').isVisible(), false);
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['AI composer and settings remain reachable above the simulated keyboard', async () => {
    const t = await setup('page5.html');
    try {
      await t.page.locator('#userInput').fill('只输入，不发送');
      await keyboard(t.page, 390, 28);
      await t.page.waitForFunction(() => { const b = document.querySelector('.composer-area').getBoundingClientRect(); return b.top >= 26 && b.bottom <= 420; }, null, { timeout: 3000 });
      const composer = await t.page.locator('.composer-area').boundingBox();
      assert.ok(composer.y >= 28 - 2 && composer.y + composer.height <= 28 + 390 + 2, 'AI composer outside visible viewport ' + JSON.stringify(composer));
      await keyboardReset(t.page);
      await t.page.getByRole('button', { name: '打开侧栏', exact: true }).click();
      await t.page.locator('button[onclick="openSettings()"]').click();
      await t.page.locator('#cfgSecret').focus();
      await keyboard(t.page, 360, 35);
      await assertPanelWithinKeyboard(t.page, '#settings [data-mobile-panel]', '#settings .modal-actions button:last-child', 360, 35);
      await assertFocusContained(t.page, '#settings');
      await touchTargets(t.page, '#settings button', 'AI settings');
      await neutralColors(t.page, '.app,.topbar,.composer,.modal,.btn.primary');
      await screenshot(t.page, 'mobile-ai-settings-keyboard.png');
      await keyboardReset(t.page);
      await t.page.keyboard.press('Escape');
      assert.equal(await t.page.locator('#settings').isVisible(), false);
      assert.equal(await t.page.locator('#userInput').inputValue(), '只输入，不发送');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }],
  ['observation desk uses white palette and preserves note drafts through keyboard/modal close', async () => {
    const t = await setup('page6.html');
    try {
      await neutralColors(t.page, 'body,.activity,.bookmark,.record-panel,.desk-note');
      await t.page.locator('#mobileNoteOpen').click();
      await t.page.locator('#deskText').fill('合成手机纸条草稿');
      await keyboard(t.page, 400, 40);
      await assertPanelWithinKeyboard(t.page, '#deskComposerPanel', '#deskSubmit', 400, 40);
      await assertFocusContained(t.page, '#deskComposer');
      await touchTargets(t.page, '#deskComposer button', 'paper composer');
      assert.ok(await t.page.locator('#deskText').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      await neutralColors(t.page, '#deskComposerPanel,#deskSubmit,#deskNickname,#deskText');
      await screenshot(t.page, 'mobile-desk-keyboard.png');
      await keyboardReset(t.page);
      await t.page.keyboard.press('Escape');
      assert.equal(await t.page.locator('#deskComposer').isVisible(), false);
      assert.equal(await t.page.evaluate(() => document.activeElement.id), 'mobileNoteOpen');
      await t.page.locator('#mobileNoteOpen').click();
      assert.equal(await t.page.locator('#deskText').inputValue(), '合成手机纸条草稿');
      await t.page.locator('#deskComposerClose').click();
      await assertNoOverflow(t.page, 'desk after keyboard');
      assert.deepEqual(t.errors, []);
    } finally { await t.close(); }
  }]
];

(async () => {
  collectAssets(path.join(ROOT, 'assets'));
  await compileLegacyCss();
  server = http.createServer((req, res) => {
    const relative = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!allowed.has(relative)) return res.writeHead(404).end();
    const file = path.join(ROOT, relative);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const selected = process.env.MOBILE_TEST_FILTER ? tests.filter(([name]) => name.includes(process.env.MOBILE_TEST_FILTER)) : tests;
  let failed = 0;
  for (const [name, run] of selected) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  console.log(`${selected.length - failed}/${selected.length} mobile groups passed. Simulated keyboard viewport; synthetic APIs only.`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
