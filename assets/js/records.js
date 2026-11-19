// --- 通用工具函数 ---
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    toastMessage.textContent = message;
    toastIcon.className = 'fa ' + (type === 'success' ? 'fa-check-circle text-green-400' : type === 'error' ? 'fa-times-circle text-red-400' : 'fa-info-circle text-blue-400');

    toast.classList.remove('opacity-0', 'translate-y-10');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 2800);
}

let lastMetricsMinute;
function updateAllCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    document.getElementById('local-current-time').textContent = timeString;
    document.getElementById('gist-current-time').textContent = timeString;
    refreshTimers(now);
    const minute = Math.floor(now.getTime() / 60000);
    if (minute !== lastMetricsMinute) {
        lastMetricsMinute = minute;
        for (const [source, app] of [['local', localApp], ['gist', gistApp]]) {
            if (!app.calendar) continue;
            app.calendar.refreshToday(now);
            updateRecordMetrics(source, app.calendar.index, now);
        }
    }
}

function formatRecordTime(date = new Date()) {
    return RecordEntries.format(date);
}

function parseRecordDate(value) {
    return RecordEntries.parse(value);
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
}

function parseStoredJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`无法读取 ${key}，已使用空数据`, error);
        return fallback;
    }
}

function safeSetStorage(storage, key, value) {
    try {
        storage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`无法保存 ${key}`, error);
        showToast('浏览器存储空间不可用，请检查隐私设置', 'error');
        return false;
    }
}

function parseCsvRows(content) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = String(content || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        const next = source[i + 1];
        if (char === '"' && quoted && next === '"') {
            field += '"';
            i++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(field);
            field = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && next === '\n') i++;
            row.push(field);
            if (row.some(cell => cell.trim() !== '')) rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field || row.length) {
        row.push(field);
        if (row.some(cell => cell.trim() !== '')) rows.push(row);
    }
    return rows;
}

function parseRecordCsv(content) {
    return RecordEntries.fromRows(parseCsvRows(content));
}

function updateRecordMetrics(version, index, now = new Date()) {
    const summary = RecordCalendar.metrics(index, now);
    document.getElementById(version + '-today-count').textContent = summary.today;
    document.getElementById(version + '-week-count').textContent = summary.week;
    document.getElementById(version + '-last-record').textContent = summary.elapsed;
}

let pendingConfirmAction = null;

function syncModalLock() {
    const open = ['record-modal-overlay', 'confirm-modal-overlay', 'edit-modal-overlay']
        .some(id => !document.getElementById(id).classList.contains('hidden'));
    document.body.classList.toggle('overflow-hidden', open);
    window.dispatchEvent(new CustomEvent('timer:feedback-modal', { detail: { open } }));
}

function showAppDialog(id, onClose, initialFocus) {
    const dialog = document.getElementById(id);
    dialog.classList.remove('hidden');
    syncModalLock();
    window.TimerMobile?.openDialog(dialog, { onClose, initialFocus });
}

function hideAppDialog(id) {
    const dialog = document.getElementById(id);
    dialog.classList.add('hidden');
    syncModalLock();
    window.TimerMobile?.closeDialog(dialog);
}

let recordDraft;
let editTarget;

function fillTags(containerId, inputId) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    container.replaceChildren();
    for (const tag of preferences().tags) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tag;
        button.addEventListener('click', () => {
            input.value = [input.value.trim(), tag].filter(Boolean).join(' ').slice(0, input.maxLength);
        });
        container.appendChild(button);
    }
}

function openRecordModal(version, entry, day = '') {
    recordDraft = { version, entry, day, connection: appFor(version).config };
    document.getElementById('record-version').value = version;
    document.getElementById('record-modal-title').textContent = day ? '补记这天' : '记录此刻';
    document.getElementById('record-time-preview').textContent = entry.time;
    document.getElementById('record-frozen-time').hidden = !!day;
    document.getElementById('record-backfill-fields').hidden = !day;
    document.getElementById('record-date').value = day;
    document.getElementById('record-clock-input').value = entry.time.slice(-8);
    document.getElementById('record-remark').value = '';
    fillTags('record-tags', 'record-remark');
    showAppDialog('record-modal-overlay', closeRecordModal, day ? '#record-clock-input' : '#record-remark');
}

