// Tab navigation
function showTab(tab) {
    ['upload', 'dashboard', 'history'].forEach(t => {
        document.getElementById('page-' + t).classList.add('hidden');
        document.getElementById('tab-' + t).classList.remove('active');
    });
    document.getElementById('page-' + tab).classList.remove('hidden');
    document.getElementById('tab-' + tab).classList.add('active');

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'history') loadHistory();
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
            alert('Error: ' + receipt.error);
            document.getElementById('loadingMsg').classList.add('hidden');
            return;
        }

        document.getElementById('loadingMsg').classList.add('hidden');
        document.getElementById('resultCard').classList.remove('hidden');
        document.getElementById('uploadForm').reset();
        document.getElementById('fileName').classList.add('hidden');

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

        document.getElementById('resultContent').innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <p class="font-semibold text-gray-800">${receipt.shop_name}</p>
                    <p class="text-sm text-gray-400">${receipt.date || 'Date unknown'}</p>
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

// Dashboard
async function loadDashboard() {
    const [shops, categories, frequent, monthly] = await Promise.all([
        fetch('/stats/shops').then(r => r.json()),
        fetch('/stats/categories').then(r => r.json()),
        fetch('/stats/frequent-items').then(r => r.json()),
        fetch('/stats/monthly').then(r => r.json())
    ]);

    // Stat cards
    const totalAll = shops.reduce((s, r) => s + parseFloat(r.total_spent), 0);
    const thisMonth = parseFloat(monthly[0]?.total_spent) || 0;
    const receiptsCount = await fetch('/receipts').then(r => r.json()).then(d => d.length);

    document.getElementById('stat-month').textContent = '£' + thisMonth.toFixed(2);
    document.getElementById('stat-total').textContent = '£' + totalAll.toFixed(2);
    document.getElementById('stat-receipts').textContent = receiptsCount;
    document.getElementById('stat-topshop').textContent = shops[0]?.shop_name || '—';

    // Monthly bars
    const monthlyEl = document.getElementById('monthlyStats');
    if (monthly.length === 0) {
        monthlyEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        const max = Math.max(...monthly.map(m => parseFloat(m.total_spent)));
        monthlyEl.innerHTML = monthly.map(m => `
            <div class="mb-3">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                    <span>${m.month}</span>
                    <span class="font-semibold text-gray-700">£${m.total_spent}</span>
                </div>
                <div class="bg-gray-100 rounded-full overflow-hidden">
                    <div class="bar gradient-bg" style="width:${(m.total_spent / max * 100).toFixed(0)}%"></div>
                </div>
            </div>
        `).join('');
    }

    // Category bars
    const catEl = document.getElementById('categoryStats');
    const catColors = ['#667eea','#48bb78','#ed8936','#e53e3e','#38b2ac','#9f7aea','#f6ad55','#fc8181'];
    if (categories.length === 0) {
        catEl.innerHTML = '<p class="text-gray-300 text-sm">No data yet.</p>';
    } else {
        const max = Math.max(...categories.map(c => parseFloat(c.total_spent)));
        catEl.innerHTML = categories.map((c, i) => `
            <div class="mb-3">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                    <span>${c.category}</span>
                    <span class="font-semibold text-gray-700">£${c.total_spent}</span>
                </div>
                <div class="bg-gray-100 rounded-full overflow-hidden">
                    <div class="bar" style="width:${(c.total_spent / max * 100).toFixed(0)}%; background:${catColors[i % catColors.length]}"></div>
                </div>
            </div>
        `).join('');
    }

    // Shops
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

    // Frequent items
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

// History
async function loadHistory() {
    const receipts = await fetch('/receipts').then(r => r.json());
    const el = document.getElementById('historyContent');

    if (receipts.length === 0) {
        el.innerHTML = '<p class="text-gray-300 text-sm">No receipts yet.</p>';
        return;
    }

    el.innerHTML = receipts.map(r => `
        <div class="flex items-center justify-between py-3.5 border-b last:border-0">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center">
                    <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                    </svg>
                </div>
                <div>
                    <p class="text-sm font-semibold text-gray-800">${r.shop_name}</p>
                    <p class="text-xs text-gray-400">${r.date || 'Date unknown'} · ${new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
            </div>
            <span class="text-base font-bold text-gray-800">£${r.receipt_total}</span>
        </div>
    `).join('');
}
