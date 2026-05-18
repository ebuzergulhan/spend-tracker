const TABS = ['upload', 'manual', 'dashboard', 'history'];

const categoryColors = {
    'Vegetables': 'bg-green-100 text-green-700',
    'Fruit': 'bg-orange-100 text-orange-700',
    'Dairy': 'bg-blue-100 text-blue-700',
    'Meat & Fish': 'bg-red-100 text-red-700',
    'Bakery': 'bg-yellow-100 text-yellow-700',
    'Drinks': 'bg-cyan-100 text-cyan-700',
    'Snacks': 'bg-pink-100 text-pink-700',
    'Household': 'bg-gray-100 text-gray-700',
    'Groceries': 'bg-emerald-100 text-emerald-700',
    'Health': 'bg-teal-100 text-teal-700',
    'Discount': 'bg-red-100 text-red-600',
};

const categories = ['Groceries', 'Vegetables', 'Fruit', 'Dairy', 'Meat & Fish', 'Bakery', 'Drinks', 'Snacks', 'Household', 'Clothing', 'Electronics', 'Fuel', 'Restaurant', 'Health', 'Other'];

// ── Modal ────────────────────────────────────────────────────────────────────
// type: 'alert' | 'confirm' | 'prompt'
// Returns: true (alert/confirm OK), false (confirm Cancel), string|null (prompt)
function showModal({ title, message, type = 'alert', inputDefault = '', confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
    return new Promise(resolve => {
        const overlay  = document.getElementById('modal-overlay');
        const card     = document.getElementById('modal-card');
        const titleEl  = document.getElementById('modal-title');
        const msgEl    = document.getElementById('modal-message');
        const inputWrap= document.getElementById('modal-input-wrap');
        const inputEl  = document.getElementById('modal-input');
        const buttonsEl= document.getElementById('modal-buttons');

        titleEl.textContent   = title || '';
        titleEl.className     = title ? 'font-semibold text-gray-800 mb-1' : 'hidden';
        msgEl.textContent     = message || '';
        buttonsEl.innerHTML   = '';
        card.className        = 'card p-6 w-full max-w-sm modal-animate';

        if (type === 'prompt') {
            inputWrap.classList.remove('hidden');
            inputEl.value = inputDefault;
            setTimeout(() => inputEl.focus(), 50);
        } else {
            inputWrap.classList.add('hidden');
        }

        const close = result => {
            overlay.classList.add('hidden');
            resolve(result);
        };

        if (type === 'confirm' || type === 'prompt') {
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = cancelLabel;
            cancelBtn.className = 'flex-1 border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-gray-50 transition';
            cancelBtn.onclick = () => close(type === 'prompt' ? null : false);
            buttonsEl.appendChild(cancelBtn);
        }

        const okBtn = document.createElement('button');
        okBtn.textContent = confirmLabel;
        okBtn.className = 'flex-1 gradient-bg text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition';
        okBtn.onclick = () => close(type === 'prompt' ? (inputEl.value.trim() || null) : true);
        buttonsEl.appendChild(okBtn);

        // Allow Enter key in prompt input
        inputEl.onkeydown = e => { if (e.key === 'Enter') okBtn.click(); };

        overlay.classList.remove('hidden');
    });
}
// ─────────────────────────────────────────────────────────────────────────────

// "2024-01-15" → "15 Jan 2024"
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'null') return null;
    const [year, month, day] = dateStr.split('-');
    return new Date(year, parseInt(month) - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "2024-01" → "Jan 2024"
function formatMonth(monthStr) {
    const [year, month] = monthStr.split('-');
    return new Date(year, parseInt(month) - 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}

// Returns { from, to } date strings for a period, or null for "all time"
function getPeriodDates(period) {
    if (period === 'all') return null;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (period === 'this-month')    return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),     to: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
    if (period === 'last-month')    return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmt(new Date(now.getFullYear(), now.getMonth(), 0)) };
    if (period === 'last-3-months') return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 3, 1)), to: fmt(now) };
    if (period === 'last-6-months') return { from: fmt(new Date(now.getFullYear(), now.getMonth() - 6, 1)), to: fmt(now) };
    if (period === 'this-year')     return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
    if (period === 'last-year')     return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` };
    return null;
}

let dashboardPeriod = 'all';

function setDashboardPeriod(period) {
    dashboardPeriod = period;
    loadDashboard();
}

// Tab navigation
function showTab(tab) {
    TABS.forEach(t => {
        document.getElementById('page-' + t).classList.add('hidden');
        document.getElementById('tab-' + t).classList.remove('active');
    });
    document.getElementById('page-' + tab).classList.remove('hidden');
    document.getElementById('tab-' + tab).classList.add('active');

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'history') loadHistory();
    if (tab === 'manual') initManualForm();
}

// Show selected filename
document.getElementById('receiptImage').addEventListener('change', function () {
    const nameEl = document.getElementById('fileName');
    if (this.files[0]) {
        nameEl.textContent = this.files[0].name;
        nameEl.classList.remove('hidden');
    }
});

// ── Scan review & confirm ─────────────────────────────────────────────────────
let pendingReceipt = null;

function scanItemRow(name, category, qty, lineTotal) {
    const isDiscount = lineTotal < 0;
    const unitPrice = qty > 0 ? lineTotal / qty : lineTotal;
    const safeName = name.replace(/"/g, '&quot;');
    return `
        <tr class="scan-row ${isDiscount ? 'bg-red-50' : ''} border-b border-gray-50 last:border-0"
            data-name="${safeName}" data-category="${category}">
            <td class="py-2 pr-2">
                <span class="text-xs px-1.5 py-0.5 rounded-full font-medium ${categoryColors[category] || 'bg-purple-100 text-purple-700'}">${category}</span>
                <span class="text-sm text-gray-700 ml-1">${name}</span>
            </td>
            <td class="py-2 pr-2 whitespace-nowrap">
                <input type="number" value="${qty % 1 === 0 ? parseInt(qty) : qty}" min="0.001" step="1"
                    class="scan-qty-input w-14 border border-gray-200 rounded-lg px-1 py-0.5 text-sm text-center focus:outline-none focus:border-purple-400"
                    oninput="updateScanRow(this)"/>
            </td>
            <td class="py-2 pr-2 whitespace-nowrap">
                <input type="number" value="${lineTotal.toFixed(2)}" step="0.01"
                    class="scan-total-input w-20 border border-gray-200 rounded-lg px-1 py-0.5 text-sm text-center focus:outline-none focus:border-purple-400 ${isDiscount ? 'text-red-500' : ''}"
                    oninput="updateScanRow(this)"/>
            </td>
            <td class="py-2 pr-2 text-xs text-purple-600 whitespace-nowrap scan-unit-display">£${unitPrice.toFixed(2)}</td>
            <td class="py-2">
                <button onclick="removeScanRow(this)" class="text-gray-300 hover:text-red-400 transition font-bold text-lg leading-none">×</button>
            </td>
        </tr>`;
}

function renderScanReview(receipt) {
    const calcTotal = receipt.items.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
    const itemRows = receipt.items.map(item =>
        scanItemRow(item.name, item.category, parseFloat(item.quantity) || 1, parseFloat(item.price) || 0)
    ).join('');

    document.getElementById('scan-card-title').textContent = 'Review & Confirm';
    document.getElementById('resultContent').innerHTML = `
        <div class="flex justify-between items-start mb-3">
            <div>
                <p class="font-semibold text-gray-800">${receipt.shop_name}</p>
                <p class="text-xs text-gray-400">${receipt.date ? formatDate(receipt.date) : 'Date unknown'}</p>
            </div>
            <p class="text-xl font-bold text-gray-800">£${parseFloat(receipt.total).toFixed(2)}</p>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left mb-2 text-sm">
                <thead>
                    <tr class="text-xs text-gray-400 font-medium">
                        <th class="pb-2">Item</th>
                        <th class="pb-2">Qty</th>
                        <th class="pb-2 whitespace-nowrap">Line Total</th>
                        <th class="pb-2 whitespace-nowrap">Unit Price</th>
                        <th class="pb-2"></th>
                    </tr>
                </thead>
                <tbody id="scan-items-body">${itemRows}</tbody>
            </table>
        </div>
        <button onclick="addScanItem()" class="text-xs text-purple-600 font-medium hover:text-purple-800 mb-3 flex items-center gap-1">
            <span class="text-base leading-none font-bold">+</span> Add missing item
        </button>
        <div id="scan-validation" class="mb-3">${buildValidationHtml(calcTotal, receipt.total)}</div>
        <button onclick="confirmSave()" id="confirm-save-btn"
            class="w-full gradient-bg text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 transition">
            Confirm &amp; Save to Database
        </button>
    `;
}

function buildValidationHtml(calcTotal, receiptTotal) {
    const diff = Math.abs(calcTotal - parseFloat(receiptTotal));
    const match = diff < 0.02;
    return `
        <div class="flex items-center gap-2 px-3 py-2.5 rounded-xl ${match ? 'bg-green-50' : 'bg-amber-50'}">
            <span class="text-base">${match ? '✓' : '⚠️'}</span>
            <span class="text-sm ${match ? 'text-green-700' : 'text-amber-700'} font-medium">Calculated: £${calcTotal.toFixed(2)}</span>
            <span class="text-gray-300 mx-1">|</span>
            <span class="text-xs ${match ? 'text-green-600' : 'text-amber-600'}">
                ${match ? 'Totals match — ready to save' : `Difference: £${diff.toFixed(2)} — adjust items above`}
            </span>
        </div>`;
}

function recalcScanValidation() {
    if (!pendingReceipt) return;
    let calcTotal = 0;
    document.querySelectorAll('#scan-items-body .scan-total-input').forEach(el => {
        calcTotal += parseFloat(el.value) || 0;
    });
    const valDiv = document.getElementById('scan-validation');
    if (valDiv) valDiv.innerHTML = buildValidationHtml(calcTotal, pendingReceipt.total);
}

function updateScanRow(inputEl) {
    const row = inputEl.closest('tr');
    const qty = parseFloat(row.querySelector('.scan-qty-input').value) || 1;
    const lineTotal = parseFloat(row.querySelector('.scan-total-input').value) || 0;
    const unitDisplay = row.querySelector('.scan-unit-display');
    if (unitDisplay) unitDisplay.textContent = qty > 0 ? `£${(lineTotal / qty).toFixed(2)}` : '—';
    recalcScanValidation();
}

function removeScanRow(btn) {
    btn.closest('tr').remove();
    recalcScanValidation();
}

function addScanItem() {
    const tbody = document.getElementById('scan-items-body');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'scan-row border-b border-gray-50 bg-blue-50/40';
    tr.dataset.name = '';
    tr.dataset.category = 'Groceries';
    tr.innerHTML = `
        <td class="py-2 pr-2">
            <select class="scan-cat-select text-xs border border-gray-200 rounded-lg px-1 py-0.5 mr-1 focus:outline-none focus:border-purple-400"
                onchange="this.closest('tr').dataset.category=this.value">
                ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <input type="text" placeholder="Item name"
                class="scan-name-input text-sm border border-gray-200 rounded-lg px-2 py-0.5 w-28 focus:outline-none focus:border-purple-400"
                oninput="this.closest('tr').dataset.name=this.value"/>
        </td>
        <td class="py-2 pr-2 whitespace-nowrap">
            <input type="number" value="1" min="0.001" step="1"
                class="scan-qty-input w-14 border border-gray-200 rounded-lg px-1 py-0.5 text-sm text-center focus:outline-none focus:border-purple-400"
                oninput="updateScanRow(this)"/>
        </td>
        <td class="py-2 pr-2 whitespace-nowrap">
            <input type="number" value="0.00" step="0.01"
                class="scan-total-input w-20 border border-gray-200 rounded-lg px-1 py-0.5 text-sm text-center focus:outline-none focus:border-purple-400"
                oninput="updateScanRow(this)"/>
        </td>
        <td class="py-2 pr-2 text-xs text-purple-600 whitespace-nowrap scan-unit-display">£0.0000</td>
        <td class="py-2">
            <button onclick="removeScanRow(this)" class="text-gray-300 hover:text-red-400 transition font-bold text-lg leading-none">×</button>
        </td>
    `;
    tbody.appendChild(tr);
    tr.querySelector('.scan-name-input').focus();
}

async function confirmSave() {
    if (!pendingReceipt) return;
    const btn = document.getElementById('confirm-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const items = [];
    document.querySelectorAll('#scan-items-body tr.scan-row').forEach(row => {
        const nameInput = row.querySelector('.scan-name-input');
        const name = nameInput ? nameInput.value.trim() : row.dataset.name;
        const category = row.dataset.category || 'Groceries';
        const qty = parseFloat(row.querySelector('.scan-qty-input')?.value) || 1;
        const price = parseFloat(row.querySelector('.scan-total-input')?.value) || 0;
        if (name) items.push({ name, price, quantity: qty, category });
    });

    try {
        const res = await fetch('/receipts/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop_name: pendingReceipt.shop_name, date: pendingReceipt.date, total: pendingReceipt.total, items, image_filename: pendingReceipt.image_filename || null })
        });
        const result = await res.json();

        if (result.error) {
            await showModal({ title: 'Save failed', message: result.error });
            if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Save to Database'; }
            return;
        }

        pendingReceipt = null;
        document.getElementById('resultCard').classList.add('hidden');
        document.getElementById('scan-card-title').textContent = 'Receipt Scanned';
        await showModal({ title: '✓ Saved', message: `${result.item_count} items from ${result.shop_name} saved successfully.` });
        loadDashboard();
    } catch (err) {
        await showModal({ title: 'Something went wrong', message: 'Could not save. Please try again.' });
        if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Save to Database'; }
    }
}

// Upload form
document.getElementById('uploadForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('receiptImage');
    if (!fileInput.files[0]) {
        await showModal({ title: 'No file selected', message: 'Please choose a receipt image before scanning.' });
        return;
    }

    document.getElementById('loadingMsg').classList.remove('hidden');
    document.getElementById('resultCard').classList.add('hidden');

    const formData = new FormData();
    formData.append('receiptImage', fileInput.files[0]);

    try {
        const response = await fetch('/upload', { method: 'POST', body: formData });
        const receipt = await response.json();

        if (receipt.error) {
            document.getElementById('loadingMsg').classList.add('hidden');
            await showModal({ title: 'Scan failed', message: receipt.error });
            return;
        }

        document.getElementById('loadingMsg').classList.add('hidden');
        document.getElementById('resultCard').classList.remove('hidden');
        document.getElementById('uploadForm').reset();
        document.getElementById('fileName').classList.add('hidden');

        pendingReceipt = receipt;
        renderScanReview(receipt);

    } catch (error) {
        document.getElementById('loadingMsg').classList.add('hidden');
        await showModal({ title: 'Something went wrong', message: 'Could not scan the receipt. Please try again.' });
        console.error(error);
    }
});

// Manual entry
function initManualForm() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('m-date').value = today;
    const container = document.getElementById('manualItems');
    if (container.children.length === 0) addManualItem();
}

function addManualItem() {
    const container = document.getElementById('manualItems');
    const div = document.createElement('div');
    div.className = 'flex gap-2 items-center';
    div.innerHTML = `
        <input type="text" placeholder="Item name" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <input type="number" placeholder="£0.00" step="0.01" class="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <select class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400">
            ${categories.map(c => `<option>${c}</option>`).join('')}
        </select>
        <button type="button" onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-600 text-lg font-bold">×</button>
    `;
    container.appendChild(div);
}

document.getElementById('manualForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const shop = document.getElementById('m-shop').value.trim();
    const date = document.getElementById('m-date').value;
    const rows = document.getElementById('manualItems').children;

    if (!shop || !date || rows.length === 0) {
        await showModal({ title: 'Missing details', message: 'Please fill in the shop name, date, and at least one item.' });
        return;
    }

    const items = Array.from(rows).map(row => {
        const inputs = row.querySelectorAll('input, select');
        return { name: inputs[0].value, price: inputs[1].value, category: inputs[2].value };
    }).filter(i => i.name && i.price);

    if (items.length === 0) {
        await showModal({ title: 'No items', message: 'Please add at least one item with a name and price.' });
        return;
    }

    try {
        const response = await fetch('/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop_name: shop, date, items })
        });
        const result = await response.json();

        if (result.success) {
            await showModal({ title: 'Saved', message: 'Your entry has been saved successfully.' });
            document.getElementById('manualForm').reset();
            document.getElementById('manualItems').innerHTML = '';
            addManualItem();
        }
    } catch (error) {
        await showModal({ title: 'Something went wrong', message: 'Could not save the entry. Please try again.' });
        console.error(error);
    }
});

// Dashboard
async function loadDashboard() {
    const dates = getPeriodDates(dashboardPeriod);
    const qs = dates ? `?from=${dates.from}&to=${dates.to}` : '';

    const [shops, cats, frequent, monthly] = await Promise.all([
        fetch('/stats/shops' + qs).then(r => r.json()),
        fetch('/stats/categories' + qs).then(r => r.json()),
        fetch('/stats/frequent-items' + qs).then(r => r.json()),
        fetch('/stats/monthly' + qs).then(r => r.json())
    ]);

    const totalAll = shops.reduce((s, r) => s + parseFloat(r.total_spent), 0);

    let periodTotal, periodLabel;
    if (dashboardPeriod === 'all') {
        const curMonth = new Date().toISOString().slice(0, 7);
        periodTotal = parseFloat(monthly.find(m => m.month === curMonth)?.total_spent) || 0;
        periodLabel = 'This Month';
    } else {
        periodTotal = totalAll;
        const labels = { 'this-month': 'This Month', 'last-month': 'Last Month', 'last-3-months': 'Last 3 Months', 'last-6-months': 'Last 6 Months', 'this-year': 'This Year', 'last-year': 'Last Year' };
        periodLabel = labels[dashboardPeriod] || 'Period';
    }

    const receiptsCount = await fetch('/receipts' + qs).then(r => r.json()).then(d => d.length);

    document.getElementById('stat-month-label').textContent = periodLabel;
    document.getElementById('stat-month').textContent = '£' + periodTotal.toFixed(2);
    document.getElementById('stat-total').textContent = '£' + totalAll.toFixed(2);
    document.getElementById('stat-receipts').textContent = receiptsCount;
    document.getElementById('stat-topshop').textContent = shops[0]?.shop_name || '—';

    const monthlyEl = document.getElementById('monthlyStats');
    if (monthly.length === 0) {
        monthlyEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        const max = Math.max(...monthly.map(m => parseFloat(m.total_spent)));
        monthlyEl.innerHTML = monthly.map(m => `
            <div class="mb-3">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                    <span>${formatMonth(m.month)}</span>
                    <span class="font-semibold text-gray-700">£${m.total_spent}</span>
                </div>
                <div class="bg-gray-100 rounded-full overflow-hidden">
                    <div class="bar gradient-bg" style="width:${(parseFloat(m.total_spent) / max * 100).toFixed(0)}%"></div>
                </div>
            </div>
        `).join('');
    }

    const catEl = document.getElementById('categoryStats');
    const catColors = ['#667eea','#48bb78','#ed8936','#e53e3e','#38b2ac','#9f7aea','#f6ad55','#fc8181'];
    if (cats.length === 0) {
        catEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        const max = Math.max(...cats.map(c => parseFloat(c.total_spent)));
        catEl.innerHTML = cats.map((c, i) => `
            <div class="mb-3 cursor-pointer group" onclick="showCategoryDetail('${c.category.replace(/'/g, "\\'")}', '${c.total_spent}')">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                    <span class="group-hover:text-purple-600 transition">${c.category}</span>
                    <span class="font-semibold text-gray-700">£${c.total_spent}</span>
                </div>
                <div class="bg-gray-100 rounded-full overflow-hidden">
                    <div class="bar" style="width:${(parseFloat(c.total_spent) / max * 100).toFixed(0)}%; background:${catColors[i % catColors.length]}"></div>
                </div>
            </div>
        `).join('');
    }

    const shopEl = document.getElementById('shopStats');
    if (shops.length === 0) {
        shopEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        shopEl.innerHTML = shops.map((s, i) => `
            <div class="flex items-center justify-between py-2.5 border-b last:border-0">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold">${i + 1}</div>
                    <div>
                        <p class="text-sm font-medium text-gray-800">${s.shop_name}</p>
                        <p class="text-xs text-gray-400">${s.item_count} items</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-gray-800">£${s.total_spent}</span>
                    <button onclick="renameShop(this)" data-shop="${s.shop_name.replace(/"/g, '&quot;')}" class="text-gray-300 hover:text-purple-500 transition" title="Rename shop">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    const freqEl = document.getElementById('frequentItems');
    if (frequent.length === 0) {
        freqEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        freqEl.innerHTML = frequent.slice(0, 8).map(item => `
            <div class="flex items-center justify-between py-2.5 border-b last:border-0">
                <div>
                    <p class="text-sm font-medium text-gray-800">${item.item_name}</p>
                    <p class="text-xs text-gray-400">${item.category}</p>
                </div>
                <div class="text-right">
                    <p class="text-sm font-semibold text-purple-600">${item.times_bought}x</p>
                    <p class="text-xs text-gray-400">£${item.total_spent}</p>
                </div>
            </div>
        `).join('');
    }
}

