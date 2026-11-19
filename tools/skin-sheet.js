// Renders contact sheets of the character cosmetics so they can be eyeballed (or screenshot-reviewed).
//   node tools/skin-sheet.js [outDir] [seed]
// Needs the game running (default http://localhost:3000, override with BASE_URL) and playwright.
// Writes faces / hats / accs / pats / colors sheets plus a "combo" sheet of random full outfits,
// because most visual bugs only show up when several things are worn at once.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || 'design-sheets');
const seed0 = parseInt(process.argv[3] || '7', 10);
const base = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await page.goto(base);
    const sheets = await page.evaluate((seed0) => {
        const res = {};
        const mk = (title, items, cols, cell) => {
            const rows = Math.ceil(items.length / cols);
            const sheet = document.createElement('canvas'); sheet.width = cols * cell; sheet.height = rows * cell;
            const tmp = document.createElement('canvas'); tmp.width = cell; tmp.height = cell; document.body.appendChild(tmp);
            const r = new Renderer(tmp);
            const g = sheet.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height);
            items.forEach((it, i) => {
                const skin = { face: 'classic', hat: 'none', acc: 'none', pat: 'none', ...it.skin };
                r.drawPortrait(skin, it.color || Skins.COLORS[0].hex, 1.2);
                const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
                g.drawImage(tmp, x, y);
                g.fillStyle = '#2b2140'; g.font = '11px sans-serif'; g.fillText(it.id, x + 6, y + 14);
            });
            tmp.remove();
            res[title] = sheet.toDataURL('image/png');
        };
        mk('faces', Skins.FACES.map(f => ({ id: f.id, skin: { face: f.id } })), 8, 170);
        mk('hats', Skins.HATS.map(f => ({ id: f.id, skin: { hat: f.id } })), 8, 170);
        mk('accs', Skins.ACCS.map(f => ({ id: f.id, skin: { acc: f.id } })), 8, 170);
        mk('pats', Skins.PATTERNS.map(f => ({ id: f.id, skin: { pat: f.id } })), 8, 170);
        mk('colors', Skins.COLORS.map(f => ({ id: f.id, color: f.hex })), 8, 170);
        let seed = seed0;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const combos = [];
        for (let i = 0; i < 32; i++) { const k = Skins.randomSkin(rnd); combos.push({ id: `${k.hat}+${k.acc}+${k.face}+${k.pat}`, color: k.color, skin: k }); }
        mk('combo', combos, 6, 225);
        return res;
    }, seed0);
    for (const [name, url] of Object.entries(sheets)) {
        fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
        console.log('wrote', path.join(out, `${name}.png`));
    }
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
