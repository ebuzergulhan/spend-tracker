require('dotenv').config();

const express = require('express');
const app = express();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3001;

const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const fs = require('fs');

const anthropic = new Anthropic();

const db = new Pool({
    connectionString: process.env.DATABASE_URL
});


app.use(express.static('public'));
app.use(express.json());

// If the new shop name matches or contains an existing canonical name, use the canonical one.
// This merges "ALDI STORES Edgbaston Road Birmingham" → "ALDI STORES" automatically.
async function normalizeShopName(name) {
    const { rows } = await db.query('SELECT DISTINCT shop_name FROM items');
    const lower = name.toLowerCase().trim();

    // Exact case-insensitive match
    const exact = rows.find(r => r.shop_name.toLowerCase() === lower);
    if (exact) return exact.shop_name;

    // New name contains an existing name — pick the longest match to be most specific
    const match = rows
        .filter(r => r.shop_name.length >= 4 && lower.includes(r.shop_name.toLowerCase()))
        .sort((a, b) => b.shop_name.length - a.shop_name.length)[0];
    if (match) return match.shop_name;

    return name;
}

// Upload and scan a receipt
app.post('/upload', upload.single('receiptImage'), async (req, res) => {
    try {
        const imageData = fs.readFileSync(req.file.path);
        const base64Image = imageData.toString('base64');

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: req.file.mimetype,
                                data: base64Image
                            }
                        },
                        {
                            type: 'text',
                            text: `Extract the receipt details and return ONLY a valid JSON object with this exact structure:
{
  "shop_name": "store name",
  "date": "YYYY-MM-DD or null if not visible",
  "total": 0.00,
  "items": [
    { "name": "item name", "price": 0.00, "category": "one of: Groceries, Vegetables, Fruit, Dairy, Meat & Fish, Bakery, Drinks, Snacks, Household, Clothing, Electronics, Fuel, Restaurant, Health, Other" }
  ]
}
Total and price must be plain numbers only. No currency symbols.`
                        }
                    ]
                }
            ]
        });

        const rawText = response.content[0].text;
        const cleanText = rawText.replace(/```json\n?|\n?```/g, '').trim();
        const receipt = JSON.parse(cleanText);

        receipt.total = parseFloat(receipt.total) || 0;
        receipt.shop_name = await normalizeShopName(receipt.shop_name);
        const createdAt = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];
        // Reject future dates and unreadable dates — store null so the UI shows * with upload date
        const receiptDate = (receipt.date && receipt.date !== 'null' && receipt.date <= today) ? receipt.date : null;

        // Check for duplicate receipt
        const duplicate = await db.query(
            `SELECT id FROM items WHERE shop_name = $1 AND date = $2 AND receipt_total = $3 LIMIT 1`,
            [receipt.shop_name, receiptDate, receipt.total]
        );

        if (duplicate.rows.length > 0) {
            fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: 'This receipt has already been scanned.' });
        }

        for (const item of receipt.items) {
            await db.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, receipt_total, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [receiptDate, receipt.shop_name, item.category, item.name, parseFloat(item.price) || 0, receipt.total, createdAt]
            );
        }

        fs.unlinkSync(req.file.path);
        res.json(receipt);

    } catch (error) {
        console.error('Upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Spending by shop — sum receipt_total once per receipt, not item prices
app.get('/stats/shops', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT shop_name,
               ROUND(SUM(receipt_total)::numeric, 2) as total_spent,
               SUM(item_count) as item_count
        FROM (
            SELECT shop_name, created_at,
                   MAX(receipt_total) as receipt_total,
                   COUNT(*) as item_count
            FROM items
            ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
            GROUP BY shop_name, created_at
        ) t
        GROUP BY shop_name
        ORDER BY total_spent DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// Spending by category
app.get('/stats/categories', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT category, ROUND(SUM(item_price)::numeric, 2) as total_spent, COUNT(*) as item_count
        FROM items
        ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
        GROUP BY category
        ORDER BY total_spent DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// Items breakdown for a single category
app.get('/stats/categories/:category/items', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT item_name,
               COUNT(*) as times_bought,
               ROUND(AVG(item_price)::numeric, 2) as avg_price,
               ROUND(SUM(item_price)::numeric, 2) as total_spent
        FROM items
        WHERE category = $1
        ${f ? 'AND date >= $2 AND date <= $3' : ''}
        GROUP BY item_name
        ORDER BY total_spent DESC
    `, f ? [req.params.category, from, to] : [req.params.category]);
    res.json(result.rows);
});

// Most frequently bought items
app.get('/stats/frequent-items', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT item_name, category, COUNT(*) as times_bought, ROUND(SUM(item_price)::numeric, 2) as total_spent
        FROM items
        ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
        GROUP BY item_name, category
        ORDER BY times_bought DESC
        LIMIT 20
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// Spending by month — sum receipt_total once per receipt
app.get('/stats/monthly', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT month, ROUND(SUM(receipt_total)::numeric, 2) as total_spent
        FROM (
            SELECT TO_CHAR(date::date, 'YYYY-MM') as month,
                   created_at, MAX(receipt_total) as receipt_total
            FROM items
            WHERE date IS NOT NULL AND date != 'null'
            ${f ? 'AND date >= $1 AND date <= $2' : ''}
            GROUP BY month, created_at
        ) t
        GROUP BY month
        ORDER BY month DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// All receipts grouped for history display
app.get('/receipts', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT created_at, shop_name, date, receipt_total
        FROM items
        ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
        GROUP BY created_at, shop_name, date, receipt_total
        ORDER BY created_at DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// Get all items for a single receipt
app.get('/receipts/:created_at/items', async (req, res) => {
    const result = await db.query(
        `SELECT item_name, item_price, category FROM items WHERE created_at = $1 ORDER BY id`,
        [req.params.created_at]
    );
    res.json(result.rows);
});

// Edit a receipt — delete old rows, insert updated ones
app.put('/receipts/:created_at', async (req, res) => {
    try {
        const { shop_name, date, items } = req.body;
        const createdAt = req.params.created_at;
        const receiptTotal = items.reduce((sum, item) => sum + parseFloat(item.price), 0);

        await db.query(`DELETE FROM items WHERE created_at = $1`, [createdAt]);

        for (const item of items) {
            await db.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, receipt_total, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [date || null, shop_name, item.category, item.name, parseFloat(item.price) || 0, receiptTotal, createdAt]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Edit error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Rename a shop across all items
app.put('/shops/rename', async (req, res) => {
    const { old_name, new_name } = req.body;
    if (!old_name || !new_name) return res.status(400).json({ error: 'Missing names' });
    await db.query('UPDATE items SET shop_name = $1 WHERE shop_name = $2', [new_name.trim(), old_name]);
    res.json({ success: true });
});

// Export one row per receipt (summary)
app.get('/export/receipts/csv', async (req, res) => {
    const result = await db.query(`
        SELECT date, shop_name, receipt_total, COUNT(*) as item_count, created_at
        FROM items
        GROUP BY date, shop_name, receipt_total, created_at
        ORDER BY date DESC NULLS LAST, created_at DESC
    `);

    const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const headers = ['Date', 'Shop', 'Total (£)', 'Items', 'Added'];
    const rows = result.rows.map(r => [
        r.date || '',
        escape(r.shop_name),
        r.receipt_total,
        r.item_count,
        r.created_at ? r.created_at.split('T')[0] : ''
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="receipts-summary.csv"');
    res.send(csv);
});

// Export all items as CSV
app.get('/export/csv', async (req, res) => {
    const result = await db.query(`
        SELECT date, shop_name, category, item_name, item_price, receipt_total, created_at
        FROM items
        ORDER BY date DESC NULLS LAST, created_at DESC
    `);

    const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
    const headers = ['Date', 'Shop', 'Category', 'Item', 'Price (£)', 'Receipt Total (£)', 'Added'];
    const rows = result.rows.map(r => [
        r.date || '',
        escape(r.shop_name),
        escape(r.category),
        escape(r.item_name),
        r.item_price,
        r.receipt_total,
        r.created_at ? r.created_at.split('T')[0] : ''
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="spend-tracker.csv"');
    res.send(csv);
});

// Delete a receipt by created_at
app.delete('/receipts/:created_at', async (req, res) => {
    await db.query(`DELETE FROM items WHERE created_at = $1`, [req.params.created_at]);
    res.json({ success: true });
});

// Manual entry
app.post('/manual', async (req, res) => {
    try {
        const { shop_name, date, items } = req.body;
        const createdAt = new Date().toISOString();
        const receiptTotal = items.reduce((sum, item) => sum + parseFloat(item.price), 0);

        for (const item of items) {
            await db.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, receipt_total, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [date, shop_name, item.category, item.name, parseFloat(item.price) || 0, receiptTotal, createdAt]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Manual entry error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ─── New Finance Sections ────────────────────────────────────────────────────

// Create tables on startup
(async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS recurring_expenses (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            frequency TEXT NOT NULL DEFAULT 'monthly',
            start_date DATE,
            notes TEXT,
            total_installments INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS total_installments INTEGER`);
    await db.query(`ALTER TABLE recurring_expenses ADD COLUMN IF NOT EXISTS link TEXT`);
    await db.query(`ALTER TABLE expense_log ADD COLUMN IF NOT EXISTS litres NUMERIC(8,2)`);
    await db.query(`
        CREATE TABLE IF NOT EXISTS debts (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            total_amount NUMERIC(10,2) NOT NULL,
            monthly_payment NUMERIC(10,2) NOT NULL,
            start_date DATE NOT NULL,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS outing_items (
            id SERIAL PRIMARY KEY,
            date DATE,
            place_name TEXT NOT NULL,
            category TEXT NOT NULL,
            item_name TEXT NOT NULL,
            item_price NUMERIC(10,2) DEFAULT 0,
            receipt_total NUMERIC(10,2) DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS expense_log (
            id SERIAL PRIMARY KEY,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            amount NUMERIC(10,2) NOT NULL,
            date DATE NOT NULL,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
})();

// Recurring expenses (fixed costs + subscriptions)
app.get('/recurring', async (req, res) => {
    const { category } = req.query;
    const result = category
        ? await db.query('SELECT * FROM recurring_expenses WHERE category = $1 ORDER BY name', [category])
        : await db.query('SELECT * FROM recurring_expenses ORDER BY category, name');
    res.json(result.rows);
});

app.post('/recurring', async (req, res) => {
    try {
        const { name, category, amount, frequency, start_date, notes, total_installments, link } = req.body;
        const result = await db.query(
            `INSERT INTO recurring_expenses (name, category, amount, frequency, start_date, notes, total_installments, link)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, category, parseFloat(amount) || 0, frequency || 'monthly', start_date || null, notes || null,
             total_installments ? parseInt(total_installments) : null, link || null]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/recurring/:id', async (req, res) => {
    try {
        const { name, category, amount, frequency, start_date, notes, total_installments, link } = req.body;
        const result = await db.query(
            `UPDATE recurring_expenses SET name=$1, category=$2, amount=$3, frequency=$4, start_date=$5, notes=$6, total_installments=$7, link=$8
             WHERE id=$9 RETURNING *`,
            [name, category, parseFloat(amount) || 0, frequency || 'monthly', start_date || null, notes || null,
             total_installments ? parseInt(total_installments) : null, link || null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/recurring/:id', async (req, res) => {
    await db.query('DELETE FROM recurring_expenses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// Expense log (bills, fuel, transport one-off payments)
app.get('/expense-log', async (req, res) => {
    const { category, from, to } = req.query;
    let where = [];
    let params = [];
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    if (from)     { params.push(from);     where.push(`date >= $${params.length}`); }
    if (to)       { params.push(to);       where.push(`date <= $${params.length}`); }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await db.query(
        `SELECT * FROM expense_log ${whereClause} ORDER BY date DESC, created_at DESC`,
        params
    );
    res.json(result.rows);
});

app.post('/expense-log', async (req, res) => {
    try {
        const { category, name, amount, date, notes, litres } = req.body;
        const result = await db.query(
            `INSERT INTO expense_log (category, name, amount, date, notes, litres)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [category, name, parseFloat(amount) || 0, date, notes || null, litres ? parseFloat(litres) : null]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/expense-log/:id', async (req, res) => {
    try {
        const { category, name, amount, date, notes, litres } = req.body;
        const result = await db.query(
            `UPDATE expense_log SET category=$1, name=$2, amount=$3, date=$4, notes=$5, litres=$6
             WHERE id=$7 RETURNING *`,
            [category, name, parseFloat(amount) || 0, date, notes || null,
             litres ? parseFloat(litres) : null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/expense-log/:id', async (req, res) => {
    await db.query('DELETE FROM expense_log WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// Home summary — this month totals per section
app.get('/summary/home', async (req, res) => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const [groceries, outabout, logs, allRecurring] = await Promise.all([
        db.query(`
            SELECT ROUND(SUM(receipt_total)::numeric, 2) as total
            FROM (
                SELECT created_at, MAX(receipt_total) as receipt_total
                FROM items
                WHERE date >= $1 AND date <= $2
                GROUP BY created_at
            ) t
        `, [monthStart, monthEnd]),
        db.query(`
            SELECT ROUND(SUM(receipt_total)::numeric, 2) as total
            FROM (
                SELECT created_at, MAX(receipt_total) as receipt_total
                FROM outing_items
                WHERE date >= $1 AND date <= $2
                GROUP BY created_at
            ) t
        `, [monthStart, monthEnd]),
        db.query(`
            SELECT category, ROUND(SUM(amount)::numeric, 2) as total
            FROM expense_log
            WHERE date >= $1 AND date <= $2
            GROUP BY category
        `, [monthStart, monthEnd]),
        db.query(`SELECT * FROM recurring_expenses`)
    ]);

    // Monthly equivalent per recurring item, skipping finished installments
    function toMonthly(amount, freq) {
        if (freq === 'annual')    return amount / 12;
        if (freq === 'weekly')    return amount * 52 / 12;
        if (freq === 'quarterly') return amount / 3;
        return amount;
    }
    function freqMonths(freq) {
        if (freq === 'annual')    return 12;
        if (freq === 'quarterly') return 3;
        if (freq === 'weekly')    return 1 / 4.33;
        return 1;
    }

    const recurringMap = {};
    allRecurring.rows.forEach(r => {
        if (r.total_installments) {
            const start = new Date(r.start_date);
            const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
            const paid = Math.floor(monthsElapsed / freqMonths(r.frequency)) + 1;
            if (paid >= parseInt(r.total_installments)) return; // finished, skip
        }
        recurringMap[r.category] = (recurringMap[r.category] || 0) + toMonthly(parseFloat(r.amount), r.frequency);
    });

    const logMap = {};
    logs.rows.forEach(r => { logMap[r.category] = parseFloat(r.total) || 0; });

    res.json({
        month: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
        groceries: parseFloat(groceries.rows[0]?.total) || 0,
        outabout: parseFloat(outabout.rows[0]?.total) || 0,
        bills: logMap['bill'] || 0,
        transport: (recurringMap['transport'] || 0) + (logMap['transport'] || 0) + (logMap['fuel'] || 0),
        fixed: recurringMap['fixed'] || 0,
        subscriptions: recurringMap['subscription'] || 0
    });
});

// ─── Debts ───────────────────────────────────────────────────────────────────

app.get('/debts', async (req, res) => {
    const result = await db.query('SELECT * FROM debts ORDER BY created_at DESC');
    res.json(result.rows);
});

app.post('/debts', async (req, res) => {
    try {
        const { name, total_amount, monthly_payment, start_date, notes } = req.body;
        const result = await db.query(
            `INSERT INTO debts (name, total_amount, monthly_payment, start_date, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, parseFloat(total_amount), parseFloat(monthly_payment), start_date, notes || null]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/debts/:id', async (req, res) => {
    try {
        const { name, total_amount, monthly_payment, start_date, notes } = req.body;
        const result = await db.query(
            `UPDATE debts SET name=$1, total_amount=$2, monthly_payment=$3, start_date=$4, notes=$5
             WHERE id=$6 RETURNING *`,
            [name, parseFloat(total_amount), parseFloat(monthly_payment), start_date, notes || null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/debts/:id', async (req, res) => {
    await db.query('DELETE FROM debts WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ─── Out & About ─────────────────────────────────────────────────────────────

app.post('/upload/outing', upload.single('receiptImage'), async (req, res) => {
    try {
        const imageData = fs.readFileSync(req.file.path);
        const base64Image = imageData.toString('base64');

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: { type: 'base64', media_type: req.file.mimetype, data: base64Image }
                    },
                    {
                        type: 'text',
                        text: `Extract the receipt details and return ONLY a valid JSON object with this exact structure:
{
  "place_name": "name of the place",
  "date": "YYYY-MM-DD or null if not visible",
  "total": 0.00,
  "items": [
    { "name": "item name", "price": 0.00, "category": "one of: Restaurant, Fast Food, Coffee & Drinks, Parking, Entertainment, Shopping, Health & Beauty, Hotel, Transport, Other" }
  ]
}
Total and price must be plain numbers only. No currency symbols.`
                    }
                ]
            }]
        });

        const rawText = response.content[0].text;
        const cleanText = rawText.replace(/```json\n?|\n?```/g, '').trim();
        const receipt = JSON.parse(cleanText);

        receipt.total = parseFloat(receipt.total) || 0;
        const createdAt = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];
        const receiptDate = (receipt.date && receipt.date !== 'null' && receipt.date <= today) ? receipt.date : null;

        const duplicate = await db.query(
            `SELECT id FROM outing_items WHERE place_name = $1 AND date = $2 AND receipt_total = $3 LIMIT 1`,
            [receipt.place_name, receiptDate, receipt.total]
        );
        if (duplicate.rows.length > 0) {
            fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: 'This receipt has already been scanned.' });
        }

        for (const item of receipt.items) {
            await db.query(
                `INSERT INTO outing_items (date, place_name, category, item_name, item_price, receipt_total, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [receiptDate, receipt.place_name, item.category, item.name, parseFloat(item.price) || 0, receipt.total, createdAt]
            );
        }

        fs.unlinkSync(req.file.path);
        res.json(receipt);
    } catch (error) {
        console.error('Outing upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/outings', async (req, res) => {
    const result = await db.query(`
        SELECT created_at, place_name, date, receipt_total
        FROM outing_items
        GROUP BY created_at, place_name, date, receipt_total
        ORDER BY created_at DESC
    `);
    res.json(result.rows);
});

app.get('/outings/:created_at/items', async (req, res) => {
    const result = await db.query(
        `SELECT item_name, item_price, category FROM outing_items WHERE created_at = $1 ORDER BY id`,
        [req.params.created_at]
    );
    res.json(result.rows);
});

app.delete('/outings/:created_at', async (req, res) => {
    await db.query(`DELETE FROM outing_items WHERE created_at = $1`, [req.params.created_at]);
    res.json({ success: true });
});

app.get('/stats/outings/categories', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT category, ROUND(SUM(item_price)::numeric, 2) as total_spent, COUNT(*) as item_count
        FROM outing_items
        ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
        GROUP BY category ORDER BY total_spent DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

app.get('/stats/outings/places', async (req, res) => {
    const { from, to } = req.query;
    const f = from && to;
    const result = await db.query(`
        SELECT place_name, ROUND(SUM(receipt_total)::numeric, 2) as total_spent, COUNT(*) as visit_count
        FROM (
            SELECT place_name, created_at, MAX(receipt_total) as receipt_total
            FROM outing_items
            ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
            GROUP BY place_name, created_at
        ) t
        GROUP BY place_name ORDER BY total_spent DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

app.get('/stats/outings/monthly', async (req, res) => {
    const result = await db.query(`
        SELECT month, ROUND(SUM(receipt_total)::numeric, 2) as total_spent
        FROM (
            SELECT TO_CHAR(date::date, 'YYYY-MM') as month, created_at, MAX(receipt_total) as receipt_total
            FROM outing_items
            WHERE date IS NOT NULL
            GROUP BY month, created_at
        ) t
        GROUP BY month ORDER BY month DESC
    `);
    res.json(result.rows);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
