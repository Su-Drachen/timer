const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const catalog = require('../assets/themes/catalog.js');

const source = readFileSync(join(__dirname, '../assets/js/notebook-theme.js'), 'utf8');
const key = 'timer.appearance.v1';

function setup(initial = {}, dark = false) {
  const values = new Map(Object.entries(initial));
  const root = { dataset: {} };
  const window = new EventTarget();
  const media = new EventTarget();
  const changes = [];
  media.matches = dark;
  window.matchMedia = () => media;
  window.TimerThemeCatalog = catalog;
  window.addEventListener('timer:theme-change', event => changes.push(event.detail));
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  vm.runInNewContext(source, { window, document: { documentElement: root }, localStorage: storage, CustomEvent });
  return { manager: window.TimerThemes, root, media, changes, values, storage, window };
}

test('legacy preferences retain their appearance even when the new preference is corrupt', () => {
  for (const [legacy, skin] of Object.entries({ blue: 'classic', dark: 'classic', white: 'minimal' })) {
    const t = setup({ userTheme: legacy, [key]: '{' }, true);
    assert.equal(t.root.dataset.skin, skin);
    assert.equal(t.root.dataset.theme, legacy);
  }
});

test('a draft can be previewed without changing the applied pack, storage or subscribers', () => {
  const t = setup({ userTheme: 'white' }), element = { dataset: {} };
  const choice = { theme: 'pixel', mode: 'dark', decoration: 'simple' };
  t.manager.preview(element, choice);
  assert.deepEqual(element.dataset, { skin: 'pixel', theme: 'dark', decoration: 'simple' });
  assert.equal(t.root.dataset.skin, 'minimal');
  assert.equal(t.values.has(key), false);
  assert.equal(t.changes.length, 0);
  t.manager.apply(choice);
  assert.deepEqual(JSON.parse(t.values.get(key)), choice);
  assert.equal(t.root.dataset.skin, 'pixel');
  assert.equal(t.changes.length, 1);
});

test('system mode tracks the OS, fixed mode persists, and a change in another tab updates the root', () => {
  const t = setup();
  assert.equal(t.manager.read().mode, 'system');
  t.media.matches = true;
  t.media.dispatchEvent(new Event('change'));
  assert.equal(t.root.dataset.theme, 'dark');
  t.manager.apply({ theme: 'pixel', mode: 'light' });
  assert.equal(t.root.dataset.theme, 'blue');
  t.values.set(key, JSON.stringify({ theme: 'minimal', mode: 'system' }));
  t.window.dispatchEvent(Object.assign(new Event('storage'), { key }));
  assert.equal(t.root.dataset.skin, 'minimal');
  assert.equal(t.root.dataset.theme, 'dark');
});

test('storage failure leaves the current appearance and selection intact', () => {
  const t = setup();
  t.storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => t.manager.apply({ theme: 'pixel' }));
  assert.equal(t.root.dataset.skin, 'classic');
  assert.equal(t.manager.read().theme, 'classic');
  assert.equal(t.changes.length, 0);
});
