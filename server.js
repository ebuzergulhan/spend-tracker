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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