function closeRecordModal() {
    recordDraft = null;
    hideAppDialog('record-modal-overlay');
}

function openConfirmModal(callback, message = '删除后无法恢复，请确认继续。', title = '删除这条记录？') {
    pendingConfirmAction = callback;
    document.getElementById('confirm-modal-title').textContent = title;
    document.getElementById('confirm-action-btn').textContent = title === '取消这次计时？' ? '确认取消计时' : '确认删除';
    document.getElementById('confirm-modal-message').textContent = message;
    showAppDialog('confirm-modal-overlay', closeConfirmModal, '#cancel-confirm-btn');
}

function closeConfirmModal() {
    pendingConfirmAction = null;
    hideAppDialog('confirm-modal-overlay');
}

function openEditModal(version, index) {
    const app = version === 'local' ? localApp : gistApp;
    const record = app.records[index];
    if (!record) return;
    editTarget = { record: { ...record }, connection: app.config, occurrence: occurrenceAt(app.records, index) };
    document.querySelector('label[for="edit-time"]').textContent = record.endTime ? '开始时间' : '记录时间';
    document.getElementById('edit-end-field').hidden = !record.endTime;
    document.getElementById('edit-end').value = record.endTime || '';
    document.getElementById('edit-version').value = version;
    document.getElementById('edit-index').value = index;
    document.getElementById('edit-time').value = record.time;
    document.getElementById('edit-remark').value = record.remark || '';
    fillTags('edit-tags', 'edit-remark');
    showAppDialog('edit-modal-overlay', closeEditModal, '#edit-remark');
}

function closeEditModal() {
    editTarget = null;
    hideAppDialog('edit-modal-overlay');
}

function openGistConfig() {
    window.location.hash = 'personal/cloud?return=records';
}

function updateYearOptions(source, app) {
    const select = document.getElementById(source + '-year-select');
    const currentRealYear = new Date().getFullYear();
    const yearsSet = new Set([currentRealYear]);

    app.records.forEach(r => {
        const parsed = parseRecordDate(r.time);
        const y = parsed ? parsed.getFullYear() : NaN;
        if (!isNaN(y)) yearsSet.add(y);
    });

    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
    select.innerHTML = sortedYears.map(y => `<option value="${y}" ${y === app.selectedYear ? 'selected' : ''}>${y} 年</option>`).join('');
}

function updateStatistics(source, app) {
    const yearRecords = app.records.filter(r => parseRecordDate(r.time)?.getFullYear() === app.selectedYear);

    document.getElementById(source + '-summary-label').textContent = `${app.selectedYear} 年记录`;
    document.getElementById(source + '-summary-value').textContent = `${yearRecords.length} 条`;

    const monthlyCounts = Array(12).fill(0);
    yearRecords.forEach(r => {
        const parsed = parseRecordDate(r.time);
        const m = parsed ? parsed.getMonth() : NaN;
        if (!isNaN(m)) monthlyCounts[m]++;
    });

    const ctx = document.getElementById(source + '-records-chart').getContext('2d');
    if (app.recordsChart) app.recordsChart.destroy();

    const computedStyle = getComputedStyle(document.documentElement);
    const chartBorder = computedStyle.getPropertyValue('--chart-border').trim() || '#165DFF';
    const chartBg = computedStyle.getPropertyValue('--chart-bg').trim() || 'rgba(22, 93, 255, 0.15)';
    const textSub = computedStyle.getPropertyValue('--text-sub').trim() || '#86909C';

    app.recordsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
            datasets: [{
                label: '记录条数',
                data: monthlyCounts,
                backgroundColor: chartBg,
                borderColor: chartBorder,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 550, easing: 'easeOutQuart' },
            scales: {
                x: { grid: { display: false }, ticks: { color: textSub, font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { stepSize: 1, color: textSub, font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.08)' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { displayColors: false, padding: 10, cornerRadius: 10, callbacks: { label: context => ` ${context.parsed.y} 条` } }
            }
        }
    });
}

