'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const core = require('../assets/js/feedback-core.js');

const at = '2026-10-22T06:00:00.000Z';
const note = (id, fields = {}) => ({ id, kind: 'note', author: '朋友', text: '你好',
  createdAt: at, parentId: null, recordTime: null, ownerId: 'visitor', deleted: false, ...fields });
const wire = (data, id = 10) => ({ id, body: JSON.stringify({ app: 'observer-desk', version: 1,
  kind: data.kind || 'note', data }) });
const gist = (comments = []) => ({ files: { 'Interaction.json': { content: JSON.stringify(comments) } } });
const response = (data, status = 200, link = '') => ({ ok: status >= 200 && status < 300, status,
  headers: { get: key => key.toLowerCase() === 'link' ? link : null }, json: async () => data });
const unsupported = { supported: () => false };
function mockStore(handler) {
  const calls = [];
  const store = core.createStore({ gistId: 'abcdef1234', token: 'unit-test-token',
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return handler(url, init, calls);
    } });
  return { store, calls };
}

test('creation is inert; reads occur only on explicit load and append never loads', async () => {
  const { store, calls } = mockStore(url => response(url.includes('/comments?') ? [] : gist()));
  assert.equal(calls.length, 0);
  await assert.rejects(store.append(note('first')), { code: 'MANUAL_REFRESH_REQUIRED' });
  assert.equal(calls.length, 0);
  await store.load();
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET']);
  await store.load();
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET', 'GET', 'GET']);
});

test('legacy/native events merge, duplicate IDs are deterministic, malformed events are skipped', async () => {
  const legacy = note('legacy');
  const native = note('native');
  const pin = { id: 'pin', kind: 'pin', targetId: 'native', createdAt: at };
  const deletion = { id: 'delete', kind: 'delete', targetIds: ['native'], ownerId: 'visitor', createdAt: at };
  const { store } = mockStore(url => response(url.includes('/comments?') ? [
    wire({ ...legacy, text: 'duplicate' }), wire(native), wire(pin), wire(deletion),
    { id: 90, body: '<script>ordinary comment</script>' }, wire({ ...note('bad'), createdAt: 'invalid' })
  ] : gist([legacy])));
  const data = await store.load();
  assert.deepEqual(data.comments.map(x => x.id), ['legacy', 'native']);
  assert.equal(data.comments[0].text, '你好');
  assert.equal(data.pins[0].id, 'pin');
  assert.equal(data.deletions[0].id, 'delete');
  assert.ok(data.warnings.length >= 2);
});

test('append is a single native-comment POST, deduplicates and retains successful local sends', async () => {
  const { store, calls } = mockStore((url, init) => response(init.method === 'POST' ? { id: 123 } :
    url.includes('/comments?') ? [] : gist()));
  await store.load();
  const saved = await store.append(note('reply', { parentId: 'root' }));
  assert.equal(saved._gistCommentId, 123);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].method, 'POST');
  assert.ok(calls[2].url.endsWith('/comments'));
  const envelope = JSON.parse(JSON.parse(calls[2].body).body);
  assert.equal(envelope.app, 'observer-desk');
  assert.equal(envelope.data.parentId, 'root');
  assert.equal(calls[2].body.includes('records.json'), false);
  await store.append(note('reply', { parentId: 'root' }));
  assert.equal(calls.length, 3);
  const data = await store.load();
  assert.equal(data.comments.find(x => x.id === 'reply')._gistCommentId, 123);
  await assert.rejects(store.append({ id: 'reply', kind: 'pin', targetId: null, createdAt: at }),
    { code: 'ID_KIND_CONFLICT' });
  assert.equal(calls.length, 5);
});

test('concurrent same-ID sends share one POST', async () => {
  let finish;
  const { store, calls } = mockStore((url, init) => init.method === 'POST' ? new Promise(resolve => { finish = resolve; }) :
    response(url.includes('/comments?') ? [] : gist()));
  await store.load();
  const one = store.append(note('parallel'));
  const two = store.append(note('parallel'));
  await Promise.resolve();
  finish(response({ id: 24 }));
  assert.equal((await one)._gistCommentId, 24);
  assert.equal((await two)._gistCommentId, 24);
  assert.equal(calls.filter(x => x.method === 'POST').length, 1);
});

