require('dotenv').config();

const express = require('express');
const app = express();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3001;

const Anthropic = require('@anthropic-ai/sdk');
const Database = require('better-sqlite3');
const fs = require('fs');

const anthropic = new Anthropic();
const db = new Database('receipts.db');

// One row per item — makes filtering and analysis easy
db.exec(`
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        shop_name TEXT,
        category TEXT,
        item_name TEXT,
        item_price REAL,
        receipt_total REAL,
        created_at TEXT
    )
`);

app.use(express.static('public'));

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

        const stmt = db.prepare(`
            INSERT INTO items (date, shop_name, category, item_name, item_price, receipt_total, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of receipt.items) {
            stmt.run(
                receipt.date,
                receipt.shop_name,
                item.category,
                item.name,
                parseFloat(item.price) || 0,
                receipt.total,
                createdAt
            );
        }

        fs.unlinkSync(req.file.path);

        res.json(receipt);

    } catch (error) {
        console.error('Upload error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Spending by shop
app.get('/stats/shops', (req, res) => {
    const rows = db.prepare(`
        SELECT shop_name, ROUND(SUM(item_price), 2) as total_spent, COUNT(*) as item_count
        FROM items
        GROUP BY shop_name
        ORDER BY total_spent DESC
    `).all();
    res.json(rows);
});

// Spending by category
app.get('/stats/categories', (req, res) => {
    const rows = db.prepare(`
        SELECT category, ROUND(SUM(item_price), 2) as total_spent, COUNT(*) as item_count
        FROM items
        GROUP BY category
        ORDER BY total_spent DESC
    `).all();
    res.json(rows);
});

// Most frequently bought items
app.get('/stats/frequent-items', (req, res) => {
    const rows = db.prepare(`
        SELECT item_name, category, COUNT(*) as times_bought, ROUND(SUM(item_price), 2) as total_spent
        FROM items
        GROUP BY item_name
        ORDER BY times_bought DESC
        LIMIT 20
    `).all();
    res.json(rows);
});

// Spending by month
app.get('/stats/monthly', (req, res) => {
    const rows = db.prepare(`
        SELECT strftime('%Y-%m', date) as month, ROUND(SUM(item_price), 2) as total_spent
        FROM items
        WHERE date IS NOT NULL
        GROUP BY month
        ORDER BY month DESC
    `).all();
    res.json(rows);
});

// All receipts grouped for history display
app.get('/receipts', (req, res) => {
    const rows = db.prepare(`
        SELECT created_at, shop_name, date, receipt_total
        FROM items
        GROUP BY created_at
        ORDER BY created_at DESC
    `).all();
    res.json(rows);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