// History with sort, filter, expand, and edit
let allReceipts = [];
let expandedReceipt = null;
let editingReceipt = null;
const receiptItemsCache = {};

async function loadHistory() {
    allReceipts = await fetch('/receipts').then(r => r.json());
    renderHistory();
}

async function toggleReceipt(createdAt) {
    if (editingReceipt === createdAt) return;
    if (expandedReceipt === createdAt) {
        expandedReceipt = null;
    } else {
        expandedReceipt = createdAt;
        if (!receiptItemsCache[createdAt]) {
            receiptItemsCache[createdAt] = await fetch('/receipts/' + encodeURIComponent(createdAt) + '/items').then(r => r.json());
        }
    }
    editingReceipt = null;
    renderHistory();
}

function startEdit(createdAt) {
    editingReceipt = createdAt;
    renderHistory();
}

function cancelEdit() {
    editingReceipt = null;
    renderHistory();
}

function addEditItem() {
    const container = document.getElementById('edit-items-container');
    const div = document.createElement('div');
    div.className = 'edit-item-row flex gap-2 items-center';
    div.innerHTML = `
        <input type="text" placeholder="Item name" class="edit-name flex-1 min-w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <input type="number" placeholder="0.00" step="0.01" class="edit-price w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <input type="number" value="1" min="0.001" step="1" title="Quantity" class="edit-qty w-16 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <select class="edit-category border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400">
            ${categories.map(c => `<option>${c}</option>`).join('')}
        </select>
        <button type="button" onclick="this.closest('.edit-item-row').remove()" class="text-red-400 hover:text-red-600 text-lg font-bold flex-shrink-0">×</button>
    `;
    container.appendChild(div);
}

