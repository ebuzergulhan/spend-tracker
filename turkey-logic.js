// turkey-logic.js — pure aggregation logic for the Turkey trip page (Stage 1).
//
// No dependencies. Used by the local test server (turkey-local.js) now, and by
// server.js on deploy, so the money math has ONE source of truth.
//
// Currency model: each expense is stored in the currency it was actually paid in
// ('TRY' or 'GBP'). The page shows everything in Turkish Lira (₺), with the GBP
// (£) equivalent, using the TCMB rate `tryPerGbp` (TRY per 1 GBP).

const CATEGORIES = ['Food & Drink', 'Groceries', 'Transport', 'Shopping', 'Accommodation', 'Other'];

// Convert one amount to TRY. Returns null if a GBP amount can't be converted
// because the rate is unknown.
function toTRY(amount, currency, tryPerGbp) {
    const a = parseFloat(amount) || 0;
    if (currency === 'GBP') return tryPerGbp ? a * tryPerGbp : null;
    return a; // already TRY
}

// expenses: [{ date, description, category, amount, currency, source, created_at }]
// tryPerGbp: number of TRY per 1 GBP (TCMB ForexSelling), or null if unknown.
function summarize(expenses, tryPerGbp) {
    const rows = expenses.map(e => ({ ...e, amountTRY: toTRY(e.amount, e.currency, tryPerGbp) }));

    const totalTRY = rows.reduce((s, r) => s + (r.amountTRY || 0), 0);
    const totalGBP = tryPerGbp ? totalTRY / tryPerGbp : null;

    // Native split — how much was actually paid in each currency (before conversion).
    const nativeTRY = expenses.filter(e => e.currency === 'TRY')
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const nativeGBP = expenses.filter(e => e.currency === 'GBP')
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    // Breakdown by category, in TRY (with GBP equivalent and % share).
    const byCat = {};
    for (const r of rows) {
        const c = CATEGORIES.includes(r.category) ? r.category : 'Other';
        if (!byCat[c]) byCat[c] = { category: c, totalTRY: 0, count: 0 };
        byCat[c].totalTRY += (r.amountTRY || 0);
        byCat[c].count += 1;
    }
    const categories = Object.values(byCat)
        .map(c => ({
            ...c,
            totalGBP: tryPerGbp ? c.totalTRY / tryPerGbp : null,
            pct: totalTRY ? (c.totalTRY / totalTRY * 100) : 0,
        }))
        .sort((a, b) => b.totalTRY - a.totalTRY);

    // Days covered + daily average.
    const days = new Set(expenses.map(e => (e.date || '').slice(0, 10)).filter(Boolean));
    const dayCount = days.size;
    const avgPerDayTRY = dayCount ? totalTRY / dayCount : 0;

    // Most recent first.
    const sortedRows = rows.slice().sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') ||
        (b.created_at || '').localeCompare(a.created_at || ''));

    return {
        totalTRY,
        totalGBP,
        nativeTRY,
        nativeGBP,
        count: expenses.length,
        dayCount,
        avgPerDayTRY,
        avgPerDayGBP: (tryPerGbp && dayCount) ? avgPerDayTRY / tryPerGbp : null,
        categories,
        rows: sortedRows,
    };
}

module.exports = { CATEGORIES, toTRY, summarize };