test('uncertain send requires manual load, then resolves an already saved logical ID without duplicate POST', async () => {
  let remote = [];
  const payload = note('uncertain');
  const { store, calls } = mockStore((url, init) => {
    if (init.method === 'POST') { remote = [wire(payload, 44)]; throw new Error('secret server text'); }
    return response(url.includes('/comments?') ? remote : gist());
  });
  await store.load();
  await assert.rejects(store.append(payload), error => error.uncertain && !error.message.includes('secret'));
  await assert.rejects(store.append(payload), { code: 'MANUAL_REFRESH_REQUIRED', uncertain: true });
  assert.equal(calls.length, 3);
  await store.load();
  assert.equal((await store.append(payload))._gistCommentId, 44);
  assert.equal(calls.filter(x => x.method === 'POST').length, 1);
});

test('a manual load proving an uncertain note absent permits exactly one retry POST', async () => {
  let posts = 0;
  const { store, calls } = mockStore((url, init) => {
    if (init.method === 'POST') return ++posts === 1 ? response({}, 503) : response({ id: 31 });
    return response(url.includes('/comments?') ? [] : gist());
  });
  await store.load();
  await assert.rejects(store.append(note('retry')), { uncertain: true });
  await assert.rejects(store.append(note('retry')), { code: 'MANUAL_REFRESH_REQUIRED' });
  await store.load();
  assert.equal((await store.append(note('retry')))._gistCommentId, 31);
  assert.deepEqual(calls.map(x => x.method), ['GET', 'GET', 'POST', 'GET', 'GET', 'POST']);
});

test('a load started before a failed POST does not falsely reconcile that send', async () => {
  let finishGet;
  let deferGet = false;
  const { store } = mockStore((url, init) => {
    if (init.method === 'POST') return response({}, 503);
    if (deferGet && !url.includes('/comments?')) return new Promise(resolve => { finishGet = resolve; });
    return response(url.includes('/comments?') ? [] : gist());
  });
  await store.load();
  deferGet = true;
  const loading = store.load();
  await assert.rejects(store.append(note('race')), { uncertain: true });
  finishGet(response(gist()));
  await loading;
  await assert.rejects(store.append(note('race')), { code: 'MANUAL_REFRESH_REQUIRED' });
});

test('partial refresh failure preserves previous known IDs and does not enable an initial send', async () => {
  let broken = false;
  const existing = note('known');
  const { store, calls } = mockStore(url => {
    if (url.includes('/comments?')) return broken ? response({}, 500) : response([wire(existing, 22)]);
    return response(gist());
  });
  await store.load();
  broken = true;
  await assert.rejects(store.load());
  assert.equal((await store.append(existing))._gistCommentId, 22);
  assert.equal(calls.filter(x => x.method === 'POST').length, 0);
  const second = mockStore(url => response({}, 500));
  await assert.rejects(second.store.load());
  await assert.rejects(second.store.append(note('first')), { code: 'MANUAL_REFRESH_REQUIRED' });
  assert.equal(second.calls.length, 1);
});

test('pagination rebuilds the GitHub endpoint instead of forwarding credentials to Link URLs', async () => {
  const { store, calls } = mockStore(url => {
    if (new URL(url).searchParams.get('page') === '1') return response([wire(note('one'))], 200, '<https://untrusted.invalid/next>; rel="next"');
    if (new URL(url).searchParams.get('page') === '2') return response([wire(note('two'))]);
    return response(gist());
  });
  assert.equal((await store.load()).comments.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(x => x.url.startsWith('https://api.github.com/gists/abcdef1234')));
});

test('pagination limit fails explicitly and leaves sending disabled', async () => {
  const { store, calls } = mockStore(url => response(url.includes('/comments?') ? [] : gist(), 200,
    url.includes('/comments?') ? '<ignored>; rel="next"' : ''));
  await assert.rejects(store.load(), /2000/);
  await assert.rejects(store.append(note('too-many')), { code: 'MANUAL_REFRESH_REQUIRED' });
  assert.equal(calls.length, 21);
});

