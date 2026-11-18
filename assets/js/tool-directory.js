(() => {
    'use strict';
    // Each tool owns its page and setup flow. The catalog only describes its entry.
    const groups = [
        ['回看与分析', [
            ['备注词条', '看看云端记录里经常出现的词', 'tags', 'sage', 'page1.html'],
            ['时长分析', '回看实际计时与历史配对估算', 'hourglass-half', 'blue', 'page4.html'],
            ['成就徽章', '查看已收集的记录徽章', 'trophy', 'gold', 'page2.html'],
            ['AI 顾问', '与 AI 对话，按需分析记录', 'comments-o', 'violet', 'page5.html']
        ]],
        ['数据管理', [
            ['数据整理', '筛选、编辑和清理本机记录', 'sliders', 'blue', 'page3.html']
        ]]
    ];
    const catalog = document.getElementById('tool-directory');
    const storageKey = 'timer.pinnedTool';
    const entriesByPage = new Map(groups.flatMap(([, entries]) => entries.map(entry => [entry[4], entry])));
    function makeGroup(title, entries, pinned) {
        const group = document.createElement('section');
        group.className = 'tool-group';
        const heading = document.createElement('h2');
        heading.textContent = title;
        group.append(heading);
        for (const [name, description, icon, color, page] of entries) {
            const entry = document.createElement('div');
            entry.className = 'tool-entry';
            const link = document.createElement('a');
            link.className = 'tool-card';
            link.href = page;
            const mark = document.createElement('span');
            mark.className = 'tool-mark ' + color;
            mark.setAttribute('aria-hidden', 'true');
            const symbol = document.createElement('i');
            symbol.className = 'fa fa-' + icon;
            mark.append(symbol);
            const copy = document.createElement('span');
            copy.className = 'tool-copy';
            const label = document.createElement('strong');
            label.textContent = name;
            const note = document.createElement('small');
            note.textContent = description;
            copy.append(label, note);
            link.append(mark, copy);
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'tool-pin';
            pin.dataset.pin = page;
            pin.setAttribute('aria-label', '置顶' + name);
            pin.setAttribute('aria-pressed', String(page === pinned));
            pin.title = (page === pinned ? '取消置顶' : '置顶') + name;
            pin.innerHTML = '<i class="fa fa-thumb-tack" aria-hidden="true"></i>';
            entry.append(link, pin);
            group.append(entry);
        }
        return group;
    }
    function readPin() {
        try { return localStorage.getItem(storageKey); }
        catch (_) { return null; }
    }
    function render() {
        const focusedPin = catalog.contains(document.activeElement) ? document.activeElement.dataset.pin : null;
        const pinned = readPin(), fragment = document.createDocumentFragment();
        if (entriesByPage.has(pinned)) fragment.append(makeGroup('已置顶', [entriesByPage.get(pinned)], pinned));
        for (const [title, entries] of groups) {
            const remaining = entries.filter(entry => entry[4] !== pinned);
            if (remaining.length) fragment.append(makeGroup(title, remaining, pinned));
        }
        catalog.replaceChildren(fragment);
        if (focusedPin && entriesByPage.has(focusedPin)) catalog.querySelector(`[data-pin="${focusedPin}"]`)?.focus();
    }
    catalog.addEventListener('click', event => {
        const pin = event.target.closest('[data-pin]');
        if (!pin || !entriesByPage.has(pin.dataset.pin)) return;
        try {
            if (readPin() === pin.dataset.pin) localStorage.removeItem(storageKey);
            else localStorage.setItem(storageKey, pin.dataset.pin);
            render();
        } catch (_) { window.showToast?.('无法保存置顶设置，请检查浏览器存储权限。', 'error'); }
    });
    window.addEventListener('storage', event => {
        if (event.key === null || event.key === storageKey) render();
    });
    render();
})();
