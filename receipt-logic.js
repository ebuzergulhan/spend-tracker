// receipt-logic.js — prompt, parsing and checks for grocery receipt scans.
// No dependencies, so it can be tested on its own (server.js does the API call).

const CATEGORIES = ['Groceries', 'Vegetables', 'Fruit', 'Dairy', 'Meat & Fish', 'Bakery', 'Drinks', 'Snacks',
    'Household', 'Clothing', 'Electronics', 'Fuel', 'Restaurant', 'Health', 'Discount', 'Other'];

// Cheap model first; the stronger one only re-reads receipts whose sums don't add up.
const SCAN_MODEL_FAST = 'claude-haiku-4-5';
const SCAN_MODEL_STRONG = 'claude-sonnet-5';

const RECEIPT_PROMPT = `You are reading a photo of a UK shop receipt (supermarket, Amazon, pharmacy, etc.). Return ONLY a valid JSON object (no markdown, no code fences) with exactly this structure:
{
  "shop_name": "store brand only, e.g. Tesco, Aldi, Morrisons, Sainsbury's, Amazon",
  "date_raw": "the purchase date EXACTLY as printed, e.g. 23/09/2026 or 23.09.26, or null if not visible",
  "date": "the same date as YYYY-MM-DD, or null",
  "subtotal": 0.00,
  "savings": 0.00,
  "total": 0.00,
  "items": [
    { "name": "product name", "price": 0.00, "quantity": 1, "category": "${CATEGORIES.join('|')}" }
  ]
}

How UK receipts are laid out. Follow these rules exactly:
1. DATES ARE DAY-FIRST: DD/MM/YYYY or DD/MM/YY. 23/09/2026 is 23 September 2026, so "date" is "2026-09-23". 03/09/26 is 3 September 2026. Never read a UK date month-first.
2. ONE item per product. A product name often wraps onto 2 or 3 lines: join those lines into one name. The product's price is the amount on the right of its first line.
3. QUANTITY: a number printed at the far LEFT of a product line (e.g. "2 Cadbury ...") is the quantity. A following line like "£1.40 each", "2 @ £1.40" or "2 x £0.89" (a count times a MONEY amount) confirms the unit price; it is NOT a separate item. With no such number, quantity is 1.
4. PACK SIZES ARE NOT QUANTITIES: "6x25g", "4 X 18g", "3 X 20g", "4x85g", "12 pack", "6 x 330ml" are part of the product name. Keep them in the name and do NOT use them as the quantity.
5. "price" is the LINE TOTAL printed on the right (the cost of all units). Never divide it. Letters after a price such as "1.25 A" or "0.89 B" are VAT codes: ignore them.
6. LOYALTY AND OFFER LINES belong to the product above them and are NOT products. Examples: "Cc £1.50" (Tesco Clubcard price), "Clubcard Price", "Nectar Price", "More Card", "Price Match", "Price Reduced", "Multibuy", "2 for £3". The amount on the LEFT of such a line (the "Cc £1.50" part) is only the reduced price: ignore it. The NEGATIVE amount on the right (e.g. "-£0.70") is the saving: add exactly ONE item {"name": "<product> saving", "price": -0.70, "quantity": 1, "category": "Discount"}.
7. THE SUMMARY SECTION IS NOT ITEMS. Never add Subtotal, Savings, Promotions, Total savings, Total, Balance due, Card, Cash, Change, VAT, points, or payment lines as items. Use them to fill "subtotal", "savings" (a positive number, 0 if none) and "total".
8. CANCELLED or VOIDED items: if an item is followed by "ITEM CANCELLED" or "VOID" and a matching negative amount, leave both out.
9. The same product on separate lines stays as separate items, quantity 1 each.
10. CHECK YOUR WORK before answering: the non-Discount prices must add up to "subtotal", the Discount prices must add up to minus "savings", and all item prices together must equal "total". If they do not match, re-read the receipt line by line and fix the items.
11. All numbers are plain decimals with no currency symbols.`;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function round2(n) { return Math.round(n * 100) / 100; }

function isoFromParts(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null; // e.g. 31/02
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Parse a date as printed on a UK receipt. Numeric dates are always day-first.
function parseUkDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoFromParts(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
        let y = +m[3];
        if (y < 100) y += 2000;
        return isoFromParts(y, +m[2], +m[1]);
    }
    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})/);
    if (m) {
        const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
        let y = +m[3];
        if (y < 100) y += 2000;
        if (mon >= 0) return isoFromParts(y, mon + 1, +m[1]);
    }
    return null;
}

// Today's date in the UK (the server itself may run on UTC in another country).
function londonToday(now = new Date()) {
    return now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}
function addDays(iso, days) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// A receipt date is accepted if it's a real date and not later than tomorrow (UK time).
function validReceiptDate(iso, today = londonToday()) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    if (!isoFromParts(+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10))) return null;
    return iso <= addDays(today, 1) ? iso : null;
}

// Pull the JSON object out of the model's reply (tolerates code fences and stray text).
function parseReceiptText(text) {
    const clean = String(text || '').replace(/```json\n?|\n?```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No JSON found in the scan result');
    return JSON.parse(clean.slice(start, end + 1));
}

// Clean up the model's output and check whether its sums match the receipt.
function normalizeReceipt(r, today = londonToday()) {
    const items = (Array.isArray(r.items) ? r.items : [])
        .map(it => {
            let price = round2(num(it.price));
            let category = CATEGORIES.includes(it.category) ? it.category : (price < 0 ? 'Discount' : 'Other');
            if (category === 'Discount' && price > 0) price = -price;
            const qty = num(it.quantity);
            return { name: String(it.name || '').trim(), price, quantity: qty > 0 ? qty : 1, category };
        })
        .filter(it => it.name);

    const fromPrinted = validReceiptDate(parseUkDate(r.date_raw), today);
    const fromModel = validReceiptDate(parseUkDate(r.date), today);
    const date = fromPrinted || fromModel || null;

    const total = round2(num(r.total));
    const itemsSum = round2(items.reduce((s, it) => s + it.price, 0));
    const ok = total > 0 && items.length > 0 && Math.abs(itemsSum - total) < 0.02;

    return {
        shop_name: String(r.shop_name || 'Unknown shop').trim(),
        date,
        date_raw: r.date_raw || null,
        date_source: fromPrinted ? 'printed' : fromModel ? 'model' : null,
        subtotal: r.subtotal == null ? null : round2(num(r.subtotal)),
        savings: r.savings == null ? null : round2(Math.abs(num(r.savings))),
        total,
        items,
        check: {
            ok,
            items_sum: itemsSum,
            total,
            reason: ok ? null : `Items add up to £${itemsSum.toFixed(2)} but the receipt total is £${total.toFixed(2)}`,
        },
    };
}

module.exports = {
    CATEGORIES, SCAN_MODEL_FAST, SCAN_MODEL_STRONG, RECEIPT_PROMPT,
    parseUkDate, londonToday, addDays, validReceiptDate, parseReceiptText, normalizeReceipt,
};
