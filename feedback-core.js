/* Feedback transport and author signatures, compatible with see/observer-desk.html.
 * No network request occurs until load() or append() is explicitly called. */
(function (root) {
  'use strict';
  var createStore, createAuth;
(function (root) {
  'use strict';

  var APP = 'observer-desk';
  var MAX_PAGES = 20;
  var TIMEOUT_MS = 15000;

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function makeError(message, properties) {
    var error = new Error(message);
    if (properties) Object.assign(error, properties);
    // Only this module's fixed, credential-free messages may be displayed by the UI.
    error.safeMessage = true;
    return error;
  }

  function validData(data, kind) {
    if (!isObject(data) || typeof data.id !== 'string' || !data.id.trim()) return false;
    if (typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) return false;
    if (kind === 'pin') {
      return data.kind === 'pin' && (data.targetId === null || typeof data.targetId === 'string');
    }
    if (kind === 'delete') {
      return data.kind === 'delete' && typeof data.ownerId === 'string' &&
        Array.isArray(data.targetIds) && data.targetIds.length > 0 && data.targetIds.length <= 500 &&
        data.targetIds.every(function (id) { return typeof id === 'string' && id.trim().length > 0; }) &&
        new Set(data.targetIds).size === data.targetIds.length;
    }
    if (kind !== 'note') return false;
    return (data.kind === undefined || data.kind === 'note') &&
      typeof data.author === 'string' && typeof data.text === 'string' &&
      (data.parentId === undefined || data.parentId === null || typeof data.parentId === 'string');
  }

  function createDeskStore(options) {
    options = options || {};
    var gistId = String(options.gistId || '');
    if (!/^[a-f0-9]+$/i.test(gistId)) throw makeError('评论 Gist ID 无效。');
    var token = typeof options.token === 'string' ? options.token.trim() : '';
    var fetchImpl = options.fetchImpl || (root.fetch && root.fetch.bind(root));
    if (typeof fetchImpl !== 'function') throw makeError('当前浏览器不支持联网读取，请使用更新的浏览器。');
    var baseUrl = 'https://api.github.com/gists/' + encodeURIComponent(gistId);
    var knownRecords = new Map();
    var confirmedAppends = new Map();
    var pendingAppends = new Map();
    var attemptedKinds = new Map();
    var uncertainIds = new Set();
    var loaded = false;
    var loading = null;

    async function request(url, method, body) {
      var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      var headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      var timer;
      var timedOut = false;
      try {
        var timeout = new Promise(function (_, reject) {
          timer = setTimeout(function () {
            timedOut = true;
            if (controller) controller.abort();
            reject(makeError('连接 GitHub 超时，请检查网络后重试。'));
          }, TIMEOUT_MS);
        });
        var response = await Promise.race([
          Promise.resolve().then(function () {
            return fetchImpl(url, {
              method: method,
              headers: headers,
              body: body,
              signal: controller ? controller.signal : undefined,
              cache: 'no-store'
            });
          }),
          timeout
        ]);
        if (!response || !response.ok) {
          var status = response ? response.status : 0;
          var message = status === 401 ? 'GitHub 凭据无效或已失效（401）。' :
            status === 403 ? 'GitHub 拒绝访问，可能是权限不足或请求次数受限（403）。' :
            status === 404 ? '找不到评论 Gist，或当前凭据无权访问（404）。' :
            status === 429 ? 'GitHub 请求过于频繁，请稍后重试（429）。' :
            'GitHub 请求失败（HTTP ' + status + '），请稍后重试。';
          throw makeError(message, {
            status: status,
            responseReceived: true,
            uncertain: method === 'POST' && (status >= 500 || status === 408 || status === 0)
          });
        }
        var json;
        try {
          json = await Promise.race([
            response.json(),
            timeout
          ]);
        } catch (error) {
          throw makeError(timedOut ? '读取 GitHub 响应超时，请稍后重试。' : 'GitHub 返回的数据无法解析，请稍后重试。', {
            uncertain: method === 'POST', responseReceived: true
          });
        }
        return { data: json, headers: response.headers };
      } catch (error) {
        if (error && error.responseReceived) throw error;
        throw makeError(timedOut ? '连接 GitHub 超时，请检查网络后重试。' : '无法连接 GitHub，请检查网络后重试。', {
          uncertain: method === 'POST'
        });
      } finally {
        clearTimeout(timer);
      }
    }

    function readLegacy(gist, warnings) {
      var file = gist && gist.files && gist.files['Interaction.json'];
      if (!file) {
        warnings.push('未找到旧纸条文件 Interaction.json；新纸条仍可正常读取。');
        return [];
      }
      if (file.truncated) {
        warnings.push('旧纸条文件内容被 GitHub 截断，暂时无法完整展示；原文件未改动。');
        return [];
      }
      var data;
      try {
        data = JSON.parse(file.content);
      } catch (_) {
        warnings.push('旧纸条文件解析失败，暂时无法展示；原文件未改动。');
        return [];
      }
      var comments = Array.isArray(data) ? data : isObject(data) && data.comments;
      if (!Array.isArray(comments)) {
        warnings.push('旧纸条文件格式不支持，暂时无法展示；原文件未改动。');
        return [];
      }
      return comments.filter(function (comment) {
        var valid = isObject(comment) && typeof comment.id === 'string' && comment.id.length > 0;
        if (!valid) warnings.push('一条旧纸条缺少有效 ID，已跳过展示。');
        return valid;
      }).map(function (comment) {
        // Keep deleted parents and unknown fields, including any legacy identity data.
        return Object.assign({}, comment);
      });
    }

    function readEnvelope(comment, warnings) {
      if (!isObject(comment) || typeof comment.body !== 'string') return null;
      var envelope;
      try {
        envelope = JSON.parse(comment.body);
      } catch (_) {
        if (comment.body.indexOf(APP) !== -1) warnings.push('一条纸条的数据损坏，已跳过展示。');
        return null;
      }
      if (!isObject(envelope) || envelope.app !== APP) return null;
      if (envelope.version !== 1 || (envelope.kind !== 'note' && envelope.kind !== 'pin' && envelope.kind !== 'delete')) {
        warnings.push('一条纸条使用了暂不支持的数据版本或类型，已跳过展示。');
        return null;
      }
      if (!validData(envelope.data, envelope.kind)) {
        warnings.push('一条纸条缺少必要字段，已跳过展示。');
        return null;
      }
      // The native ID is transport metadata; never change signed payload fields.
      return { kind: envelope.kind, data: Object.assign({}, envelope.data, { _gistCommentId: comment.id }) };
    }

    async function performLoad() {
      // Only this explicit read may reconcile an earlier uncertain send. A read
      // started before that send failed is not sufficient confirmation.
      var reconciling = new Set(uncertainIds);
      var warnings = [];
      var gistResponse = await request(baseUrl, 'GET');
      if (!isObject(gistResponse.data) || !isObject(gistResponse.data.files)) {
        throw makeError('GitHub 返回的评论 Gist 格式不正确，请稍后重试。');
      }
      var comments = readLegacy(gistResponse.data, warnings);
      var pins = [];
      var deletions = [];
      var groups = { note: comments, pin: pins, delete: deletions };
      var nextKnown = new Map();
      comments.forEach(function (comment) {
        if (!nextKnown.has(comment.id)) nextKnown.set(comment.id, { kind: 'note', data: comment });
      });
      for (var page = 1; page <= MAX_PAGES; page += 1) {
        var result = await request(baseUrl + '/comments?per_page=100&page=' + page, 'GET');
        if (!Array.isArray(result.data)) throw makeError('GitHub 返回的纸条列表格式不正确，请稍后重试。');
        result.data.forEach(function (nativeComment) {
          var parsed = readEnvelope(nativeComment, warnings);
          if (!parsed) return;
          if (nextKnown.has(parsed.data.id)) {
            warnings.push(nextKnown.get(parsed.data.id).kind === parsed.kind ?
              '检测到重复的纸条 ID，已保留先收到的一条。' :
              '检测到不同操作共用了同一个 ID，已保留先收到的一条，请联系作者检查数据。');
            return;
          }
          nextKnown.set(parsed.data.id, parsed);
          groups[parsed.kind].push(parsed.data);
        });
        var link = result.headers && typeof result.headers.get === 'function' ? result.headers.get('link') || '' : '';
        var hasNext = /rel\s*=\s*"next"/i.test(link);
        if (!hasNext) break;
        if (page === MAX_PAGES) throw makeError('纸条超过当前可完整读取的范围（2000 条），请先整理存储后再发送。');
        // Rebuild the endpoint locally instead of forwarding credentials to a Link URL.
      }
      confirmedAppends.forEach(function (record, id) {
        if (nextKnown.has(id)) return;
        nextKnown.set(id, record);
        groups[record.kind].push(record.data);
      });
      knownRecords = nextKnown;
      loaded = true;
      reconciling.forEach(function (id) { uncertainIds.delete(id); });
      return { comments: comments, pins: pins, deletions: deletions, warnings: warnings };
    }

    function load() {
      if (loading) return loading;
      loading = performLoad().finally(function () { loading = null; });
      return loading;
    }

    function append(payload) {
      var clean;
      try {
        if (!isObject(payload)) throw makeError('纸条数据格式不正确。');
        clean = Object.assign({}, payload);
        delete clean._gistCommentId;
        clean = JSON.parse(JSON.stringify(clean));
        var kind = clean.kind === undefined ? 'note' : clean.kind;
        if (!validData(clean, kind)) throw makeError(kind === 'delete' ?
          '删除请求格式不正确：须包含 1–500 个互不重复的留言 ID、身份标识和有效时间，未发送。' :
          '纸条缺少必要字段，未发送。');
        if (!token) throw makeError('尚未配置 Gist 写入凭据，无法递出纸条。');
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : makeError('纸条数据格式不正确。'));
      }
      if (attemptedKinds.has(clean.id) && attemptedKinds.get(clean.id) !== kind) {
        return Promise.reject(makeError('这个 ID 已用于另一种操作，请重新发起当前操作。', { code: 'ID_KIND_CONFLICT' }));
      }
      attemptedKinds.set(clean.id, kind);
      if (pendingAppends.has(clean.id)) return pendingAppends.get(clean.id);
      var task = (async function () {
        if (uncertainIds.has(clean.id)) {
          throw makeError('上次回复是否送达还未确认，请先手动刷新留言，再重试这条回复。', {
            code: 'MANUAL_REFRESH_REQUIRED', uncertain: true
          });
        } else if (!loaded) {
          throw makeError('请先手动刷新并成功读取留言，再发送回复。', { code: 'MANUAL_REFRESH_REQUIRED' });
        }
        if (knownRecords.has(clean.id)) {
          var known = knownRecords.get(clean.id);
          if (known.kind !== kind) throw makeError('这个 ID 已用于另一种操作，请重新发起当前操作。', { code: 'ID_KIND_CONFLICT' });
          return known.data;
        }
        var envelope = { app: APP, version: 1, kind: kind, data: clean };
        try {
          var result = await request(baseUrl + '/comments', 'POST', JSON.stringify({ body: JSON.stringify(envelope) }));
          if (!isObject(result.data) || result.data.id === undefined || result.data.id === null) {
            throw makeError('GitHub 未返回保存确认，请先手动刷新留言，再重试这条回复。', { uncertain: true });
          }
          var saved = Object.assign({}, clean, { _gistCommentId: result.data.id });
          var entry = { kind: kind, data: saved };
          knownRecords.set(clean.id, entry);
          confirmedAppends.set(clean.id, entry);
          return saved;
        } catch (error) {
          if (error.uncertain) uncertainIds.add(clean.id);
          throw error;
        }
      })().finally(function () { pendingAppends.delete(clean.id); });
      pendingAppends.set(clean.id, task);
      return task;
    }

    return { load: load, append: append };
  }

  createStore = createDeskStore;
})(root);

/* Local author signatures. The shared Gist token is never used as identity. */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'observer-desk-author-key-v1';
  var APP = 'observer-desk-author';
  var DOMAIN = APP + ':v1\n';
  var UNSUPPORTED = '当前浏览器不支持安全签名，仍可浏览和留言；请在支持 Web Crypto 的浏览器中启用作者功能。';

  function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function cloneJson(value, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') throw new Error('签名内容必须是有效的 JSON 数据。');
    if (!Array.isArray(value) && !plainObject(value)) throw new Error('签名内容包含不支持的对象。');
    if (Object.getOwnPropertySymbols(value).length) throw new Error('签名内容包含不支持的属性。');
    ancestors = ancestors || new Set();
    if (ancestors.has(value)) throw new Error('签名内容不能循环引用。');
    ancestors.add(value);
    var result = Array.isArray(value) ? [] : {};
    if (Array.isArray(value) && Object.keys(value).length !== value.length) {
      throw new Error('签名数组不能包含空位或额外属性。');
    }
    Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new Error('签名内容包含不安全的属性名。');
      }
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error('签名内容不能包含属性访问器。');
      }
      result[key] = cloneJson(descriptor.value, ancestors);
    });
    ancestors.delete(value);
    return result;
  }

  function canonicalJson(value, topLevel) {
    if (Array.isArray(value)) return '[' + value.map(function (item) { return canonicalJson(item, false); }).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().filter(function (key) {
        return key.charAt(0) !== '_' && !(topLevel && key === 'authorProof');
      }).map(function (key) {
        return JSON.stringify(key) + ':' + canonicalJson(value[key], false);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function encodeBase64Url(bytes) {
    var binary = '';
    for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    return root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeBase64Url(value, length) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('无效的签名或密钥编码。');
    var padded = value.replace(/-/g, '+').replace(/_/g, '/');
    padded += '='.repeat((4 - padded.length % 4) % 4);
    var binary = root.atob(padded);
    var result = Uint8Array.from(binary, function (character) { return character.charCodeAt(0); });
    if (result.length !== length || encodeBase64Url(result) !== value) throw new Error('无效的签名或密钥长度。');
    return result;
  }

  function publicParts(jwk) {
    if (!plainObject(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('作者公钥配置无效。');
    decodeBase64Url(jwk.x, 32);
    decodeBase64Url(jwk.y, 32);
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }

  function createDeskAuth(publicJwk) {
    var configured = publicParts(cloneJson(publicJwk));
    var keyIdentity = configured.crv + '.' + configured.x + '.' + configured.y;
    var cryptoApi = root.crypto;
    var available = Boolean(cryptoApi && cryptoApi.subtle && root.TextEncoder);
    var storage = null;
    try { storage = root.localStorage || null; } catch (_) { /* Memory-only author sessions remain usable. */ }
    var ownerKey = null;
    var persistent = false;
    var epoch = 0;
    var publicKeyPromise = null;

    function requireCrypto() {
      if (!available) throw new Error(UNSUPPORTED);
    }

    function publicKey() {
      requireCrypto();
      if (!publicKeyPromise) {
        publicKeyPromise = cryptoApi.subtle.importKey('jwk', Object.assign({}, configured, {
          ext: true, key_ops: ['verify']
        }), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      }
      return publicKeyPromise;
    }

    function bytes(value) {
      return new root.TextEncoder().encode(value);
    }

    async function validatePrivateFile(file) {
      requireCrypto();
      if (!plainObject(file) || file.app !== APP || file.version !== 1 || !plainObject(file.privateKey)) {
        throw new Error('请选择此书桌的作者密钥文件。');
      }
      var jwk = file.privateKey;
      var parts;
      try { parts = publicParts(jwk); } catch (_) { throw new Error('作者密钥格式无效。'); }
      if (parts.crv !== configured.crv || parts.x !== configured.x || parts.y !== configured.y) {
        throw new Error('这份作者密钥不属于当前书桌。');
      }
      try { decodeBase64Url(jwk.d, 32); } catch (_) { throw new Error('作者密钥缺少有效的私钥。'); }
      var normalized = Object.assign({}, configured, { d: jwk.d, ext: true, key_ops: ['sign'] });
      var imported;
      try {
        imported = await cryptoApi.subtle.importKey('jwk', normalized, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
        // Checking the coordinates alone is insufficient when a file supplies a different private scalar.
        var challenge = bytes(DOMAIN + 'key-check:' + keyIdentity);
        var signature = await cryptoApi.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, imported, challenge);
        var valid = await cryptoApi.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(), signature, challenge);
        if (!valid) throw new Error('mismatch');
      } catch (_) {
        throw new Error('作者密钥无法通过验证，请使用原始密钥文件。');
      }
      return { key: imported, jwk: normalized };
    }

    var initialized = (async function () {
      if (!available || !storage) return;
      var initialEpoch = epoch;
      try {
        var savedText = storage.getItem(STORAGE_KEY);
        if (!savedText) return;
        var saved = cloneJson(JSON.parse(savedText));
        if (saved.publicKeyId !== keyIdentity) return;
        var validated = await validatePrivateFile(saved);
        if (epoch === initialEpoch) {
          ownerKey = validated.key;
          persistent = true;
        }
      } catch (_) { /* A corrupt or unrelated saved key never grants author privileges. */ }
    })();

    async function importKey(jsonOrObject) {
      requireCrypto();
      var operation = ++epoch;
      var file;
      try {
        file = cloneJson(typeof jsonOrObject === 'string' ? JSON.parse(jsonOrObject) : jsonOrObject);
      } catch (_) {
        throw new Error('无法读取作者密钥文件，请选择原始 JSON 文件。');
      }
      var validated = await validatePrivateFile(file);
      if (operation !== epoch) throw new Error('作者设置已改变，请重新导入密钥。');
      ownerKey = validated.key;
      persistent = false;
      if (storage) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify({
            app: APP, version: 1, publicKeyId: keyIdentity, privateKey: validated.jwk
          }));
          persistent = true;
        } catch (_) { /* The caller can surface isPersistent() when the browser blocks storage. */ }
      }
    }

    async function sign(payload) {
      requireCrypto();
      await initialized;
      if (!ownerKey) throw new Error('请先导入作者密钥，再使用作者功能。');
      var copy = cloneJson(payload);
      if (!plainObject(copy)) throw new Error('签名内容必须是一个对象。');
      var signingKey = ownerKey;
      var signingEpoch = epoch;
      var signature = await cryptoApi.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, bytes(DOMAIN + canonicalJson(copy, true)));
      if (signingKey !== ownerKey || signingEpoch !== epoch) throw new Error('作者身份已退出，请重新启用后提交。');
      copy.authorProof = { v: 1, signature: encodeBase64Url(new Uint8Array(signature)) };
      return copy;
    }

    async function verify(payload) {
      if (!available) return false;
      try {
        var copy = cloneJson(payload);
        if (!plainObject(copy) || !plainObject(copy.authorProof)) return false;
        var proof = copy.authorProof;
        if (proof.v !== 1 || Object.keys(proof).sort().join(',') !== 'signature,v') return false;
        var signature = decodeBase64Url(proof.signature, 64);
        return await cryptoApi.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await publicKey(), signature, bytes(DOMAIN + canonicalJson(copy, true)));
      } catch (_) { return false; }
    }

    function forget() {
      ++epoch;
      ownerKey = null;
      persistent = false;
      if (!storage) return;
      try {
        var saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
        if (saved && saved.publicKeyId === keyIdentity) storage.removeItem(STORAGE_KEY);
      } catch (_) { /* Clearing the active in-memory identity still succeeds. */ }
    }

    return {
      ready: available,
      initialized: initialized,
      supported: function () { return available; },
      isOwner: function () { return Boolean(ownerKey); },
      isPersistent: function () { return persistent; },
      importKey: importKey,
      sign: sign,
      verify: verify,
      forget: forget
    };
  }

  createAuth = createDeskAuth;
})(root);

  // Verify the original payload before limiting display fields. These strings
  // are plain text; callers must insert them with textContent, never innerHTML.
  async function prepareFeed(data, auth) {
    data = data || {};
    auth = auth || createAuth(authorPublicKey);
    var list = function (value) { return Array.isArray(value) ? value : []; };
    var text = function (value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; };
    var validId = function (value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 256; };
    var owns = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
    var warnings = list(data.warnings).filter(function (value) { return typeof value === 'string'; }).map(function (value) {
      return value.slice(0, 500);
    });
    var rawById = new Map();
    list(data.comments).forEach(function (raw) {
      if (raw && validId(raw.id) && !rawById.has(raw.id)) rawById.set(raw.id, raw);
    });
    var rawNotes = Array.from(rawById.values());
    var pins = list(data.pins).filter(function (event) {
      return event && validId(event.id) && event.kind === 'pin' &&
        (event.targetId === null || validId(event.targetId)) && Number.isFinite(Date.parse(event.createdAt));
    });
    var deletions = list(data.deletions).filter(function (event) {
      return event && validId(event.id) && event.kind === 'delete' &&
        Number.isFinite(Date.parse(event.createdAt)) && typeof event.ownerId === 'string' &&
        Array.isArray(event.targetIds) && event.targetIds.length > 0 && event.targetIds.length <= 500 &&
        event.targetIds.every(validId) && new Set(event.targetIds).size === event.targetIds.length;
    });
    var supported = Boolean(auth && typeof auth.supported === 'function' && auth.supported());
    if (!supported) warnings.push('此浏览器无法验证作者签名，作者标记和置顶不可用，部分由作者删除的内容可能仍显示。');
    var verified = new Set();
    await Promise.all(rawNotes.concat(pins, deletions).map(async function (payload) {
      if (!supported) return;
      try { if (await auth.verify(payload) === true) verified.add(payload); } catch (_) { /* Invalid proof grants no rights. */ }
    }));
    var notes = rawNotes.map(function (raw) {
      return {
        id: raw.id,
        author: text(raw.author, 64) || '朋友',
        text: text(raw.text, 2000),
        createdAt: Number.isFinite(Date.parse(raw.createdAt)) ? text(raw.createdAt, 80) : '',
        recordTime: text(raw.recordTime, 80) || null,
        parentId: validId(raw.parentId) ? raw.parentId : null,
        rootId: null,
        replies: [],
        verified: verified.has(raw),
        deleted: raw.deleted === true,
        pinned: false,
        ownerId: text(raw.ownerId, 256),
        replyToName: text(raw.replyToName, 64),
        gesture: ['coffee', 'light', 'sit'].indexOf(raw.gesture) >= 0 ? raw.gesture : null
      };
    });
    var byId = new Map(notes.map(function (note) { return [note.id, note]; }));
    deletions.forEach(function (event) {
      event.targetIds.forEach(function (id) {
        var note = byId.get(id);
        var raw = rawById.get(id);
        if (!note) return;
        // Match the observer's existing owner deletion semantics. A malformed
        // author proof must never fall back to visitor deletion privileges.
        if (verified.has(event) || (!owns(event, 'authorProof') && event.ownerId &&
            raw.ownerId === event.ownerId && !note.verified && !owns(raw, 'authorProof'))) note.deleted = true;
      });
    });
    function rootFor(note) {
      var path = [];
      var positions = new Map();
      var current = note;
      while (current.parentId && byId.has(current.parentId)) {
        positions.set(current.id, path.length);
        path.push(current.id);
        if (positions.has(current.parentId)) {
          // A deterministic root keeps malformed cycles visible exactly once.
          var cycle = path.slice(positions.get(current.parentId)).sort();
          return byId.get(cycle[0]);
        }
        current = byId.get(current.parentId);
      }
      return current;
    }
    var roots = [];
    notes.forEach(function (note) {
      var top = rootFor(note);
      note.rootId = top.id;
      if (top === note) roots.push(note);
      else top.replies.push(note);
      if (note.deleted) note.text = '';
    });
    function chronological(a, b) {
      return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.id.localeCompare(b.id);
    }
    roots.forEach(function (note) { note.replies.sort(chronological); });
    var verifiedPins = pins.filter(function (event) { return verified.has(event); }).sort(chronological);
    var lastPin = verifiedPins[verifiedPins.length - 1];
    var pinned = lastPin && byId.get(lastPin.targetId);
    if (pinned && !pinned.deleted && pinned.rootId === pinned.id) pinned.pinned = true;
    roots.sort(function (a, b) { return Number(b.pinned) - Number(a.pinned) || chronological(b, a); });
    return { notes: notes, roots: roots, warnings: Array.from(new Set(warnings)).slice(0, 6) };
  }

  var authorPublicKey = Object.freeze({
    kty: 'EC', crv: 'P-256',
    x: 'WzHApBVS6J9oajVmyLKlUwov-tlvVR2CVgLnLHPTias',
    y: '3gtuqZTrXNWoYf7FkuOexDG2CG2ia65cNRkuCGFj0hU'
  });
  var api = { createStore: createStore, createAuth: function (publicJwk) {
    return createAuth(publicJwk || authorPublicKey);
  }, prepareFeed: prepareFeed, authorPublicKey: authorPublicKey };
  root.TimerFeedbackCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
