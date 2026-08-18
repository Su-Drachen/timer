/**
 * record.js - 记录列表管理模块
 * 负责记录的增删改查 UI 渲染、自适应收起/固定高度滑动展开、CSV 导入与导出
 */

const RecordManager = {
    isExpanded: {
        local: false,
        gist: false
    },

    init() {
        this.bindEvents();
        // 订阅数据变更以自动重绘
        DataStore.subscribe((version) => {
            this.render(version);
        });
    },

    bindEvents() {
        // --- 本地版事件绑定 ---
        document.getElementById('local-record-btn').addEventListener('click', () => {
            const remark = prompt("请输入本次记录的备注（可选）：", "");
            if (remark === null) return AppUI.showToast("已取消记录", "info");
            DataStore.addLocalRecord(remark);
            AppUI.showToast("已记录当前时间 (本地)", "success");
        });

        document.getElementById('local-expand-btn').addEventListener('click', () => {
            this.isExpanded.local = !this.isExpanded.local;
            this.render('local');
        });

        document.getElementById('local-download-btn').addEventListener('click', () => {
            this.exportCsv('local');
        });

        document.getElementById('local-import-btn').addEventListener('click', () => {
            document.getElementById('csv-file-input').click();
        });

        // --- 云端版事件绑定 ---
        document.getElementById('gist-record-btn').addEventListener('click', async () => {
            const remark = prompt("请输入本次记录的备注（可选）：", "");
            if (remark === null) return AppUI.showToast("已取消操作", "info");

            const btn = document.getElementById('gist-record-btn');
            const originHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i><span>云端保存校验中...</span>';

            try {
                await DataStore.addGistRecord(remark);
                AppUI.showToast("云端已成功保存并完成验证！", "success");
            } catch (error) {
                AppUI.showToast(`保存失败: ${error.message}`, "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = originHtml;
            }
        });

        document.getElementById('gist-expand-btn').addEventListener('click', () => {
            this.isExpanded.gist = !this.isExpanded.gist;
            this.render('gist');
        });

        document.getElementById('gist-download-btn').addEventListener('click', () => {
            this.exportCsv('gist');
        });

        document.getElementById('gist-import-btn').addEventListener('click', () => {
            document.getElementById('csv-file-input').click();
        });

        // Gist 配置表单提交
        document.getElementById('gist-config-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const u = document.getElementById('gist-username').value.trim();
            const g = document.getElementById('gist-gistId').value.trim();
            const p = document.getElementById('gist-pat').value.trim();
            DataStore.saveGistConfig(u, g, p);
        });

        // 编辑模态框提交
        document.getElementById('edit-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSaveEdit();
        });

        document.getElementById('cancel-edit-btn').addEventListener('click', () => this.closeEditModal());
        document.getElementById('edit-modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeEditModal();
        });

        // 全局 CSV 导入文件解析
        document.getElementById('csv-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const isLocal = document.getElementById('tab-local').classList.contains('active');
                await this.importCsv(evt.target.result, isLocal ? 'local' : 'gist');
            };
            reader.readAsText(file);
            e.target.value = null;
        });
    },

    render(version) {
        const isLocal = version === 'local';
        const records = isLocal ? DataStore.localRecords : DataStore.gistRecords;
        const container = document.getElementById(`${version}-records-container`);
        const badge = document.getElementById(`${version}-record-count-badge`);
        const expandWrapper = document.getElementById(`${version}-expand-wrapper`);
        const expandBtn = document.getElementById(`${version}-expand-btn`);

        if (!container || !badge) return;

        // 统一按时间倒序
        records.sort((a, b) => new Date(b.time.replace(/\//g, '-')) - new Date(a.time.replace(/\//g, '-')));
        badge.textContent = records.length;

        if (records.length === 0) {
            container.innerHTML = `<p class="text-center py-6 text-xs opacity-50">${!isLocal && !DataStore.gistConfig ? '请先配置 Gist 信息' : '暂无任何记录'}</p>`;
            container.className = 'space-y-2.5 custom-scrollbar';
            expandWrapper.classList.add('hidden');
            return;
        }

        // 高度控制规范：收起时高度贴合显示前3条；展开时 max-h-72 且滚动
        const expanded = this.isExpanded[version];
        if (expanded) {
            container.className = 'space-y-2.5 max-h-72 overflow-y-auto pr-1.5 custom-scrollbar';
        } else {
            container.className = 'space-y-2.5 custom-scrollbar';
        }

        const displayList = expanded ? records : records.slice(0, 3);

        container.innerHTML = displayList.map((item, idx) => `
            <div class="flex items-center justify-between p-3 rounded-xl border transition-all" style="border-color: var(--border-color); background-color: var(--bg-card);">
                <div class="min-w-0 flex-1 pr-2">
                    <p class="text-xs sm:text-sm font-semibold font-mono tracking-tight">${item.time}</p>
                    <p class="text-xs opacity-60 truncate mt-0.5" title="${item.remark || ''}">${item.remark || '无备注'}</p>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="RecordManager.openEditModal('${version}', ${idx})" class="w-7 h-7 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-blue-500/10 text-blue-500"><i class="fa fa-pencil text-xs"></i></button>
                    <button onclick="RecordManager.handleDelete('${version}', ${idx})" class="w-7 h-7 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-red-500/10 text-red-500"><i class="fa fa-trash-o text-xs"></i></button>
                </div>
            </div>
        `).join('');

        if (records.length > 3) {
            expandWrapper.classList.remove('hidden');
            expandBtn.innerHTML = expanded
                ? '<span>收起至前 3 条</span><i class="fa fa-chevron-up text-[10px]"></i>'
                : `<span>展开全部数据 (${records.length}条，可滑动)</span><i class="fa fa-chevron-down text-[10px]"></i>`;
        } else {
            expandWrapper.classList.add('hidden');
        }
    },

    openEditModal(version, index) {
        const records = version === 'local' ? DataStore.localRecords : DataStore.gistRecords;
        const target = records[index];
        if (!target) return;

        document.getElementById('edit-version').value = version;
        document.getElementById('edit-index').value = index;
        document.getElementById('edit-time').value = target.time;
        document.getElementById('edit-remark').value = target.remark || '';
        document.getElementById('edit-modal-overlay').classList.remove('hidden');
    },

    closeEditModal() {
        document.getElementById('edit-modal-overlay').classList.add('hidden');
    },

    async handleSaveEdit() {
        const version = document.getElementById('edit-version').value;
        const index = parseInt(document.getElementById('edit-index').value, 10);
        const newTime = document.getElementById('edit-time').value.trim();
        const newRemark = document.getElementById('edit-remark').value.trim();

        if (!newTime) return AppUI.showToast('记录时间不能为空', 'error');

        if (version === 'local') {
            DataStore.updateLocalRecord(index, newTime, newRemark);
            this.closeEditModal();
            AppUI.showToast('本地记录已更新', 'success');
        } else {
            const btn = document.getElementById('save-edit-btn');
            const originText = btn.textContent;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>保存校验中...';

            try {
                await DataStore.updateGistRecord(index, newTime, newRemark);
                this.closeEditModal();
                AppUI.showToast('云端记录已更新并验证成功！', 'success');
            } catch (err) {
                AppUI.showToast(`修改失败: ${err.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = originText;
            }
        }
    },

    async handleDelete(version, index) {
        if (!confirm(`确定要删除此条${version === 'gist' ? '云端' : '本地'}记录吗？`)) return;

        if (version === 'local') {
            DataStore.deleteLocalRecord(index);
            AppUI.showToast('本地记录已删除', 'success');
        } else {
            AppUI.showToast("正在删除并同步云端...", "info");
            try {
                await DataStore.deleteGistRecord(index);
                AppUI.showToast('云端记录已删除', 'success');
            } catch (err) {
                AppUI.showToast(`删除失败: ${err.message}`, 'error');
            }
        }
    },

    exportCsv(version) {
        const records = version === 'local' ? DataStore.localRecords : DataStore.gistRecords;
        if (records.length === 0) return AppUI.showToast('暂无记录可导出', 'error');

        let csv = "序号,时间,备注\n";
        const sorted = [...records].sort((a, b) => new Date(b.time.replace(/\//g, '-')) - new Date(a.time.replace(/\//g, '-')));
        sorted.forEach((r, idx) => {
            const remarkText = r.remark ? `"${r.remark.replace(/"/g, '""')}"` : '""';
            csv += `${sorted.length - idx},"${r.time}",${remarkText}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `时间记录_${version === 'local' ? '本地' : '云端'}_${new Date().toISOString().slice(0,10)}.csv`);
        link.click();
    },

    async importCsv(csvContent, version) {
        try {
            const parsedRecords = csvContent.trim().split('\n').slice(1).map(line => {
                const parts = line.split(',');
                if (parts.length < 2) return null;
                const time = parts[1].replace(/"/g, '').trim();
                const remark = parts.slice(2).join(',').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
                return time ? { time, remark } : null;
            }).filter(Boolean);

            if (version === 'local') {
                const added = DataStore.mergeLocalRecords(parsedRecords);
                if (added > 0) {
                    AppUI.showToast(`导入成功！新增 ${added} 条记录`, 'success');
                } else {
                    AppUI.showToast('数据已是最新，无新增条目', 'info');
                }
            } else {
                AppUI.showToast('正在解析并合并同步到云端...', 'info');
                const added = await DataStore.mergeGistRecords(parsedRecords);
                if (added > 0) {
                    AppUI.showToast(`导入成功！已同步新增 ${added} 条记录`, 'success');
                } else {
                    AppUI.showToast('云端数据已是最新', 'info');
                }
            }
        } catch (err) {
            AppUI.showToast(`导入失败: ${err.message}`, 'error');
        }
    }
};