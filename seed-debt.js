require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    // Insert the debt
    const debtRes = await db.query(
        `INSERT INTO debts (name, total_amount, monthly_payment, start_date, notes, payment_currency)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
            'TC Central Bank Scholarship',
            44513.32,
            100.00,
            '2026-04-20',
            'Scholarship loan — paid in TRY, converted to GBP by TC Central Bank each month',
            'TRY'
        ]
    );
    const debtId = debtRes.rows[0].id;
    console.log('Created debt ID:', debtId);

    // Payment schedule (48 payments)
    const payments = [
        { seq: 1,  due_date: '2026-04-20', amount: 100.00 },
        { seq: 2,  due_date: '2026-05-20', amount: 100.00 },
        { seq: 3,  due_date: '2026-06-20', amount: 100.00 },
        { seq: 4,  due_date: '2026-07-20', amount: 100.00 },
        { seq: 5,  due_date: '2026-08-20', amount: 100.00 },
        { seq: 6,  due_date: '2026-09-20', amount: 100.00 },
        { seq: 7,  due_date: '2026-10-20', amount: 100.00 },
        { seq: 8,  due_date: '2026-11-20', amount: 100.00 },
        { seq: 9,  due_date: '2026-12-20', amount: 100.00 },
        { seq: 10, due_date: '2027-01-20', amount: 100.00 },
        { seq: 11, due_date: '2027-02-20', amount: 100.00 },
        { seq: 12, due_date: '2027-03-20', amount: 3351.33 },
        { seq: 13, due_date: '2027-04-20', amount: 100.00 },
        { seq: 14, due_date: '2027-05-20', amount: 100.00 },
        { seq: 15, due_date: '2027-06-20', amount: 100.00 },
        { seq: 16, due_date: '2027-07-20', amount: 100.00 },
        { seq: 17, due_date: '2027-08-20', amount: 100.00 },
        { seq: 18, due_date: '2027-09-20', amount: 100.00 },
        { seq: 19, due_date: '2027-10-20', amount: 100.00 },
        { seq: 20, due_date: '2027-11-20', amount: 100.00 },
        { seq: 21, due_date: '2027-12-20', amount: 100.00 },
        { seq: 22, due_date: '2028-01-20', amount: 100.00 },
        { seq: 23, due_date: '2028-02-20', amount: 100.00 },
        { seq: 24, due_date: '2028-03-20', amount: 7802.67 },
        { seq: 25, due_date: '2028-04-20', amount: 1112.83 },
        { seq: 26, due_date: '2028-05-20', amount: 1112.83 },
        { seq: 27, due_date: '2028-06-20', amount: 1112.83 },
        { seq: 28, due_date: '2028-07-20', amount: 1112.83 },
        { seq: 29, due_date: '2028-08-20', amount: 1112.83 },
        { seq: 30, due_date: '2028-09-20', amount: 1112.83 },
        { seq: 31, due_date: '2028-10-20', amount: 1112.83 },
        { seq: 32, due_date: '2028-11-20', amount: 1112.83 },
        { seq: 33, due_date: '2028-12-20', amount: 1112.83 },
        { seq: 34, due_date: '2029-01-20', amount: 1112.83 },
        { seq: 35, due_date: '2029-02-20', amount: 1112.83 },
        { seq: 36, due_date: '2029-03-20', amount: 1112.83 },
        { seq: 37, due_date: '2029-04-20', amount: 1483.78 },
        { seq: 38, due_date: '2029-05-20', amount: 1483.78 },
        { seq: 39, due_date: '2029-06-20', amount: 1483.78 },
        { seq: 40, due_date: '2029-07-20', amount: 1483.78 },
        { seq: 41, due_date: '2029-08-20', amount: 1483.78 },
        { seq: 42, due_date: '2029-09-20', amount: 1483.78 },
        { seq: 43, due_date: '2029-10-20', amount: 1483.78 },
        { seq: 44, due_date: '2029-11-20', amount: 1483.78 },
        { seq: 45, due_date: '2029-12-20', amount: 1483.78 },
        { seq: 46, due_date: '2030-01-20', amount: 1483.78 },
        { seq: 47, due_date: '2030-02-20', amount: 1483.78 },
        { seq: 48, due_date: '2030-03-20', amount: 1483.78 },
    ];

    for (const p of payments) {
        await db.query(
            `INSERT INTO debt_payment_schedule (debt_id, seq, due_date, amount_gbp) VALUES ($1, $2, $3, $4)`,
            [debtId, p.seq, p.due_date, p.amount]
        );
    }

    // Update total_amount to the exact schedule sum
    const total = payments.reduce((s, p) => s + p.amount, 0);
    await db.query(`UPDATE debts SET total_amount = $1 WHERE id = $2`, [Math.round(total * 100) / 100, debtId]);

    console.log(`Inserted ${payments.length} payments. Total: £${total.toFixed(2)}`);
    console.log('Done! You can now delete this file.');
    await db.end();
}

run().catch(err => { console.error(err); process.exit(1); });
