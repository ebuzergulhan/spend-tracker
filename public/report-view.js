// report-view.js — the report block used on the Reports page and on the Groceries / Out & About / Shopping
// dashboards: week / month / year switch, summary cards, a period-by-period table and a stacked bar chart.
// Needs report-logic.js (window.ReportLogic). Usage:
//   ReportView.mount(el, { section: 'outabout', onRange: (from, to, label) => … })   // one section, by category
//   ReportView.mount(el, { sectionToggles: true })                                     // every section (Reports page)
(function () {
    const RL = window.ReportLogic;

    const SECTION_COLORS = {
        groceries: 'var(--cat-groceries-dot)', shopping: 'var(--cat-shopping-dot)', outabout: 'var(--cat-outabout-dot)',
        transport: 'var(--cat-transport-dot)', fixed: 'var(--cat-fixed-dot)', subscriptions: 'var(--cat-subscriptions-dot)',
        bills: 'var(--cat-bills-dot)',
    };
    const SECTION_PAGES = { groceries: 'index.html', shopping: 'shopping.html', outabout: 'outabout.html', transport: 'transport.html',
        fixed: 'fixed.html', subscriptions: 'subscriptions.html', bills: 'bills.html' };
    // Categories inside a section: a colour-blind-checked palette, used in this fixed order (biggest category first).
    const CAT_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'];
    const OTHER_COLOR = '#a8a6a0';
    const PERIODS = [['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']];
    const WORDS = {
        week: { now: 'This week', prev: 'Last week', avg: 'Weekly average', unit: 'week', units: 'weeks' },
        month: { now: 'This month', prev: 'Last month', avg: 'Monthly average', unit: 'month', units: 'months' },
        year: { now: 'This year', prev: 'Last year', avg: 'Yearly average', unit: 'year', units: 'years' },
    };

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = n => '£' + (parseFloat(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const localToday = () => new Date().toLocaleDateString('en-CA');
    const store = {
        get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: settings just aren't remembered */ } },
    };

    function injectStyles() {
        if (document.getElementById('rv-styles')) return;
        const css = `
        .rv-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:14px; }
        .rv-seg { display:inline-flex; border:1px solid var(--sp-ink-15); border-radius:10px; overflow:hidden; background:var(--sp-paper); }
        .rv-seg button { font:inherit; font-size:13px; padding:7px 14px; border:0; background:none; color:var(--sp-ink-70); cursor:pointer; }
        .rv-seg button + button { border-left:1px solid var(--sp-ink-08); }
        .rv-seg button.on { background:var(--sp-ink); color:var(--sp-bg); font-weight:600; }
        .rv-select { font:inherit; font-size:13px; height:34px; padding:0 10px; border:1px solid var(--sp-ink-15); border-radius:10px; background:var(--sp-paper); color:var(--sp-ink); }
        .rv-chips { display:flex; flex-wrap:wrap; gap:6px; margin:-4px 0 14px; }
        .rv-chip { font:inherit; font-size:12px; display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px;
                   border:1px solid var(--sp-ink-15); background:var(--sp-paper); color:var(--sp-ink); cursor:pointer; }
        .rv-chip.off { color:var(--sp-ink-30); background:transparent; text-decoration:line-through; }
        .rv-chip.off .rv-dot { opacity:.3; }
        .rv-dot { width:9px; height:9px; border-radius:999px; flex-shrink:0; display:inline-block; }
        .rv-kpis { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; margin-bottom:16px; }
        @media (max-width: 900px) { .rv-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); } }
        .rv-kpis .sp-kpi { padding:14px; min-width:0; }
        .rv-kpis .sp-kpi-value { font-size:22px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .rv-kpis .sp-kpi-sub { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rv-card { margin-bottom:16px; }
        .rv-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table.rv-tbl { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
        .rv-tbl th { font-size:11px; font-weight:600; color:var(--sp-ink-50); padding:8px 10px; text-align:right; white-space:nowrap; }
        .rv-tbl th:first-child, .rv-tbl td:first-child { text-align:left; position:sticky; left:0; background:var(--sp-paper); z-index:1; }
        .rv-tbl td { font-size:13px; padding:9px 10px; text-align:right; white-space:nowrap; border-top:1px solid var(--sp-ink-04); color:var(--sp-ink); }
        .rv-tbl tbody tr { cursor:pointer; }
        .rv-tbl tbody tr:hover td { background:var(--sp-panel); }
        .rv-tbl tbody tr.sel td { background:var(--sp-ink-08); }
        .rv-tbl td.zero { color:var(--sp-ink-30); }
        .rv-tbl td.neg { color:var(--sp-down); }
        .rv-tbl .tot { font-weight:700; }
        .rv-tbl tfoot td { font-weight:600; background:var(--sp-panel); border-top:2px solid var(--sp-ink-08); }
        .rv-tbl tfoot td:first-child { background:var(--sp-panel); }
        .rv-tbl th .rv-dot { margin-right:5px; vertical-align:middle; }
        .rv-now { font-size:10px; font-weight:600; color:var(--sp-ink-50); margin-left:6px; }
        .rv-bars { display:flex; flex-direction:column; gap:10px; }
        .rv-bar { display:grid; grid-template-columns:118px 1fr 84px; gap:10px; align-items:center; cursor:pointer; }
        @media (max-width: 600px) { .rv-bar { grid-template-columns:86px 1fr 72px; } }
        .rv-bar-label { font-size:12px; color:var(--sp-ink-70); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rv-bar.sel .rv-bar-label { color:var(--sp-ink); font-weight:600; }
        .rv-track { height:14px; }
        .rv-fill { height:100%; display:flex; gap:2px; border-radius:0 4px 4px 0; overflow:hidden; min-width:0; }
        .rv-seg-fill { height:100%; min-width:2px; }
        .rv-bar-total { font-size:12px; font-weight:600; text-align:right; color:var(--sp-ink); font-variant-numeric:tabular-nums; }
        .rv-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:14px; padding-top:12px; border-top:1px solid var(--sp-ink-04); }
        .rv-legend span { font-size:12px; color:var(--sp-ink-70); display:inline-flex; align-items:center; gap:6px; }
        .rv-note { font-size:12px; color:var(--sp-ink-50); margin:10px 0 0; }
        .rv-tip { position:fixed; z-index:60; pointer-events:none; background:var(--sp-ink); color:var(--sp-bg); font-size:12px; line-height:1.4;
                  padding:6px 9px; border-radius:8px; max-width:240px; box-shadow:0 4px 14px rgba(0,0,0,.18); }
        .rv-lists { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        @media (max-width: 767px) { .rv-lists { grid-template-columns:1fr; } }
        .rv-li { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 80px; gap:10px; align-items:center; margin-bottom:10px; }
        .rv-li-name { font-size:13px; color:var(--sp-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .rv-li-sub { font-size:11px; color:var(--sp-ink-50); }
        .rv-li-track { height:6px; border-radius:999px; background:var(--sp-ink-08); overflow:hidden; }
        .rv-li-track span { display:block; height:100%; border-radius:0 4px 4px 0; }
        .rv-li-val { font-size:13px; font-weight:500; text-align:right; font-variant-numeric:tabular-nums; }
        .rv-empty { font-size:13px; color:var(--sp-ink-50); text-align:center; padding:20px 0; }
        .rv-selbar { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--sp-ink-70); margin:-6px 0 12px; }
        .rv-selbar button { font:inherit; font-size:12px; border:0; background:none; color:var(--sp-ink); text-decoration:underline; cursor:pointer; padding:0; }
        `;
        const style = document.createElement('style');
        style.id = 'rv-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // One floating tooltip for every chart on the page.
    let tipEl = null, tipTimer = null;
    function showTip(text, x, y) {
        if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'rv-tip'; document.body.appendChild(tipEl); }
        tipEl.innerHTML = text;
        tipEl.hidden = false;
        const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
        tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 12)) + 'px';
        tipEl.style.top = Math.max(8, y - h - 12) + 'px';
    }
    function hideTip() { if (tipEl) tipEl.hidden = true; }

    function mount(el, opts = {}) {
        injectStyles();
        const section = opts.section || null;
        const key = 'report-view:' + (section || 'all');
        const saved = store.get(key) || {};
        const state = {
            period: ['week', 'month', 'year'].includes(saved.period) ? saved.period : 'month',
            show: [6, 12, 24, 0].includes(saved.show) ? saved.show : 12,
            hidden: new Set(Array.isArray(saved.hidden) ? saved.hidden : []),
            selected: null,          // a clicked period row narrows the lists below to that period
            data: null, error: null,
        };
        const save = () => store.set(key, { period: state.period, show: state.show, hidden: [...state.hidden] });

        el.innerHTML = '<div class="rv-empty">Loading report…</div>';
        fetch('/report/data' + (section ? '?section=' + encodeURIComponent(section) : ''))
            .then(r => r.json())
            .then(d => { if (d.error) throw new Error(d.error); state.data = d; render(); })
            .catch(() => { el.innerHTML = '<div class="rv-empty">Couldn’t load the report — refresh to try again.</div>'; });

        function colorFor(col, i) {
            if (!section) return SECTION_COLORS[col.key];
            if (col.negative || col.adjustment) return null;
            if (col.key === RL.OTHER) return OTHER_COLOR;
            return CAT_PALETTE[i] || OTHER_COLOR;
        }

        function render() {
            const today = state.data.today || localToday();
            const rep = RL.buildReport(state.data, { period: state.period, today, section });
            const words = WORDS[state.period];
            // Colours follow the column (category / section), never its position in the current view.
            const allCols = rep.columns.map((c, i) => ({ ...c, color: colorFor(c, i) }));
            const rows = state.show ? rep.rows.slice(0, state.show) : rep.rows;
            const activeCols = allCols.filter(c => !state.hidden.has(c.key));
            const cols = activeCols.filter(c => rows.some(r => r.values[c.key]));   // skip columns that are empty in this view
            const rowTotal = r => Math.round(cols.reduce((s, c) => s + (r.values[c.key] || 0), 0) * 100) / 100;
            if (state.selected && !rows.some(r => r.key === state.selected)) state.selected = null;

            const current = rep.rows.find(r => r.current) || rep.rows[0];
            const idx = rep.rows.indexOf(current);
            const prev = rep.rows[idx + 1], before = rep.rows[idx + 2];
            const complete = rows.filter(r => !r.current && r.key < current.key);
            const avg = complete.length ? complete.reduce((s, r) => s + rowTotal(r), 0) / complete.length : null;
            let top = null;
            for (const c of cols) if (!c.negative && !c.adjustment && (current.values[c.key] || 0) > 0 && (!top || current.values[c.key] > current.values[top.key])) top = c;

            const delta = (a, b) => {
                if (!b) return '';
                const pct = Math.round((a - b) / b * 100);
                if (!pct) return `<span class="sp-kpi-delta">same as ${esc(before.label)}</span>`;
                return `<span class="sp-kpi-delta sp-kpi-delta--${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${esc(before.label)}</span>`;
            };
            const kpi = (label, value, sub) => `<div class="sp-kpi"><div class="sp-kpi-label">${label}</div><div class="sp-kpi-value">${value}</div>${sub ? `<div class="sp-kpi-sub">${sub}</div>` : ''}</div>`;
            const kpis = [
                kpi(`${words.now} <span style="opacity:.6">(${esc(current.label)})</span>`, money(rowTotal(current)),
                    section ? `${current.count} receipt${current.count === 1 ? '' : 's'} so far` : 'so far'),
                prev ? kpi(`${words.prev} <span style="opacity:.6">(${esc(prev.label)})</span>`, money(rowTotal(prev)), delta(rowTotal(prev), before && rowTotal(before)))
                     : kpi(words.prev, '—', ''),
                kpi(words.avg, avg == null ? '—' : money(avg), complete.length ? `over the last ${complete.length} complete ${complete.length === 1 ? words.unit : words.units}` : 'not enough history yet'),
                kpi(section ? `Top category this ${words.unit}` : `Biggest this ${words.unit}`,
                    top ? esc(top.label) : '—', top ? money(current.values[top.key]) : 'nothing yet'),
            ].join('');

            const controls = `
                <div class="rv-controls">
                  <div class="rv-seg" role="group" aria-label="Group by">${PERIODS.map(([k, l]) => `<button type="button" data-rv="period" data-v="${k}" class="${k === state.period ? 'on' : ''}">${l}</button>`).join('')}</div>
                  <select class="rv-select" data-rv="show" aria-label="How far back">
                    ${[6, 12, 24, 0].map(v => `<option value="${v}" ${v === state.show ? 'selected' : ''}>${v ? `Last ${v} ${words.units}` : 'Everything'}</option>`).join('')}
                  </select>
                </div>
                ${opts.sectionToggles ? `<div class="rv-chips">${allCols.map(c => `<button type="button" class="rv-chip ${state.hidden.has(c.key) ? 'off' : ''}" data-rv="toggle" data-v="${esc(c.key)}"
                    aria-pressed="${!state.hidden.has(c.key)}"><span class="rv-dot" style="background:${c.color}"></span>${esc(c.label)}</button>`).join('')}</div>` : ''}`;

            const colHead = c => {
                const label = !section && SECTION_PAGES[c.key] ? `<a href="${SECTION_PAGES[c.key]}" style="color:inherit;text-decoration:none">${esc(c.label)}</a>` : esc(c.label);
                return `<th>${c.color ? `<span class="rv-dot" style="background:${c.color}"></span>` : ''}${label}</th>`;
            };
            const cell = v => `<td class="${!v ? 'zero' : v < 0 ? 'neg' : ''}">${v ? money(v) : '—'}</td>`;
            const shownTotals = cols.map(c => rows.reduce((s, r) => s + (r.values[c.key] || 0), 0));
            const grand = shownTotals.reduce((a, b) => a + b, 0);
            const table = rows.length ? `
                <div class="rv-scroll"><table class="rv-tbl">
                  <thead><tr><th>${words.unit[0].toUpperCase() + words.unit.slice(1)}</th>${cols.map(colHead).join('')}<th>Total</th></tr></thead>
                  <tbody>${rows.map(r => `<tr data-rv="row" data-v="${r.key}" class="${r.key === state.selected ? 'sel' : ''}">
                      <td>${esc(r.label)}${r.current ? '<span class="rv-now">so far</span>' : ''}</td>
                      ${cols.map(c => cell(r.values[c.key])).join('')}
                      <td class="tot">${money(rowTotal(r))}</td></tr>`).join('')}</tbody>
                  <tfoot>
                    <tr><td>Total</td>${shownTotals.map(v => `<td>${money(v)}</td>`).join('')}<td>${money(grand)}</td></tr>
                    <tr><td>Average</td>${shownTotals.map(v => `<td>${money(v / rows.length)}</td>`).join('')}<td>${money(grand / rows.length)}</td></tr>
                  </tfoot>
                </table></div>` : '<div class="rv-empty">No spending yet.</div>';

            // Stacked bars: only the spending parts (discounts / adjustments are in the table, not drawn).
            const drawn = cols.filter(c => c.color);
            const posSum = r => drawn.reduce((s, c) => s + Math.max(0, r.values[c.key] || 0), 0);
            const max = Math.max(...rows.map(posSum), 0.01);
            const bars = `<div class="rv-bars">${rows.map(r => {
                const segs = drawn.filter(c => (r.values[c.key] || 0) > 0).map(c => {
                    const v = r.values[c.key];
                    const tip = `<strong>${esc(c.label)}</strong><br>${esc(r.label)} · ${money(v)} (${Math.round(v / (rowTotal(r) || v) * 100)}%)`;
                    return `<div class="rv-seg-fill" style="flex:${v} 1 0;background:${c.color}" data-tip="${esc(tip)}"></div>`;
                }).join('');
                return `<div class="rv-bar ${r.key === state.selected ? 'sel' : ''}" data-rv="row" data-v="${r.key}">
                    <span class="rv-bar-label">${esc(r.label)}</span>
                    <div class="rv-track"><div class="rv-fill" style="width:${(posSum(r) / max * 100).toFixed(2)}%">${segs}</div></div>
                    <span class="rv-bar-total">${money(rowTotal(r))}</span></div>`;
            }).join('')}</div>`;
            const legend = drawn.length > 1 ? `<div class="rv-legend">${drawn.map(c => `<span><span class="rv-dot" style="background:${c.color}"></span>${esc(c.label)}</span>`).join('')}</div>` : '';

            const notes = [];
            if (cols.some(c => c.adjustment)) notes.push(`“${RL.NOT_ITEMISED}” is the part of a receipt total its item lines don’t cover — usually an older scan that didn’t add up. Edit the receipt in History to fix it.`);
            if (!section) notes.push('Transport includes fuel. Home costs, subscriptions and instalments are counted at their monthly cost' + (state.period === 'week' ? ', spread evenly over the weeks.' : '.'));
            if (state.period === 'week' && section === 'shopping') notes.push('Instalments are spread evenly over the weeks.');
            if (rep.undated) notes.push(`${rep.undated} receipt${rep.undated === 1 ? ' has' : 's have'} no date, so ${rep.undated === 1 ? 'it isn’t' : 'they aren’t'} counted here.`);

            // Range for the lists below: the clicked period, or everything shown.
            const sel = rows.find(r => r.key === state.selected);
            const from = sel ? sel.from : (state.show && rows.length ? rows[rows.length - 1].from : null);
            const to = sel ? sel.to : null;
            const rangeLabel = sel ? sel.label : (state.show ? `last ${rows.length} ${rows.length === 1 ? words.unit : words.units}` : 'all time');

            let lists = '';
            if (section && (opts.showPlaces || opts.showCategories)) {
                const b = RL.breakdown(state.data.receipts[section], from, to);
                const list = (items, color, sub) => {
                    if (!items.length) return '<div class="rv-empty">Nothing in this period.</div>';
                    const m = Math.max(...items.map(i => i.total), 0.01);
                    return items.slice(0, 12).map(i => `<div class="rv-li"><div style="min-width:0"><div class="rv-li-name" title="${esc(i.name)}">${esc(i.name)}</div>${sub ? `<div class="rv-li-sub">${sub(i)}</div>` : ''}</div>
                        <div class="rv-li-track"><span style="width:${Math.max(0, i.total / m * 100).toFixed(1)}%;background:${color}"></span></div>
                        <div class="rv-li-val">${money(i.total)}</div></div>`).join('');
                };
                const secColor = `var(--cat-${section}-dot)`;
                lists = `<div class="rv-lists">
                    ${opts.showCategories ? `<div class="sp-card"><div class="sp-card-head"><div><h3 class="sp-card-title">By category</h3><div class="sp-card-sub">${esc(rangeLabel)}</div></div></div>
                        <div class="sp-card-body">${list(b.categories.filter(c => c.total > 0), secColor)}</div></div>` : ''}
                    ${opts.showPlaces ? `<div class="sp-card"><div class="sp-card-head"><div><h3 class="sp-card-title">By place</h3><div class="sp-card-sub">${esc(rangeLabel)} · ${b.count} receipt${b.count === 1 ? '' : 's'}</div></div></div>
                        <div class="sp-card-body">${list(b.places, secColor, i => `${i.count} visit${i.count === 1 ? '' : 's'}`)}</div></div>` : ''}
                </div>`;
            }

            el.innerHTML = `
                ${controls}
                <div class="rv-kpis">${kpis}</div>
                ${sel ? `<div class="rv-selbar">Showing details for <strong>${esc(sel.label)}</strong> <button type="button" data-rv="clear">Show all</button></div>` : ''}
                <div class="sp-card rv-card">
                  <div class="sp-card-head"><div><h3 class="sp-card-title">${section ? 'By category' : 'By section'}, ${words.unit} by ${words.unit}</h3>
                    <div class="sp-card-sub">Newest first · tap a row to see its details</div></div></div>
                  <div class="sp-card-body sp-card-body--flush" style="padding:6px 8px 8px">${table}</div>
                </div>
                <div class="sp-card rv-card">
                  <div class="sp-card-head"><div><h3 class="sp-card-title">Total per ${words.unit}</h3></div></div>
                  <div class="sp-card-body">${bars}${legend}${notes.map(t => `<p class="rv-note">${t}</p>`).join('')}</div>
                </div>
                ${lists}`;

            if (opts.onRange) opts.onRange(from, to, rangeLabel);
        }

        el.addEventListener('click', e => {
            const b = e.target.closest('[data-rv]');
            if (!b || !state.data) return;
            const act = b.dataset.rv, v = b.dataset.v;
            if (act === 'period' && v !== state.period) { state.period = v; state.selected = null; save(); render(); }
            if (act === 'toggle') { state.hidden.has(v) ? state.hidden.delete(v) : state.hidden.add(v); save(); render(); }
            if (act === 'row' && !e.target.closest('a')) { state.selected = state.selected === v ? null : v; render(); }
            if (act === 'clear') { state.selected = null; render(); }
        });
        el.addEventListener('change', e => {
            if (e.target.dataset.rv === 'show') { state.show = parseInt(e.target.value, 10) || 0; state.selected = null; save(); render(); }
        });
        el.addEventListener('pointermove', e => {
            const s = e.target.closest('[data-tip]');
            if (s) { clearTimeout(tipTimer); showTip(s.dataset.tip, e.clientX, e.clientY); } else hideTip();
        });
        el.addEventListener('pointerleave', hideTip);
        el.addEventListener('pointerdown', e => {   // touch: show the tip briefly
            const s = e.target.closest('[data-tip]');
            if (s && e.pointerType !== 'mouse') { showTip(s.dataset.tip, e.clientX, e.clientY); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 2500); }
        });

        return { reload() { fetch('/report/data' + (section ? '?section=' + encodeURIComponent(section) : '')).then(r => r.json()).then(d => { if (!d.error) { state.data = d; render(); } }).catch(() => {}); } };
    }

    window.ReportView = { mount };
})();
