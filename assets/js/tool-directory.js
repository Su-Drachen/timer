(() => {
    'use strict';
    // Each tool owns its page and setup flow. The catalog only describes its entry.
    const groups = [
        ['回看与分析', [
            ['备注词条', '看看云端记录里经常出现的词', 'tags', 'sage', 'page1.html'],
            ['时长分析', '配对本机和云端时间，回看每段时长', 'hourglass-half', 'blue', 'page4.html'],
            ['成就徽章', '查看已收集的记录徽章', 'trophy', 'gold', 'page2.html'],
            ['AI 顾问', '与 AI 对话，按需分析记录', 'comments-o', 'violet', 'page5.html']
        ]],
        ['数据管理', [
            ['数据整理', '筛选、编辑和清理本机记录', 'sliders', 'blue', 'page3.html']
        ]]
    ];
    const catalog = document.getElementById('tool-directory');
    for (const [title, entries] of groups) {
        const group = document.createElement('section');
        group.className = 'tool-group';
        const heading = document.createElement('h2');
        heading.textContent = title;
        group.append(heading);
        for (const [name, description, icon, color, page] of entries) {
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
            const arrow = document.createElement('i');
            arrow.className = 'fa fa-angle-right tool-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            link.append(mark, copy, arrow);
            group.append(link);
        }
        catalog.append(group);
    }
})();
