// report-logic.js — groups spending into weeks, months or years for the Reports page and the section dashboards.
// Runs in the browser (window.ReportLogic) and in Node (server + tests). No dependencies, no date-library,
// and no time zones: every date is a plain 'YYYY-MM-DD' string.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReportLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const round2 = n => Math.round(n * 100) / 100;
    const pad = n => String(n).padStart(2, '0');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Column order for the all-sections report. Chosen so neighbouring colours stay easy to tell apart,
    // including for colour-blind readers (checked with the palette validator).
    const SECTION_COLUMNS = [
        { key: 'groceries', label: 'Groceries' },
        { key: 'shopping', label: 'Shopping' },
        { key: 'outabout', label: 'Out & About' },
        { key: 'transport', label: 'Transport' },
        { key: 'fixed', label: 'Home Costs' },
        { key: 'subscriptions', label: 'Subscriptions' },
        { key: 'bills', label: 'Bills' },
    ];
    // Same mapping the Home page uses.
    const RECURRING_SECTION = { shopping: 'shopping', bills: 'bills', transport: 'transport', fixed: 'fixed', subscription: 'subscriptions' };
    const EXPENSE_SECTION = { bill: 'bills', fuel: 'transport', transport: 'transport' };

    const NOT_ITEMISED = 'Not itemised';   // receipt total minus its item lines (old scans that didn't add up)
    const INSTALMENTS = 'Instalments';     // Shopping instalment plans
    const OTHER = 'Other';
    const MAX_PERIODS = 1200;

    // 'YYYY-MM-DD' from a date-ish value (DATE, TEXT or timestamp text); null when it isn't a real date.
    function isoDate(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? '' : value));
        if (!m) return null;
        const y = +m[1], mo = +m[2], d = +m[3];
        if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
        const dt = new Date(Date.UTC(y, mo - 1, d));
        return dt.getUTCMonth() === mo - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }
    const toUTC = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    const fromUTC = dt => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    function addDaysIso(iso, n) { const dt = toUTC(iso); dt.setUTCDate(dt.getUTCDate() + n); return fromUTC(dt); }
    function addMonthsKey(ym, n) {
        const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
        return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`;
    }
    // Monday of the week that contains `iso`.
    function weekStart(iso) { const dt = toUTC(iso); return addDaysIso(iso, -((dt.getUTCDay() + 6) % 7)); }

    function periodKey(iso, period) {
        if (period === 'year') return iso.slice(0, 4);
        if (period === 'month') return iso.slice(0, 7);
        return weekStart(iso);
    }
    function nextKey(key, period) {
        if (period === 'year') return String(+key + 1);
        if (period === 'month') return addMonthsKey(key, 1);
        return addDaysIso(key, 7);
    }
    function periodRange(key, period) {
        if (period === 'year') return { from: `${key}-01-01`, to: `${key}-12-31` };
        if (period === 'month') return { from: `${key}-01`, to: addDaysIso(`${addMonthsKey(key, 1)}-01`, -1) };
        return { from: key, to: addDaysIso(key, 6) };
    }
    function periodLabel(key, period) {
        if (period === 'year') return key;
        if (period === 'month') return `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
        const { to } = periodRange(key, 'week');
        const d1 = +key.slice(8, 10), m1 = MONTHS[+key.slice(5, 7) - 1];
        const d2 = +to.slice(8, 10), m2 = MONTHS[+to.slice(5, 7) - 1];
        return m1 === m2 ? `${d1}–${d2} ${m2} ${to.slice(0, 4)}` : `${d1} ${m1} – ${d2} ${m2} ${to.slice(0, 4)}`;
    }
    const PERIOD_NAMES = { week: 'week', month: 'month', year: 'year' };

    // Item rows (one per receipt line) → one entry per receipt: { date, place, total, cats: { category: amount } }.
    // The receipt total is taken once per receipt (MAX), like every other report in the app.
    function groupReceipts(rows) {
        const byId = new Map();
        for (const r of rows || []) {
            const id = String(r.rid);
            if (!byId.has(id)) byId.set(id, { date: null, place: '', total: 0, cats: {} });
            const g = byId.get(id);
            g.date = g.date || isoDate(r.date);
            g.place = g.place || String(r.place || '').trim();
            g.total = Math.max(g.total, parseFloat(r.receipt_total) || 0);
            const cat = String(r.category || '').trim() || OTHER;
            g.cats[cat] = round2((g.cats[cat] || 0) + (parseFloat(r.item_price) || 0));
        }
        return [...byId.values()].map(g => ({ ...g, total: round2(g.total) }));
    }

    const toMonthly = (amount, freq) =>
        freq === 'annual' ? amount / 12 : freq === 'weekly' ? amount * 52 / 12 : freq === 'quarterly' ? amount / 3 : amount;

    // Monthly cost of every recurring item for each month it applies to, up to this month — the same rules the
    // old Monthly Report used: instalment plans run for their number of payments from the start date; ongoing
    // costs run from their start (or creation) date until now. Returns { 'YYYY-MM': { category: amount } }.
    function recurringByMonth(rows, today) {
        const out = {};
        const nowKey = today.slice(0, 7);
        for (const r of rows || []) {
            const n = parseInt(r.total_installments, 10);
            const start = n > 0 ? isoDate(r.start_date) : (isoDate(r.start_date) || isoDate(r.created_at));
            if (!start) continue;
            const amount = toMonthly(parseFloat(r.amount) || 0, r.frequency);
            if (!amount) continue;
            let key = start.slice(0, 7);
            const last = n > 0 && addMonthsKey(key, n - 1) < nowKey ? addMonthsKey(key, n - 1) : nowKey;
            for (let guard = 0; key <= last && guard < MAX_PERIODS; guard++, key = addMonthsKey(key, 1)) {
                out[key] = out[key] || {};
                out[key][r.category] = (out[key][r.category] || 0) + amount;
            }
        }
        return out;
    }

    // Spread monthly recurring costs over weeks / years. Weeks get the monthly cost × 12 ÷ 52 of the month their
    // Monday falls in (only weeks that have started); years add up their months.
    function recurringEntries(byMonth, period, today) {
        const entries = [];
        const months = Object.keys(byMonth).sort();
        if (!months.length) return entries;
        if (period !== 'week') {
            for (const m of months) {
                for (const [cat, amt] of Object.entries(byMonth[m])) entries.push({ key: periodKey(`${m}-01`, period), cat, amount: amt });
            }
            return entries;
        }
        const lastWeek = weekStart(today);
        let wk = weekStart(`${months[0]}-01`);
        for (let guard = 0; wk <= lastWeek && guard < MAX_PERIODS * 5; guard++, wk = addDaysIso(wk, 7)) {
            const month = byMonth[wk.slice(0, 7)];
            if (!month) continue;
            for (const [cat, amt] of Object.entries(month)) entries.push({ key: wk, cat, amount: amt * 12 / 52 });
        }
        return entries;
    }

    // Categories of one section, biggest (all time) first, folded to at most `max` named ones + "Other".
    // Ranking uses ALL data, so colours and columns don't jump around when the period or range changes.
    function sectionColumns(receipts, { max = 7, instalments = 0 } = {}) {
        const totals = {};
        let unmatched = false, discount = false;
        for (const r of receipts) {
            let sum = 0;
            for (const [cat, amt] of Object.entries(r.cats)) {
                sum += amt;
                if (cat === 'Discount' || amt < 0) { discount = discount || amt !== 0; continue; }
                totals[cat] = (totals[cat] || 0) + amt;
            }
            unmatched = unmatched || Math.abs(r.total - sum) >= 0.01;
        }
        if (instalments) totals[INSTALMENTS] = (totals[INSTALMENTS] || 0) + instalments;
        const ranked = Object.keys(totals).filter(c => c !== OTHER).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b));
        const named = ranked.slice(0, max);
        const folded = ranked.length > max || OTHER in totals;
        const columns = named.map(key => ({ key, label: key }));
        if (folded) columns.push({ key: OTHER, label: OTHER, folded: ranked.length > max });
        if (discount) columns.push({ key: 'Discount', label: 'Discounts', negative: true });
        if (unmatched) columns.push({ key: NOT_ITEMISED, label: NOT_ITEMISED, adjustment: true });
        return { columns, named: new Set(named) };
    }

    // data: { receipts: { groceries: [...], outabout: [...], shopping: [...] }, expenses: [{ category, amount, date }], recurring: [...] }
    // opts: { period: 'week' | 'month' | 'year', today: 'YYYY-MM-DD', section: null (all sections) or 'groceries' | 'outabout' | 'shopping' }
    // → { period, columns, rows (newest first): [{ key, label, from, to, values, total, count, current }], undated }
    function buildReport(data, { period = 'month', today, section = null, maxCategories = 7 } = {}) {
        if (!today || !isoDate(today)) throw new Error('buildReport needs today as YYYY-MM-DD');
        const receiptsBy = (data && data.receipts) || {};
        const byMonth = recurringByMonth((data && data.recurring) || [], today);
        const entries = [];   // { key, col, amount, receipt }
        let undated = 0;
        let columns;

        if (!section) {
            columns = SECTION_COLUMNS.map(c => ({ ...c }));
            for (const sec of ['groceries', 'outabout', 'shopping']) {
                for (const r of receiptsBy[sec] || []) {
                    if (!r.date) { undated++; continue; }
                    entries.push({ key: periodKey(r.date, period), col: sec, amount: r.total, receipt: true });
                }
            }
            for (const e of (data && data.expenses) || []) {
                const col = EXPENSE_SECTION[e.category];
                const date = isoDate(e.date);
                if (!col) continue;
                if (!date) { undated++; continue; }
                entries.push({ key: periodKey(date, period), col, amount: parseFloat(e.amount) || 0, receipt: true });
            }
            for (const e of recurringEntries(byMonth, period, today)) {
                const col = RECURRING_SECTION[e.cat];
                if (col) entries.push({ key: e.key, col, amount: e.amount });
            }
        } else {
            const receipts = receiptsBy[section] || [];
            const recurring = section === 'shopping'
                ? recurringEntries(byMonth, period, today).filter(e => e.cat === 'shopping') : [];
            const { columns: cols, named } = sectionColumns(receipts.filter(r => r.date), {
                max: maxCategories, instalments: recurring.reduce((s, e) => s + e.amount, 0) });
            columns = cols;
            const colFor = cat => named.has(cat) ? cat : OTHER;
            for (const r of receipts) {
                if (!r.date) { undated++; continue; }
                const key = periodKey(r.date, period);
                let sum = 0;
                for (const [cat, amt] of Object.entries(r.cats)) {
                    sum += amt;
                    entries.push({ key, col: cat === 'Discount' || amt < 0 ? 'Discount' : colFor(cat), amount: amt });
                }
                if (Math.abs(r.total - sum) >= 0.01) entries.push({ key, col: NOT_ITEMISED, amount: r.total - sum });
                entries.push({ key, col: null, amount: 0, receipt: true });
            }
            for (const e of recurring) entries.push({ key: e.key, col: colFor(INSTALMENTS), amount: e.amount });
        }

        // Every period from the first one with spending up to now — gaps included, so quiet weeks show as £0.
        const nowKey = periodKey(today, period);
        const keys = entries.map(e => e.key);
        let first = keys.length ? keys.reduce((a, b) => (b < a ? b : a)) : nowKey;
        const lastData = keys.length ? keys.reduce((a, b) => (b > a ? b : a)) : nowKey;
        const last = lastData > nowKey ? lastData : nowKey;
        if (first > last) first = last;
        const rowsByKey = new Map();
        let guard = 0;
        for (let k = first; k <= last && guard < MAX_PERIODS * 5; k = nextKey(k, period), guard++) {
            rowsByKey.set(k, { key: k, label: periodLabel(k, period), ...periodRange(k, period), values: {}, total: 0, count: 0, current: k === nowKey });
        }
        for (const e of entries) {
            const row = rowsByKey.get(e.key);
            if (!row) continue;
            if (e.receipt) row.count++;
            if (e.col) row.values[e.col] = (row.values[e.col] || 0) + e.amount;
        }
        const rows = [...rowsByKey.values()].reverse().map(row => {
            const values = {};
            for (const c of columns) values[c.key] = round2(row.values[c.key] || 0);
            return { ...row, values, total: round2(Object.values(values).reduce((s, v) => s + v, 0)) };
        });
        return { period, columns, rows, undated };
    }

    // Places (shops) and categories for the receipts of one section between two dates — for the dashboard lists.
    function breakdown(receipts, from, to) {
        const places = {}, cats = {};
        let count = 0;
        for (const r of receipts || []) {
            if (!r.date || (from && r.date < from) || (to && r.date > to)) continue;
            count++;
            const p = r.place || 'Unknown';
            places[p] = places[p] || { name: p, total: 0, count: 0 };
            places[p].total = round2(places[p].total + r.total);
            places[p].count++;
            for (const [cat, amt] of Object.entries(r.cats)) cats[cat] = round2((cats[cat] || 0) + amt);
        }
        return {
            count,
            places: Object.values(places).sort((a, b) => b.total - a.total),
            categories: Object.entries(cats).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
        };
    }

    return {
        SECTION_COLUMNS, NOT_ITEMISED, INSTALMENTS, OTHER, PERIOD_NAMES,
        isoDate, weekStart, periodKey, nextKey, periodRange, periodLabel,
        groupReceipts, recurringByMonth, recurringEntries, sectionColumns, buildReport, breakdown,
    };
});
