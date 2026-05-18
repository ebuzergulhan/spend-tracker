require('dotenv').config();

const express = require('express');
const app = express();
const path = require('path');
const multer = require('multer');
const upload = multer({ dest: 'uploads/receipts-tmp/' });
const debtDocUpload = multer({ dest: 'uploads/debt-docs/' });
const paymentReceiptUpload = multer({ dest: 'uploads/debt-receipts/' });
const PORT = process.env.PORT || 3001;

const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');
const fs = require('fs');
if (!fs.existsSync('uploads/debt-docs')) fs.mkdirSync('uploads/debt-docs', { recursive: true });
if (!fs.existsSync('uploads/debt-receipts')) fs.mkdirSync('uploads/debt-receipts', { recursive: true });
if (!fs.existsSync('uploads/receipts')) fs.mkdirSync('uploads/receipts', { recursive: true });
if (!fs.existsSync('uploads/receipts-tmp')) fs.mkdirSync('uploads/receipts-tmp', { recursive: true });

const anthropic = new Anthropic();

const db = new Pool({
    connectionString: process.env.DATABASE_URL
});


app.get('/', (req, res) => res.redirect('/home.html'));
app.use(express.static('public'));
// Serve debt docs with original filename so browser can display/download correctly
const MIME = { '.pdf':'application/pdf', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.doc':'application/msword', '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
app.get('/uploads/debt-docs/:filename', async (req, res) => {
    try {
        const row = await db.query(`SELECT original_name FROM debt_documents WHERE filename=$1`, [req.params.filename]);
        const name = row.rows[0]?.original_name || req.params.filename;
        const ext  = path.extname(name).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${name}"`);
        res.sendFile(path.resolve('uploads/debt-docs', req.params.filename));
    } catch { res.status(404).send('Not found'); }
});
app.get('/uploads/debt-receipts/:filename', async (req, res) => {
    try {
        const fn = req.params.filename;
        const r1 = await db.query(`SELECT receipt_original_name FROM debt_actual_payments WHERE receipt_filename=$1`, [fn]);
        const r2 = r1.rows[0] ? r1 : await db.query(`SELECT receipt_original_name FROM debt_payment_schedule WHERE receipt_filename=$1`, [fn]);
        const name = r2.rows[0]?.receipt_original_name || fn;
        const ext  = path.extname(name).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${name}"`);
        res.sendFile(path.resolve('uploads/debt-receipts', fn));
    } catch { res.status(404).send('Not found'); }
});
app.get('/uploads/receipts/:filename', (req, res) => {
    const fp = path.resolve('uploads/receipts', req.params.filename);
    if (!fs.existsSync(fp)) return res.status(404).send('Not found');
    const ext = path.extname(req.params.filename).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
    res.sendFile(fp);
});
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
                            text: `Extract receipt details and return ONLY a valid JSON object with this exact structure:
{
  "shop_name": "store name",
  "date": "YYYY-MM-DD or null if not visible",
  "total": 0.00,
  "items": [
    { "name": "item name", "price": 0.00, "quantity": 1, "category": "Groceries|Vegetables|Fruit|Dairy|Meat & Fish|Bakery|Drinks|Snacks|Household|Clothing|Electronics|Fuel|Restaurant|Health|Discount|Other" }
  ]
}

Rules:
1. CANCELLED items: if an item is followed by "ITEM CANCELLED" and a matching negative charge, exclude BOTH lines — they were voided and cost nothing.
2. Discount/savings lines (e.g. "Nectar Price Saving", "Special Offer", "X for £Y" promotions): include as a separate item with a NEGATIVE price and category "Discount". Do NOT subtract from the item price directly.
3. Prices shown are LINE TOTALS — the total cost for that quantity. Do not divide them.
4. Quantity in item name: if a name ends with "X4", "X2" etc., or starts with "2 X", "3 X" etc., set quantity to that number. The price is still the line total for all units.
5. If the same item appears as separate lines (e.g. AVOCADO listed twice at £0.88 each), keep them as separate items with quantity 1 each.
6. All numbers are plain decimals, no currency symbols.`
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

        // Move to permanent receipts folder with a readable name
        const ext = path.extname(req.file.originalname || '.jpg').toLowerCase() || '.jpg';
        const safeName = receipt.shop_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const receiptFilename = `${Date.now()}_${safeName}${ext}`;
        fs.renameSync(req.file.path, `uploads/receipts/${receiptFilename}`);
        receipt.image_filename = receiptFilename;

        res.json(receipt);

    } catch (error) {
        console.error('Upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Save a reviewed/confirmed receipt to the database
app.post('/receipts/confirm', async (req, res) => {
    try {
        const { shop_name, date, total, items, image_filename } = req.body;
        const today = new Date().toISOString().split('T')[0];
        const receiptDate = (date && date !== 'null' && date <= today) ? date : null;
        const receiptTotal = parseFloat(total) || 0;
        const normalizedShop = await normalizeShopName(shop_name);

        const duplicate = await db.query(
            `SELECT id FROM items WHERE shop_name = $1 AND date = $2 AND receipt_total = $3 LIMIT 1`,
            [normalizedShop, receiptDate, receiptTotal]
        );
        if (duplicate.rows.length > 0) {
            if (image_filename && fs.existsSync(`uploads/receipts/${image_filename}`)) {
                fs.unlinkSync(`uploads/receipts/${image_filename}`);
            }
            return res.status(409).json({ error: 'This receipt has already been saved.' });
        }

        const createdAt = new Date().toISOString();
        for (const item of items) {
            const qty = parseFloat(item.quantity) || 1;
            const linePrice = parseFloat(item.price) || 0;
            await db.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, quantity, unit_price, receipt_total, created_at, receipt_image)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [receiptDate, normalizedShop, item.category, item.name, linePrice, qty, qty > 0 ? linePrice / qty : linePrice, receiptTotal, createdAt, image_filename || null]
            );
        }

        res.json({ success: true, shop_name: normalizedShop, item_count: items.length });
    } catch (error) {
        console.error('Confirm save error:', error.message);
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
        SELECT created_at, shop_name, date, receipt_total, MAX(receipt_image) AS receipt_image
        FROM items
        ${f ? 'WHERE date >= $1 AND date <= $2' : ''}
        GROUP BY created_at, shop_name, date, receipt_total
        ORDER BY date DESC NULLS LAST, created_at DESC
    `, f ? [from, to] : []);
    res.json(result.rows);
});

// Get all items for a single receipt
app.get('/receipts/:created_at/items', async (req, res) => {
    const result = await db.query(
        `SELECT id, item_name, item_price, quantity, unit_price, category, receipt_image FROM items WHERE created_at = $1 ORDER BY id`,
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

        // Preserve the receipt image filename before deleting rows
        const imgRow = await db.query(`SELECT receipt_image FROM items WHERE created_at = $1 LIMIT 1`, [createdAt]);
        const receiptImage = imgRow.rows[0]?.receipt_image || null;

        await db.query(`DELETE FROM items WHERE created_at = $1`, [createdAt]);

        for (const item of items) {
            const qty = parseFloat(item.quantity) || 1;
            const linePrice = parseFloat(item.price) || 0;
            const unitPrice = item.unit_price != null ? parseFloat(item.unit_price) : (qty > 0 ? linePrice / qty : linePrice);
            await db.query(
                `INSERT INTO items (date, shop_name, category, item_name, item_price, quantity, unit_price, receipt_total, created_at, receipt_image)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [date || null, shop_name, item.category, item.name, linePrice, qty, unitPrice, receiptTotal, createdAt, receiptImage]
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
                `INSERT INTO items (date, shop_name, category, item_name, item_price, quantity, receipt_total, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [date, shop_name, item.category, item.name, parseFloat(item.price) || 0, parseFloat(item.quantity) || 1, receiptTotal, createdAt]
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
    await db.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS payment_currency TEXT DEFAULT 'GBP'`);
    await db.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS monthly_payment_foreign NUMERIC(10,2)`);
    await db.query(`
        CREATE TABLE IF NOT EXISTS debt_actual_payments (
            id SERIAL PRIMARY KEY,
            debt_id INTEGER REFERENCES debts(id) ON DELETE CASCADE,
            payment_date DATE NOT NULL,
            amount_try NUMERIC(12,2),
            amount_gbp NUMERIC(10,2) NOT NULL,
            notes TEXT,
            receipt_filename TEXT,
            receipt_original_name TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS debt_payment_schedule (
            id SERIAL PRIMARY KEY,
            debt_id INTEGER REFERENCES debts(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL,
            due_date DATE NOT NULL,
            amount_gbp NUMERIC(10,2) NOT NULL,
            is_paid BOOLEAN DEFAULT FALSE,
            receipt_filename TEXT,
            receipt_original_name TEXT,
            paid_at TIMESTAMPTZ
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS debt_documents (
            id SERIAL PRIMARY KEY,
            debt_id INTEGER REFERENCES debts(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            uploaded_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS shopping_items (
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
    await db.query(`ALTER TABLE outing_items ADD COLUMN IF NOT EXISTS trip_name TEXT`);
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS quantity NUMERIC(8,3) DEFAULT 1`);
    await db.query(`ALTER TABLE outing_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(8,3) DEFAULT 1`);
    await db.query(`ALTER TABLE shopping_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(8,3) DEFAULT 1`);
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,4)`);
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS receipt_image TEXT`);
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

    const [groceries, outabout, shopping, logs, allRecurring] = await Promise.all([
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
            SELECT ROUND(SUM(receipt_total)::numeric, 2) as total
            FROM (
                SELECT created_at, MAX(receipt_total) as receipt_total
                FROM shopping_items
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
        shopping: (parseFloat(shopping.rows[0]?.total) || 0) + (recurringMap['shopping'] || 0),
        bills: logMap['bill'] || 0,
        transport: (recurringMap['transport'] || 0) + (logMap['transport'] || 0) + (logMap['fuel'] || 0),
        fixed: recurringMap['fixed'] || 0,
        subscriptions: recurringMap['subscription'] || 0
    });
});

// ─── Debts ───────────────────────────────────────────────────────────────────

app.get('/debts', async (req, res) => {
    const result = await db.query(`
        SELECT d.*,
            COALESCE(s.schedule_count, 0) AS schedule_count,
            COALESCE(s.total_scheduled, 0) AS total_scheduled,
            s.last_due_date,
            COALESCE(ap.actual_payment_count, 0) AS actual_payment_count,
            COALESCE(ap.actual_paid_gbp, 0) AS actual_paid_gbp
        FROM debts d
        LEFT JOIN (
            SELECT debt_id,
                COUNT(*)::int AS schedule_count,
                SUM(amount_gbp) AS total_scheduled,
                MAX(due_date) AS last_due_date
            FROM debt_payment_schedule GROUP BY debt_id
        ) s ON s.debt_id = d.id
        LEFT JOIN (
            SELECT debt_id,
                COUNT(*)::int AS actual_payment_count,
                SUM(amount_gbp) AS actual_paid_gbp
            FROM debt_actual_payments GROUP BY debt_id
        ) ap ON ap.debt_id = d.id
        ORDER BY d.created_at DESC
    `);
    res.json(result.rows);
});

app.post('/debts', async (req, res) => {
    try {
        const { name, total_amount, monthly_payment, start_date, notes, payment_currency, monthly_payment_foreign } = req.body;
        const result = await db.query(
            `INSERT INTO debts (name, total_amount, monthly_payment, start_date, notes, payment_currency, monthly_payment_foreign)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, parseFloat(total_amount), parseFloat(monthly_payment), start_date, notes || null,
             payment_currency || 'GBP', monthly_payment_foreign ? parseFloat(monthly_payment_foreign) : null]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/debts/:id', async (req, res) => {
    try {
        const { name, total_amount, monthly_payment, start_date, notes, payment_currency, monthly_payment_foreign } = req.body;
        const result = await db.query(
            `UPDATE debts SET name=$1, total_amount=$2, monthly_payment=$3, start_date=$4, notes=$5,
             payment_currency=$6, monthly_payment_foreign=$7 WHERE id=$8 RETURNING *`,
            [name, parseFloat(total_amount), parseFloat(monthly_payment), start_date, notes || null,
             payment_currency || 'GBP', monthly_payment_foreign ? parseFloat(monthly_payment_foreign) : null, req.params.id]
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

app.post('/debts/:id/upload', debtDocUpload.single('document'), async (req, res) => {
    try {
        const result = await db.query(
            `INSERT INTO debt_documents (debt_id, filename, original_name) VALUES ($1, $2, $3) RETURNING *`,
            [req.params.id, req.file.filename, req.file.originalname]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/debts/:id/documents', async (req, res) => {
    const result = await db.query(
        `SELECT * FROM debt_documents WHERE debt_id = $1 ORDER BY uploaded_at DESC`, [req.params.id]
    );
    res.json(result.rows);
});

app.delete('/debt-documents/:id', async (req, res) => {
    try {
        const doc = await db.query(`SELECT filename FROM debt_documents WHERE id = $1`, [req.params.id]);
        if (doc.rows[0]) {
            const fp = `uploads/debt-docs/${doc.rows[0].filename}`;
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        await db.query(`DELETE FROM debt_documents WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Exchange Rate ───────────────────────────────────────────────────────────

app.get('/api/exchange-rate', async (req, res) => {
    const from     = (req.query.from || 'TRY').toUpperCase();
    const to       = (req.query.to   || 'GBP').toUpperCase();
    const dateParam = req.query.date; // YYYY-MM-DD

    // Resolve the TCMB URL for a given date, skipping weekends back to Friday
    function tcmbUrl(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const today = new Date();
        if (d > today) { d.setTime(today.getTime()); }
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
        const dd   = String(d.getDate()).padStart(2, '0');
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;
    }

    const url = dateParam ? tcmbUrl(dateParam) : 'https://www.tcmb.gov.tr/kurlar/today.xml';

    try {
        const xml = await fetch(url).then(r => r.text());
        const re  = new RegExp(`<Currency[^>]*CurrencyCode="${to}"[^>]*>[\\s\\S]*?<ForexSelling>([\\d.]+)<\\/ForexSelling>`, 'i');
        const match = xml.match(re);
        if (!match) throw new Error(`${to} not found in TCMB response`);
        // Parse the date from the XML header e.g. Date="16/05/2026"
        const xmlDate = (xml.match(/Date="(\d{2})\/(\d{2})\/(\d{4})"/) || []);
        const rateDate = xmlDate.length ? `${xmlDate[3]}-${xmlDate[2]}-${xmlDate[1]}` : dateParam || 'today';
        const tryPerForeign = parseFloat(match[1]);
        const rate = 1 / tryPerForeign;
        return res.json({ rate, inverse: tryPerForeign, source: 'TCMB', date: rateDate });
    } catch (tcmbErr) {
        try {
            const fbUrl = dateParam
                ? `https://api.frankfurter.app/${dateParam}?from=${from}&to=${to}`
                : `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
            const data = await fetch(fbUrl).then(r => r.json());
            const rate = data.rates[to];
            return res.json({ rate, inverse: 1 / rate, source: 'Frankfurter', date: data.date });
        } catch {
            res.status(503).json({ error: 'Exchange rate unavailable. Try again or enter manually.' });
        }
    }
});

// ─── Debt Actual Payments ────────────────────────────────────────────────────

app.get('/debts/:id/actual-payments', async (req, res) => {
    const result = await db.query(
        `SELECT * FROM debt_actual_payments WHERE debt_id = $1 ORDER BY payment_date DESC, created_at DESC`,
        [req.params.id]
    );
    res.json(result.rows);
});

app.post('/debts/:id/actual-payments', paymentReceiptUpload.single('receipt'), async (req, res) => {
    try {
        const { payment_date, amount_try, amount_gbp, notes } = req.body;
        let receiptOriginalName = null;
        if (req.file) {
            const debtRow = await db.query(`SELECT payment_currency FROM debts WHERE id = $1`, [req.params.id]);
            const currency = debtRow.rows[0]?.payment_currency || 'GBP';
            const ext = path.extname(req.file.originalname).toLowerCase();
            receiptOriginalName = `${payment_date}_${currency}_receipt${ext}`;
        }
        const result = await db.query(
            `INSERT INTO debt_actual_payments (debt_id, payment_date, amount_try, amount_gbp, notes, receipt_filename, receipt_original_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [req.params.id, payment_date,
             amount_try ? parseFloat(amount_try) : null,
             parseFloat(amount_gbp),
             notes || null,
             req.file ? req.file.filename : null,
             receiptOriginalName]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/debt-actual-payments/:id', paymentReceiptUpload.single('receipt'), async (req, res) => {
    try {
        const { payment_date, amount_try, amount_gbp, notes, remove_file } = req.body;
        const existing = await db.query(`SELECT * FROM debt_actual_payments WHERE id = $1`, [req.params.id]);
        if (!existing.rows[0]) return res.status(404).json({ error: 'Not found' });

        let receiptFilename = existing.rows[0].receipt_filename;
        let receiptOriginalName = existing.rows[0].receipt_original_name;

        if ((remove_file === 'true' || req.file) && receiptFilename) {
            const fp = `uploads/debt-receipts/${receiptFilename}`;
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
            receiptFilename = null;
            receiptOriginalName = null;
        }

        if (req.file) {
            const debtRow = await db.query(`SELECT payment_currency FROM debts WHERE id = (SELECT debt_id FROM debt_actual_payments WHERE id = $1)`, [req.params.id]);
            const currency = debtRow.rows[0]?.payment_currency || 'GBP';
            const ext = path.extname(req.file.originalname).toLowerCase();
            receiptFilename = req.file.filename;
            receiptOriginalName = `${payment_date}_${currency}_receipt${ext}`;
        }

        const result = await db.query(
            `UPDATE debt_actual_payments SET payment_date=$1, amount_try=$2, amount_gbp=$3, notes=$4, receipt_filename=$5, receipt_original_name=$6 WHERE id=$7 RETURNING *`,
            [payment_date, amount_try ? parseFloat(amount_try) : null, parseFloat(amount_gbp), notes || null, receiptFilename, receiptOriginalName, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/debt-actual-payments/:id', async (req, res) => {
    try {
        const row = await db.query(`SELECT receipt_filename FROM debt_actual_payments WHERE id = $1`, [req.params.id]);
        if (row.rows[0]?.receipt_filename) {
            const fp = `uploads/debt-receipts/${row.rows[0].receipt_filename}`;
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        await db.query(`DELETE FROM debt_actual_payments WHERE id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Debt Payment Schedule ───────────────────────────────────────────────────

app.post('/debts/:id/payment-schedule', async (req, res) => {
    try {
        const { payments } = req.body; // [{seq, due_date, amount_gbp}]
        await db.query(`DELETE FROM debt_payment_schedule WHERE debt_id = $1`, [req.params.id]);
        for (const p of payments) {
            await db.query(
                `INSERT INTO debt_payment_schedule (debt_id, seq, due_date, amount_gbp) VALUES ($1, $2, $3, $4)`,
                [req.params.id, p.seq, p.due_date, parseFloat(p.amount_gbp)]
            );
        }
        const total = payments.reduce((s, p) => s + parseFloat(p.amount_gbp), 0);
        await db.query(`UPDATE debts SET total_amount = $1 WHERE id = $2`, [Math.round(total * 100) / 100, req.params.id]);
        res.json({ success: true, count: payments.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/debts/:id/payment-schedule', async (req, res) => {
    const result = await db.query(
        `SELECT * FROM debt_payment_schedule WHERE debt_id = $1 ORDER BY seq`,
        [req.params.id]
    );
    res.json(result.rows);
});

app.patch('/debt-payment-schedule/:id/paid', async (req, res) => {
    try {
        const row = await db.query(`SELECT is_paid FROM debt_payment_schedule WHERE id = $1`, [req.params.id]);
        const current = row.rows[0]?.is_paid;
        const result = await db.query(
            `UPDATE debt_payment_schedule SET is_paid = $1, paid_at = $2 WHERE id = $3 RETURNING *`,
            [!current, !current ? new Date() : null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/debt-payment-schedule/:id/receipt', paymentReceiptUpload.single('receipt'), async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE debt_payment_schedule SET receipt_filename=$1, receipt_original_name=$2 WHERE id=$3 RETURNING *`,
            [req.file.filename, req.file.originalname, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/debt-payment-schedule/:id/receipt', async (req, res) => {
    try {
        const row = await db.query(`SELECT receipt_filename FROM debt_payment_schedule WHERE id = $1`, [req.params.id]);
        if (row.rows[0]?.receipt_filename) {
            const fp = `uploads/debt-receipts/${row.rows[0].receipt_filename}`;
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
        const result = await db.query(
            `UPDATE debt_payment_schedule SET receipt_filename=NULL, receipt_original_name=NULL WHERE id=$1 RETURNING *`,
            [req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Shopping ────────────────────────────────────────────────────────────────

app.post('/upload/shopping', upload.single('receiptImage'), async (req, res) => {
    try {
        const imageData = fs.readFileSync(req.file.path);
        const base64Image = imageData.toString('base64');
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 2048,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64Image } },
                    { type: 'text', text: `Extract the receipt details and return ONLY a valid JSON object:
{
  "place_name": "shop or website name",
  "date": "YYYY-MM-DD or null",
  "total": 0.00,
  "items": [
    { "name": "item name", "price": 0.00, "quantity": 1, "category": "one of: Amazon, IKEA, Clothing, Electronics, Books, Sports, Home & Garden, Health & Beauty, Toys & Games, Food & Drink, Other" }
  ]
}
Total and price must be plain numbers only. No currency symbols. quantity is the number of units purchased (default 1).` }
                ]
            }]
        });
        const receipt = JSON.parse(response.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
        receipt.total = parseFloat(receipt.total) || 0;
        const createdAt = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];
        const receiptDate = (receipt.date && receipt.date !== 'null' && receipt.date <= today) ? receipt.date : null;

        const dup = await db.query(`SELECT id FROM shopping_items WHERE place_name=$1 AND date=$2 AND receipt_total=$3 LIMIT 1`,
            [receipt.place_name, receiptDate, receipt.total]);
        if (dup.rows.length > 0) { fs.unlinkSync(req.file.path); return res.status(409).json({ error: 'Already scanned.' }); }

        for (const item of receipt.items) {
            await db.query(`INSERT INTO shopping_items (date,place_name,category,item_name,item_price,quantity,receipt_total,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [receiptDate, receipt.place_name, item.category, item.name, parseFloat(item.price)||0, parseFloat(item.quantity)||1, receipt.total, createdAt]);
        }
        fs.unlinkSync(req.file.path);
        res.json(receipt);
    } catch (error) { console.error('Shopping upload error:', error.message); res.status(500).json({ error: error.message }); }
});

app.get('/shopping', async (req, res) => {
    const result = await db.query(`SELECT created_at,place_name,date,receipt_total FROM shopping_items GROUP BY created_at,place_name,date,receipt_total ORDER BY created_at DESC`);
    res.json(result.rows);
});
app.get('/shopping/:created_at/items', async (req, res) => {
    const result = await db.query(`SELECT item_name,item_price,quantity,category FROM shopping_items WHERE created_at=$1 ORDER BY id`, [req.params.created_at]);
    res.json(result.rows);
});
app.delete('/shopping/:created_at', async (req, res) => {
    await db.query(`DELETE FROM shopping_items WHERE created_at=$1`, [req.params.created_at]);
    res.json({ success: true });
});
app.get('/stats/shopping/categories', async (req, res) => {
    const { from, to } = req.query; const f = from && to;
    const result = await db.query(`SELECT category, ROUND(SUM(item_price)::numeric,2) as total_spent, COUNT(*) as item_count FROM shopping_items ${f?'WHERE date>=$1 AND date<=$2':''} GROUP BY category ORDER BY total_spent DESC`, f?[from,to]:[]);
    res.json(result.rows);
});
app.get('/stats/shopping/places', async (req, res) => {
    const { from, to } = req.query; const f = from && to;
    const result = await db.query(`SELECT place_name, ROUND(SUM(receipt_total)::numeric,2) as total_spent, COUNT(*) as order_count FROM (SELECT place_name,created_at,MAX(receipt_total) as receipt_total FROM shopping_items ${f?'WHERE date>=$1 AND date<=$2':''} GROUP BY place_name,created_at) t GROUP BY place_name ORDER BY total_spent DESC`, f?[from,to]:[]);
    res.json(result.rows);
});

// ─── Monthly Report ───────────────────────────────────────────────────────────

app.get('/report/monthly', async (req, res) => {
    const [grocRows, outRows, shopRows, logRows, recurRows] = await Promise.all([
        db.query(`SELECT TO_CHAR(date::date,'YYYY-MM') m, created_at, MAX(receipt_total) t FROM items WHERE date IS NOT NULL GROUP BY m,created_at`),
        db.query(`SELECT TO_CHAR(date::date,'YYYY-MM') m, created_at, MAX(receipt_total) t FROM outing_items WHERE date IS NOT NULL GROUP BY m,created_at`),
        db.query(`SELECT TO_CHAR(date::date,'YYYY-MM') m, created_at, MAX(receipt_total) t FROM shopping_items WHERE date IS NOT NULL GROUP BY m,created_at`),
        db.query(`SELECT TO_CHAR(date::date,'YYYY-MM') m, category, SUM(amount) t FROM expense_log WHERE date IS NOT NULL GROUP BY m,category`),
        db.query(`SELECT * FROM recurring_expenses`)
    ]);

    function toMonthly(amount, freq) {
        if (freq==='annual') return amount/12; if (freq==='weekly') return amount*52/12;
        if (freq==='quarterly') return amount/3; return amount;
    }
    function freqMonths(freq) {
        if (freq==='annual') return 12; if (freq==='quarterly') return 3;
        if (freq==='weekly') return 1/4.33; return 1;
    }

    // Collect all months
    const months = new Set();
    [...grocRows.rows,...outRows.rows,...shopRows.rows].forEach(r => months.add(r.m));
    logRows.rows.forEach(r => months.add(r.m));

    // Sum receipt-based tables by month
    const sumByMonth = (rows) => {
        const map = {};
        rows.forEach(r => { map[r.m] = (map[r.m]||0) + parseFloat(r.t); });
        return map;
    };
    const groc = sumByMonth(grocRows.rows);
    const out  = sumByMonth(outRows.rows);
    const shop = sumByMonth(shopRows.rows);

    // Sum expense_log by month+category
    const logMap = {};
    logRows.rows.forEach(r => {
        if (!logMap[r.m]) logMap[r.m] = {};
        logMap[r.m][r.category] = (logMap[r.m][r.category]||0) + parseFloat(r.t);
    });

    // Recurring monthly equivalent per month (check if installment was active)
    const now = new Date();
    const recurByCategory = {};
    recurRows.rows.forEach(r => {
        if (r.total_installments) {
            const start = new Date(r.start_date);
            const endMonth = new Date(start);
            endMonth.setMonth(endMonth.getMonth() + parseInt(r.total_installments) - 1);
            // Add to every month it was active
            const cur = new Date(start.getFullYear(), start.getMonth(), 1);
            while (cur <= endMonth && cur <= now) {
                const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
                months.add(key);
                if (!recurByCategory[key]) recurByCategory[key] = {};
                recurByCategory[key][r.category] = (recurByCategory[key][r.category]||0) + toMonthly(parseFloat(r.amount), r.frequency);
                cur.setMonth(cur.getMonth()+1);
            }
        } else {
            // Ongoing — add from start_date (or creation) to now
            const start = r.start_date ? new Date(r.start_date) : new Date(r.created_at);
            const cur = new Date(start.getFullYear(), start.getMonth(), 1);
            while (cur <= now) {
                const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
                months.add(key);
                if (!recurByCategory[key]) recurByCategory[key] = {};
                recurByCategory[key][r.category] = (recurByCategory[key][r.category]||0) + toMonthly(parseFloat(r.amount), r.frequency);
                cur.setMonth(cur.getMonth()+1);
            }
        }
    });

    const sorted = [...months].sort().reverse();
    const report = sorted.map(m => {
        const log = logMap[m] || {};
        const rec = recurByCategory[m] || {};
        return {
            month: m,
            groceries:     Math.round((groc[m]||0)*100)/100,
            outabout:      Math.round((out[m]||0)*100)/100,
            shopping:      Math.round((shop[m]||0)*100)/100,
            bills:         Math.round((log.bill||0)*100)/100,
            fuel:          Math.round((log.fuel||0)*100)/100,
            transport:     Math.round(((log.transport||0)+(rec.transport||0))*100)/100,
            fixed:         Math.round((rec.fixed||0)*100)/100,
            subscriptions: Math.round((rec.subscription||0)*100)/100,
        };
    });
    res.json(report);
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
    { "name": "item name", "price": 0.00, "quantity": 1, "category": "one of: Restaurant, Fast Food, Coffee & Drinks, Parking, Entertainment, Shopping, Health & Beauty, Hotel, Transport, Other" }
  ]
}
Total and price must be plain numbers only. No currency symbols. quantity is the number of units purchased (default 1).`
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

        const tripName = (req.body.trip_name || '').trim() || null;
        for (const item of receipt.items) {
            await db.query(
                `INSERT INTO outing_items (date, place_name, category, item_name, item_price, quantity, receipt_total, created_at, trip_name)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [receiptDate, receipt.place_name, item.category, item.name, parseFloat(item.price) || 0, parseFloat(item.quantity) || 1, receipt.total, createdAt, tripName]
            );
        }

        fs.unlinkSync(req.file.path);
        res.json(receipt);
    } catch (error) {
        console.error('Outing upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/outings/manual', async (req, res) => {
    try {
        const { place_name, amount, category, date, trip_name } = req.body;
        const createdAt = new Date().toISOString();
        await db.query(
            `INSERT INTO outing_items (date, place_name, category, item_name, item_price, receipt_total, created_at, trip_name)
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
            [date || null, place_name, category, place_name, parseFloat(amount) || 0, createdAt, (trip_name || '').trim() || null]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/outings', async (req, res) => {
    const result = await db.query(`
        SELECT created_at, place_name, date, receipt_total, trip_name
        FROM outing_items
        GROUP BY created_at, place_name, date, receipt_total, trip_name
        ORDER BY created_at DESC
    `);
    res.json(result.rows);
});

app.get('/outings/:created_at/items', async (req, res) => {
    const result = await db.query(
        `SELECT item_name, item_price, quantity, category FROM outing_items WHERE created_at = $1 ORDER BY id`,
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