function renderSharedRecords(version, app) {
    app.records.sort((a, b) => (parseRecordDate(b.time)?.getTime() || 0) - (parseRecordDate(a.time)?.getTime() || 0));
    if (!app.calendar) {
        app.calendar = RecordCalendar.mount(document.getElementById(version + '-calendar'), () => renderRecordList(version, app));
    }
    app.calendar.update(app.records, parseRecordDate);
    renderRecordList(version, app);
    updateYearOptions(version, app);
    updateStatistics(version, app);
    updateRecordMetrics(version, app.calendar.index);
}

function renderRecordList(version, app) {
    const prefix = version;
    const container = document.getElementById(`${prefix}-records-container`);
    const badge = document.getElementById(`${prefix}-record-count-badge`);
    const expandWrapper = document.getElementById(`${prefix}-expand-wrapper`);
    const expandBtn = document.getElementById(`${prefix}-expand-btn`);

    const selected = app.calendar.selected;
    const chosenIndices = app.calendar.index.byDay.get(selected) || [];
    const count = selected ? chosenIndices.length : app.records.length;
    document.getElementById(prefix + '-backfill').hidden = !selected;
    document.getElementById(prefix + '-list-title').textContent = selected ? selected.slice(5).replace('-', '/') + ' 记录' : '全部记录';
    badge.textContent = count;

    if (count === 0) {
        const emptyText = selected ? '这一天还没有记录' : (version === 'gist' ? '云端暂无记录' : '暂无本地记录');
        container.innerHTML = `<p class="text-center py-6 text-xs opacity-50">${emptyText}</p>`;
        container.className = 'space-y-2.5 custom-scrollbar';
        expandWrapper.classList.add('hidden');
        return;
    }

    container.className = app.isExpanded && !selected
        ? 'space-y-2.5 max-h-72 overflow-y-auto pr-1.5 custom-scrollbar'
        : 'space-y-2.5 custom-scrollbar';

    const indices = selected ? chosenIndices : Array.from({ length: app.isExpanded ? count : Math.min(3, count) }, (_, i) => i);
    container.innerHTML = indices.map(idx => {
        const item = app.records[idx];
        const time = escapeHTML(selected ? (parseRecordDate(item.time) ? formatRecordTime(parseRecordDate(item.time)).slice(-8) : item.time) : item.time);
        const remark = escapeHTML(item.remark || '无备注');
        const session = item.endTime && Number.isFinite(item.durationSeconds)
            ? `<p class="text-xs">至 ${escapeHTML(item.endTime)} · 用时 ${RecordEntries.duration(item.durationSeconds)}</p>` : '';
        return `
            <div class="record-item flex items-center justify-between p-3 rounded-xl border transition-all" style="border-color: var(--border-color); background-color: var(--bg-card);">
                <div class="min-w-0 flex-1 pr-2">
                    <p class="text-xs sm:text-sm font-semibold font-mono tracking-tight">${time}</p>
                    ${session}
                    <p class="text-xs opacity-60 truncate mt-0.5" title="${remark}">${remark}</p>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="openEditModal('${version}', ${idx})" aria-label="编辑记录" title="编辑" class="icon-btn w-8 h-8 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-blue-500/10 text-blue-500"><i class="fa fa-pencil text-xs"></i></button>
                    <button onclick="${version}App.handleDeleteRecord(${idx})" aria-label="删除记录" title="删除" class="icon-btn w-8 h-8 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-500/10 text-red-500"><i class="fa fa-trash-o text-xs"></i></button>
                </div>
            </div>`;
    }).join('');

    if (!selected && app.records.length > 3) {
        expandWrapper.classList.remove('hidden');
        expandBtn.innerHTML = app.isExpanded
            ? '<span>收起</span><i class="fa fa-chevron-up text-[10px]"></i>'
            : `<span>展开全部数据 (${app.records.length}条)</span><i class="fa fa-chevron-down text-[10px]"></i>`;
    } else {
        expandWrapper.classList.add('hidden');
    }

}

