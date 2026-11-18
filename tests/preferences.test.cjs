'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/preferences.js'), 'utf8');
function setup(value, blocked = false) {
    const events = [], window = new EventTarget();
    const storage = {
        getItem() { return value ?? null; },
        setItem(_, next) { if (blocked) throw Error('storage blocked'); value = next; }
    };
    class TestEvent extends Event {
        constructor(type, { detail }) { super(type); this.detail = detail; }
    }
    Object.assign(window, { localStorage: storage, CustomEvent: TestEvent });
    window.addEventListener('timer:preferences-changed', event => events.push(event.detail));
    vm.runInNewContext(source, { window });
    return { window, api: window.TimerPreferences, events };
}
const plain = obj => JSON.parse(JSON.stringify(obj));
test('new, malformed and incomplete preferences use usable defaults', () => {
    for (const raw of [undefined, '{broken', 'null', '[]', '{"quickRecord":"false","timerEnabled":1}', '7']) {
        assert.deepEqual(plain(setup(raw).api.read()), { quickRecord: true, timerEnabled: false, tags: [] });
    }
});
test('partial updates preserve other preferences and normalize up to three unique custom words', () => {
    const { api, events } = setup();
    api.save({ timerEnabled: true, tags: [' 睡前 ', {}, '', '睡前', '☀', '我的词', '多余'] });
    assert.deepEqual(plain(api.read()), { quickRecord: true, timerEnabled: true, tags: ['睡前', '☀', '我的词'] });
    api.save({ quickRecord: false });
    assert.equal(events.length, 2);
    assert.deepEqual(plain(events[1]), { quickRecord: false, timerEnabled: true, tags: ['睡前', '☀', '我的词'] });
    api.save({ tags: [] });
    assert.deepEqual(plain(api.read()), { quickRecord: false, timerEnabled: true, tags: [] });
});
test('settings surface storage failures and notify listeners on cross-tab changes', () => {
    const blocked = setup(undefined, true);
    assert.throws(() => blocked.api.save({ timerEnabled: true }));
    assert.equal(blocked.events.length, 0);
    const { window, events } = setup('{"tags":["新词"]}');
    for (const key of ['unrelated', 'timer.recordPreferences', null]) {
        const event = new Event('storage');
        Object.defineProperty(event, 'key', { value: key });
        window.dispatchEvent(event);
    }
    assert.equal(events.length, 2);
    assert.deepEqual(plain(events[0].tags), ['新词']);
});
