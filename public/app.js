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
};

const categories = ['Groceries', 'Vegetables', 'Fruit', 'Dairy', 'Meat & Fish', 'Bakery', 'Drinks', 'Snacks', 'Household', 'Clothing', 'Electronics', 'Fuel', 'Restaurant', 'Health', 'Other'];

// "2024-01-15" → "15-01-2024"
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'null') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
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

// Upload form
document.getElementById('uploadForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const fileInput = document.getElementById('receiptImage');
    if (!fileInput.files[0]) {
        alert('Please select an image first');
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
            alert(receipt.error);
            return;
        }

        document.getElementById('loadingMsg').classList.add('hidden');
        document.getElementById('resultCard').classList.remove('hidden');
        document.getElementById('uploadForm').reset();
        document.getElementById('fileName').classList.add('hidden');

        document.getElementById('resultContent').innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <p class="font-semibold text-gray-800">${receipt.shop_name}</p>
                    <p class="text-sm text-gray-400">${receipt.date ? formatDate(receipt.date) : 'Date unknown'}</p>
                </div>
                <p class="text-2xl font-bold text-gray-800">£${receipt.total}</p>
            </div>
            <div class="border-t pt-4 space-y-2">
                ${receipt.items.map(item => `
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-2">
                            <span class="tag ${categoryColors[item.category] || 'bg-purple-100 text-purple-700'}">${item.category}</span>
                            <span class="text-sm text-gray-700">${item.name}</span>
                        </div>
                        <span class="text-sm font-medium text-gray-800">£${item.price}</span>
                    </div>
                `).join('')}
            </div>
        `;

    } catch (error) {
        document.getElementById('loadingMsg').classList.add('hidden');
        alert('Something went wrong. Check the console.');
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
        alert('Please fill in shop name, date and at least one item.');
        return;
    }

    const items = Array.from(rows).map(row => {
        const inputs = row.querySelectorAll('input, select');
        return { name: inputs[0].value, price: inputs[1].value, category: inputs[2].value };
    }).filter(i => i.name && i.price);

    if (items.length === 0) {
        alert('Please add at least one item with a name and price.');
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
            alert('Entry saved!');
            document.getElementById('manualForm').reset();
            document.getElementById('manualItems').innerHTML = '';
            addManualItem();
        }
    } catch (error) {
        alert('Something went wrong.');
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
            <div class="mb-3">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                    <span>${c.category}</span>
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
                <span class="text-sm font-semibold text-gray-800">£${s.total_spent}</span>
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
        <input type="text" placeholder="Item name" class="edit-name flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <input type="number" placeholder="0.00" step="0.01" class="edit-price w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
        <select class="edit-category border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400">
            ${categories.map(c => `<option>${c}</option>`).join('')}
        </select>
        <button type="button" onclick="this.closest('.edit-item-row').remove()" class="text-red-400 hover:text-red-600 text-lg font-bold">×</button>
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
        category: row.querySelector('.edit-category').value
    })).filter(i => i.name && i.price);

    if (!shop || items.length === 0) {
        alert('Please fill in shop name and at least one item.');
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
        alert('Something went wrong.');
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

    // Sort by purchase date (r.date), fall back to upload date (created_at)
    const getDate = r => new Date(r.date || r.created_at);
    if (sortBy === 'newest') receipts.sort((a, b) => getDate(b) - getDate(a));
    if (sortBy === 'oldest') receipts.sort((a, b) => getDate(a) - getDate(b));
    if (sortBy === 'expensive') receipts.sort((a, b) => parseFloat(b.receipt_total) - parseFloat(a.receipt_total));
    if (sortBy === 'cheapest') receipts.sort((a, b) => parseFloat(a.receipt_total) - parseFloat(b.receipt_total));

    if (receipts.length === 0) {
        el.innerHTML = '<p class="text-gray-400 text-sm">No receipts found.</p>';
        return;
    }

    el.innerHTML = receipts.map(r => {
        const uploadDate = new Date(r.created_at).toISOString().split('T')[0];
        const dateEstimated = !r.date || r.date === uploadDate;
        const isExpanded = expandedReceipt === r.created_at;
        const isEditing = editingReceipt === r.created_at;
        const items = receiptItemsCache[r.created_at] || [];

        let detailHTML = '';

        if (isEditing) {
            const dateValue = r.date || uploadDate;
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
                            <div class="edit-item-row flex gap-2 items-center">
                                <input type="text" value="${item.item_name.replace(/"/g, '&quot;')}" class="edit-name flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
                                <input type="number" value="${parseFloat(item.item_price).toFixed(2)}" step="0.01" class="edit-price w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-purple-400"/>
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
                        ${items.map(item => `
                            <div class="flex justify-between items-center text-xs">
                                <div class="flex items-center gap-2">
                                    <span class="tag ${categoryColors[item.category] || 'bg-purple-100 text-purple-700'}">${item.category}</span>
                                    <span class="text-gray-700">${item.item_name}</span>
                                </div>
                                <span class="text-gray-600 font-medium">£${parseFloat(item.item_price).toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <p class="text-xs text-gray-300 mb-2">Added ${addedLabel}${dateEstimated ? ' · <span class="text-orange-400">* date not on receipt</span>' : ''}</p>
                    <button onclick="startEdit('${r.created_at}')" class="text-xs text-purple-600 font-medium hover:text-purple-800">Edit receipt</button>
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
                    <button onclick="deleteReceipt('${r.created_at}'); event.stopPropagation();" class="text-red-400 hover:text-red-600 transition">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                    </button>
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

async function deleteReceipt(createdAt) {
    if (!confirm('Delete this receipt?')) return;
    await fetch('/receipts/' + encodeURIComponent(createdAt), { method: 'DELETE' });
    delete receiptItemsCache[createdAt];
    if (expandedReceipt === createdAt) expandedReceipt = null;
    if (editingReceipt === createdAt) editingReceipt = null;
    loadHistory();
}