// --- 本地版 (Local) 核心逻辑 ---
const localApp = {
    records: [],
    recordsChart: null,
    isExpanded: false,
    selectedYear: new Date().getFullYear(),

    init() {
        this.loadRecordsFromLocal();
        bindSource('local');
        document.getElementById('local-expand-btn').addEventListener('click', () => {
            this.isExpanded = !this.isExpanded;
            this.renderRecords();
        });
        document.getElementById('local-year-select').addEventListener('change', (e) => {
            this.selectedYear = parseInt(e.target.value, 10);
            updateStatistics('local', this);
        });
    },

    loadRecordsFromLocal() {
        const saved = parseStoredJson('timeRecords', []);
        this.records = Array.isArray(saved) ? saved : [];
        this.renderRecords();
    },

    handleDeleteRecord(index) { confirmDeletion('local', index); },

    renderRecords() {
        return renderSharedRecords('local', this);
    }
};


// --- 云端版 (Gist) 核心逻辑 ---
const gistApp = {
    isInitialized: false,
    isLoading: false, // 增加加载状态标识
    config: {},
    records: [],
    recordsChart: null,
    isExpanded: false,
    selectedYear: new Date().getFullYear(),

    init() {
        this.refreshConnection();
        bindSource('gist');
        document.getElementById('gist-config-open-btn').addEventListener('click', openGistConfig);
        document.getElementById('gist-expand-btn').addEventListener('click', () => {
            this.isExpanded = !this.isExpanded;
            this.renderRecords();
        });
        document.getElementById('gist-year-select').addEventListener('change', (e) => {
            this.selectedYear = parseInt(e.target.value, 10);
            updateStatistics('gist', this);
        });
    },

    hasConnection() {
        return !!(this.config.GIST_ID && this.config.GITHUB_PAT);
    },

    refreshConnection() {
        this.receipt = null;
        paintReceipt('gist');
        this.config = window.TimerConfig.read();
        this.canWrite = false;
        this.records = [];
        this.isLoading = false;
        this.renderRecords();
        this.loadRecordsFromGist();
    },

    async fetchDirectFromApi(config = this.config) {
        const res = await fetch(`https://api.github.com/gists/${config.GIST_ID}`, {
            headers: {
                'Authorization': `token ${config.GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `API 请求错误 (${res.status})`);
        }
        const data = await res.json();
        if (!data.files || data.truncated) throw new Error('未能读取完整的 Gist 文件列表');
        const file = data.files['records.json'];
        if (!file) return [];
        if (file.truncated || typeof file.content !== 'string') throw new Error('未能读取完整的记录文件');
        if (!file.content.trim()) return [];
        try {
            const parsed = JSON.parse(file.content);
            if (!Array.isArray(parsed)) throw new Error();
            return parsed;
        } catch (error) {
            throw new Error('云端记录格式无效');
        }
    },

    async loadRecordsFromGist() {
        const connection = this.config;
        if (!this.config.GIST_ID || !this.config.GITHUB_PAT) {
            document.getElementById('gist-records-container').innerHTML = '<p class="text-center py-6 text-xs opacity-50">请到个人页连接云端记录</p>';
            const status = document.getElementById('gist-sync-status');
            if (status) status.innerHTML = '<span class="status-dot" style="background:#F59E0B"></span>未配置';
            return;
        }
        this.isLoading = true;
        const status = document.getElementById('gist-sync-status');
        if (status) status.innerHTML = '<i class="fa fa-refresh fa-spin"></i>同步中';
        showToast("正在连接云端同步数据...", "info");
        try {
            const data = await this.fetchDirectFromApi(connection);
            if (connection !== this.config) return;
            this.records = Array.isArray(data) ? data : [];
            this.canWrite = true;
            this.renderRecords();
            if (status) status.innerHTML = '<span class="status-dot"></span>已同步';
            showToast("云端同步完成！", "success");
        } catch (error) {
            if (connection !== this.config) return;
            console.error(error);
            showToast(`同步失败: ${error.message}`, "error");
            this.renderRecords();
            if (status) {
                status.innerHTML = '<button type="button" class="cloud-retry">读取失败 · 重试</button>';
                status.firstElementChild.addEventListener('click', () => this.loadRecordsFromGist(), { once: true });
            }
        } finally {
            if (connection === this.config) this.isLoading = false;
        }
    },

    async saveAndVerify(targetRecords) {
        const connection = this.config;
        if (!this.config.GIST_ID || !this.config.GITHUB_PAT) {
            throw new Error("云端账号配置缺失");
        }
        if (!this.canWrite) throw new Error("请先成功读取当前云端记录");
        const jsonContent = JSON.stringify(targetRecords, null, 2);

        const res = await fetch(`https://api.github.com/gists/${this.config.GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${this.config.GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: { 'records.json': { content: jsonContent } }
            })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `上传失败 (${res.status})`);
        }

        const verified = await this.fetchDirectFromApi(connection);
        if (connection !== this.config) throw new Error("云端连接已更改，请查看当前连接的记录");
        if (JSON.stringify(verified) !== JSON.stringify(targetRecords)) {
            throw new Error("云端与本地校验不一致，正在重新确认");
        }
        return verified;
    },

    handleDeleteRecord(index) { confirmDeletion('gist', index); },

    renderRecords() {
        return renderSharedRecords('gist', this);
    }
};

