// spectrum-shell.js — sidebar + header builder.
// Drop-in replacement for initSharedPage(). Builds the left sidebar nav and
// top header inside <div class="sp-shell">. Pages just need:
//
//   <div class="sp-shell">
//     <main class="sp-main">
//       <!-- page body here -->
//     </main>
//   </div>
//
// Then call:
//   initSpectrum({ active: 'home', title: 'Finance Home', subtitle: '…' });
//
// To inject the period selector / action buttons, pass them too:
//   initSpectrum({ active: 'home', title: 'Home',
//     actions: '<button class="sp-btn-ghost">Export</button>' +
//              '<button class="sp-btn-primary">+ Log expense</button>',
//     period: 'May 2026'
//   });

const SPECTRUM_CATS = {
  groceries:     { label: 'Groceries',     href: 'index.html',         color: 'var(--cat-groceries-dot)' },
  outabout:      { label: 'Out & About',   href: 'outabout.html',      color: 'var(--cat-outabout-dot)' },
  shopping:      { label: 'Shopping',      href: 'shopping.html',      color: 'var(--cat-shopping-dot)' },
  bills:         { label: 'Bills',         href: 'bills.html',         color: 'var(--cat-bills-dot)' },
  fixed:         { label: 'Home Costs',    href: 'fixed.html',         color: 'var(--cat-fixed-dot)' },
  transport:     { label: 'Transport',     href: 'transport.html',     color: 'var(--cat-transport-dot)' },
  subscriptions: { label: 'Subscriptions', href: 'subscriptions.html', color: 'var(--cat-subscriptions-dot)' },
  debts:         { label: 'Debts',         href: 'debts.html',         color: 'var(--cat-debts-dot)' },
  loan:          { label: 'Loan',          href: 'loan.html',          color: 'var(--cat-debts-dot)' },
};

const SPECTRUM_NAV = [
  { group: 'Overview', items: [
    { id: 'home',     label: 'Home',           href: 'home.html' },
    { id: 'upcoming', label: 'Upcoming',       href: 'upcoming.html' },
    { id: 'monthly',  label: 'Monthly Report', href: 'monthly.html' },
  ]},
  { group: 'Spending', items: [
    { id: 'groceries', cat: 'groceries' },
    { id: 'outabout',  cat: 'outabout' },
    { id: 'shopping',  cat: 'shopping' },
  ]},
  { group: 'Recurring', items: [
    { id: 'bills',         cat: 'bills' },
    { id: 'fixed',         cat: 'fixed' },
    { id: 'transport',     cat: 'transport' },
    { id: 'subscriptions', cat: 'subscriptions' },
  ]},
  { group: 'Debt', items: [
    { id: 'debts', cat: 'debts' },
    { id: 'loan',  cat: 'loan' },
  ]},
];

function initSpectrum({ active, title, subtitle = '', period = '', actions = '' } = {}) {
  const shell = document.querySelector('.sp-shell');
  if (!shell) {
    console.warn('[spectrum] no .sp-shell on page — wrap your <main> in <div class="sp-shell">');
    return;
  }

  // Sidebar
  const sidebarHtml = `
    <aside class="sp-sidebar">
      <a href="home.html" class="sp-logo" style="text-decoration:none;color:inherit">
        <span class="sp-logo-mark">£</span>
        <span class="sp-logo-name">Penny</span>
      </a>
      <nav style="display:flex;flex-direction:column;gap:14px">
        ${SPECTRUM_NAV.map(g => `
          <div class="sp-nav-group">
            <div class="sp-nav-group-label">${g.group}</div>
            ${g.items.map(it => {
              const cat   = it.cat ? SPECTRUM_CATS[it.cat] : null;
              const label = it.label || (cat && cat.label) || it.id;
              const href  = it.href  || (cat && cat.href)  || '#';
              const isActive = it.id === active;
              const dot = cat
                ? `<span class="sp-nav-dot" style="background:${cat.color}"></span>`
                : `<span class="sp-nav-dot is-square"></span>`;
              return `<a href="${href}" class="sp-nav-item ${isActive ? 'is-active' : ''}">${dot}<span>${label}</span></a>`;
            }).join('')}
          </div>
        `).join('')}
      </nav>
    </aside>
  `;
  shell.insertAdjacentHTML('afterbegin', sidebarHtml);

  // Header (only if .sp-main exists and has no <header>)
  const main = shell.querySelector('.sp-main');
  if (main && !main.querySelector('.sp-header')) {
    main.insertAdjacentHTML('afterbegin', `
      <header class="sp-header">
        <div>
          <h1>${title || ''}</h1>
          ${subtitle ? `<div class="sp-subtitle">${subtitle}</div>` : ''}
        </div>
        <div class="sp-header-actions">
          ${actions}
          ${period ? `<button class="sp-pill">${period} <span style="opacity:.5">▾</span></button>` : ''}
        </div>
      </header>
    `);
  }

  // Inject modal HTML (mirrors the old initSharedPage modal so showModal() still works)
  if (!document.getElementById('modal-overlay')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="modal-overlay" class="sp-modal-overlay hidden">
        <div id="modal-card" class="sp-modal">
          <p id="modal-title" style="font-weight:600;color:var(--sp-ink);margin:0 0 4px"></p>
          <p id="modal-message" style="color:var(--sp-ink-70);font-size:13px;margin:0 0 20px"></p>
          <div id="modal-input-wrap" class="hidden" style="margin-bottom:20px">
            <input id="modal-input" class="sp-input"/>
          </div>
          <div id="modal-buttons" style="display:flex;gap:8px"></div>
        </div>
      </div>
    `);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
// fmt(n) → "£1,234.56"  ·  fmt0(n) → "£1,235"  (drops .00 cleanly)
window.fmt  = window.fmt  || (n => '£' + (parseFloat(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
window.fmt0 = window.fmt0 || (n => '£' + Math.round(parseFloat(n) || 0).toLocaleString('en-GB'));

// catKey(name) → "outabout"  (normalises display names to data-cat keys)
window.catKey = function(name) {
  return String(name || '').toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '');
};

// kpiCard({label, value, delta, deltaTone, sub}) → HTML string for a KPI card
window.kpiCard = function({ label, value, delta = '', deltaTone = '', sub = '' }) {
  const toneCls = deltaTone ? `sp-kpi-delta--${deltaTone}` : '';
  return `
    <div class="sp-kpi">
      <div class="sp-kpi-row">
        <div class="sp-kpi-label">${label}</div>
        ${delta ? `<div class="sp-kpi-delta ${toneCls}">${delta}</div>` : ''}
      </div>
      <div class="sp-kpi-value">${value}</div>
      ${sub ? `<div class="sp-kpi-sub">${sub}</div>` : ''}
    </div>`;
};

// badge(cat) → HTML chip   e.g. badge('groceries')
window.badge = function(catNameOrKey, label) {
  const key = SPECTRUM_CATS[catNameOrKey] ? catNameOrKey : catKey(catNameOrKey);
  const lbl = label || (SPECTRUM_CATS[key] && SPECTRUM_CATS[key].label) || catNameOrKey;
  return `<span class="sp-badge" data-cat="${key}">${lbl}</span>`;
};

window.SPECTRUM_CATS = SPECTRUM_CATS;
