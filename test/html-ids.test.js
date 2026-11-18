const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('every element id the browser code looks up exists in index.html', () => {
    const missing = [];
    for (const f of fs.readdirSync(path.join(root, 'js')).filter(n => n.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
        for (const m of src.matchAll(/getElementById\('([^']+)'\)|new Renderer\('([^']+)'\)/g)) {
            const id = m[1] || m[2];
            if (!ids.has(id)) missing.push(`${f}: #${id}`);
        }
    }
    assert.deepEqual(missing, []);
});

test('every script the page loads exists, and every icon it asks for is defined', () => {
    for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
        const src = m[1];
        if (src.startsWith('/socket.io')) continue;
        const file = src.startsWith('shared/') ? path.join(__dirname, '..', src) : path.join(root, src);
        assert.ok(fs.existsSync(file), `missing script ${src}`);
    }
    const iconsSrc = fs.readFileSync(path.join(root, 'js', 'icons.js'), 'utf8');
    const defined = new Set([...iconsSrc.matchAll(/^\s{8}(\w+): \[/gm)].map(m => m[1]));
    const wanted = new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map(m => m[1]));
    for (const f of fs.readdirSync(path.join(root, 'js')).filter(n => n.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
        for (const m of src.matchAll(/(?:Icons\.(?:svg|set|draw|html)\([^,]*?,\s*|Icons\.svg\()'([a-z_]+)'/g)) wanted.add(m[1]);
        for (const m of src.matchAll(/icon: '([a-z_]+)'/g)) wanted.add(m[1]);
    }
    const unknown = [...wanted].filter(n => !defined.has(n));
    assert.deepEqual(unknown, [], `icons used but not defined: ${unknown}`);
});

test('the touch controls have everything touch.js binds', () => {
    for (const id of ['touch-controls', 'tc-pad', 'tc-jump', 'tc-push', 'tc-pull', 'tc-inhale', 'tc-power', 'tc-emote', 'tc-emotes', 'btn-fullscreen']) {
        assert.ok(ids.has(id), `missing #${id}`);
    }
    // four emote buttons in the panel, in the same order as the server's emotes
    const panel = html.match(/id="tc-emotes"[\s\S]*?<\/div>/)[0];
    assert.equal((panel.match(/<button/g) || []).length, 4);
});
