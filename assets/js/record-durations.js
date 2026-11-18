/* Convert timed sessions and legacy time points into intervals for the two analysis pages. */
(function (root) {
    'use strict';

    function timestamp(time) {
        return typeof time === 'string' ? root.RecordEntries.parse(time)?.getTime() ?? NaN : NaN;
    }

    function interval(start, end, seconds, measured) {
        return {
            start, end, startTimestamp: start.timestamp, endTimestamp: end.timestamp,
            durationSeconds: seconds, durationMinutes: seconds / 60, measured,
            isCrossDay: new Date(start.timestamp).toDateString() !== new Date(end.timestamp).toDateString()
        };
    }

    function collect(localRecords, cloudRecords) {
        const points = [], results = [], measuredIds = new Set();
        for (const [source, records] of [['本机', localRecords], ['云端', cloudRecords]]) {
            if (!Array.isArray(records)) continue;
            for (const record of records) {
                if (!record || typeof record !== 'object') continue;
                const remark = typeof record.remark === 'string' ? record.remark : '';
                if (record.startTime || record.endTime || record.durationSeconds != null) {
                    const start = { time: record.startTime, timestamp: timestamp(record.startTime), source, remark };
                    const end = { time: record.endTime, timestamp: timestamp(record.endTime), source, remark: '' };
                    if (!Number.isFinite(start.timestamp) || !Number.isFinite(end.timestamp) ||
                        !Number.isSafeInteger(record.durationSeconds) || record.durationSeconds < 0) continue;
                    if (record.id && measuredIds.has(record.id)) continue;
                    if (record.id) measuredIds.add(record.id);
                    results.push(interval(start, end, record.durationSeconds, true));
                } else {
                    const ms = timestamp(record.time);
                    if (Number.isFinite(ms)) points.push({ time: record.time, timestamp: ms, source, remark });
                }
            }
        }
        // Legacy pairs join the first available point from the other source within 1 min–12 h.
        points.sort((a, b) => a.timestamp - b.timestamp);
        const used = new Set();
        for (let i = 0; i < points.length; i++) {
            if (used.has(i)) continue;
            const start = points[i];
            for (let j = i + 1; j < points.length; j++) {
                const end = points[j], seconds = (end.timestamp - start.timestamp) / 1000;
                if (seconds > 12 * 3600) break;
                if (seconds < 60 || used.has(j) || start.source === end.source) continue;
                used.add(j);
                results.push(interval(start, end, seconds, false));
                break;
            }
        }
        return results.sort((a, b) => b.startTimestamp - a.startTimestamp);
    }

    function label(item) {
        return item.measured ? item.start.source + '计时' : '配对估算 · ' + item.start.source + ' → ' + item.end.source;
    }

    function formatSeconds(value) {
        const seconds = Math.round(value);
        if (seconds < 60) return seconds + ' 秒';
        const minutes = Math.floor(seconds / 60);
        const rest = seconds % 60;
        const hours = Math.floor(minutes / 60);
        const parts = [];
        if (hours) parts.push(hours + ' 小时');
        if (minutes % 60) parts.push(minutes % 60 + ' 分');
        if (rest) parts.push(rest + ' 秒');
        return parts.join(' ');
    }

    const api = { collect, label, formatSeconds };
    root.RecordDurations = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
