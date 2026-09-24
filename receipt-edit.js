// receipt-edit.js — History → "Edit receipt" for Groceries, Out & About and Shopping.
// A receipt is stored as one row per item, so an edit swaps the receipt's rows for the edited ones.
// That happens inside ONE transaction: if anything goes wrong, the original receipt is left exactly as it was.
// The receipt keeps its "added" time, its photo and (unless the edit changes it) its trip.

const L = require('./receipt-logic');

const TABLES = {
    groceries: { table: 'items', place: 'shop_name' },
    outabout: { table: 'outing_items', place: 'place_name' },
    shopping: { table: 'shopping_items', place: 'place_name' },
};

const round2 = n => Math.round(n * 100) / 100;

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

// Check and tidy the edited receipt before anything is touched.
function prepareEdit(body) {
    body = body || {};
    const place = String(body.place_name || body.shop_name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!place) throw httpError(400, 'The shop / place name is missing.');

    const items = (Array.isArray(body.items) ? body.items : [])
        .map(it => {
            const price = round2(parseFloat(it.price) || 0);
            const qty = Math.round((parseFloat(it.quantity) > 0 ? parseFloat(it.quantity) : 1) * 1000) / 1000;
            return {
                name: String(it.name || '').replace(/\s+/g, ' ').trim().slice(0, 200),
                price,
                quantity: qty,
                unit_price: Math.round(price / qty * 10000) / 10000,
                category: String(it.category || '').trim().slice(0, 60) || 'Other',
            };
        })
        .filter(it => it.name);
    if (!items.length) throw httpError(400, 'Add at least one item.');

    const dateGiven = body.date != null && String(body.date).trim() !== '';
    const date = dateGiven ? L.validReceiptDate(String(body.date).trim()) : null;
    if (dateGiven && !date) throw httpError(400, 'That date doesn’t look right.');

    return {
        place,
        date,
        items,
        total: round2(items.reduce((s, it) => s + it.price, 0)),   // same as the grocery edit: total = sum of the lines
        // Only change the trip when the form sends it (the grocery history form doesn't).
        trip: Object.prototype.hasOwnProperty.call(body, 'trip_name') ? L.normalizeTripName(body.trip_name) : undefined,
    };
}

async function editReceipt(db, section, createdAt, body) {
    const t = TABLES[section];
    if (!t) throw httpError(400, 'Unknown section.');
    if (!createdAt) throw httpError(400, 'Which receipt?');
    const e = prepareEdit(body);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const old = await client.query(
            `SELECT id, receipt_image, trip_name FROM ${t.table} WHERE created_at = $1 ORDER BY id FOR UPDATE`, [createdAt]);
        if (!old.rows.length) {
            await client.query('ROLLBACK');
            throw httpError(404, 'That receipt wasn’t found — refresh the page and try again.');
        }
        const image = (old.rows.find(r => r.receipt_image) || {}).receipt_image || null;
        const trip = e.trip !== undefined ? e.trip : ((old.rows.find(r => r.trip_name) || {}).trip_name || null);

        await client.query(`DELETE FROM ${t.table} WHERE id = ANY($1::int[])`, [old.rows.map(r => r.id)]);
        for (const it of e.items) {
            await client.query(
                `INSERT INTO ${t.table} (date, ${t.place}, category, item_name, item_price, quantity, unit_price, receipt_total, created_at, receipt_image, trip_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [e.date, e.place, it.category, it.name, it.price, it.quantity, it.unit_price, e.total, createdAt, image, trip]
            );
        }
        await client.query('COMMIT');
        return { success: true, total: e.total, items: e.items.length, trip_name: trip };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { TABLES, prepareEdit, editReceipt };
