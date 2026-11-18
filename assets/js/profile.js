/* Personal settings for the four-tab home. Sensitive fields are never inserted into markup. */
(function () {
    'use strict';
    const config = window.TimerConfig;
    const sections = {
        cloud: ['云端记录', 'cloud', '在自己的 GitHub Gist 中保存和查看记录。'],
        comments: ['朋友留言', 'comments-o', '连接存放纸条和回复的 Gist，与记录分开管理。'],
        author: ['作者身份', 'key', '在这台设备上导入作者钥匙，可署名回复和管理纸条。'],
        ai: ['AI 服务', 'magic', '使用自己的清言 API 凭据。主动分析时，记录摘要及备注会发送给清言。'],
        appearance: ['外观', 'adjust', '选择此浏览器使用的主题。']
    };
    const themes = { blue: '清新', white: '极简白', dark: '暗夜黑' };
    let view;

    function route() {
        const [path, query = ''] = location.hash.slice(1).split('?');
        const [tab, section] = path.split('/');
        return {
            active: tab === 'personal',
            section: Object.hasOwn(sections, section || '') ? section : '',
            back: config.returnPath(new URLSearchParams(query).get('return'))
        };
    }

    function statuses() {
        const gist = config.read(), ai = config.readAi();
        return {
            cloud: gist.GIST_ID && gist.GITHUB_PAT ? '已配置' : '未配置',
            comments: gist.COMMENT_GIST_ID && gist.GITHUB_PAT ? '已配置' : '未配置',
            author: config.author()?.isOwner() ? '已启用' : '未启用',
            ai: ai.apiKey && ai.apiSecret && ai.assistantId ? '已配置' : '未配置',
            appearance: themes[document.documentElement.dataset.theme] || themes.blue
        };
    }
    function row(key, state) {
        const [name, icon] = sections[key];
        return `<a class="settings-row" href="#personal/${key}"><span class="settings-icon"><i class="fa fa-${icon}" aria-hidden="true"></i></span><span class="settings-copy"><strong>${name}</strong></span><span class="settings-state" data-state="${key}">${state}</span><i class="fa fa-angle-right" aria-hidden="true"></i></a>`;
    }
    function overview() {
        const states = statuses();
        view.innerHTML = `<div class="profile-page"><header class="profile-header"><span class="profile-mark" aria-hidden="true"><i class="fa fa-user-o"></i></span><h1>个人</h1><p>当前设备 · 时间笔记</p></header>
            <section class="settings-group"><h2>功能连接</h2>${['cloud', 'comments', 'ai'].map(key => row(key, states[key])).join('')}</section>
            <section class="settings-group"><h2>偏好设置</h2>${row('author', states.author)}${row('appearance', states.appearance)}
                <a class="settings-row" href="page0.html"><span class="settings-icon"><i class="fa fa-book" aria-hidden="true"></i></span><span class="settings-copy"><strong>进阶指南</strong></span><i class="fa fa-angle-right" aria-hidden="true"></i></a>
            </section></div>`;
    }

    function field(id, label, type = 'text') {
        return `<label for="profile-${id}">${label}<input id="profile-${id}" name="${id}" type="${type}" spellcheck="false" autocapitalize="none" autocomplete="off"></label>`;
    }
    function errorText(text) {
        const status = view.querySelector('.settings-status');
        if (status) status.textContent = text;
    }
    function finish(back, message) {
        window.showToast?.(message, 'success');
        location.assign(back || '#personal');
    }
    function bindField(form, name, value, secret = false) {
        const input = form.elements.namedItem(name);
        if (secret && value) input.placeholder = '已保存，留空保留';
        else input.value = value || '';
        input.required = !secret || !value;
    }
    function changed(section, previous) {
        const next = config.read();
        const cloudChanged = ['GIST_ID', 'GITHUB_USERNAME', 'GITHUB_PAT'].some(key => previous[key] !== next[key]);
        window.dispatchEvent(new CustomEvent('timer:feedback-config', { detail: { section, cloudChanged } }));
    }

    function settingsForm(section, container, back) {
        const isAi = section === 'ai', isCloud = section === 'cloud';
        const current = isAi ? config.readAi() : config.read();
        const gistKey = isCloud ? 'GIST_ID' : 'COMMENT_GIST_ID';
        const inputs = isAi
            ? field('key', 'API Key', 'password') + field('secret', 'API Secret', 'password') + field('assistant', 'Assistant ID')
            : field('username', 'GitHub 用户名') + field('gist', isCloud ? '记录 Gist ID' : '留言 Gist ID') + field('token', 'GitHub 访问令牌（PAT）', 'password');
        const otherGistKey = isCloud ? 'COMMENT_GIST_ID' : 'GIST_ID';
        const hasSaved = isAi ? current.apiKey || current.apiSecret :
            current[gistKey] || (!current[otherGistKey] && (current.GITHUB_USERNAME || current.GITHUB_PAT));
        container.innerHTML = `<form class="settings-form">${inputs}<p class="settings-help">${isAi ? '凭据保存在当前浏览器。' : 'GitHub 用户名和访问令牌由云端记录与朋友留言共用。'}</p><div class="settings-actions"><button class="settings-primary" type="submit">保存配置</button>
            ${hasSaved ? '<button class="settings-secondary" type="button" data-clear>移除此配置</button>' : ''}</div></form>`;
        const form = container.querySelector('form');
        if (isAi) {
            bindField(form, 'key', current.apiKey, true);
            bindField(form, 'secret', current.apiSecret, true);
            bindField(form, 'assistant', current.assistantId);
        } else {
            bindField(form, 'username', current.GITHUB_USERNAME);
            bindField(form, 'gist', current[gistKey]);
            form.elements.gist.pattern = '[a-fA-F0-9]{5,64}';
            form.elements.gist.title = '请输入 Gist ID，例如链接末尾的十六进制字符串。';
            bindField(form, 'token', current.GITHUB_PAT, true);
        }
        form.addEventListener('submit', event => {
            event.preventDefault();
            const value = name => form.elements.namedItem(name).value.trim();
            try {
                if (isAi) {
                    const saved = config.readAi();
                    const ai = { apiKey: value('key') || saved.apiKey, apiSecret: value('secret') || saved.apiSecret, assistantId: value('assistant') };
                    if (!ai.apiKey || !ai.apiSecret || !ai.assistantId) return errorText('请填写完整的 AI 服务信息。');
                    config.saveAi(ai);
                } else {
                    const previous = config.read(), token = value('token') || previous.GITHUB_PAT;
                    if (!token || !value('username') || !config.isGistId(value('gist'))) return errorText('请检查用户名、Gist ID 和访问令牌。');
                    const patch = { GITHUB_USERNAME: value('username'), [gistKey]: value('gist') };
                    if (value('token')) patch.GITHUB_PAT = token;
                    config.saveGist(patch);
                    changed(section, previous);
                }
                finish(back, '配置已保存');
            } catch (_) { errorText('配置保存失败，请检查浏览器的存储权限后重试。'); }
        });
        form.querySelector('[data-clear]')?.addEventListener('click', () => {
            if (!window.confirm(`移除此设备的${sections[section][0]}配置？`)) return;
            try {
                if (isAi) config.saveAi({});
                else {
                    const previous = config.read(), patch = { [gistKey]: '' };
                    if (!previous[otherGistKey]) Object.assign(patch, { GITHUB_USERNAME: '', GITHUB_PAT: '' });
                    config.saveGist(patch);
                    changed(section, previous);
                }
                finish(back, '配置已移除');
            } catch (_) { errorText('配置移除失败，请重试。'); }
        });
    }

    function authorControls(container, back) {
        if (!config.author()?.supported()) { container.textContent = '此浏览器不支持作者签名。'; return; }
        container.innerHTML = `<div class="settings-form"><label for="profile-author-key">作者钥匙文件（JSON）<input type="file" id="profile-author-key" accept=".json,application/json"></label>
            <div class="settings-actions"><button type="button" class="settings-secondary" data-forget>退出作者身份</button></div></div>`;
        const fileInput = container.querySelector('input'), forget = container.querySelector('button');
        forget.hidden = !config.author().isOwner();
        fileInput.onchange = async () => {
            const file = fileInput.files[0];
            if (!file) return;
            fileInput.disabled = true; forget.disabled = true;
            try {
                const key = await file.text();
                const auth = config.author();
                await auth.importKey(key);
                if (auth !== config.author()) return errorText('作者身份已更新，请重新选择文件。');
                window.dispatchEvent(new Event('timer:author-change'));
                if (container.isConnected) finish(back, auth.isPersistent() ? '作者身份已启用' : '作者身份已在本次打开期间启用');
            } catch (_) { if (container.isConnected) errorText('钥匙验证失败，请选择这张书桌对应的作者 JSON 文件。'); }
            finally { fileInput.value = ''; fileInput.disabled = false; forget.disabled = false; }
        };
        forget.onclick = () => {
            if (!window.confirm('退出此设备的作者身份？')) return;
            config.author().forget();
            window.dispatchEvent(new Event('timer:author-change'));
            finish(back, '已退出作者身份');
        };
    }

    function themeControls(container) {
        container.innerHTML = `<div class="settings-themes">${Object.entries(themes).map(([key, name]) => `<button type="button" class="settings-secondary" data-theme-key="${key}" aria-pressed="${document.documentElement.dataset.theme === key}">${name}</button>`).join('')}</div>`;
        container.addEventListener('click', event => {
            const key = event.target.closest('button')?.dataset.themeKey;
            if (!Object.hasOwn(themes, key)) return;
            window.switchTheme(key);
            container.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeKey === key)));
        });
    }
    function syncAuthorState() {
        const { active, section } = route();
        if (!active || (section && section !== 'author')) return;
        const auth = config.author();
        if (!auth) return;
        Promise.resolve(auth.initialized).then(() => {
            if (config.author() !== auth) return;
            const state = view.querySelector('[data-state="author"]'), forget = view.querySelector('[data-forget]');
            if (state) state.textContent = auth.isOwner() ? '已启用' : '未启用';
            if (forget) forget.hidden = !auth.isOwner();
        });
    }
    function show() {
        if (!view) return;
        const { active, section, back } = route();
        if (!active) { view.replaceChildren(); return; }
        if (!section) overview();
        else {
            const [name, , help] = sections[section];
            view.innerHTML = `<div class="profile-page settings-detail"><a class="settings-back" href="${back || '#personal'}"><i class="fa fa-angle-left" aria-hidden="true"></i> ${back ? '返回原功能' : '个人'}</a><h1>${name}</h1><p>${help}</p><div data-controls></div><p role="status" class="settings-status"></p></div>`;
            const container = view.querySelector('[data-controls]');
            if (section === 'author') authorControls(container, back);
            else if (section === 'appearance') themeControls(container);
            else settingsForm(section, container, back);
        }
        syncAuthorState();
    }
    function mount() {
        view = document.getElementById('home-profile-view');
        if (!view) return;
        window.addEventListener('hashchange', show);
        window.addEventListener('timer:author-change', syncAuthorState);
        window.addEventListener('storage', () => {
            const { active, section } = route();
            if (active && !section) show();
        });
        show();
    }
    window.TimerProfile = { show };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
})();
