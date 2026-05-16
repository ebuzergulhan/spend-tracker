const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');

// Each entry: [mojibake string, correct string]
// mojibake happened when PowerShell read UTF-8 files as CP1252
const fixes = [
    ['â€”', '—'],  // â€" → —  (em dash)
    ['â†’', '→'],  // â†' → →  (right arrow)
    ['Â£',       '£'],  // Â£  → £   (pound sign)
    ['â€™', '’'],  // â€™ → '  (right single quote)
    ['â€˜', '‘'],  // â€˜ → '  (left single quote)
    ['â€“', '–'],  // â€" → –  (en dash)
];

let count = 0;
fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(file => {
    const fp = path.join(dir, file);
    let content = fs.readFileSync(fp, 'utf8');
    let fixed = content;
    fixes.forEach(([bad, good]) => { fixed = fixed.split(bad).join(good); });
    if (fixed !== content) {
        fs.writeFileSync(fp, fixed, 'utf8');
        console.log('Fixed:', file);
        count++;
    }
});
console.log('Done. Fixed', count, 'files.');
