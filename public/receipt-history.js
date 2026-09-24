// receipt-history.js — the History tab for Out & About and Shopping: newest receipts first, search and sort,
// the receipt photo, and editing (shop, date, trip, items, quantities, prices, categories) or deleting a receipt.
// Usage: ReceiptHistory.mount(el, { section: 'outabout', base: '/outings', groupTrips: true })
(function () {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => '£' + (parseFloat(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const round2 = n => Math.round(n * 100) / 100;
    const fmtQty = q => String(Math.round(q * 1000) / 1000);
    const day = d => (d || '').slice(0, 10);
    const niceDate = d => {
        if (!day(d)) return '';
        const [y, m, dd] = day(d).split('-').map(Number);
        return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    const localToday = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

    function injectStyles() {
        if (document.getElementById('rh-styles')) return;
        const style = document.createElement('style');
        style.id = 'rh-styles';
        style.textContent = `
        .rh-tools { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
        .rh-tools .sp-input { flex:1; min-width:160px; }
        .rh-row { display:flex; align-items:center; gap:12px; padding:12px 6px; cursor:pointer; border-radius:10px; }
        .rh-row:hover { background:var(--sp-panel); }
        .rh-main { flex:1; min-width:0; }
        .rh-place { font-size:13px; font-weight:600; color:var(--sp-ink); word-break:break-word; }
        .rh-date { font-size:12px; color:var(--sp-ink-50); margin-top:2px; }
        .rh-date .warn { color:var(--sp-warn); font-weight:600; }
        .rh-total { font-size:13px; font-weight:700; color:var(--sp-ink); font-variant-numeric:tabular-nums; white-space:nowrap; }
        .rh-chev { width:16px; height:16px; color:var(--sp-ink-30); transition:transform .2s; flex-shrink:0; }
        .rh-open > .rh-row .rh-chev, .rh-open > .rh-trip-head .rh-chev { transform:rotate(180deg); }
        .rh-item { border-bottom:1px solid var(--sp-ink-04); }
        .rh-detail { padding:2px 6px 14px 14px; }
        .rh-line { display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:5px 0; }
        .rh-line .n { color:var(--sp-ink); min-width:0; }
        .rh-line .q { font-weight:600; }
        .rh-line .c { font-size:11px; color:var(--sp-ink-50); margin-left:4px; }
        .rh-line .u { font-size:11px; color:var(--sp-ink-50); margin-left:4px; white-space:nowrap; }
        .rh-line .p { font-variant-numeric:tabular-nums; white-space:nowrap; }
        .rh-meta { font-size:12px; color:var(--sp-ink-50); padding-top:8px; }
        .rh-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
        .rh-actions button { font:inherit; font-size:12px; font-weight:600; border:1px solid var(--sp-ink-15); background:var(--sp-paper);
                             color:var(--sp-ink); border-radius:8px; padding:6px 12px; cursor:pointer; }
        .rh-actions button.del { color:var(--sp-up); }
        .rh-trip { margin-bottom:6px; border-radius:12px; border:1px solid var(--sp-ink-08); }
        .rh-trip-head { display:flex; align-items:center; gap:12px; padding:12px; cursor:pointer; }
        .rh-trip-body { padding:0 10px 6px 18px; border-top:1px solid var(--sp-ink-04); }
        .rh-sub { font-size:11px; font-weight:600; color:var(--sp-ink-50); text-transform:uppercase; letter-spacing:.05em; margin:16px 0 4px; }
        .rh-form { background:var(--sp-panel); border-radius:12px; padding:12px; margin:4px 0 14px; }
        .rh-form label { font-size:11px; font-weight:600; color:var(--sp-ink-50); display:block; margin-bottom:4px; }
        .rh-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; margin-bottom:10px; }
        .rh-in { width:100%; box-sizing:border-box; height:36px; padding:0 10px; border:1px solid var(--sp-ink-15); border-radius:9px;
                 background:#fff; color:var(--sp-ink); font:inherit; font-size:14px; }
        .rh-erow { background:#fff; border:1px solid var(--sp-ink-08); border-radius:10px; padding:8px; margin-bottom:6px; }
        .rh-erow .top { display:flex; gap:6px; }
        .rh-erow .top .rh-in { flex:1; }
        .rh-erow .bot { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:6px; font-size:12px; color:var(--sp-ink-50); }
        .rh-erow .bot label { display:inline-flex; align-items:center; gap:4px; margin:0; font-weight:500; font-size:12px; }
        .rh-erow .bot .rh-in { height:32px; font-size:13px; text-align:right; }
        .rh-erow .qty { width:64px; } .rh-erow .price { width:84px; } .rh-erow select.rh-in { width:auto; max-width:170px; text-align:left; }
        .rh-x { background:none; border:0; color:var(--sp-ink-30); font-size:20px; cursor:pointer; padding:0 6px; line-height:1; }
        .rh-x:hover { color:var(--sp-up); }
        .rh-foot { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:10px; }
        .rh-add { font:inherit; font-size:13px; font-weight:600; border:0; background:none; color:var(--sp-ink); cursor:pointer; padding:0; text-decoration:underline; }
        .rh-sum { margin-left:auto; font-size:13px; font-weight:700; }
        .rh-err { color:var(--sp-up); font-size:12px; margin-top:8px; }
        .rh-empty { color:var(--sp-ink-50); font-size:13px; text-align:center; padding:24px 0; }
        .rh-photo { position:fixed; inset:0; z-index:70; background:rgba(0,0,0,.82); display:flex; align-items:center; justify-content:center; padding:16px; }
        .rh-photo img { max-width:100%; max-height:88vh; border-radius:12px; background:#fff; object-fit:contain; }
        .rh-photo button { position:absolute; top:max(14px, env(safe-area-inset-top)); right:16px; font:inherit; font-size:14px; color:#fff; background:rgba(255,255,255,.15);
                           border:0; border-radius:999px; padding:8px 14px; cursor:pointer; }
        `;
        document.head.appendChild(style);
    }

    function viewPhoto(filename) {
        const o = document.createElement('div');
        o.className = 'rh-photo';
        o.innerHTML = `<button type="button">Close</button><img src="/uploads/receipts/${encodeURIComponent(filename)}" alt="Receipt photo">`;
        o.addEventListener('click', e => { if (e.target === o || e.target.tagName === 'BUTTON') o.remove(); });
        document.body.appendChild(o);
    }

    function mount(el, opts) {
        injectStyles();
        const S = {
            receipts: [], items: {}, expanded: null, editing: null, openTrip: null, draft: null, error: '',
            categories: [], trips: [], sort: 'newest', filter: '', loaded: false,
        };
        const itemsUrl = ca => `${opts.base}/${encodeURIComponent(ca)}/items`;
        const receiptUrl = ca => `${opts.base}/${encodeURIComponent(ca)}`;
        const find = ca => S.receipts.find(r => r.created_at === ca);

        el.innerHTML = `
            <div class="rh-tools">
              <input class="sp-input" type="search" placeholder="Search shop or trip…" data-rh="filter" aria-label="Search">
              <select class="sp-select" style="width:auto" data-rh="sort" aria-label="Sort">
                <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                <option value="expensive">Most expensive</option><option value="cheapest">Cheapest first</option>
                <option value="added">Last added</option>
              </select>
            </div>
            <div data-rh="list"><div class="rh-empty">Loading…</div></div>
            <datalist id="rh-trips-${opts.section}"></datalist>`;
        const listEl = el.querySelector('[data-rh="list"]');

        async function load() {
            try {
                S.receipts = await fetch(opts.base).then(r => r.json());
                S.loaded = true;
            } catch { listEl.innerHTML = '<div class="rh-empty">Couldn’t load — refresh to try again.</div>'; return; }
            render();
            if (!S.categories.length) {
                fetch('/scan/sections').then(r => r.json()).then(m => { S.categories = (m.sections[opts.section] || {}).categories || []; }).catch(() => {});
                fetch('/trips').then(r => r.json()).then(t => {
                    S.trips = Array.isArray(t) ? t.map(x => x.name) : [];
                    el.querySelector('datalist').innerHTML = S.trips.map(n => `<option value="${esc(n)}">`).join('');
                }).catch(() => {});
            }
        }

        // Newest by receipt date; receipts without a date go last (by when they were added).
        const byDateDesc = (a, b) => (day(b.date) || '0').localeCompare(day(a.date) || '0') || String(b.created_at).localeCompare(String(a.created_at));
        function sorted(list) {
            const l = [...list];
            if (S.sort === 'newest') l.sort(byDateDesc);
            if (S.sort === 'oldest') l.sort((a, b) => (day(a.date) || '9').localeCompare(day(b.date) || '9') || String(a.created_at).localeCompare(String(b.created_at)));
            if (S.sort === 'expensive') l.sort((a, b) => parseFloat(b.receipt_total) - parseFloat(a.receipt_total));
            if (S.sort === 'cheapest') l.sort((a, b) => parseFloat(a.receipt_total) - parseFloat(b.receipt_total));
            if (S.sort === 'added') l.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            return l;
        }

        function render() {
            if (!S.loaded) return;
            const q = S.filter.trim().toLowerCase();
            const list = sorted(S.receipts.filter(r => !q || String(r.place_name).toLowerCase().includes(q) || String(r.trip_name || '').toLowerCase().includes(q)));
            if (!list.length) { listEl.innerHTML = `<div class="rh-empty">${S.receipts.length ? 'Nothing matches your search.' : 'No receipts yet.'}</div>`; return; }

            // Out & About: receipts from the same trip are grouped, and the group sits where its newest receipt would.
            if (opts.groupTrips && (S.sort === 'newest' || S.sort === 'oldest')) {
                const blocks = [];
                const trips = new Map();
                for (const r of list) {
                    if (!r.trip_name) { blocks.push({ r }); continue; }
                    const k = r.trip_name.toLowerCase();
                    if (!trips.has(k)) { const b = { trip: r.trip_name, receipts: [] }; trips.set(k, b); blocks.push(b); }
                    trips.get(k).receipts.push(r);
                }
                listEl.innerHTML = blocks.map(b => b.r ? receiptHtml(b.r) : tripHtml(b)).join('');
            } else {
                listEl.innerHTML = list.map(r => receiptHtml(r)).join('');
            }
            const f = listEl.querySelector('[data-rh="place"]');
            if (f && S.focus) { f.focus(); S.focus = false; }
        }

        function tripHtml(b) {
            const total = b.receipts.reduce((s, r) => s + (parseFloat(r.receipt_total) || 0), 0);
            const dates = b.receipts.map(r => day(r.date)).filter(Boolean).sort();
            const range = dates.length ? (dates[0] === dates[dates.length - 1] ? niceDate(dates[0]) : `${niceDate(dates[0])} – ${niceDate(dates[dates.length - 1])}`) : '';
            const open = S.openTrip === b.trip.toLowerCase() || b.receipts.some(r => r.created_at === S.expanded || r.created_at === S.editing);
            return `<div class="rh-trip ${open ? 'rh-open' : ''}">
                <div class="rh-trip-head" data-rh="trip" data-v="${esc(b.trip)}">
                  <div class="rh-main"><div class="rh-place">✈ ${esc(b.trip)}</div>
                    <div class="rh-date">${range}${range ? ' · ' : ''}${b.receipts.length} receipt${b.receipts.length === 1 ? '' : 's'}</div></div>
                  <div class="rh-total">${money(total)}</div>${chevron()}
                </div>
                ${open ? `<div class="rh-trip-body">${b.receipts.map(r => receiptHtml(r, true)).join('')}</div>` : ''}
            </div>`;
        }

        const chevron = () => '<svg class="rh-chev" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';

        function receiptHtml(r, inTrip) {
            const open = S.expanded === r.created_at || S.editing === r.created_at;
            const date = day(r.date) ? niceDate(r.date) : '<span class="warn">Date not read</span>';
            return `<div class="rh-item ${open ? 'rh-open' : ''}">
                <div class="rh-row" data-rh="toggle" data-v="${esc(r.created_at)}">
                  <div class="rh-main"><div class="rh-place">${esc(r.place_name)}${!inTrip && window.tripBadge ? tripBadge(r.trip_name) : ''}</div>
                    <div class="rh-date">${date}${r.receipt_image ? ' · 📷' : ''}</div></div>
                  <div class="rh-total">${money(r.receipt_total)}</div>${chevron()}
                </div>
                ${S.editing === r.created_at ? editHtml(r) : open ? detailHtml(r) : ''}
            </div>`;
        }

        function detailHtml(r) {
            const items = S.items[r.created_at];
            if (!items) return '<div class="rh-detail rh-meta">Loading…</div>';
            const added = new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            return `<div class="rh-detail">
                ${items.map(i => {
                    const qty = parseFloat(i.quantity) || 1, line = parseFloat(i.item_price) || 0;
                    return `<div class="rh-line"><span class="n">${qty !== 1 ? `<span class="q">${fmtQty(qty)}×</span> ` : ''}${esc(i.item_name)}<span class="c">${esc(i.category)}</span>${qty !== 1 ? `<span class="u">${money(line / qty)} each</span>` : ''}</span>
                        <span class="p">${money(line)}</span></div>`;
                }).join('')}
                <div class="rh-meta">Added ${added}${r.trip_name ? ` · Trip: ${esc(r.trip_name)}` : ''}</div>
                <div class="rh-actions">
                  <button type="button" data-rh="edit" data-v="${esc(r.created_at)}">Edit receipt</button>
                  ${r.receipt_image ? `<button type="button" data-rh="photo" data-v="${esc(r.receipt_image)}">View photo</button>` : ''}
                  <button type="button" class="del" data-rh="delete" data-v="${esc(r.created_at)}">Delete</button>
                </div>
            </div>`;
        }

        function categoryOptions(selected) {
            const cats = S.categories.length ? [...S.categories] : [];
            if (selected && !cats.includes(selected)) cats.unshift(selected);   // keep an old category that's no longer in the list
            if (!cats.length) cats.push('Other');
            return cats.map(c => `<option ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
        }

        function editHtml(r) {
            const d = S.draft;
            if (!d) return '<div class="rh-detail rh-meta">Loading…</div>';
            const sum = round2(d.items.reduce((s, it) => s + (parseFloat(it.price) || 0), 0));
            return `<div class="rh-form">
                <div class="rh-grid">
                  <div><label>Shop / place</label><input class="rh-in" data-rh="place" value="${esc(d.place_name)}"></div>
                  <div><label>Date</label><input class="rh-in" type="date" data-rh="date" max="${localToday(1)}" value="${esc(d.date)}"></div>
                  <div><label>Trip (optional)</label><input class="rh-in" data-rh="tripname" list="rh-trips-${opts.section}" value="${esc(d.trip_name)}" placeholder="e.g. Oxford trip"></div>
                </div>
                ${d.items.map((it, i) => `<div class="rh-erow">
                    <div class="top"><input class="rh-in" data-rh="iname" data-i="${i}" value="${esc(it.name)}" placeholder="Item name">
                      <button type="button" class="rh-x" data-rh="idel" data-i="${i}" aria-label="Remove item">×</button></div>
                    <div class="bot">
                      <label>Qty <input class="rh-in qty" type="number" step="any" min="0.001" data-rh="iqty" data-i="${i}" value="${fmtQty(it.quantity)}"></label>
                      <label>Line £ <input class="rh-in price" type="number" step="0.01" data-rh="iprice" data-i="${i}" value="${(parseFloat(it.price) || 0).toFixed(2)}"></label>
                      <span data-each="${i}">${money((parseFloat(it.price) || 0) / (it.quantity || 1))} each</span>
                      <select class="rh-in" data-rh="icat" data-i="${i}">${categoryOptions(it.category)}</select>
                    </div></div>`).join('')}
                <div class="rh-foot">
                  <button type="button" class="rh-add" data-rh="iadd">+ Add item</button>
                  <span class="rh-sum" data-sum>Total ${money(sum)}</span>
                </div>
                <p class="rh-meta" style="padding-top:4px">The receipt total becomes the sum of the items.</p>
                ${S.error ? `<p class="rh-err">${esc(S.error)}</p>` : ''}
                <div class="rh-actions">
                  <button type="button" data-rh="save" data-v="${esc(r.created_at)}" style="background:var(--sp-ink);color:var(--sp-bg);border-color:var(--sp-ink)" ${S.saving ? 'disabled' : ''}>${S.saving ? 'Saving…' : 'Save changes'}</button>
                  <button type="button" data-rh="cancel">Cancel</button>
                </div>
            </div>`;
        }

        async function ensureItems(ca) {
            if (!S.items[ca]) S.items[ca] = await fetch(itemsUrl(ca)).then(r => r.json());
            return S.items[ca];
        }

        async function startEdit(ca) {
            const r = find(ca);
            S.editing = ca; S.error = ''; S.draft = null; render();
            const items = await ensureItems(ca);
            S.draft = {
                place_name: r.place_name, date: day(r.date), trip_name: r.trip_name || '',
                items: items.map(i => ({ name: i.item_name, quantity: parseFloat(i.quantity) || 1, price: parseFloat(i.item_price) || 0, category: i.category })),
            };
            S.focus = true;
            render();
        }

        async function saveEdit(ca) {
            const d = S.draft;
            S.saving = true; S.error = ''; render();
            try {
                const res = await fetch(receiptUrl(ca), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ place_name: d.place_name, date: d.date, trip_name: d.trip_name, items: d.items }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.error) throw new Error(data.error || 'Couldn’t save the changes.');
                delete S.items[ca];
                S.editing = null; S.draft = null; S.expanded = ca;
                S.saving = false;
                await load();
                await ensureItems(ca); render();
                if (opts.onChange) opts.onChange();
            } catch (e) {
                S.saving = false;
                S.error = e.message === 'Failed to fetch' ? 'Connection problem — nothing was changed, try again.' : e.message;
                render();
            }
        }

        el.addEventListener('click', async e => {
            const b = e.target.closest('[data-rh]');
            if (!b) return;
            const act = b.dataset.rh, v = b.dataset.v;
            if (act === 'toggle') {
                if (S.editing === v) return;
                S.expanded = S.expanded === v ? null : v; S.editing = null; S.draft = null;
                render();
                if (S.expanded) { await ensureItems(v); render(); }
            }
            if (act === 'trip') { const k = v.toLowerCase(); S.openTrip = S.openTrip === k ? null : k; S.expanded = null; S.editing = null; render(); }
            if (act === 'photo') viewPhoto(v);
            if (act === 'edit') startEdit(v);
            if (act === 'cancel') { S.editing = null; S.draft = null; S.error = ''; render(); }
            if (act === 'save') saveEdit(v);
            if (act === 'iadd') { S.draft.items.push({ name: '', quantity: 1, price: 0, category: S.categories.includes('Other') ? 'Other' : (S.categories[0] || 'Other') }); render(); }
            if (act === 'idel') { S.draft.items.splice(Number(b.dataset.i), 1); render(); }
            if (act === 'delete') {
                const ok = await showModal({ title: 'Delete receipt', message: 'This removes the receipt and all its items.', type: 'confirm', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
                if (!ok) return;
                await fetch(receiptUrl(v), { method: 'DELETE' });
                delete S.items[v]; S.expanded = null;
                await load();
                if (opts.onChange) opts.onChange();
            }
        });
        // Typing updates the draft without re-rendering (so the cursor stays put); totals refresh on change.
        el.addEventListener('input', e => {
            const t = e.target, act = t.dataset.rh;
            if (act === 'filter') { S.filter = t.value; render(); return; }
            if (!S.draft) return;
            const it = S.draft.items[Number(t.dataset.i)];
            if (act === 'place') S.draft.place_name = t.value;
            if (act === 'date') S.draft.date = t.value;
            if (act === 'tripname') S.draft.trip_name = t.value;
            if (act === 'iname') it.name = t.value;
            if (act === 'iqty') it.quantity = parseFloat(t.value) > 0 ? parseFloat(t.value) : 1;
            if (act === 'iprice') it.price = round2(parseFloat(t.value) || 0);
            if (act === 'iqty' || act === 'iprice') {   // refresh the unit price and total in place
                const each = el.querySelector(`[data-each="${t.dataset.i}"]`);
                if (each) each.textContent = `${money(it.price / (it.quantity || 1))} each`;
                const sum = el.querySelector('[data-sum]');
                if (sum) sum.textContent = `Total ${money(S.draft.items.reduce((s2, x) => s2 + (parseFloat(x.price) || 0), 0))}`;
            }
        });
        el.addEventListener('change', e => {
            const t = e.target, act = t.dataset.rh;
            if (act === 'sort') { S.sort = t.value; render(); return; }
            if (!S.draft) return;
            if (act === 'icat') S.draft.items[Number(t.dataset.i)].category = t.value;
        });

        return { load };
    }

    window.ReceiptHistory = { mount };
})();