test('feed limits plain-text display, retains reply context, and handles parent cycles once', async () => {
  const data = await core.prepareFeed({ comments: [
    note('a', { parentId: 'b', author: 'x'.repeat(100), text: '<img onerror=alert(1)>' + 'x'.repeat(3000) }),
    note('b', { parentId: 'a' }), note('child', { parentId: 'b' }),
    note('gone', { deleted: true }), note('reply', { parentId: 'gone' })
  ] }, unsupported);
  assert.equal(data.notes[0].text.length, 2000);
  assert.equal(data.notes[0].author.length, 64);
  assert.equal(data.notes[0].text.startsWith('<img'), true); // Text remains literal, never executable HTML.
  assert.deepEqual(data.roots.find(x => x.id === 'a').replies.map(x => x.id), ['b', 'child']);
  assert.equal(data.roots.find(x => x.id === 'gone').text, '');
  assert.equal(data.roots.find(x => x.id === 'gone').replies[0].id, 'reply');
  assert.equal(data.notes.every(x => !x.verified), true);
  assert.equal(data.warnings.length, 1);
});

async function testIdentity() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const auth = core.createAuth(publicKey);
  await auth.initialized;
  await auth.importKey({ app: 'observer-desk-author', version: 1, privateKey });
  return { auth, publicKey, privateKey };
}

test('author signature format verifies original content and ignores transport metadata only', async () => {
  const { auth } = await testIdentity();
  const signed = await auth.sign(note('signed', { author: 'Su-Drachen' }));
  assert.equal(auth.isOwner(), true);
  assert.equal(await auth.verify(signed), true);
  assert.deepEqual(Object.keys(signed.authorProof).sort(), ['signature', 'v']);
  assert.equal(await auth.verify({ ...signed, _gistCommentId: 88 }), true);
  assert.equal(await auth.verify({ ...signed, text: 'tampered' }), false);
  const data = await core.prepareFeed({ comments: [signed, { ...signed, id: 'tampered' }] }, auth);
  assert.equal(data.notes[0].verified, true);
  assert.equal(data.notes[1].verified, false);
  auth.forget();
  await assert.rejects(auth.sign(note('new')), /作者密钥/);
});

test('verified author deletes/pins apply; forged author deletes and visitor deletes of author notes do not', async () => {
  const { auth } = await testIdentity();
  const authorNote = await auth.sign(note('author', { ownerId: 'author-owner' }));
  const signedDelete = await auth.sign({ id: 'delete-1', kind: 'delete', ownerId: 'author-owner',
    createdAt: at, targetIds: ['deleted-by-author'] });
  const forgedDelete = { ...signedDelete, id: 'forged', targetIds: ['safe'] };
  const signedPin = await auth.sign({ id: 'pin-1', kind: 'pin', targetId: 'safe', createdAt: at });
  const visitorDelete = { id: 'delete-2', kind: 'delete', ownerId: 'author-owner', createdAt: at,
    targetIds: ['author', 'visitor-owned'] };
  const data = await core.prepareFeed({ comments: [authorNote, note('safe'), note('deleted-by-author'),
    note('visitor-owned', { ownerId: 'author-owner' })], pins: [signedPin],
    deletions: [signedDelete, forgedDelete, visitorDelete] }, auth);
  const byId = new Map(data.notes.map(x => [x.id, x]));
  assert.equal(byId.get('author').deleted, false);
  assert.equal(byId.get('safe').deleted, false);
  assert.equal(byId.get('safe').pinned, true);
  assert.equal(data.roots[0].id, 'safe');
  assert.equal(byId.get('deleted-by-author').deleted, true);
  assert.equal(byId.get('visitor-owned').deleted, true);
});

test('author credentials use the existing shared storage key and unrelated keys cannot impersonate the author', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    const { auth, publicKey, privateKey } = await testIdentity();
    assert.equal(auth.isPersistent(), true);
    assert.equal(values.has('observer-desk-author-key-v1'), true);
    const restored = core.createAuth(publicKey);
    await restored.initialized;
    assert.equal(restored.isOwner(), true);
    const productionIdentity = core.createAuth();
    await productionIdentity.initialized;
    assert.equal(productionIdentity.isOwner(), false);
    await assert.rejects(productionIdentity.importKey({ app: 'observer-desk-author', version: 1, privateKey }), /不属于/);
    restored.forget();
    assert.equal(values.has('observer-desk-author-key-v1'), false);
  } finally { delete globalThis.localStorage; }
});
