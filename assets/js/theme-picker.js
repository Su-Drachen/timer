(function () {
    'use strict';

    const modes = { system: '跟随系统', light: '浅色', dark: '深色' };
    const decorations = { full: '完整', simple: '简洁' };
    const tabs = { records: '记录', friends: '朋友', tools: '工具', personal: '个人' };
    const same = (a, b) => a.theme === b.theme && a.mode === b.mode && a.decoration === b.decoration;
    const clock = date => date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    function buttons(values, attribute) {
        return Object.entries(values).map(([value, name]) => `<button type="button" data-${attribute}="${value}" aria-pressed="false">${name}</button>`).join('');
    }

    function makePreview(shell) {
        shell.innerHTML = `<div class="theme-demo-body">
            <div data-demo-page="records">
                <div class="theme-demo-screen"><span class="theme-demo-clock-label">现在时间</span><time class="theme-demo-clock"></time><span class="theme-demo-art" aria-hidden="true"></span></div>
                <div class="theme-demo-actions"><button type="button" data-preview-record>＋ 试记一次</button><span data-preview-receipt role="status">仅作演示</span></div>
                <div class="theme-demo-calendar"><strong data-demo-month></strong><div data-demo-grid></div></div>
            </div>
            <div class="theme-demo-other" data-demo-page="friends" hidden><strong>朋友留言</strong><div class="theme-demo-note">今天也给自己留一点时间。</div></div>
            <div class="theme-demo-other" data-demo-page="tools" hidden><strong>工具</strong><div class="theme-demo-note">时长分析<small>本次示例 · 12 分钟</small></div></div>
            <div class="theme-demo-other" data-demo-page="personal" hidden><strong>个人</strong><div class="theme-demo-note">使用偏好<small>快记已开启</small></div></div>
            </div><div class="theme-demo-nav" role="group" aria-label="示例导航">${buttons(tabs, 'preview-tab')}</div>`;
        const grid = shell.querySelector('[data-demo-grid]');
        const receipt = shell.querySelector('[data-preview-receipt]');
        const time = shell.querySelector('time');
        let dayKey = '', trials = 0;
        function tick() {
            const now = new Date();
            time.textContent = clock(now);
            const key = now.toDateString();
            if (key === dayKey) return;
            dayKey = key;
            trials = 0;
            receipt.textContent = '仅作演示';
            const year = now.getFullYear(), month = now.getMonth(), today = now.getDate();
            shell.querySelector('[data-demo-month]').textContent = `${month + 1} 月`;
            const weekdays = Array.from('一二三四五六日', day => `<small aria-hidden="true">${day}</small>`).join('');
            const offset = (new Date(year, month, 1).getDay() + 6) % 7;
            const days = new Date(year, month + 1, 0).getDate();
            const cells = Array.from({ length: days }, (_, i) => {
                const d = i + 1;
                const sample = d === today - 2 || d === today - 5;
                return `<span${d === today ? ' data-demo-today aria-current="date"' : ''}${sample ? ' data-marked' : ''} aria-label="${month + 1}月${d}日${sample ? '，有示例记录' : ''}">${d}</span>`;
            });
            grid.innerHTML = weekdays + '<i aria-hidden="true"></i>'.repeat(offset) + cells.join('');
        }
        function selectTab(id) {
            shell.querySelectorAll('[data-preview-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.previewTab === id)));
            shell.querySelectorAll('[data-demo-page]').forEach(panel => { panel.hidden = panel.dataset.demoPage !== id; });
        }
        shell.querySelectorAll('[data-preview-tab]').forEach(button => {
            const svg = document.querySelector(`#mobile-home-nav [data-page="${button.dataset.previewTab}"] svg`)?.cloneNode(true);
            if (svg) { svg.setAttribute('aria-hidden', 'true'); button.prepend(svg); }
        });
        shell.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.hasAttribute('data-preview-record')) {
                tick();
                trials++;
                receipt.textContent = `示例已记录 · ${time.textContent} · 第 ${trials} 次`;
                const today = grid.querySelector('[data-demo-today]');
                today.setAttribute('data-marked', '');
                today.setAttribute('aria-label', `今天，已试记 ${trials} 次`);
            } else if (button.dataset.previewTab) selectTab(button.dataset.previewTab);
        });
        tick();
        selectTab('records');
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }

    function mount(container) {
        const manager = window.TimerThemes;
        const catalog = manager.list();
        let saved = manager.read(), draft = { ...saved };
        container.innerHTML = `<div class="theme-picker">
            <fieldset><legend>主题</legend><div class="theme-options"></div><p class="theme-description"></p></fieldset>
            <fieldset class="theme-setting"><legend>明暗</legend><div class="theme-segments">${buttons(modes, 'mode')}</div></fieldset>
            <fieldset class="theme-setting" data-decoration-settings><legend>主题装饰</legend><div class="theme-segments">${buttons(decorations, 'decoration')}</div></fieldset>
            <section aria-label="互动预览"><h2>互动预览</h2><div class="theme-demo" data-theme-preview></div></section>
            <div class="theme-apply"><button type="button" class="settings-primary" data-apply-theme>应用主题</button><span role="status" data-apply-status></span></div>
        </div>`;
        const list = container.querySelector('.theme-options');
        catalog.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.themeKey = item.id;
            button.setAttribute('aria-label', item.name);
            button.innerHTML = `<span class="theme-swatch" aria-hidden="true"><span class="theme-swatch-screen"><i></i><i></i><i></i></span><span class="theme-swatch-keys"></span></span><span class="theme-choice-title"></span><small data-applied hidden>使用中</small>`;
            button.querySelector('.theme-choice-title').textContent = item.name;
            list.append(button);
        });
        const shell = container.querySelector('[data-theme-preview]');
        const stopClock = makePreview(shell);
        const apply = container.querySelector('[data-apply-theme]');
        const status = container.querySelector('[data-apply-status]');
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        let saving = false;
        function render() {
            const selected = catalog.find(item => item.id === draft.theme);
            for (const button of list.children) {
                const key = button.dataset.themeKey;
                button.setAttribute('aria-pressed', String(key === draft.theme));
                button.querySelector('[data-applied]').hidden = key !== saved.theme;
                button.setAttribute('aria-label', button.querySelector('.theme-choice-title').textContent + (key === saved.theme ? '，使用中' : ''));
                manager.preview(button.querySelector('.theme-swatch'), { ...draft, theme: key });
            }
            container.querySelector('.theme-description').textContent = selected?.description || '';
            container.querySelector('[data-decoration-settings]').hidden = !selected?.supportsDecoration;
            container.querySelectorAll('button[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === draft.mode)));
            container.querySelectorAll('button[data-decoration]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.decoration === draft.decoration)));
            manager.preview(shell, draft);
            apply.disabled = saving || same(draft, saved);
            apply.textContent = same(draft, saved) ? '已应用' : '应用主题';
        }
        function sync() {
            const dirty = !same(draft, saved);
            saved = manager.read();
            if (!dirty) draft = { ...saved };
            render();
        }
        container.addEventListener('click', async event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button === apply) {
                if (saving || same(draft, saved)) return;
                saving = true;
                render();
                try {
                    await manager.apply({ ...draft });
                    sync();
                    status.textContent = '主题已应用到此设备。';
                } catch (_) { status.textContent = '保存失败，请检查浏览器存储后重试。'; }
                finally { saving = false; render(); }
                return;
            }
            const { themeKey, mode, decoration } = button.dataset;
            if (themeKey) draft.theme = themeKey;
            else if (mode) draft.mode = mode;
            else if (decoration) draft.decoration = decoration;
            else return;
            status.textContent = '';
            render();
        });
        render();
        window.addEventListener('timer:theme-change', sync);
        if (media.addEventListener) media.addEventListener('change', render);
        else media.addListener(render);
        return () => {
            stopClock();
            window.removeEventListener('timer:theme-change', sync);
            if (media.removeEventListener) media.removeEventListener('change', render);
            else media.removeListener(render);
        };
    }
    window.TimerThemePicker = { mount };
})();
