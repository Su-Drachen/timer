(function (root) {
    'use strict';
    const pad = number => String(number).padStart(2, '0');

    function format(date) {
        return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
    function parse(value) {
        const raw = String(value || '').trim();
        const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
        if (!match) {
            const legacy = new Date(raw);
            return Number.isFinite(+legacy) ? legacy : null;
        }
        const [, y, m, d, h = 0, min = 0, s = 0] = match.map(Number);
        const date = new Date(y, m - 1, d, h || 0, min || 0, s || 0);
        return date.getMonth() === m - 1 && date.getDate() === d && (h || 0) <= 23 &&
            (min || 0) <= 59 && (s || 0) <= 59 ? date : null;
    }
    function create(at, remark = '') {
        return { id: crypto.randomUUID(), time: format(at), remark: remark.trim() };
    }
    function timed(timer) {
        const startTime = format(new Date(timer.start));
        const endTime = format(new Date(timer.end));
        return { id: timer.id, time: startTime, remark: '', startTime, endTime,
            durationSeconds: Math.floor(timer.end / 1000) - Math.floor(timer.start / 1000) };
    }
    function edit(record, time, remark, end) {
        const start = parse(time);
        if (!start) throw new Error('请填写有效的记录时间');
        const changed = { ...record, time: time.trim(), remark: String(remark || '').trim() };
        if (!record.startTime || !record.endTime) return changed;
        const seconds = Number.isFinite(record.durationSeconds) ? record.durationSeconds :
            (+parse(record.endTime) - +parse(record.startTime)) / 1000;
        const finish = end === undefined ? new Date(+start + seconds * 1000) : parse(end);
        if (!finish || !Number.isFinite(+finish) || finish < start) throw new Error('结束时间须等于或晚于开始时间');
        return { ...changed, time: format(start), startTime: format(start), endTime: format(finish), durationSeconds: Math.round((finish - start) / 1000) };
    }
    function duration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds / 60) % 60;
        return (hours ? hours + ':' : '') + pad(minutes) + ':' + pad(seconds % 60);
    }
    function locate(records, target) {
        const matches = records.map((record, index) => ({ record, index })).filter(({ record }) =>
            target.id ? record.id === target.id : !record.id && record.time === target.time && record.remark === target.remark);
        if (matches.length !== 1 || JSON.stringify(matches[0].record) !== JSON.stringify(target)) {
            throw new Error('记录已变更或无法唯一识别，请重新打开列表核对');
        }
        return matches[0].index;
    }
    function insert(records, entry) {
        if (!records.some(record => record.id === entry.id)) return [entry, ...records];
        locate(records, entry);
        return records;
    }
    function merge(records, incoming) {
        const result = [...records];
        const ids = new Set(records.filter(record => record.id).map(record => record.id));
        // Old CSVs have no ids. Match occurrences, so two identical old entries survive a round trip.
        const occurrences = new Map();
        const legacyKey = record => JSON.stringify([record.time, record.remark || '']);
        for (const record of records) {
            const key = legacyKey(record);
            occurrences.set(key, (occurrences.get(key) || 0) + 1);
        }
        for (const record of incoming) {
            if (record.id) {
                if (ids.has(record.id)) continue;
                ids.add(record.id);
            } else {
                const key = legacyKey(record);
                const count = occurrences.get(key) || 0;
                if (count) { occurrences.set(key, count - 1); continue; }
            }
            result.push(record);
        }
        return result.length === records.length ? records : result;
    }
    function csv(records) {
        const lines = ['序号,时间,备注,记录ID,开始时间,结束时间,时长秒数'];
        const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
        records.forEach((record, index) => lines.push([records.length - index, record.time, record.remark,
            record.id, record.startTime, record.endTime, record.durationSeconds].map(quote).join(',')));
        return lines.join('\n') + '\n';
    }
    function fromRows(rows) {
        const [header, ...data] = rows;
        if (!header) return [];
        const extended = header[3]?.trim() === '记录ID';
        return data.filter(row => row[1]?.trim()).map(row => {
            const record = { time: row[1].trim(), remark: (extended ? row[2] || '' : row.slice(2).join(',')).trim() };
            if (!extended) return record;
            if (row[3]) record.id = row[3];
            if (row[4] || row[5]) {
                const start = parse(row[4]), end = parse(row[5]);
                if (!start || !end || end < start) throw new Error('CSV 中的计时起止无效');
                return { ...record, time: format(start), startTime: format(start), endTime: format(end), durationSeconds: Math.round((end - start) / 1000) };
            }
            return record;
        });
    }
    root.RecordEntries = { format, parse, create, edit, timed, duration, locate, insert, merge, csv, fromRows };
})(globalThis);
