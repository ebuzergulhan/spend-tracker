// scan-store.js — saves smart-scanned receipts into each section's EXISTING table, and reads trips.
// Only INSERTs and SELECTs: nothing here updates or deletes existing data.
// Each receipt is saved inside a transaction, so it is stored completely or not at all.

const L = require('./receipt-logic');

const round2 = n => Math.round(n * 100) / 100;

function userError(message) {
    const e = new Error(message);
    e.status = 400;
    return e;
}

// Validate and tidy what the review screen sends before anything is written.
function prepareReceipt(body) {
    const section = L.SECTIONS[body.section] ? body.section : null;
    if (!section) throw userError('Choose a section for this receipt.');
    const shop = String(body.shop_name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!shop) throw userError('The shop name is missing.');

    const items = (Array.isArray(body.items) ? body.items : [])
        .map(it => {
            const price = round2(parseFloat(it.price) || 0);
            const qty = Math.round((parseFloat(it.quantity) > 0 ? parseFloat(it.quantity) : 1) * 1000) / 1000;
            return {
                name: String(it.name || '').trim().slice(0, 200),
                price,
                quantity: qty,
                unit_price: Math.round(price / qty * 10000) / 10000,   // same rule as the grocery page: line total ÷ quantity
                category: L.categoryForSection(it.category, section, price),
            };
        })
        .filter(it => it.name);

    const itemsSum = round2(items.reduce((s, it) => s + it.price, 0));
    const total = round2(parseFloat(body.total) || 0) || itemsSum;
    const perLine = section !== 'fuel' && section !== 'transport';
    if (perLine && !items.length) throw userError('There are no items to save.');
    if (!(total > 0)) throw userError('The receipt total is missing.');

    return {
        section,
        shop,
        total,
        items,
        date: L.validReceiptDate(body.date) || (perLine ? null : L.londonToday()), // expense_log needs a date
        trip: L.normalizeTripName(body.trip_name),
        litres: section === 'fuel' && parseFloat(body.litres) > 0 ? round2(parseFloat(body.litres)) : null,
        image: typeof body.image_filename === 'string' && /^[\w.-]+$/.test(body.image_filename) ? body.image_filename : null,
    };
}

// Same "already saved?" rule the section pages use: same shop, date and total.
// IS NOT DISTINCT FROM also treats two missing dates as equal.
const DUPLICATE_SQL = {
    groceries: `SELECT 1 FROM items WHERE shop_name = $1 AND date IS NOT DISTINCT FROM $2 AND receipt_total = $3 LIMIT 1`,
    outabout: `SELECT 1 FROM outing_items WHERE place_name = $1 AND date IS NOT DISTINCT FROM $2 AND receipt_total = $3 LIMIT 1`,
    shopping: `SELECT 1 FROM shopping_items WHERE place_name = $1 AND date IS NOT DISTINCT FROM $2 AND receipt_total = $3 LIMIT 1`,
    fuel: `SELECT 1 FROM expense_log WHERE category = 'fuel' AND name = $1 AND date = $2 AND amount = $3 LIMIT 1`,
    transport: `SELECT 1 FROM expense_log WHERE category = 'transport' AND name = $1 AND date = $2 AND amount = $3 LIMIT 1`,
};

