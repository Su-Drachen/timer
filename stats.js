/**
 * stats.js - 数据统计与图表模块
 * 负责年份选择、年度次数统计及月度趋势图表渲染
 */

const StatsManager = {
    selectedYears: {
        local: new Date().getFullYear(),
        gist: new Date().getFullYear()
    },
    charts: {
        local: null,
        gist: null
    },

    init() {
        this.bindEvents();
        // 订阅数据更新
        DataStore.subscribe((version) => {
            this.updateStats(version);
        });
    },

    bindEvents() {
        const localSelect = document.getElementById('local-year-select');
        if (localSelect) {
            localSelect.addEventListener('change', (e) => {
                this.selectedYears.local = parseInt(e.target.value, 10);
                this.updateStats('local');
            });
        }

        const gistSelect = document.getElementById('gist-year-select');
        if (gistSelect) {
            gistSelect.addEventListener('change', (e) => {
                this.selectedYears.gist = parseInt(e.target.value, 10);
                this.updateStats('gist');
            });
        }
    },

    updateStats(version) {
        this.populateYearOptions(version);
        this.renderSummaryAndChart(version);
    },

    populateYearOptions(version) {
        const isLocal = version === 'local';
        const records = isLocal ? DataStore.localRecords : DataStore.gistRecords;
        const select = document.getElementById(`${version}-year-select`);
        if (!select) return;

        const currentRealYear = new Date().getFullYear();
        const yearsSet = new Set([currentRealYear]);

        records.forEach(r => {
            const y = new Date(r.time.replace(/\//g, '-')).getFullYear();
            if (!isNaN(y)) yearsSet.add(y);
        });

        const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
        const curSelected = this.selectedYears[version];

        select.innerHTML = sortedYears.map(y => `
            <option value="${y}" ${y === curSelected ? 'selected' : ''}>${y} 年</option>
        `).join('');
    },

    renderSummaryAndChart(version) {
        const isLocal = version === 'local';
        const records = isLocal ? DataStore.localRecords : DataStore.gistRecords;
        const selectedYear = this.selectedYears[version];

        const yearRecords = records.filter(r => new Date(r.time.replace(/\//g, '-')).getFullYear() === selectedYear);

        // 更新年度汇总数字
        const labelEl = document.getElementById(`${version}-summary-label`);
        const valueEl = document.getElementById(`${version}-summary-value`);
        if (labelEl) labelEl.textContent = `${selectedYear} 年度总打卡`;
        if (valueEl) valueEl.textContent = `${yearRecords.length} 次`;

        // 计算 12 个月度数据
        const monthlyCounts = Array(12).fill(0);
        yearRecords.forEach(r => {
            const m = new Date(r.time.replace(/\//g, '-')).getMonth();
            if (!isNaN(m)) monthlyCounts[m]++;
        });

        // 渲染或更新 Chart.js
        const canvas = document.getElementById(`${version}-records-chart`);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        if (this.charts[version]) {
            this.charts[version].destroy();
        }

        // 读取 CSS 主题变量
        const style = getComputedStyle(document.documentElement);
        const chartBorder = style.getPropertyValue('--chart-border').trim() || '#165DFF';
        const chartBg = style.getPropertyValue('--chart-bg').trim() || 'rgba(22, 93, 255, 0.15)';
        const textSub = style.getPropertyValue('--text-sub').trim() || '#86909C';

        this.charts[version] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
                datasets: [{
                    label: '打卡频次',
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
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: textSub, font: { size: 10 } }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: textSub, font: { size: 10 } },
                        grid: { color: 'rgba(128,128,128,0.08)' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    },

    updateChartsTheme() {
        this.renderSummaryAndChart('local');
        this.renderSummaryAndChart('gist');
    }
};