// --- 启动初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('timer:theme-change', () => {
        if (localApp.recordsChart) updateStatistics('local', localApp);
        if (gistApp.recordsChart) updateStatistics('gist', gistApp);
    });
    localApp.init();
    updateAllCurrentTime();
    setInterval(updateAllCurrentTime, 1000);

    const tabLocal = document.getElementById('tab-local');
    const tabGist = document.getElementById('tab-gist');
    const contentLocal = document.getElementById('content-local');
    const contentGist = document.getElementById('content-gist');

    tabLocal.addEventListener('click', () => {
        tabLocal.classList.add('active');
        tabGist.classList.remove('active');
        tabLocal.setAttribute('aria-selected', 'true');
        tabGist.setAttribute('aria-selected', 'false');
        contentLocal.classList.remove('hidden');
        contentGist.classList.add('hidden');
    });

    tabGist.addEventListener('click', () => {
        tabGist.classList.add('active');
        tabLocal.classList.remove('active');
        tabGist.setAttribute('aria-selected', 'true');
        tabLocal.setAttribute('aria-selected', 'false');
        contentGist.classList.remove('hidden');
        contentLocal.classList.add('hidden');

        if (!gistApp.isInitialized) {
            gistApp.init();
            gistApp.isInitialized = true;
        }
    });

    window.addEventListener('storage', event => {
        if (event.key === 'timeRecords' || event.key === null) localApp.loadRecordsFromLocal();
        refreshTimers();
    });
    window.addEventListener('timer:preferences-changed', () => refreshTimers());

    const pageParams = new URLSearchParams(window.location.search);
    if (pageParams.get('tab') === 'gist') {
        tabGist.click();
        history.replaceState(null, '', window.location.pathname + window.location.hash);
        if (pageParams.get('config') === '1') openGistConfig();
    }

    document.getElementById('record-form').addEventListener('submit', submitDraft);

    ['cancel-record-btn', 'cancel-record-btn-secondary'].forEach(id => {
        document.getElementById(id).addEventListener('click', closeRecordModal);
    });
    document.getElementById('record-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeRecordModal();
    });

    document.getElementById('confirm-action-btn').addEventListener('click', async () => {
        const action = pendingConfirmAction;
        closeConfirmModal();
        if (action) await action();
    });
    document.getElementById('cancel-confirm-btn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeConfirmModal();
    });

    document.getElementById('edit-form').addEventListener('submit', submitEdit);

    document.getElementById('cancel-edit-btn').addEventListener('click', closeEditModal);
    document.getElementById('close-edit-btn').addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditModal();
    });
    window.addEventListener('timer:feedback-config', event => {
        if (gistApp.isInitialized && event.detail?.cloudChanged !== false) gistApp.refreshConnection();
    });

    document.getElementById('csv-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const version = document.querySelector('.tab-btn.active').id === 'tab-local' ? 'local' : 'gist';
        const connection = appFor(version).config;
        file.text().then(content => importCsv(version, content, connection)).catch(error => showToast(error.message, 'error'));
        e.target.value = '';

    });
});