async function saveReceiptEdit() {
    const createdAt = editingReceipt;
    const shop = document.getElementById('edit-shop').value.trim();
    const date = document.getElementById('edit-date').value;
    const rows = document.getElementById('edit-items-container').querySelectorAll('.edit-item-row');
    const items = Array.from(rows).map(row => ({
        name: row.querySelector('.edit-name').value,
        price: row.querySelector('.edit-price').value,
        quantity: parseFloat(row.querySelector('.edit-qty')?.value) || 1,
        category: row.querySelector('.edit-category').value
    })).filter(i => i.name && i.price);

    if (!shop || items.length === 0) {
        await showModal({ title: 'Missing details', message: 'Please fill in the shop name and at least one item.' });
        return;
    }

    try {
        const res = await fetch('/receipts/' + encodeURIComponent(createdAt), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shop_name: shop, date, items })
        });
        const result = await res.json();
        if (result.success) {
            delete receiptItemsCache[createdAt];
            editingReceipt = null;
            expandedReceipt = createdAt;
            await loadHistory();
        }
    } catch (error) {
        await showModal({ title: 'Something went wrong', message: 'Could not save changes. Please try again.' });
        console.error(error);
    }
}

function renderHistory() {
    const el = document.getElementById('historyContent');
    const filterText = document.getElementById('filterShop').value.toLowerCase();
    const sortBy = document.getElementById('sortBy').value;

    let receipts = allReceipts.filter(r =>
        r.shop_name.toLowerCase().includes(filterText)
    );

    const getDate = r => new Date(r.date || r.created_at);
    if (sortBy === 'newest') receipts.sort((a, b) => getDate(b) - getDate(a));
    if (sortBy === 'oldest') receipts.sort((a, b) => getDate(a) - getDate(b));
    if (sortBy === 'expensive') receipts.sort((a, b) => parseFloat(b.receipt_total) - parseFloat(a.receipt_total));
    if (sortBy === 'cheapest') receipts.sort((a, b) => parseFloat(a.receipt_total) - parseFloat(b.receipt_total));
    if (sortBy === 'uploaded') receipts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (receipts.length === 0) {
        el.innerHTML = '<p class="text-gray-400 text-sm">No receipts found.</p>';
        return;
    }

    el.innerHTML = receipts.map(r => {
        const uploadDate = new Date(r.created_at).toISOString().split('T')[0];
        const dateEstimated = !r.date;
        const isExpanded = expandedReceipt === r.created_at;
        const isEditing = editingReceipt === r.created_at;
        const items = receiptItemsCache[r.created_at] || [];

        let detailHTML = '';

        if (isEditing) {
            const today = new Date().toISOString().split('T')[0];
            const dateValue = (r.date && r.date <= today) ? r.date : uploadDate;
            detailHTML = `
                <div class="ml-13 mt-1 mb-3 space-y-3" onclick="event.stopPropagation()">
                    <div class="flex gap-2 flex-wrap">
                        <div class="flex-1 min-w-32">
                            <label class="text-xs text-gray-500 block mb-1">Shop</label>
                            <input id="edit-shop" value="${r.shop_name.replace(/"/g, '&quot;')}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                        </div>
                        <div>
                            <label class="text-xs text-gray-500 block mb-1">Date</label>
                            <input type="date" id="edit-date" value="${dateValue}" class="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                        </div>
                    </div>
                    <div id="edit-items-container" class="space-y-2">
                        ${items.map(item => `
                            <div class="edit-item-row flex gap-2 items-center flex-wrap">
                                <input type="text" value="${item.item_name.replace(/"/g, '&quot;')}" class="edit-name flex-1 min-w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                                <input type="number" value="${parseFloat(item.item_price).toFixed(2)}" step="0.01" class="edit-price w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                                <input type="number" value="${parseFloat(item.quantity) || 1}" min="0.001" step="1" title="Quantity" class="edit-qty w-16 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                                <select class="edit-category border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400">
                                    ${categories.map(c => `<option ${c === item.category ? 'selected' : ''}>${c}</option>`).join('')}
                                </select>
                                <button type="button" onclick="this.closest('.edit-item-row').remove()" class="text-red-400 hover:text-red-600 text-lg font-bold flex-shrink-0">×</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" onclick="addEditItem()" class="text-sm text-purple-600 font-medium hover:text-purple-800">+ Add item</button>
                    <div class="flex gap-2">
                        <button onclick="saveReceiptEdit()" class="gradient-bg text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90">Save</button>
                        <button onclick="cancelEdit()" class="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-xl hover:bg-gray-50">Cancel</button>
                    </div>
                </div>
            `;
        } else if (isExpanded) {
            const addedLabel = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            detailHTML = `
                <div class="ml-13 mt-1 mb-3" onclick="event.stopPropagation()">
                    <div class="space-y-1.5 mb-3">
                        ${items.map(item => {
                            const qty = parseFloat(item.quantity) || 1;
                            const lineTotal = parseFloat(item.item_price);
                            const unitPrice = item.unit_price != null ? parseFloat(item.unit_price) : lineTotal / qty;
                            return `
                            <div class="flex justify-between items-start text-xs py-0.5">
                                <div class="flex items-center gap-2 flex-1 min-w-0">
                                    <span class="tag shrink-0 ${categoryColors[item.category] || 'bg-purple-100 text-purple-700'}">${item.category}</span>
                                    <div class="min-w-0">
                                        <span class="text-gray-700">${qty > 1 ? `<span class="font-semibold text-purple-600">${Number.isInteger(qty) ? qty : qty}x</span> ` : ''}${item.item_name}</span>
                                        <span class="text-gray-400 ml-1">· £${unitPrice.toFixed(2)}/unit</span>
                                    </div>
                                </div>
                                <span class="text-gray-600 font-medium ml-3 shrink-0">£${lineTotal.toFixed(2)}</span>
                            </div>`;
                        }).join('')}
                    </div>
                    <p class="text-xs text-gray-300 mb-2">Added ${addedLabel}${dateEstimated ? ' · <span class="text-orange-400">* date not on receipt</span>' : ''}</p>
                    <div class="flex items-center gap-3">
                        <button onclick="startEdit('${r.created_at}')" class="text-xs text-purple-600 font-medium hover:text-purple-800">Edit receipt</button>
                        ${r.receipt_image ? `<button onclick="viewReceiptPhoto('${r.receipt_image}')" class="text-xs text-blue-500 font-medium hover:text-blue-700 flex items-center gap-1">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                            View photo</button>` : ''}
                        <button onclick="deleteReceipt('${r.created_at}')" class="text-xs text-red-400 font-medium hover:text-red-600">Delete</button>
                    </div>
                </div>
            `;
        }

        return `
        <div class="border-b last:border-0 ${isExpanded || isEditing ? 'bg-purple-50/40 rounded-xl' : ''}">
            <div class="flex items-center justify-between py-3.5 px-1 cursor-pointer select-none" onclick="toggleReceipt('${r.created_at}')">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center flex-shrink-0">
                        <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                        </svg>
                    </div>
                    <div>
                        <p class="text-sm font-semibold text-gray-800">${r.shop_name}</p>
                        <p class="text-xs text-gray-400">${dateEstimated ? `<span class="text-orange-400 font-semibold">*</span> ${formatDate(r.date || uploadDate)}` : formatDate(r.date)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-base font-bold text-gray-800">£${r.receipt_total}</span>
                    <svg class="w-4 h-4 text-gray-400 transition-transform ${isExpanded || isEditing ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                    </svg>
                </div>
            </div>
            ${detailHTML}
        </div>
        `;
    }).join('');
}

function viewReceiptPhoto(filename) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="relative max-w-lg w-full">
            <button onclick="this.closest('.fixed').remove()" class="absolute -top-10 right-0 text-white text-sm font-medium flex items-center gap-1 hover:text-gray-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                Close
            </button>
            <img src="/uploads/receipts/${filename}" alt="Receipt" class="w-full rounded-xl shadow-2xl max-h-[85vh] object-contain bg-white"/>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function showCategoryDetail(category, totalSpent) {
    const overlay = document.getElementById('cat-modal-overlay');
    const contentEl = document.getElementById('cat-modal-content');

    document.getElementById('cat-modal-title').textContent = category;
    document.getElementById('cat-modal-sub').textContent = `£${totalSpent} total · click an item to see purchases`;
    contentEl.innerHTML = '<p class="text-gray-400 text-sm py-4 text-center">Loading...</p>';
    overlay.classList.remove('hidden');

    const dates = getPeriodDates(dashboardPeriod);
    const qs = dates ? `?from=${dates.from}&to=${dates.to}` : '';
    const items = await fetch(`/stats/categories/${encodeURIComponent(category)}/items${qs}`).then(r => r.json());

    if (items.length === 0) {
        contentEl.innerHTML = '<p class="text-gray-400 text-sm py-4 text-center">No items found.</p>';
        return;
    }

    contentEl.innerHTML = items.map(item => `
        <div class="flex items-center justify-between py-2.5 border-b last:border-0">
            <div>
                <p class="text-sm font-medium text-gray-800">${item.item_name}</p>
                <p class="text-xs text-gray-400">${item.times_bought}x bought · avg £${item.avg_price}</p>
            </div>
            <span class="text-sm font-semibold text-gray-700">£${item.total_spent}</span>
        </div>
    `).join('');
}

async function renameShop(btn) {
    const oldName = btn.dataset.shop;
    const newName = await showModal({
        title: 'Rename shop',
        message: `All receipts for "${oldName}" will be updated.`,
        type: 'prompt',
        inputDefault: oldName,
        confirmLabel: 'Rename'
    });
    if (!newName || newName === oldName) return;
    await fetch('/shops/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: newName })
    });
    Object.keys(receiptItemsCache).forEach(k => delete receiptItemsCache[k]);
    loadDashboard();
}

async function deleteReceipt(createdAt) {
    const confirmed = await showModal({
        title: 'Delete receipt',
        message: 'This will permanently remove the receipt and all its items.',
        type: 'confirm',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel'
    });
    if (!confirmed) return;
    await fetch('/receipts/' + encodeURIComponent(createdAt), { method: 'DELETE' });
    delete receiptItemsCache[createdAt];
    if (expandedReceipt === createdAt) expandedReceipt = null;
    if (editingReceipt === createdAt) editingReceipt = null;
    loadHistory();
}
