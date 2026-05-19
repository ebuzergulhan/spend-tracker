# Penny — Spectrum redesign handoff

This is the implementation guide for moving every page from the current purple-gradient design to the **Spectrum** design system. Read this top-to-bottom before touching code.

---

## What's in this folder

| File | Drop into | Purpose |
|---|---|---|
| `spectrum.css` | `public/spectrum.css` | Design tokens (CSS custom properties) + utility classes. The single source of truth for color, type, spacing, radii, and category palette. |
| `spectrum-shell.js` | `public/spectrum-shell.js` | Replaces `initSharedPage()`. Builds the left sidebar nav and top header. Exposes `initSpectrum()`, `fmt()`, `fmt0()`, `badge()`, `kpiCard()`. |
| `home-spectrum.html` | Use as **reference** for converting other pages — not a drop-in for `home.html` until you've migrated everything else. |
| `SPECTRUM-HANDOFF.md` | Keep in repo as `docs/` reference. |

The CSS does **not** replace Tailwind. Tailwind CDN stays — keep using `grid`, `gap-4`, `mb-6`, `flex` etc. for layout. Spectrum classes (`sp-*`) own the visual styling that used to live in custom `<style>` blocks.

---

## The big idea in one paragraph

The purple gradient header is gone, replaced by a **left sidebar nav grouped by purpose** (Overview · Spending · Recurring · Debt). Every spending category owns a single color across the entire app — Bills is teal everywhere, Transport is blue everywhere, etc. — defined once as CSS custom properties (`--cat-bills-dot`, `--cat-bills-bg`, `--cat-bills-fg`). Tabular numerals (`font-variant-numeric: tabular-nums`) on every money figure so columns align. Deltas with semantic color (rust for "up", green for "down") on every KPI. One confident ink color instead of a gradient. That's the whole system.

---

## Migration plan — ordered

Do these **in order**. Each step is independently shippable and the app keeps working between steps.

### Step 1 — Install tokens (1 file, 5 min)

1. Copy `spectrum.css` and `spectrum-shell.js` into `public/`.
2. Don't reference them yet — this step is just placement.

### Step 2 — Pick the pilot page (use `home.html` first)

Convert **one page** end-to-end before touching the others. `home.html` is recommended because:
- It's the smallest
- It exercises every component (KPIs, badges, category bars, list rows)
- It's the landing page, so visual impact is highest

Copy the structure from `home-spectrum.html`:

1. Replace the `<head>`:
   ```html
   <!-- DELETE -->
   <script src="https://cdn.tailwindcss.com"></script>
   <style>… gradient-bg, .card, .nav-btn, modalIn …</style>

   <!-- REPLACE WITH -->
   <script src="https://cdn.tailwindcss.com"></script>
   <link rel="stylesheet" href="spectrum.css"/>
   ```
2. Replace the `<body>` structure:
   ```html
   <!-- DELETE -->
   <body class="bg-gray-50">
     <div class="gradient-bg">… h1, p, #shared-nav …</div>
     <div class="max-w-5xl mx-auto px-6 -mt-8">…page content…</div>

   <!-- REPLACE WITH -->
   <body>
     <div class="sp-shell">
       <main class="sp-main">
         <div class="sp-body">
           …page content…
         </div>
       </main>
     </div>
   ```
3. Replace `initSharedPage('home')` with:
   ```js
   initSpectrum({
     active: 'home',
     title: 'Finance Home',
     subtitle: 'Your finances at a glance',
     period: 'May 2026',
     actions: `<a href="upcoming.html" class="sp-btn-ghost">Upcoming</a>
               <a href="index.html"    class="sp-btn-primary">+ Log expense</a>`,
   });
   ```
4. Replace each `.card` block with `<div class="sp-card">…</div>` (see Component Recipes below).

### Step 3 — Convert the rest, in this order

| Order | Page | Notes |
|---|---|---|
| 1 | `home.html` | Pilot. |
| 2 | `upcoming.html` | Reuses badge + date-pill components from home. |
| 3 | `bills.html` | First of the category-page family. Set the pattern. |
| 4 | `subscriptions.html`, `transport.html`, `fixed.html`, `shopping.html`, `outabout.html` | Same pattern as bills — should be near-mechanical. |
| 5 | `monthly.html` | Wide comparison table — replace the `.tbl` styles with `sp-table-*`. |
| 6 | `debts.html`, `loan.html` | Last — most custom layout. |
| 7 | `index.html` (Groceries) | The receipt scanner — most complex. |

### Step 4 — Delete dead code

After every page is migrated:

- Delete from each page's `<style>` block: `.gradient-bg`, `.card`, `.nav-btn`, `.tab-btn`, `@keyframes modalIn`. All replaced by `spectrum.css`.
- Delete the global `* { font-family: 'Inter' }` rule. `spectrum.css` sets body font.
- In `shared.js`, **keep** `fmt`, `formatDate`, `showModal` (the function); **delete** `initSharedPage` and the `#shared-nav` style injection. `initSpectrum` replaces it.
- In `shared.js`'s `showModal()`, change the classNames on the cancel/confirm buttons from `gradient-bg / border-gray-200` to `sp-btn-primary / sp-btn-ghost`.
- Delete `nav-demo.html` and `fix-quantities.html` if they're not in production use.

### Step 5 — Update theme color & manifest

In `shared.js`'s meta-tag injector:
```js
['meta', { name: 'theme-color', content: '#0f1115' }],  // was '#667eea'
```
Update `manifest.json`'s `theme_color` and `background_color` to `#0f1115` and `#fafaf7`.

---

## Token reference

All tokens are CSS custom properties on `:root`. Use these instead of hard-coded values.

### Surfaces
```
--sp-bg     #fafaf7   page background
--sp-paper  #ffffff   card/sidebar background
--sp-panel  #f4f2ec   sunken panels (date pills, dropzone)
```

### Ink (text + borders)
```
--sp-ink     #0f1115         body text
--sp-ink-70                  secondary text
--sp-ink-50                  tertiary text, labels
--sp-ink-30                  placeholder, disabled
--sp-ink-15                  borders
--sp-ink-08                  card borders, dividers
--sp-ink-04                  hover backgrounds, table stripes
```

### Semantic
```
--sp-up    rust    overspend / urgent / "went up" (negative for finance app)
--sp-down  green   saved / on track / "went down"
--sp-warn  amber   attention, soon-due
```
Each has a `*-bg` companion for chip backgrounds.

### Type
```
--sp-sans   Inter            UI (default on body)
--sp-mono   JetBrains Mono   ANY column of numbers, time codes, raw IDs
```

### Categories
Every category has 3 variables: `--cat-{key}-fg`, `--cat-{key}-bg`, `--cat-{key}-dot`.
Keys: `groceries`, `outabout`, `fixed`, `bills`, `transport`, `subscriptions`, `shopping`, `debts`.

**Rule:** any UI showing a category MUST use these. Don't write new hex codes for categories. If a new category is added, add it to both `spectrum.css` (the `:root` block) and `spectrum-shell.js` (`SPECTRUM_CATS`).

---

## Component recipes

### Sidebar + header
Already handled by `initSpectrum()`. Just wrap content in:
```html
<div class="sp-shell">
  <main class="sp-main">
    <div class="sp-body">…</div>
  </main>
</div>
```

### KPI card
```html
<div class="sp-kpi">
  <div class="sp-kpi-row">
    <div class="sp-kpi-label">This month</div>
    <div class="sp-kpi-delta sp-kpi-delta--up">+8.9%</div>
  </div>
  <div class="sp-kpi-value">£884.69</div>
  <div class="sp-kpi-sub">vs £812 in April</div>
</div>
```
Or build via JS:
```js
kpiCard({ label: 'This month', value: fmt(884.69), delta: '+8.9%', deltaTone: 'up', sub: 'vs £812 in April' })
```
Delta tones: `up` (rust), `down` (green), `warn` (amber), or omit for neutral grey.

### Card with header
```html
<div class="sp-card">
  <div class="sp-card-head">
    <div>
      <h3 class="sp-card-title">Recurring bills</h3>
      <div class="sp-card-sub">Auto-included in Upcoming each month</div>
    </div>
    <button class="sp-btn-ghost">+ Add</button>
  </div>
  <div class="sp-card-body">…</div>
</div>
```
For flush content (lists, tables) use `<div class="sp-card-body sp-card-body--flush">`.

### Category badge
```html
<span class="sp-badge" data-cat="bills">Bills</span>
<span class="sp-badge" data-cat="transport">Transport</span>
```
Or via JS: `badge('bills')`, `badge('outabout', 'Out & About')` (label optional). **The `data-cat` value must match a category key.**

### Category bar (in a breakdown list)
```html
<div style="height: 4px; background: var(--sp-ink-08); border-radius: 999px;">
  <div style="height: 100%; width: 42%; background: var(--cat-bills-dot); border-radius: 999px;"></div>
</div>
```
Always reference `var(--cat-{key}-dot)` — never a hex.

### Buttons
```html
<button class="sp-btn-primary">+ Log expense</button>
<button class="sp-btn-ghost">Export</button>
<button class="sp-pill">May 2026 ▾</button>
```

### Form fields
```html
<label class="sp-field-label">Bill name</label>
<input class="sp-input" placeholder="e.g. British Gas"/>

<label class="sp-field-label">Frequency</label>
<select class="sp-select">…</select>
```

