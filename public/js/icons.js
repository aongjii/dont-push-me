// Our own icon set. Every icon is a small list of flat vector shapes on a 24x24 grid, drawn in
// the game's palette. The same definition renders as inline SVG (for the page) and onto a canvas
// (for things drawn in the game world), so there are no emoji anywhere in the game.
//
// shape formats:
//   ['p', pathData,        fill, stroke, strokeWidth]
//   ['c', cx, cy, r,       fill, stroke, strokeWidth]
//   ['e', cx, cy, rx, ry,  fill, stroke, strokeWidth]
//   ['r', x, y, w, h, rx,  fill, stroke, strokeWidth]
// fill / stroke may be null.
const Icons = (() => {
    const K = '#2B2140';   // ink
    const P = '#FF7EA8';   // pink
    const B = '#5BB8FF';   // blue
    const Y = '#FFC93C';   // yellow
    const G = '#4CC38A';   // green
    const R = '#FF6B6B';   // red
    const O = '#FF8A4C';   // orange
    const W = '#FFFFFF';
    const L = '#C8D4EA';   // light grey-blue
    const D = '#7B7894';   // muted
    const M = '#7A2E48';   // mouth

    const DEFS = {
        // ---- powers & actions
        fire: [
            ['p', 'M12 2.2C12.8 6 18 8 18 14.2A6 6 0 0 1 6 14.2C6 11.4 7.8 9.8 8.8 7.6C9.4 9 10.2 9.6 11 9.6C11.6 7 11 4.6 12 2.2Z', O, K, 1.4],
            ['p', 'M12 21.2A3.3 3.3 0 0 1 8.7 17.9C8.7 15.6 10.9 14.6 12 12.4C13.1 14.6 15.3 15.6 15.3 17.9A3.3 3.3 0 0 1 12 21.2Z', Y, null, 0]
        ],
        ice: [
            ['p', 'M12 3V21M4.2 7.5L19.8 16.5M4.2 16.5L19.8 7.5', null, B, 2.2],
            ['p', 'M9.4 4.8L12 7.4L14.6 4.8M9.4 19.2L12 16.6L14.6 19.2M3.6 11.2L7.2 10.6L6.2 7.2M20.4 12.8L16.8 13.4L17.8 16.8M3.6 12.8L7.2 13.4L6.2 16.8M20.4 11.2L16.8 10.6L17.8 7.2', null, B, 1.6],
            ['c', 12, 12, 2, W, B, 1.6]
        ],
        spin: [
            ['p', 'M12 12C12 9.6 14.6 9 15.8 10.6C17.4 12.8 15.6 16 12.4 16.4C8.6 16.8 6 13.6 6.6 10C7.2 6 11.4 4 15 5C17.4 5.6 19.4 7.4 20.2 9.6', null, P, 2.6],
            ['p', 'M17.2 8.4L22.8 7.8L20.8 13.4Z', P, null, 0]
        ],
        wings: [
            ['p', 'M2.4 16.2C3 9.2 8 4.6 14.4 4.2L21.8 3.4C21.2 8.4 19.8 11 17.8 12.6C19.2 12.6 20.2 12.2 21.2 11.6C20.2 15.4 17.2 17.8 13.6 18.4C14.8 18.6 15.6 18.6 16.6 18.4C14.6 21 10.6 21.4 7.2 20C4.8 19 3.2 17.8 2.4 16.2Z', W, '#8FA3C8', 1.6],
            ['p', 'M5.4 15.6C8.6 13.6 12.4 9.4 16 6.2M8.6 18.2C11.6 16.4 15 13.4 18 10.4', null, L, 1.5]
        ],
        shield: [
            ['p', 'M12 2.4L20 5.4V11.6C20 16.4 16.6 20 12 21.8C7.4 20 4 16.4 4 11.6V5.4Z', B, K, 1.6],
            ['p', 'M12 5.6L16.6 7.4V11.6C16.6 14.4 14.8 16.6 12 17.8Z', W, null, 0]
        ],
        dash: [
            ['p', 'M13.6 2L5 13.4H10.6L9.4 22L19 10H13Z', Y, K, 1.5],
            ['p', 'M2.4 8H5.6M1.6 12H4.4M2.4 16H5.6', null, B, 1.6]
        ],
        inhale: [
            ['c', 12, 12, 9.6, P, K, 1.5],
            ['e', 8.4, 9.6, 1.3, 2.1, K, null, 0],
            ['e', 15.6, 9.6, 1.3, 2.1, K, null, 0],
            ['e', 5.4, 13.2, 1.7, 1.1, '#F05C8A', null, 0],
            ['e', 18.6, 13.2, 1.7, 1.1, '#F05C8A', null, 0],
            ['e', 12, 15.6, 3.5, 3.2, M, null, 0],
            ['e', 12, 17.1, 2, 1.1, '#FF8FA8', null, 0]
        ],
        push: [
            ['p', 'M12 1.8L14.6 8L21 5.6L17.2 11.4L22.4 14.6L15.6 15L16.4 21.8L12 16.8L7.6 21.8L8.4 15L1.6 14.6L6.8 11.4L3 5.6L9.4 8Z', Y, K, 1.4],
            ['c', 12, 12.4, 3, O, null, 0]
        ],
        pull: [
            ['p', 'M5 20V11A7 7 0 0 1 19 11V20H14.6V11A2.6 2.6 0 0 0 9.4 11V20Z', R, K, 1.5],
            ['r', 5, 16, 4.4, 4, 0.6, W, K, 1.5],
            ['r', 14.6, 16, 4.4, 4, 0.6, W, K, 1.5],
            ['p', 'M2.5 3.5L4.6 5.6M21.5 3.5L19.4 5.6M12 1.5V4.4', null, B, 1.8]
        ],
        lever: [
            ['r', 3, 18, 18, 3.6, 1.4, D, K, 1.4],
            ['p', 'M12 18L17.6 7.4', null, K, 2.6],
            ['c', 17.6, 6.6, 3.2, R, K, 1.4]
        ],
        star: [
            ['p', 'M12 2.2L14.9 8.6L21.8 9.3L16.6 13.9L18.1 20.8L12 17.3L5.9 20.8L7.4 13.9L2.2 9.3L9.1 8.6Z', Y, '#E8A317', 1.6],
            ['e', 9.6, 11.2, 0.9, 1.1, K, null, 0],
            ['e', 14.4, 11.2, 0.9, 1.1, K, null, 0],
            ['p', 'M10.4 13.8Q12 15.2 13.6 13.8', null, K, 1.1]
        ],
        apple: [
            ['p', 'M12 7.6C9 5.6 4.4 7.6 4.4 12.8C4.4 17.4 8 21.6 12 21.6C16 21.6 19.6 17.4 19.6 12.8C19.6 7.6 15 5.6 12 7.6Z', R, K, 1.4],
            ['p', 'M12 7.4C12 5.2 12.8 3.8 14 2.8', null, '#8A5A3A', 1.8],
            ['p', 'M13.4 5C15 3.2 17.4 3.4 18.6 4.2C17.6 6 15.4 6.4 13.4 5Z', G, K, 1.1],
            ['e', 8.4, 12, 1.2, 2.4, '#FF9A9A', null, 0]
        ],
        heart: [
            ['p', 'M12 21C5 15.8 2.6 12.4 2.6 8.8A5 5 0 0 1 12 6.6A5 5 0 0 1 21.4 8.8C21.4 12.4 19 15.8 12 21Z', R, K, 1.5],
            ['e', 7.6, 8.6, 1.5, 1, '#FFB0B0', null, 0]
        ],
        heart_empty: [
            ['p', 'M12 21C5 15.8 2.6 12.4 2.6 8.8A5 5 0 0 1 12 6.6A5 5 0 0 1 21.4 8.8C21.4 12.4 19 15.8 12 21Z', '#E7E1EF', '#B5AECB', 1.5]
        ],
        // ---- emotes
        laugh: [
            ['c', 12, 12, 9.8, Y, '#E8A317', 1.5],
            ['p', 'M6.4 10.2Q8.4 7.6 10.4 10.2M13.6 10.2Q15.6 7.6 17.6 10.2', null, K, 1.8],
            ['p', 'M6.4 13.4H17.6C17.6 17.2 15.2 19.4 12 19.4C8.8 19.4 6.4 17.2 6.4 13.4Z', M, K, 1.2],
            ['e', 12, 17.4, 2.6, 1.3, '#FF8FA8', null, 0],
            ['p', 'M3.4 11.6C2.2 12.8 2.2 14.2 3.4 15C4.6 14.2 4.6 12.8 3.4 11.6ZM20.6 11.6C19.4 12.8 19.4 14.2 20.6 15C21.8 14.2 21.8 12.8 20.6 11.6Z', B, null, 0]
        ],
        angry: [
            ['c', 12, 12, 9.8, R, '#C94B4B', 1.5],
            ['p', 'M5.6 7.2L10.4 9.6M18.4 7.2L13.6 9.6', null, K, 2.2],
            ['e', 8.4, 11.6, 1.4, 1.8, K, null, 0],
            ['e', 15.6, 11.6, 1.4, 1.8, K, null, 0],
            ['p', 'M8 17.6Q12 14.4 16 17.6', null, K, 2]
        ],
        wave: [
            ['p', 'M6.4 11.4V5.6A1.5 1.5 0 0 1 9.4 5.6V10.4M9.4 10.4V3.6A1.5 1.5 0 0 1 12.4 3.6V10.2M12.4 10.2V4.4A1.5 1.5 0 0 1 15.4 4.4V10.6M15.4 10.6V6.8A1.5 1.5 0 0 1 18.4 6.8V15.6C18.4 19 16 21.6 12.6 21.6C9.6 21.6 8 20 6.6 17.6L3.6 12.6A1.5 1.5 0 0 1 6 11C6.2 11.2 6.4 11.4 6.4 11.4Z', Y, '#C98A10', 1.5],
            ['p', 'M20.6 3.4Q22.4 5.6 21.4 8M2.8 6.4Q1.6 4.6 2.6 2.6', null, B, 1.6]
        ],
        skull: [
            ['p', 'M12 2.6C7 2.6 3.8 6 3.8 10.4C3.8 13.2 5.2 14.8 6.8 15.8V19.4H17.2V15.8C18.8 14.8 20.2 13.2 20.2 10.4C20.2 6 17 2.6 12 2.6Z', '#F4F1FA', K, 1.5],
            ['e', 8.6, 10.6, 2.2, 2.6, K, null, 0],
            ['e', 15.4, 10.6, 2.2, 2.6, K, null, 0],
            ['p', 'M12 13.4L10.6 16H13.4Z', K, null, 0],
            ['p', 'M9.4 19.4V16.8M12 19.4V17.4M14.6 19.4V16.8', null, K, 1.2]
        ],
        // ---- interface
        lock: [
            ['r', 5, 10.4, 14, 10.8, 2.4, Y, K, 1.6],
            ['p', 'M8 10.4V7.8A4 4 0 0 1 16 7.8V10.4', null, K, 2],
            ['c', 12, 15.4, 1.6, K, null, 0]
        ],
        crown: [
            ['p', 'M3 18.6L2.6 7.6L8 12.4L12 4.4L16 12.4L21.4 7.6L21 18.6Z', Y, '#E8A317', 1.6],
            ['r', 3, 18, 18, 3, 1, '#E8A317', null, 0],
            ['c', 12, 14.2, 1.5, R, null, 0]
        ],
        trophy: [
            ['p', 'M7 3H17V10A5 5 0 0 1 7 10Z', Y, '#E8A317', 1.6],
            ['p', 'M7 5H3.6C3.6 9 5 10.6 7.4 11M17 5H20.4C20.4 9 19 10.6 16.6 11', null, '#E8A317', 1.6],
            ['r', 10.6, 15, 2.8, 3.6, 0.4, '#E8A317', null, 0],
            ['r', 7.6, 18.6, 8.8, 2.8, 1, Y, '#E8A317', 1.4]
        ],
        clock: [
            ['c', 12, 13, 8.2, W, K, 1.8],
            ['p', 'M12 8.2V13L15.4 15M9.6 2.6H14.4', null, K, 1.9],
            ['p', 'M18.6 5.4L20.2 3.8', null, K, 1.9]
        ],
        wifi: [
            ['r', 3.6, 15.6, 3.6, 5, 1, G, null, 0],
            ['r', 9.9, 10.6, 3.6, 10, 1, G, null, 0],
            ['r', 16.2, 4.6, 3.6, 16, 1, G, null, 0]
        ],
        rocket: [
            ['p', 'M12 2.2C16 4.4 17.6 9 17 14L12 18.6L7 14C6.4 9 8 4.4 12 2.2Z', W, K, 1.5],
            ['c', 12, 9.4, 2.2, B, K, 1.3],
            ['p', 'M7 12.6L3.6 15.6L7.6 15.4ZM17 12.6L20.4 15.6L16.4 15.4Z', R, K, 1.2],
            ['p', 'M10 19.4Q12 23 14 19.4', O, null, 0]
        ],
        eyes: [
            ['e', 7.6, 12, 5.4, 6.8, W, K, 1.6],
            ['e', 16.4, 12, 5.4, 6.8, W, K, 1.6],
            ['e', 8.4, 12.8, 2.2, 3, K, null, 0],
            ['e', 15.6, 12.8, 2.2, 3, K, null, 0]
        ],
        door: [
            ['r', 4, 3, 11, 18, 1.4, '#C98B4B', K, 1.5],
            ['c', 11.8, 12.2, 1, Y, null, 0],
            ['p', 'M16 12H22M19.6 8.6L22.4 12L19.6 15.4', null, K, 2]
        ],
        book: [
            ['p', 'M3 5.4C6.6 4.4 9.6 4.8 12 6.6C14.4 4.8 17.4 4.4 21 5.4V19C17.4 18 14.4 18.4 12 20.2C9.6 18.4 6.6 18 3 19Z', '#E8F0FF', K, 1.5],
            ['p', 'M12 6.6V20.2', null, K, 1.4],
            ['p', 'M5.6 8.6Q8.4 8.2 10 9.4M5.6 11.6Q8.4 11.2 10 12.4M14 9.4Q15.6 8.2 18.4 8.6M14 12.4Q15.6 11.2 18.4 11.6', null, B, 1.3]
        ],
        shirt: [
            ['p', 'M8.6 3.2L2.6 6.6L5 11L7.6 9.6V20.6H16.4V9.6L19 11L21.4 6.6L15.4 3.2C14.8 5 13.6 5.8 12 5.8C10.4 5.8 9.2 5 8.6 3.2Z', B, K, 1.5]
        ],
        dice: [
            ['r', 3.4, 3.4, 17.2, 17.2, 4, W, K, 1.6],
            ['c', 8.2, 8.2, 1.6, K, null, 0],
            ['c', 15.8, 8.2, 1.6, K, null, 0],
            ['c', 12, 12, 1.6, K, null, 0],
            ['c', 8.2, 15.8, 1.6, K, null, 0],
            ['c', 15.8, 15.8, 1.6, K, null, 0]
        ],
        sound_on: [
            ['p', 'M3.4 9.4H7L12 5V19L7 14.6H3.4Z', K, K, 1.2],
            ['p', 'M15.4 8.8Q18 12 15.4 15.2M18 6.2Q22.2 12 18 17.8', null, K, 1.9]
        ],
        sound_off: [
            ['p', 'M3.4 9.4H7L12 5V19L7 14.6H3.4Z', K, K, 1.2],
            ['p', 'M15.6 9.4L21 14.6M21 9.4L15.6 14.6', null, R, 2.2]
        ],
        link: [
            ['p', 'M10 14L14 10', null, K, 2],
            ['p', 'M11.6 6.4L13.4 4.6A4.2 4.2 0 0 1 19.4 10.6L17.6 12.4', null, B, 2.4],
            ['p', 'M12.4 17.6L10.6 19.4A4.2 4.2 0 0 1 4.6 13.4L6.4 11.6', null, B, 2.4]
        ],
        kick: [
            ['c', 12, 12, 9, W, R, 2.2],
            ['p', 'M5.6 18.4L18.4 5.6', null, R, 2.4]
        ],
        chat: [
            ['p', 'M4 3.6H20A2 2 0 0 1 22 5.6V14.6A2 2 0 0 1 20 16.6H11.4L6.4 21V16.6H4A2 2 0 0 1 2 14.6V5.6A2 2 0 0 1 4 3.6Z', W, K, 1.6],
            ['c', 7.4, 10.1, 1.3, K, null, 0],
            ['c', 12, 10.1, 1.3, K, null, 0],
            ['c', 16.6, 10.1, 1.3, K, null, 0]
        ],
        check: [
            ['p', 'M4.6 12.6L9.8 17.6L19.4 6.8', null, G, 3]
        ],
        cross: [
            ['p', 'M6 6L18 18M18 6L6 18', null, K, 2.6]
        ],
        warn: [
            ['p', 'M12 3L22 20.6H2Z', Y, '#C98A10', 1.6],
            ['p', 'M12 9.4V14.4', null, K, 2.2],
            ['c', 12, 17.4, 1.2, K, null, 0]
        ],
        flag: [
            ['p', 'M5.4 21.6V3', null, K, 2],
            ['p', 'M6 3.6H18.6L16 8L18.6 12.4H6Z', P, K, 1.4]
        ],
        wind: [
            ['p', 'M2.6 8.4H14A2.8 2.8 0 1 0 11.6 5M2.6 13H18.4A3 3 0 1 1 15.8 17.6M2.6 17.6H8', null, B, 2.2]
        ],
        burst: [
            ['p', 'M12 2.4L14 8.4L20 6.6L16.6 12L21.6 15.6L15.4 15.8L15.8 22L12 17L8.2 22L8.6 15.8L2.4 15.6L7.4 12L4 6.6L10 8.4Z', Y, K, 1.4]
        ],
        // ---- touch-control arrows
        arrow_left: [
            ['p', 'M14.6 5L7.4 12L14.6 19', null, K, 3.2]
        ],
        arrow_right: [
            ['p', 'M9.4 5L16.6 12L9.4 19', null, K, 3.2]
        ],
        arrow_up: [
            ['p', 'M5 14.6L12 7.4L19 14.6', null, K, 3.2]
        ],
        keyboard: [
            ['r', 2.4, 6, 19.2, 12.4, 2.4, W, K, 1.6],
            ['r', 5, 8.6, 2.4, 2.2, 0.5, K, null, 0], ['r', 8.8, 8.6, 2.4, 2.2, 0.5, K, null, 0],
            ['r', 12.6, 8.6, 2.4, 2.2, 0.5, K, null, 0], ['r', 16.4, 8.6, 2.4, 2.2, 0.5, K, null, 0],
            ['r', 6.8, 12.2, 2.4, 2.2, 0.5, K, null, 0], ['r', 14.8, 12.2, 2.4, 2.2, 0.5, K, null, 0],
            ['r', 9.8, 14.8, 4.4, 1.8, 0.5, K, null, 0]
        ],
        fullscreen: [
            ['p', 'M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15', null, K, 2.4]
        ]
    };

    // ---- inline SVG for the page
    const NS = 'http://www.w3.org/2000/svg';

    function shapeToSvg(s) {
        const kind = s[0];
        const attrs = {};
        let tag, fill, stroke, sw;
        if (kind === 'p')      { tag = 'path';    attrs.d = s[1]; [fill, stroke, sw] = [s[2], s[3], s[4]]; }
        else if (kind === 'c') { tag = 'circle';  Object.assign(attrs, { cx: s[1], cy: s[2], r: s[3] }); [fill, stroke, sw] = [s[4], s[5], s[6]]; }
        else if (kind === 'e') { tag = 'ellipse'; Object.assign(attrs, { cx: s[1], cy: s[2], rx: s[3], ry: s[4] }); [fill, stroke, sw] = [s[5], s[6], s[7]]; }
        else                   { tag = 'rect';    Object.assign(attrs, { x: s[1], y: s[2], width: s[3], height: s[4], rx: s[5] }); [fill, stroke, sw] = [s[6], s[7], s[8]]; }
        attrs.fill = fill || 'none';
        if (stroke) {
            attrs.stroke = stroke;
            attrs['stroke-width'] = sw;
            attrs['stroke-linecap'] = 'round';
            attrs['stroke-linejoin'] = 'round';
        }
        return [tag, attrs];
    }

    function svg(name, size = 24) {
        const def = DEFS[name];
        const el = document.createElementNS(NS, 'svg');
        el.setAttribute('viewBox', '0 0 24 24');
        el.setAttribute('width', size);
        el.setAttribute('height', size);
        el.setAttribute('class', 'icon icon-' + name);
        el.setAttribute('aria-hidden', 'true');
        if (!def) return el;
        for (const s of def) {
            const [tag, attrs] = shapeToSvg(s);
            const node = document.createElementNS(NS, tag);
            for (const k in attrs) node.setAttribute(k, attrs[k]);
            el.appendChild(node);
        }
        return el;
    }

    // Replace every <i data-icon="name" data-size="20"> under root with the icon
    function hydrate(root) {
        (root || document).querySelectorAll('i[data-icon]').forEach(node => {
            const el = svg(node.dataset.icon, parseInt(node.dataset.size || '20', 10));
            if (node.className) el.setAttribute('class', el.getAttribute('class') + ' ' + node.className);
            node.replaceWith(el);
        });
    }

    // ---- canvas drawing (for things in the game world)
    const pathCache = {};
    function pathFor(d) { return pathCache[d] || (pathCache[d] = new Path2D(d)); }

    // Draw icon `name` with its centre at (x, y), `size` px wide.
    function draw(ctx, name, x, y, size = 24) {
        const def = DEFS[name];
        if (!def) return;
        const k = size / 24;
        ctx.save();
        ctx.translate(x - size / 2, y - size / 2);
        ctx.scale(k, k);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of def) {
            const kind = s[0];
            let fill, stroke, sw;
            ctx.beginPath();
            if (kind === 'p')      { fill = s[2]; stroke = s[3]; sw = s[4]; }
            else if (kind === 'c') { ctx.arc(s[1], s[2], s[3], 0, Math.PI * 2); [fill, stroke, sw] = [s[4], s[5], s[6]]; }
            else if (kind === 'e') { ctx.ellipse(s[1], s[2], s[3], s[4], 0, 0, Math.PI * 2); [fill, stroke, sw] = [s[5], s[6], s[7]]; }
            else                   { ctx.roundRect(s[1], s[2], s[3], s[4], s[5]); [fill, stroke, sw] = [s[6], s[7], s[8]]; }
            if (kind === 'p') {
                const path = pathFor(s[1]);
                if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
                if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(path); }
            } else {
                if (fill) { ctx.fillStyle = fill; ctx.fill(); }
                if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(); }
            }
        }
        ctx.restore();
    }

    // HTML string for use inside innerHTML-built content (names are fixed, so this is safe)
    function html(name, size = 18) {
        const wrap = document.createElement('span');
        wrap.appendChild(svg(name, size));
        return wrap.innerHTML;
    }

    // Put an icon inside an element, replacing whatever was there
    function set(el, name, size = 20) {
        el.replaceChildren(svg(name, size));
    }

    return { DEFS, svg, hydrate, draw, html, set, names: Object.keys(DEFS) };
})();