async function insertRows(client, r, createdAt) {
    if (r.section === 'groceries') {
        for (const it of r.items) {
            await client.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, quantity, unit_price, receipt_total, created_at, receipt_image, trip_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [r.date, r.shop, it.category, it.name, it.price, it.quantity, it.unit_price, r.total, createdAt, r.image, r.trip]
            );
        }
        return r.items.length;
    }
    if (r.section === 'outabout' || r.section === 'shopping') {
        const table = r.section === 'outabout' ? 'outing_items' : 'shopping_items';
        for (const it of r.items) {
            await client.query(
                `INSERT INTO ${table} (date, place_name, category, item_name, item_price, quantity, unit_price, receipt_total, created_at, trip_name, receipt_image)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [r.date, r.shop, it.category, it.name, it.price, it.quantity, it.unit_price, r.total, createdAt, r.trip, r.image]
            );
        }
        return r.items.length;
    }
    // Fuel and parking/travel are single entries on the Transport page.
    const notes = r.items.map(it => it.name).join(', ').slice(0, 300) || null;
    await client.query(
        `INSERT INTO expense_log (category, name, amount, date, notes, litres, trip_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.section === 'fuel' ? 'fuel' : 'transport', r.shop, r.total, r.date, notes, r.litres, r.trip]
    );
    return 1;
}

// Save one reviewed receipt. Returns { saved } or { duplicate } — never partially saves.
async function saveReceipt(db, body, { normalizeShopName } = {}) {
    const r = prepareReceipt(body);
    if (r.section === 'groceries' && normalizeShopName) r.shop = await normalizeShopName(r.shop);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const dup = await client.query(DUPLICATE_SQL[r.section], [r.shop, r.date, r.total]);
        if (dup.rows.length) {
            await client.query('ROLLBACK');
            return { duplicate: true, section: r.section, shop_name: r.shop };
        }
        const rows = await insertRows(client, r, new Date().toISOString());
        await client.query('COMMIT');
        return { saved: true, section: r.section, shop_name: r.shop, rows, trip_name: r.trip };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

// Group tagged receipts from every section into trips, with totals per section.
function summarizeTrips(rows) {
    const trips = new Map();
    for (const row of rows) {
        const name = L.normalizeTripName(row.trip_name);
        if (!name) continue;
        const key = name.toLowerCase();
        if (!trips.has(key)) trips.set(key, { name, total: 0, count: 0, start: null, end: null, by_section: {}, receipts: [] });
        const t = trips.get(key);
        const total = round2(parseFloat(row.total) || 0);
        const group = row.section === 'fuel' || row.section === 'transport' ? 'transport' : row.section;
        t.total = round2(t.total + total);
        t.count += 1;
        t.by_section[group] = round2((t.by_section[group] || 0) + total);
        const date = row.date || null;
        if (date && (!t.start || date < t.start)) t.start = date;
        if (date && (!t.end || date > t.end)) t.end = date;
        t.receipts.push({ section: row.section, place: row.place, date, total });
    }
    return [...trips.values()]
        .map(t => ({ ...t, receipts: t.receipts.sort((a, b) => (a.date || '').localeCompare(b.date || '')) }))
        .sort((a, b) => (b.end || '').localeCompare(a.end || ''));
}

// Dates are cast defensively: the oldest table (items) stores dates as text.
const TRIP_DATE = `to_char(MAX(NULLIF(date::text, '')::date), 'YYYY-MM-DD')`;

async function listTrips(db) {
    const [groc, out, shop, log] = await Promise.all([
        db.query(`SELECT trip_name, 'groceries' AS section, MAX(shop_name) AS place, ${TRIP_DATE} AS date, MAX(receipt_total) AS total
                  FROM items WHERE trip_name IS NOT NULL GROUP BY trip_name, created_at`),
        db.query(`SELECT trip_name, 'outabout' AS section, MAX(place_name) AS place, ${TRIP_DATE} AS date, MAX(receipt_total) AS total
                  FROM outing_items WHERE trip_name IS NOT NULL GROUP BY trip_name, created_at`),
        db.query(`SELECT trip_name, 'shopping' AS section, MAX(place_name) AS place, ${TRIP_DATE} AS date, MAX(receipt_total) AS total
                  FROM shopping_items WHERE trip_name IS NOT NULL GROUP BY trip_name, created_at`),
        db.query(`SELECT trip_name, category AS section, name AS place, to_char(NULLIF(date::text, '')::date, 'YYYY-MM-DD') AS date, amount AS total
                  FROM expense_log WHERE trip_name IS NOT NULL AND category IN ('fuel', 'transport')`),
    ]);
    return summarizeTrips([...groc.rows, ...out.rows, ...shop.rows, ...log.rows]);
}

module.exports = { prepareReceipt, saveReceipt, summarizeTrips, listTrips, DUPLICATE_SQL };