### Table
```html
<div class="sp-table-head" style="grid-template-columns: 80px 1fr 1fr 100px;">
  <span>Date</span><span>Bill</span><span>Notes</span><span style="text-align:right">Amount</span>
</div>
<div class="sp-table-row" style="grid-template-columns: 80px 1fr 1fr 100px;">
  <span class="sp-mono" style="color:var(--sp-ink-50)">May 15</span>
  <span style="font-weight:500">TV License</span>
  <span style="color:var(--sp-ink-50)">Direct debit</span>
  <span class="sp-num" style="text-align:right;font-weight:600">£13.25</span>
</div>
```
The grid-template-columns goes on each row so they stay aligned. Use the same column template for head + rows.

### Money figures
Anywhere you render currency: wrap the number in a tabular-numerals helper.
```html
<span class="sp-num">£1,234.56</span>          <!-- inline -->
<span class="sp-mono">14:22</span>             <!-- mono for time codes / raw data -->
```

---

## Per-page conversion notes

### `home.html`
Replace 7-cell grid of `.card p-4` blocks with a single **Spending by category** card containing a stacked bar + breakdown list (see `home-spectrum.html`). Add a "Coming up" panel beside the total — reuses data from `/recurring`.

### `upcoming.html`
- Replace `.tab-btn` for "this/next month" with the period pill (`sp-pill`) — clicking opens a dropdown.
- "Month Breakdown" cards become category bars with split fills (recurring = solid, logged = 40% opacity).
- Payment rows: keep the date tile (44px square) but use `--sp-panel` background; urgency styled with `--sp-warn` for ≤7 days.

### `bills.html` (template for `subscriptions / transport / fixed / shopping / outabout`)
- KPI row: 4 cards instead of 2. Add "Next due" and "Annual total" to fill out the row meaningfully.
- "Log a Bill Payment" form moves to a side card (right) next to recurring list (left).
- History becomes a `sp-table-*` table.
- For each sibling page (subscriptions etc.), change `active: 'bills'` to the right key and swap the category accent — that's it.

### `monthly.html`
- The `.tbl` custom CSS goes away. Use `sp-table-head` + `sp-table-row`.
- Add category dots in the header row (see `page-monthly.jsx` in the design canvas).
- Highlight the latest month with `background: var(--sp-ink-04)` on its row.
- Stacked monthly bar chart on the right.

### `debts.html` & `loan.html`
- Hero card: remaining-to-pay big number + progress bar with monthly tick marks.
- Each debt becomes an `sp-card` with progress + a 6-payment mini-strip at the bottom.
- "Next payments" rail on the left sums across all debts.
- Foreign currency shown as a secondary line in `sp-mono`.

### `index.html` (Groceries)
- Three-column layout: scan/log card (left) · receipts table (centre) · subcategory donut (right).
- Receipt scan dropzone uses `--cat-groceries-bg` tint.
- Subcategory colors are an INTERNAL palette (within Groceries) — distinct from the top-level category palette. Define them inline or add `--gr-*` tokens to `spectrum.css` if you want them reusable.

---

## Things to NOT change

- The backend endpoints (`/summary/home`, `/recurring`, `/expense-log` etc.) — the design is purely a frontend change.
- The PWA setup (sw.js, manifest.json structure) — just update colors.
- `showModal()` API — keep the function signature, only the classNames on the buttons change.
- File names and routes — every page keeps its current URL.

---

## Prompt template for handing this to Claude Code

Use this prompt verbatim to start the migration:

> I have a design system in `public/spectrum.css` and `public/spectrum-shell.js`, plus a reference implementation at `public/home-spectrum.html` and full documentation at `docs/SPECTRUM-HANDOFF.md`. Read the handoff doc, then migrate `public/home.html` to use the new design system. Follow the file's existing structure for data loading (`/summary/home` endpoint, `SECTIONS` array, etc.) but replace all visual chrome with Spectrum components per the handoff. Don't change any backend calls. When done, delete unused CSS from the page's `<style>` block.

Then, page by page:

> Migrate `public/bills.html` to Spectrum, following the same approach you used for home.html. Refer to the "bills.html" notes in the handoff doc. Keep all existing backend calls (`/expense-log`, `/recurring`) unchanged.

---

## Quick sanity checks before merging each page

- [ ] No more `gradient-bg`, `.card`, `.nav-btn`, `text-purple-*` in the HTML
- [ ] All currency uses `class="sp-num"` or `class="sp-mono"`
- [ ] Every category-coloured element references `var(--cat-{key}-*)`, no hex codes
- [ ] Sidebar shows the right page as active
- [ ] KPI deltas have a tone class (`sp-kpi-delta--up/down/warn`)
- [ ] Page works at 768px width (sidebar collapses)
- [ ] No console errors

---

If anything in this doc is ambiguous, ask before guessing — consistency across pages is the whole point.
