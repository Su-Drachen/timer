/**
 * store.js - 数据层模块
 * 管理本地 (localStorage) 与云端 (GitHub Gist) 的读写及发布订阅
 */

const DataStore = {
    // 内存数据缓存
    localRecords: [],
    gistRecords: [],
    gistConfig: null,

    // 订阅事件监听列表
    subscribers: [],

    init() {
        this.loadLocalRecords();
        this.loadGistConfig();
    },

    // 注册变更监听
    subscribe(callback) {
        if (typeof callback === 'function') {
            this.subscribers.push(callback);
        }
    },

    // 触发数据更新广播
    notify(version, eventType, data) {
        this.subscribers.forEach(cb => {
            try {
                cb(version, eventType, data);
            } catch (err) {
                console.error("Subscriber notification error:", err);
            }
        });
    },

    // --- 本地数据操作 (Local) ---
    loadLocalRecords() {
        try {
            const saved = localStorage.getItem('timeRecords');
            this.localRecords = saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error("Failed to parse local records", e);
            this.localRecords = [];
        }
        this.notify('local', 'loaded', this.localRecords);
    },

    saveLocalRecords() {
        localStorage.setItem('timeRecords', JSON.stringify(this.localRecords));
        this.notify('local', 'updated', this.localRecords);
    },

    addLocalRecord(remark = '') {
        const now = new Date();
        const timeString = now.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).replace(/\//g, '/');

        this.localRecords.unshift({ time: timeString, remark: remark.trim() });
        this.saveLocalRecords();
    },

    updateLocalRecord(index, newTime, newRemark) {
        if (!this.localRecords[index]) return false;
        this.localRecords[index] = { time: newTime, remark: newRemark };
        this.saveLocalRecords();
        return true;
    },

    deleteLocalRecord(index) {
        if (index >= 0 && index < this.localRecords.length) {
            this.localRecords.splice(index, 1);
            this.saveLocalRecords();
            return true;
        }
        return false;
    },

    mergeLocalRecords(newItems) {
        const map = new Map(this.localRecords.map(r => [r.time, r]));
        const originSize = map.size;
        newItems.forEach(r => {
            if (r && r.time) map.set(r.time, r);
        });
        const merged = Array.from(map.values());
        const addedCount = merged.length - originSize;
        if (addedCount > 0) {
            this.localRecords = merged;
            this.saveLocalRecords();
        }
        return addedCount;
    },

    // --- 云端数据操作 (Gist) ---
    loadGistConfig() {
        const savedConfig = localStorage.getItem('timeRecorderConfig');
        if (savedConfig) {
            try {
                this.gistConfig = JSON.parse(savedConfig);
                return this.gistConfig;
            } catch (e) {
                this.gistConfig = null;
            }
        }
        return null;
    },

    saveGistConfig(username, gistId, pat) {
        this.gistConfig = {
            GITHUB_USERNAME: username,
            GIST_ID: gistId,
            GITHUB_PAT: pat
        };
        localStorage.setItem('timeRecorderConfig', JSON.stringify(this.gistConfig));
        return this.initGist();
    },

    async initGist() {
        if (!this.gistConfig || !this.gistConfig.GIST_ID || !this.gistConfig.GITHUB_PAT) {
            document.getElementById('gist-config-overlay').classList.remove('hidden');
            return false;
        }
        document.getElementById('gist-config-overlay').classList.add('hidden');
        return await this.fetchGistRecords();
    },

    async fetchDirectFromApi() {
        if (!this.gistConfig?.GIST_ID || !this.gistConfig?.GITHUB_PAT) {
            throw new Error("Gist 配置缺失");
        }
        const res = await fetch(`https://api.github.com/gists/${this.gistConfig.GIST_ID}`, {
            headers: {
                'Authorization': `token ${this.gistConfig.GITHUB_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || `API 请求失败 (${res.status})`);
        }
        const data = await res.json();
        const file = data.files && data.files['records.json'];
        return file && file.content ? JSON.parse(file.content) : [];
    },

    async fetchGistRecords() {
        AppUI.showToast("正在连接云端同步数据...", "info");
        try {
            const data = await this.fetchDirectFromApi();
            this.gistRecords = Array.isArray(data) ? data : [];
            this.notify('gist', 'loaded', this.gistRecords);
            AppUI.showToast("云端同步完成！", "success");
            return true;
        } catch (error) {
            console.error(error);
            AppUI.showToast(`同步失败: ${error.message}`, "error");
            this.notify('gist', 'error', error);
            return false;
        }
    },

    async saveAndVerifyGist(targetRecords) {
        if (!this.gistConfig?.GIST_ID || !this.gistConfig?.GITHUB_PAT) {
            throw new Error("云端账号配置缺失");
        }
        const jsonContent = JSON.stringify(targetRecords, null, 2);

        const res = await fetch(`https://api.github.com/gists/${this.gistConfig.GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${this.gistConfig.GITHUB_PAT}`,
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

        const verified = await this.fetchDirectFromApi();
        if (JSON.stringify(verified) !== JSON.stringify(targetRecords)) {
            throw new Error("云端与本地校验不一致，请重试");
        }
        this.gistRecords = verified;
        this.notify('gist', 'updated', this.gistRecords);
        return verified;
    },

    async addGistRecord(remark = '') {
        const now = new Date();
        const timeString = now.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).replace(/\//g, '/');

        const newRecords = [{ time: timeString, remark: remark.trim() }, ...this.gistRecords];
        return await this.saveAndVerifyGist(newRecords);
    },

    async updateGistRecord(index, newTime, newRemark) {
        if (!this.gistRecords[index]) throw new Error("目标记录不存在");
        const newRecords = [...this.gistRecords];
        newRecords[index] = { time: newTime, remark: newRemark };
        return await this.saveAndVerifyGist(newRecords);
    },

    async deleteGistRecord(index) {
        if (index < 0 || index >= this.gistRecords.length) throw new Error("记录索引越界");
        const newRecords = [...this.gistRecords];
        newRecords.splice(index, 1);
        return await this.saveAndVerifyGist(newRecords);
    },

    async mergeGistRecords(newItems) {
        const map = new Map(this.gistRecords.map(r => [r.time, r]));
        const originSize = map.size;
        newItems.forEach(r => {
            if (r && r.time) map.set(r.time, r);
        });
        const merged = Array.from(map.values());
        const addedCount = merged.length - originSize;
        if (addedCount > 0) {
            await this.saveAndVerifyGist(merged);
        }
        return addedCount;
    }
};