// Tab navigation
function showTab(tab) {
    ['upload', 'dashboard', 'history'].forEach(t => {
        document.getElementById('page-' + t).classList.add('hidden');
        document.getElementById('tab-' + t).classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
        document.getElementById('tab-' + t).classList.add('text-gray-500');
    });
    document.getElementById('page-' + tab).classList.remove('hidden');
    document.getElementById('tab-' + tab).classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
    document.getElementById('tab-' + tab).classList.remove('text-gray-500');

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'history') loadHistory();
}

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

        document.getElementById('resultContent').innerHTML = `
            <p><strong>Shop:</strong> ${receipt.shop_name}</p>
            <p><strong>Date:</strong> ${receipt.date || 'Unknown'}</p>
            <p><strong>Total:</strong> £${receipt.total}</p>
            <h3 class="font-semibold mt-3 mb-1">Items:</h3>
            <ul class="list-disc pl-5 space-y-1">
                ${receipt.items.map(item => `
                    <li>${item.name} — £${item.price}
                        <span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full ml-1">${item.category}</span>
                    </li>
                `).join('')}
            </ul>
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

    // Monthly
    const monthlyEl = document.getElementById('monthlyStats');
    if (monthly.length === 0) {
        monthlyEl.innerHTML = '<p class="text-gray-400">No data yet.</p>';
    } else {
        const max = Math.max(...monthly.map(m => m.total_spent));
        monthlyEl.innerHTML = monthly.map(m => `
            <div class="flex items-center gap-3 mb-2">
                <span class="w-20 text-sm text-gray-600">${m.month}</span>
                <div class="flex-1 bg-gray-100 rounded-full h-5">
                    <div class="bg-blue-500 h-5 rounded-full" style="width: ${(m.total_spent / max * 100).toFixed(0)}%"></div>
                </div>
                <span class="w-16 text-right text-sm font-semibold">£${m.total_spent}</span>
            </div>
        `).join('');
    }

    // Shops
    const shopEl = document.getElementById('shopStats');
    if (shops.length === 0) {
        shopEl.innerHTML = '<p class="text-gray-400">No data yet.</p>';
    } else {
        shopEl.innerHTML = shops.map((s, i) => `
            <div class="flex justify-between items-center py-2 border-b last:border-0">
                <div>
                    <p class="font-medium text-gray-800">${s.shop_name}</p>
                    <p class="text-xs text-gray-400">${s.item_count} items</p>
                </div>
                <span class="font-semibold text-gray-700">£${s.total_spent}</span>
            </div>
        `).join('');
    }

    // Categories
    const catEl = document.getElementById('categoryStats');
    if (categories.length === 0) {
        catEl.innerHTML = '<p class="text-gray-400">No data yet.</p>';
    } else {
        const colors = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500'];
        const max = Math.max(...categories.map(c => c.total_spent));
        catEl.innerHTML = categories.map((c, i) => `
            <div class="flex items-center gap-3 mb-2">
                <span class="w-28 text-sm text-gray-600 truncate">${c.category}</span>
                <div class="flex-1 bg-gray-100 rounded-full h-4">
                    <div class="${colors[i % colors.length]} h-4 rounded-full" style="width: ${(c.total_spent / max * 100).toFixed(0)}%"></div>
                </div>
                <span class="w-14 text-right text-sm font-semibold">£${c.total_spent}</span>
            </div>
        `).join('');
    }

    // Frequent items
    const freqEl = document.getElementById('frequentItems');
    if (frequent.length === 0) {
        freqEl.innerHTML = '<p class="text-gray-400">No data yet.</p>';
    } else {
        freqEl.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                ${frequent.map(item => `
                    <div class="border rounded-xl p-3">
                        <p class="font-medium text-gray-800 text-sm">${item.item_name}</p>
                        <p class="text-xs text-gray-400 mt-1">${item.category}</p>
                        <p class="text-blue-600 font-semibold mt-1">${item.times_bought}x bought</p>
                        <p class="text-xs text-gray-500">£${item.total_spent} total</p>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

// History
async function loadHistory() {
    const receipts = await fetch('/receipts').then(r => r.json());
    const el = document.getElementById('historyContent');

    if (receipts.length === 0) {
        el.innerHTML = '<p class="text-gray-400">No receipts yet.</p>';
        return;
    }

    el.innerHTML = receipts.map(r => `
        <div class="flex justify-between items-center py-3 border-b last:border-0">
            <div>
                <p class="font-medium text-gray-800">${r.shop_name}</p>
                <p class="text-sm text-gray-400">${r.date || 'Date unknown'} · Uploaded ${new Date(r.created_at).toLocaleDateString()}</p>
            </div>
            <span class="font-semibold text-gray-700">£${r.receipt_total}</span>
        </div>
    `).join('');
}
