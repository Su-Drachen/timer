(function (root) {
    'use strict';

    function dayKey(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${month}-${day}`;
    }

    function indexRecords(records, parseDate) {
        const byDay = new Map();
        const times = [];
        records.forEach((record, index) => {
            const date = parseDate(record.time);
            if (!date) return;
            const key = dayKey(date);
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(index);
            times.push(date.getTime());
        });
        return { byDay, times };
    }

    function metrics(index, now) {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        let week = 0;
        let latest = null;
        for (const time of index.times) {
            if (time >= start && time < end) week++;
            if (time <= now && (latest === null || time > latest)) latest = time;
        }
        const today = index.byDay.get(dayKey(now))?.length || 0;
        const minutes = latest === null ? null : Math.floor((now - latest) / 60000);
        let elapsed = '—';
        if (minutes !== null) {
            if (minutes < 1) elapsed = '刚刚';
            else if (minutes < 60) elapsed = minutes + ' 分钟';
            else if (minutes < 1440) elapsed = Math.floor(minutes / 60) + ' 小时';
            else elapsed = Math.floor(minutes / 1440) + ' 天';
        }
        return { today, week, elapsed };
    }

    function mount(element, onSelect) {
        const now = new Date();
        let month = new Date(now.getFullYear(), now.getMonth(), 1);
        let selected = '';
        let index = { byDay: new Map(), times: [] };
        let today = dayKey(now);
        element.innerHTML = `
            <div class="calendar-heading">
                <h2 aria-live="polite"></h2>
                <div class="calendar-actions">
                    <button type="button" data-action="today">今天</button>
                    <button type="button" data-action="previous" aria-label="上个月"><i class="fa fa-angle-left" aria-hidden="true"></i></button>
                    <button type="button" data-action="next" aria-label="下个月"><i class="fa fa-angle-right" aria-hidden="true"></i></button>
                </div>
            </div>
            <div class="calendar-week" aria-hidden="true">${Array.from('一二三四五六日', day => '<span>' + day + '</span>').join('')}</div>
            <div class="calendar-days"></div>
            <div class="calendar-footer"><span><i aria-hidden="true"></i> 有记录</span>
                <button type="button" data-action="all" hidden>查看全部记录</button>
            </div>`;
        const heading = element.querySelector('h2');
        const days = element.querySelector('.calendar-days');
        const reset = element.querySelector('[data-action="all"]');

        function draw() {
            const year = month.getFullYear();
            const number = month.getMonth();
            heading.textContent = `${year} 年 ${number + 1} 月`;
            const offset = (month.getDay() + 6) % 7;
            const last = new Date(year, number + 1, 0).getDate();
            let html = '';
            for (let day = 1; day <= last; day++) {
                const key = dayKey(new Date(year, number, day));
                const count = index.byDay.get(key)?.length || 0;
                const style = day === 1 ? ' style="grid-column-start:' + (offset + 1) + '"' : '';
                html += `<button type="button" data-day="${key}"${style} aria-pressed="${selected === key}"
                    ${key === today ? 'aria-current="date"' : ''} aria-label="${key}，${count} 条记录">
                    <span>${day}</span>${count ? '<i aria-hidden="true"></i>' : ''}</button>`;
            }
            days.innerHTML = html;
            reset.hidden = !selected;
        }

        element.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button || !element.contains(button)) return;
            const action = button.dataset.action;
            if (button.dataset.day) selected = button.dataset.day;
            else if (action === 'today') {
                const current = new Date();
                month = new Date(current.getFullYear(), current.getMonth(), 1);
                selected = dayKey(current);
            } else {
                selected = '';
                if (action !== 'all') month.setMonth(month.getMonth() + (action === 'previous' ? -1 : 1));
            }
            draw();
            if (button.dataset.day) days.querySelector(`[data-day="${selected}"]`).focus({ preventScroll: true });
            if (action === 'all') element.querySelector('[data-action="today"]').focus({ preventScroll: true });
            onSelect();
        });
        return {
            get selected() { return selected; },
            get index() { return index; },
            update(records, parseDate) { index = indexRecords(records, parseDate); draw(); },
            refreshToday(date) {
                const key = dayKey(date);
                if (key === today) return;
                if (!selected && month.getTime() === new Date(today + 'T00:00:00').setDate(1)) {
                    month = new Date(date.getFullYear(), date.getMonth(), 1);
                }
                today = key;
                draw();
            }
        };
    }

    root.RecordCalendar = { mount, indexRecords, metrics };
})(globalThis);
