// Shared utilities for all pages

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr.split('T')[0] + 'T12:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmt(amount) {
    return '£' + parseFloat(amount || 0).toFixed(2);
}

// Custom modal (replaces alert/confirm/prompt)
function showModal({ title = '', message = '', type = 'alert', inputDefault = '', confirmLabel = 'OK', cancelLabel = 'Cancel' } = {}) {
    return new Promise(resolve => {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        const inputWrap = document.getElementById('modal-input-wrap');
        const input = document.getElementById('modal-input');
        const buttons = document.getElementById('modal-buttons');
        const overlay = document.getElementById('modal-overlay');

        inputWrap.classList.toggle('hidden', type !== 'prompt');
        if (type === 'prompt') { input.value = inputDefault; }

        buttons.innerHTML = '';

        if (type === 'confirm' || type === 'prompt') {
            const cancel = document.createElement('button');
            cancel.textContent = cancelLabel;
            cancel.className = 'flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition text-sm';
            cancel.onclick = () => { overlay.classList.add('hidden'); resolve(null); };
            buttons.appendChild(cancel);
        }

        const ok = document.createElement('button');
        ok.textContent = confirmLabel;
        ok.className = 'flex-1 gradient-bg text-white font-medium py-2.5 rounded-xl hover:opacity-90 transition text-sm';
        ok.onclick = () => {
            overlay.classList.add('hidden');
            resolve(type === 'prompt' ? input.value : true);
        };
        buttons.appendChild(ok);

        overlay.classList.remove('hidden');
        if (type === 'prompt') setTimeout(() => input.focus(), 50);
    });
}

// Inject shared nav and modal HTML into the page
// Hide scrollbar on nav (still scrollable, just invisible)
const _navStyle = document.createElement('style');
_navStyle.textContent = '#shared-nav::-webkit-scrollbar{display:none}#shared-nav{-ms-overflow-style:none;scrollbar-width:none}';
document.head.appendChild(_navStyle);

function initSharedPage(activePage) {
    const navLinks = [
        { id: 'home',          href: 'home.html',          label: 'Home' },
        { id: 'groceries',     href: 'index.html',         label: 'Groceries' },
        { id: 'outabout',      href: 'outabout.html',      label: 'Out & About' },
        { id: 'fixed',         href: 'fixed.html',         label: 'Home Costs' },
        { id: 'bills',         href: 'bills.html',         label: 'Bills' },
        { id: 'transport',     href: 'transport.html',     label: 'Transport' },
        { id: 'subscriptions', href: 'subscriptions.html', label: 'Subscriptions' },
        { id: 'shopping',      href: 'shopping.html',      label: 'Shopping' },
        { id: 'debts',         href: 'debts.html',         label: 'Debts' },
        { id: 'monthly',       href: 'monthly.html',       label: 'Report' },
    ];

    const navHtml = navLinks.map(l =>
        `<a href="${l.href}" class="nav-btn px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap${l.id === activePage ? ' active' : ''}">${l.label}</a>`
    ).join('');

    const navContainer = document.getElementById('shared-nav');
    if (navContainer) navContainer.innerHTML = navHtml;

    // Inject modal HTML if not present
    if (!document.getElementById('modal-overlay')) {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="modal-overlay" class="hidden fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div id="modal-card" class="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm modal-animate">
                    <p id="modal-title" class="font-semibold text-gray-800 mb-1"></p>
                    <p id="modal-message" class="text-gray-500 text-sm mb-5"></p>
                    <div id="modal-input-wrap" class="hidden mb-5">
                        <input id="modal-input" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-purple-400"/>
                    </div>
                    <div id="modal-buttons" class="flex gap-2"></div>
                </div>
            </div>
        `);
    }
}
